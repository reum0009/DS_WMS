const express = require('express');
const { Op } = require('sequelize');
const { auth, roleAuth } = require('../middleware/auth');

const router = express.Router();

async function genNumber(prefix, field, transaction) {
  const { WarehouseTransfer } = global.sequelize.models;
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const pattern = `${prefix}-${ymd}-%`;
  const count = await WarehouseTransfer.count({ where: { [field]: { [Op.like]: pattern } }, transaction });
  return `${prefix}-${ymd}-${String(count + 1).padStart(4, '0')}`;
}

function toQty(value) {
  const qty = Number(value);
  return Number.isFinite(qty) ? Math.trunc(qty) : 0;
}

async function sumWarehouseStocks(productId, transaction) {
  const { ProductWarehouseStock } = global.sequelize.models;
  const rows = await ProductWarehouseStock.findAll({
    where: { productId },
    attributes: ['currentStock'],
    transaction,
  });
  return rows.reduce((sum, row) => sum + (Number(row.currentStock) || 0), 0);
}

async function syncProductCurrentStock(productId, transaction) {
  const { Product } = global.sequelize.models;
  const total = await sumWarehouseStocks(productId, transaction);
  await Product.update({ currentStock: total }, { where: { id: productId }, transaction });
  return total;
}

async function getWarehouseStockRow(product, warehouseId, transaction) {
  const { ProductWarehouseStock } = global.sequelize.models;
  const safetyStock = Number(product.safetyStock) || 0;
  const [row] = await ProductWarehouseStock.findOrCreate({
    where: { productId: product.id, warehouseId },
    defaults: {
      productId: product.id,
      warehouseId,
      currentStock: 0,
      safetyStock,
      manualSafetyStock: safetyStock,
    },
    transaction,
  });
  return row;
}

async function adjustWarehouseStock(product, warehouseId, delta, transaction) {
  const row = await getWarehouseStockRow(product, warehouseId, transaction);
  let before = Number(row.currentStock) || 0;

  if (delta < 0 && before < Math.abs(delta)) {
    const totalWarehouseStock = await sumWarehouseStocks(product.id, transaction);
    const legacyStock = Number(product.currentStock) || 0;

    if (totalWarehouseStock === before && before === 0 && legacyStock >= Math.abs(delta)) {
      before = legacyStock;
      await row.update({ currentStock: before }, { transaction });
    }
  }

  const after = before + delta;
  if (after < 0) {
    const name = product.productName || product.productCode || product.id;
    throw new Error(`재고 부족: ${name} (현재 ${before}, 필요 ${Math.abs(delta)})`);
  }

  await row.update({ currentStock: after }, { transaction });
  await syncProductCurrentStock(product.id, transaction);
  return { before, after };
}

async function ensureLegacyTransferOutApplied(transfer, transaction) {
  const { Product, StockHistory } = global.sequelize.models;
  const itemsByProduct = new Map();

  for (const item of transfer.items || []) {
    if (!itemsByProduct.has(item.productId)) itemsByProduct.set(item.productId, []);
    itemsByProduct.get(item.productId).push(item);
  }

  for (const [productId, productItems] of itemsByProduct.entries()) {
    const shippedQty = productItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    const appliedQty = Number(await StockHistory.sum('quantity', {
      where: {
        productId,
        type: 'outbound',
        reference: transfer.transferOutNumber,
        warehouseId: transfer.fromWarehouseId,
      },
      transaction,
    })) || 0;
    if (appliedQty >= shippedQty) continue;

    const legacyQty = Number(await StockHistory.sum('quantity', {
      where: {
        productId,
        type: 'outbound',
        reference: transfer.transferOutNumber,
        warehouseId: null,
      },
      transaction,
    })) || 0;
    if (legacyQty === 0) continue;

    const product = await Product.findByPk(productId, { transaction });
    if (!product) throw new Error('상품 정보를 찾을 수 없습니다');

    const remainingQty = shippedQty - appliedQty;
    const warehouseTotal = await sumWarehouseStocks(productId, transaction);
    const productStock = Number(product.currentStock) || 0;
    if (warehouseTotal - productStock < remainingQty) continue;

    const { before, after } = await adjustWarehouseStock(product, transfer.fromWarehouseId, -remainingQty, transaction);
    await StockHistory.create({
      productId,
      type: 'outbound',
      quantity: remainingQty,
      balanceBefore: before,
      balanceAfter: after,
      reference: transfer.transferOutNumber,
      referenceType: 'manual',
      userId: transfer.outUserId || transfer.inUserId || 1,
      warehouseId: transfer.fromWarehouseId,
      reason: '기존 창고간 이동 출고 재고 보정',
    }, { transaction });
  }
}

