const express = require('express');
const { auth, roleAuth } = require('../middleware/auth');
const router = express.Router();

/**
 * POST /api/outbound
 * 직접 출고 처리 (POS) — 재고 차감 + 이력 기록
 */
router.post('/', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  const { StockHistory, Product, ProductWarehouseStock } = global.sequelize.models;
  const { items, reference, notes, warehouseId } = req.body;

  if (!items || !items.length) return res.status(400).json({ error: '출고 항목이 없습니다' });

  const transaction = await global.sequelize.transaction();
  try {
    const results = [];
    for (const item of items) {
      const product = await Product.findByPk(item.productId, { transaction });
      if (!product) throw new Error(`상품을 찾을 수 없습니다 (ID: ${item.productId})`);
      
      const qty = parseInt(item.quantity);
      const currentStock = parseInt(product.currentStock);
      
      if (currentStock < qty) throw new Error(`[${product.productName}] 재고 부족 (현재: ${currentStock})`);

      const before = currentStock;
      const after = before - qty;

      await product.update({ currentStock: after }, { transaction });
      if (warehouseId) {
        const whId = parseInt(warehouseId, 10);
        const [pws] = await ProductWarehouseStock.findOrCreate({
          where: { productId: item.productId, warehouseId: whId },
          defaults: { productId: item.productId, warehouseId: whId, currentStock: 0, safetyStock: 0 },
          transaction
        });
        const whBefore = parseInt(pws.currentStock, 10) || 0;
        if (whBefore < qty) throw new Error(`[${product.productName}] 창고 재고 부족 (현재: ${whBefore})`);
        await pws.update({ currentStock: whBefore - qty }, { transaction });
      }

      await StockHistory.create({
        productId: item.productId,
        type: 'outbound',
        quantity: qty,
        balanceBefore: before,
        balanceAfter: after,
        reference: reference || `OUT-${Date.now()}`,
        referenceType: 'manual',
        userId: req.user.id,
        warehouseId: warehouseId || null,
        reason: '현장 직접 출고',
        notes: notes || null
      }, { transaction });

      results.push({ productId: product.id, productName: product.productName, after });
    }

    await transaction.commit();
    res.status(201).json({ message: '출고 처리가 완료되었습니다', results });
  } catch (err) {
    await transaction.rollback();
    console.error('Outbound Error:', err); // 상세 로그 출력
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/outbound/today
 * 오늘 출고 건수 조회
 */
router.get('/today', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { StockHistory } = global.sequelize.models;
    const { Op } = require('sequelize');

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const count = await StockHistory.count({
      where: {
        type       : 'outbound',
        createdAt  : { [Op.between]: [start, end] },
      },
    });

    // 고유 reference(세션) 기준 건수
    const sessions = await StockHistory.findAll({
      attributes: [[require('sequelize').fn('DISTINCT', require('sequelize').col('reference')), 'reference']],
      where: {
        type        : 'outbound',
        createdAt   : { [Op.between]: [start, end] },
      },
      raw: true,
    });

    res.json({ count, sessions: sessions.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/outbound/sessions
 * 출고 세션 목록 검색
 */
router.get('/sessions', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { StockHistory, Product, User } = global.sequelize.models;
    const { Op } = require('sequelize');
    const { startDate, endDate, reference } = req.query;

    const where = { type: 'outbound' };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) { const s = new Date(startDate); s.setHours(0,0,0,0); where.createdAt[Op.gte] = s; }
      if (endDate)   { const e = new Date(endDate);   e.setHours(23,59,59,999); where.createdAt[Op.lte] = e; }
    }
    if (reference) where.reference = { [Op.like]: `%${reference}%` };

    const records = await StockHistory.findAll({
      where,
      include: [
        { model: Product, attributes: ['productName', 'productCode', 'unit'] },
        { model: User,    attributes: ['name'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: 300,
    });

    const map = {};
    records.forEach(r => {
      const key = r.reference;
      if (!map[key]) {
        map[key] = {
          reference : key,
          createdAt : r.createdAt,
          userName  : r.User?.name || '—',
          itemCount : 0,
          totalQty  : 0,
        };
      }
      map[key].itemCount += 1;
      map[key].totalQty  += r.quantity;
    });

    res.json(Object.values(map));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/outbound/session/:reference
 * 특정 출고 세션 상세 조회
 */
router.get('/session/:reference', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { StockHistory, Product } = global.sequelize.models;
    const items = await StockHistory.findAll({
      where: { reference: req.params.reference, type: 'outbound' },
      include: [{ model: Product, attributes: ['productName', 'productCode', 'unit', 'barcode', 'currentStock'] }],
      order: [['id', 'ASC']],
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/outbound/session/:reference/item/:id
 * 출고 항목 수량 수정
 */
router.put('/session/:reference/item/:id', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { StockHistory, Product, ProductWarehouseStock } = global.sequelize.models;
    const { quantity } = req.body;

    if (!quantity || quantity < 0) return res.status(400).json({ error: '수량 오류' });

    const record = await StockHistory.findByPk(req.params.id);
    if (!record || record.reference !== req.params.reference)
      return res.status(404).json({ error: '기록 없음' });

    const delta = quantity - record.quantity; // delta > 0 이면 출고가 늘어나는 것 -> 재고 감소
    if (delta !== 0) {
      const product = await Product.findByPk(record.productId);
      if (product) {
        if (product.currentStock < delta) return res.status(400).json({ error: '재고 부족' });
        await product.update({ currentStock: product.currentStock - delta });
      }
      if (record.warehouseId) {
        const [pws] = await ProductWarehouseStock.findOrCreate({
          where: { productId: record.productId, warehouseId: record.warehouseId },
          defaults: { productId: record.productId, warehouseId: record.warehouseId, currentStock: 0, safetyStock: 0 }
        });
        const whStock = parseInt(pws.currentStock, 10) || 0;
        if (whStock < delta) return res.status(400).json({ error: '창고 재고 부족' });
        await pws.update({ currentStock: whStock - delta });
      }
    }

    await record.update({ quantity, balanceAfter: record.balanceAfter - delta });
    res.json({ message: '수정 완료', delta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/outbound/session/:reference/item/:id
 * 출고 항목 삭제 (재고 복구)
 */
router.delete('/session/:reference/item/:id', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { StockHistory, Product, ProductWarehouseStock } = global.sequelize.models;

    const record = await StockHistory.findByPk(req.params.id);
    if (!record || record.reference !== req.params.reference)
      return res.status(404).json({ error: '기록 없음' });

    const product = await Product.findByPk(record.productId);
    if (product) await product.update({ currentStock: product.currentStock + record.quantity });
    if (record.warehouseId) {
      const [pws] = await ProductWarehouseStock.findOrCreate({
        where: { productId: record.productId, warehouseId: record.warehouseId },
        defaults: { productId: record.productId, warehouseId: record.warehouseId, currentStock: 0, safetyStock: 0 }
      });
      await pws.update({ currentStock: (parseInt(pws.currentStock, 10) || 0) + record.quantity });
    }

    await record.destroy();
    res.json({ message: '삭제 완료' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
