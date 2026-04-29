const express = require('express');
const { auth, roleAuth } = require('../middleware/auth');
const router = express.Router();

// ── 번호 자동 생성 ─────────────────────────────────────────────────
// prefix: 'TO' | 'TI', field: 'transferOutNumber' | 'transferInNumber'
async function genNumber(prefix, field) {
  const { WarehouseTransfer } = global.sequelize.models;
  const { Op } = require('sequelize');
  const d   = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const pattern = `${prefix}-${ymd}-%`;
  const count = await WarehouseTransfer.count({ where: { [field]: { [Op.like]: pattern } } });
  return `${prefix}-${ymd}-${String(count + 1).padStart(4, '0')}`;
}

// ────────────────────────────────────────────────────────────────────
// POST /  — 창고간 출고 등록 (TO 번호 생성, 재고 차감)
// ────────────────────────────────────────────────────────────────────
router.post('/', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { WarehouseTransfer, WarehouseTransferItem, Product, StockHistory } = global.sequelize.models;
    const { fromWarehouseId, toWarehouseId, items, notes } = req.body;

    if (!fromWarehouseId || !toWarehouseId)
      return res.status(400).json({ error: '출발 창고 / 도착 창고 필수' });
    if (!items || !Array.isArray(items) || !items.length)
      return res.status(400).json({ error: '이동 품목이 없습니다' });
    if (String(fromWarehouseId) === String(toWarehouseId))
      return res.status(400).json({ error: '출발과 도착 창고가 같습니다' });

    const transferOutNumber = await genNumber('TO', 'transferOutNumber');

    const transfer = await WarehouseTransfer.create({
      transferOutNumber,
      fromWarehouseId,
      toWarehouseId,
      status: 'pending',
      notes: notes || null,
      outUserId: req.user.id,
      outAt: new Date(),
    });

    for (const item of items) {
      const { productId, quantity } = item;
      if (!productId || !quantity || quantity <= 0) continue;

      await WarehouseTransferItem.create({ transferId: transfer.id, productId, quantity });

      // 출발 창고 재고 차감
      const product = await Product.findByPk(productId);
      if (product) {
        const before = product.currentStock || 0;
        const after  = Math.max(0, before - quantity);
        await product.update({ currentStock: after });
        await StockHistory.create({
          productId, type: 'outbound', quantity, balanceBefore: before, balanceAfter: after,
          reference: transferOutNumber, referenceType: 'inbound',
          userId: req.user.id, reason: `창고간 이동 출고 → ${toWarehouseId}`,
        });
      }
    }

    res.status(201).json({ message: '창고간 출고 등록 완료', transferOutNumber, id: transfer.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────
// GET /  — 이동 목록
// ────────────────────────────────────────────────────────────────────
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
        { model: Warehouse, as: 'toWarehouse',   attributes: ['warehouseName'] },
        { model: User,      as: 'outUser',       attributes: ['name'] },
        { model: User,      as: 'inUser',        attributes: ['name'] },
        { model: WarehouseTransferItem, as: 'items',
          include: [{ model: Product, attributes: ['productName','productCode','unit','barcode','currentStock'] }] },
      ],
      order: [['outAt', 'DESC']],
      limit: 200,
    });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────