router.post('/', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  const transaction = await global.sequelize.transaction();

  try {
    const { WarehouseTransfer, WarehouseTransferItem, Product, StockHistory } = global.sequelize.models;
    const { fromWarehouseId, toWarehouseId, items, notes } = req.body;

    if (!fromWarehouseId || !toWarehouseId) {
      await transaction.rollback();
      return res.status(400).json({ error: '출발 창고와 도착 창고를 선택해주세요' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ error: '이동 품목이 없습니다' });
    }
    if (String(fromWarehouseId) === String(toWarehouseId)) {
      await transaction.rollback();
      return res.status(400).json({ error: '출발 창고와 도착 창고가 같습니다' });
    }

    const transferOutNumber = await genNumber('TO', 'transferOutNumber', transaction);
    const transfer = await WarehouseTransfer.create({
      transferOutNumber,
      fromWarehouseId,
      toWarehouseId,
      status: 'pending',
      notes: notes || null,
      outUserId: req.user.id,
      outAt: new Date(),
    }, { transaction });

    for (const item of items) {
      const productId = item.productId;
      const quantity = toQty(item.quantity);
      if (!productId || quantity <= 0) throw new Error('이동 품목 수량을 확인해주세요');

      const product = await Product.findByPk(productId, { transaction });
      if (!product) throw new Error('이동할 상품 정보를 찾을 수 없습니다');

      await WarehouseTransferItem.create({ transferId: transfer.id, productId, quantity }, { transaction });
      const { before, after } = await adjustWarehouseStock(product, fromWarehouseId, -quantity, transaction);

      await StockHistory.create({
        productId,
        type: 'outbound',
        quantity,
        balanceBefore: before,
        balanceAfter: after,
        reference: transferOutNumber,
        referenceType: 'inbound',
        userId: req.user.id,
        warehouseId: fromWarehouseId,
        reason: `창고간 이동 출고 -> ${toWarehouseId}`,
      }, { transaction });
    }

    await transaction.commit();
    res.status(201).json({ message: '창고간 출고 등록 완료', transferOutNumber, id: transfer.id });
  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ error: err.message });
  }
});