// GET /out/:number  — 출고번호(TO-…)로 조회
// ────────────────────────────────────────────────────────────────────
router.get('/out/:number', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { WarehouseTransfer, WarehouseTransferItem, Warehouse, User, Product } = global.sequelize.models;

    const transfer = await WarehouseTransfer.findOne({
      where: { transferOutNumber: req.params.number },
      include: [
        { model: Warehouse, as: 'fromWarehouse', attributes: ['warehouseName'] },
        { model: Warehouse, as: 'toWarehouse',   attributes: ['warehouseName'] },
        { model: User,      as: 'outUser',       attributes: ['name'] },
        { model: User,      as: 'inUser',        attributes: ['name'] },
        { model: WarehouseTransferItem, as: 'items',
          include: [{ model: Product, attributes: ['productName','productCode','unit','barcode','currentStock'] }] },
      ],
    });

    if (!transfer) return res.status(404).json({ error: '출고번호를 찾을 수 없습니다' });
    res.json(transfer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────
// PUT /:id  — 창고간 이동 수정 (수량 변경, 재고 가감)
// ────────────────────────────────────────────────────────────────────
router.put('/:id', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { WarehouseTransfer, WarehouseTransferItem, Product, StockHistory } = global.sequelize.models;
    const { items } = req.body; // items: [{ id (item.id), quantity }]

    const transfer = await WarehouseTransfer.findByPk(req.params.id, {
      include: [{ model: WarehouseTransferItem, as: 'items' }]
    });

    if (!transfer) return res.status(404).json({ error: '이동 정보 없음' });
    if (transfer.status !== 'pending') return res.status(400).json({ error: '이동 중인 상태에서만 수정 가능합니다' });

    for (const editItem of items) {
      const dbItem = transfer.items.find(i => i.id === editItem.id);
      if (!dbItem) continue;

      const delta = editItem.quantity - dbItem.quantity; // delta > 0 이면 추가 출고 -> 재고 감소
      if (delta !== 0) {
        const product = await Product.findByPk(dbItem.productId);
        if (product) {
          if (product.currentStock < delta) return res.status(400).json({ error: `재고 부족: ${product.productName}` });
          const before = product.currentStock;
          const after  = before - delta;
          await product.update({ currentStock: after });

          await StockHistory.create({
            productId: dbItem.productId,
            type: delta > 0 ? 'outbound' : 'inbound',
            quantity: Math.abs(delta),
            balanceBefore: before,
            balanceAfter: after,
            reference: transfer.transferOutNumber,
            referenceType: 'manual',
            userId: req.user.id,
            reason: `창고간 이동 수량 수정 (${delta > 0 ? '추가출고' : '회수'})`,
          });
        }
        await dbItem.update({ quantity: editItem.quantity });
      }
    }

    res.json({ message: '수정 완료' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────
// DELETE /:id  — 창고간 이동 취소 (재고 복구)
// ────────────────────────────────────────────────────────────────────
router.delete('/:id', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { WarehouseTransfer, WarehouseTransferItem, Product, StockHistory } = global.sequelize.models;

    const transfer = await WarehouseTransfer.findByPk(req.params.id, {
      include: [{ model: WarehouseTransferItem, as: 'items' }]
    });

    if (!transfer) return res.status(404).json({ error: '이동 정보 없음' });
    if (transfer.status !== 'pending') return res.status(400).json({ error: '이동 중인 상태에서만 취소 가능합니다' });

    for (const item of transfer.items) {
      const product = await Product.findByPk(item.productId);
      if (product) {
        const before = product.currentStock;
        const after  = before + item.quantity;
        await product.update({ currentStock: after });

        await StockHistory.create({
          productId: item.productId,
          type: 'inbound',
          quantity: item.quantity,
          balanceBefore: before,
          balanceAfter: after,
          reference: transfer.transferOutNumber,
          referenceType: 'manual',
          userId: req.user.id,
          reason: `창고간 이동 취소 (재고 복구)`,
        });
      }
    }

    await transfer.update({ status: 'cancelled' });
    res.json({ message: '이동 취소 및 재고 복구 완료' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /:id/confirm  — 입고 확정 (TI 번호 생성, 재고 증가 + 자동 품목 등록)
// ────────────────────────────────────────────────────────────────────
router.post('/:id/confirm', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { WarehouseTransfer, WarehouseTransferItem, Product, StockHistory, Category, ItemCode, Warehouse } = global.sequelize.models;
    const { receivedItems, notes } = req.body;

    const transfer = await WarehouseTransfer.findByPk(req.params.id, {
      include: [
        { model: WarehouseTransferItem, as: 'items', include: [{ model: Product }] },
        { model: Warehouse, as: 'fromWarehouse' },
        { model: Warehouse, as: 'toWarehouse' }
      ],
    });

    if (!transfer)              return res.status(404).json({ error: '이동 정보 없음' });
    if (transfer.status === 'confirmed') return res.status(400).json({ error: '이미 입고 확정된 건입니다' });
    if (transfer.status === 'cancelled') return res.status(400).json({ error: '취소된 건입니다' });

    // 부서 체크 (같은 부서만 가능)
    if (transfer.fromWarehouse.deptId !== transfer.toWarehouse.deptId) {
      return res.status(403).json({ error: '타 부서 창고로의 이동은 지원되지 않습니다' });
    }

    const transferInNumber = await genNumber('TI', 'transferInNumber');

    for (const item of transfer.items) {
      const recv    = receivedItems?.find(r => r.id === item.id);
      const recvQty = recv ? Number(recv.receivedQuantity) : item.quantity;

      await item.update({ receivedQuantity: recvQty });

      if (recvQty > 0) {
        const sourceProd = item.Product;
        // 도착 창고에 해당 바코드/품목코드가 있는지 확인
        const { Op } = require('sequelize');
        let targetProd = await Product.findOne({
          where: {
            warehouseId: transfer.toWarehouseId,
            [Op.or]: [
              { productCode: sourceProd.productCode },
              { barcode: sourceProd.barcode }
            ]
          }
        });

        // 없으면 자동 등록 로직
        if (!targetProd) {
          // 카테고리 복제 (계층 구조 고려 없이 단순 복제 or 부모Id 유지)
          // 실제 운영에서는 부서ID(L1)가 같으므로 categoryId 자체를 그대로 써도 됨 (카테고리는 부서 단위 공유)
          // 단, 카테고리 모델의 부서ID 제약 확인 필요
          targetProd = await Product.create({
            productCode: sourceProd.productCode,
            productName: sourceProd.productName,
            specification: sourceProd.specification,
            categoryId: sourceProd.categoryId,
            category: sourceProd.category,
            barcode: sourceProd.barcode,
            unit: sourceProd.unit,
            unitPrice: sourceProd.unitPrice,
            currentStock: 0,
            safetyStock: sourceProd.safetyStock,
            warehouseId: transfer.toWarehouseId,
            description: sourceProd.description,
            isActive: true
          });

          // ItemCode(추가 바코드)들도 복제
          const codes = await ItemCode.findAll({ where: { itemId: sourceProd.id } });
          for (const c of codes) {
            await ItemCode.create({
              itemId: targetProd.id,
              codeType: c.codeType,
              codeValue: c.codeValue,
              supplierId: c.supplierId,
              notes: c.notes
            });
          }
        }

        const before = targetProd.currentStock || 0;
        const after  = before + recvQty;
        await targetProd.update({ currentStock: after });

        await StockHistory.create({
          productId: targetProd.id,
          type: 'inbound', quantity: recvQty,
          balanceBefore: before, balanceAfter: after,
          reference: transferInNumber, referenceType: 'inbound',
          userId: req.user.id,
          reason: `창고간 이동 입고 (전표: ${transfer.transferOutNumber})`,
          notes: notes || null,
        });
      }
    }

    await transfer.update({
      transferInNumber,
      status: 'confirmed',
      inUserId: req.user.id,
      inAt: new Date(),
    });

    res.json({
      message: '입고 확정 및 자동 등록 완료',
      transferInNumber,
      transferOutNumber: transfer.transferOutNumber,
      id: transfer.id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