router.get('/', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { WarehouseTransfer, WarehouseTransferItem, Warehouse, User, Product } = global.sequelize.models;
    const { status, toWarehouseId, fromWarehouseId } = req.query;
    const where = {};

    if (status) where.status = status;
    if (toWarehouseId) where.toWarehouseId = toWarehouseId;
    if (fromWarehouseId) where.fromWarehouseId = fromWarehouseId;

    const list = await WarehouseTransfer.findAll({
      where,
      include: [
        { model: Warehouse, as: 'fromWarehouse', attributes: ['warehouseName'] },
        { model: Warehouse, as: 'toWarehouse', attributes: ['warehouseName'] },
        { model: User, as: 'outUser', attributes: ['name'] },
        { model: User, as: 'inUser', attributes: ['name'] },
        {
          model: WarehouseTransferItem,
          as: 'items',
          include: [{ model: Product, attributes: ['productName', 'specification', 'productCode', 'unit', 'barcode', 'currentStock'] }],
        },
      ],
      order: [['outAt', 'DESC']],
      limit: 200,
    });

    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/out/:number', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { WarehouseTransfer, WarehouseTransferItem, Warehouse, User, Product } = global.sequelize.models;

    const transfer = await WarehouseTransfer.findOne({
      where: { transferOutNumber: req.params.number },
      include: [
        { model: Warehouse, as: 'fromWarehouse', attributes: ['warehouseName'] },
        { model: Warehouse, as: 'toWarehouse', attributes: ['warehouseName'] },
        { model: User, as: 'outUser', attributes: ['name'] },
        { model: User, as: 'inUser', attributes: ['name'] },
        {
          model: WarehouseTransferItem,
          as: 'items',
          include: [{ model: Product, attributes: ['productName', 'specification', 'productCode', 'unit', 'barcode', 'currentStock'] }],
        },
      ],
    });

    if (!transfer) return res.status(404).json({ error: '출고번호를 찾을 수 없습니다' });
    res.json(transfer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  const transaction = await global.sequelize.transaction();

  try {
    const { WarehouseTransfer, WarehouseTransferItem, Product, StockHistory } = global.sequelize.models;
    const { items } = req.body;

    const transfer = await WarehouseTransfer.findByPk(req.params.id, {
      include: [{ model: WarehouseTransferItem, as: 'items' }],
      transaction,
    });

    if (!transfer) {
      await transaction.rollback();
      return res.status(404).json({ error: '이동 정보를 찾을 수 없습니다' });
    }
    if (transfer.status !== 'pending') {
      await transaction.rollback();
      return res.status(400).json({ error: '이동 중인 상태에서만 수정 가능합니다' });
    }

    for (const editItem of items || []) {
      const dbItem = transfer.items.find((i) => Number(i.id) === Number(editItem.id));
      if (!dbItem) continue;

      const newQuantity = toQty(editItem.quantity);
      if (newQuantity <= 0) throw new Error('이동 수량을 확인해주세요');

      const delta = newQuantity - dbItem.quantity;
      if (delta === 0) continue;

      const product = await Product.findByPk(dbItem.productId, { transaction });
      if (!product) throw new Error('상품 정보를 찾을 수 없습니다');

      const { before, after } = await adjustWarehouseStock(product, transfer.fromWarehouseId, -delta, transaction);
      await StockHistory.create({
        productId: dbItem.productId,
        type: delta > 0 ? 'outbound' : 'inbound',
        quantity: Math.abs(delta),
        balanceBefore: before,
        balanceAfter: after,
        reference: transfer.transferOutNumber,
        referenceType: 'manual',
        userId: req.user.id,
        warehouseId: transfer.fromWarehouseId,
        reason: `창고간 이동 수량 수정 (${delta > 0 ? '추가출고' : '회수'})`,
      }, { transaction });

      await dbItem.update({ quantity: newQuantity }, { transaction });
    }

    await transaction.commit();
    res.json({ message: '수정 완료' });
  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  const transaction = await global.sequelize.transaction();

  try {
    const { WarehouseTransfer, WarehouseTransferItem, Product, StockHistory } = global.sequelize.models;

    const transfer = await WarehouseTransfer.findByPk(req.params.id, {
      include: [{ model: WarehouseTransferItem, as: 'items' }],
      transaction,
    });

    if (!transfer) {
      await transaction.rollback();
      return res.status(404).json({ error: '이동 정보를 찾을 수 없습니다' });
    }
    if (transfer.status !== 'pending') {
      await transaction.rollback();
      return res.status(400).json({ error: '이동 중인 상태에서만 취소 가능합니다' });
    }

    for (const item of transfer.items) {
      const product = await Product.findByPk(item.productId, { transaction });
      if (!product) throw new Error('상품 정보를 찾을 수 없습니다');

      const { before, after } = await adjustWarehouseStock(product, transfer.fromWarehouseId, item.quantity, transaction);
      await StockHistory.create({
        productId: item.productId,
        type: 'inbound',
        quantity: item.quantity,
        balanceBefore: before,
        balanceAfter: after,
        reference: transfer.transferOutNumber,
        referenceType: 'manual',
        userId: req.user.id,
        warehouseId: transfer.fromWarehouseId,
        reason: '창고간 이동 취소 (재고 복구)',
      }, { transaction });
    }

    await transfer.update({ status: 'cancelled' }, { transaction });
    await transaction.commit();
    res.json({ message: '이동 취소 및 재고 복구 완료' });
  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/confirm', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  const transaction = await global.sequelize.transaction();

  try {
    const { WarehouseTransfer, WarehouseTransferItem, Product, StockHistory, Warehouse } = global.sequelize.models;
    const { receivedItems, notes } = req.body;

    const transfer = await WarehouseTransfer.findByPk(req.params.id, {
      include: [
        { model: WarehouseTransferItem, as: 'items', include: [{ model: Product }] },
        { model: Warehouse, as: 'fromWarehouse' },
        { model: Warehouse, as: 'toWarehouse' },
      ],
      transaction,
    });

    if (!transfer) {
      await transaction.rollback();
      return res.status(404).json({ error: '이동 정보를 찾을 수 없습니다' });
    }
    if (transfer.status === 'confirmed') {
      await transaction.rollback();
      return res.status(400).json({ error: '이미 입고 확정된 건입니다' });
    }
    if (transfer.status === 'cancelled') {
      await transaction.rollback();
      return res.status(400).json({ error: '취소된 건입니다' });
    }

    if (transfer.fromWarehouse?.deptId !== transfer.toWarehouse?.deptId) {
      await transaction.rollback();
      return res.status(403).json({ error: '다른 부서 창고로의 이동은 지원되지 않습니다' });
    }

    const transferInNumber = await genNumber('TI', 'transferInNumber', transaction);
    await ensureLegacyTransferOutApplied(transfer, transaction);

    for (const item of transfer.items) {
      const recv = receivedItems?.find((r) => Number(r.id) === Number(item.id));
      const recvQty = recv ? toQty(recv.receivedQuantity) : item.quantity;

      if (recvQty < 0 || recvQty > item.quantity) {
        throw new Error('입고 확정 수량을 확인해주세요');
      }

      await item.update({ receivedQuantity: recvQty }, { transaction });

      if (recvQty <= 0) continue;
      const product = item.Product;
      if (!product) throw new Error('입고 확정할 상품 정보를 찾을 수 없습니다');

      const { before, after } = await adjustWarehouseStock(product, transfer.toWarehouseId, recvQty, transaction);
      await StockHistory.create({
        productId: product.id,
        type: 'inbound',
        quantity: recvQty,
        balanceBefore: before,
        balanceAfter: after,
        reference: transferInNumber,
        referenceType: 'inbound',
        userId: req.user.id,
        warehouseId: transfer.toWarehouseId,
        reason: `창고간 이동 입고 (출고번호: ${transfer.transferOutNumber})`,
        notes: notes || null,
      }, { transaction });
    }

    await transfer.update({
      transferInNumber,
      status: 'confirmed',
      inUserId: req.user.id,
      inAt: new Date(),
    }, { transaction });

    await transaction.commit();
    res.json({
      message: '입고 확정 완료',
      transferInNumber,
      transferOutNumber: transfer.transferOutNumber,
      id: transfer.id,
    });
  } catch (err) {
    await transaction.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
