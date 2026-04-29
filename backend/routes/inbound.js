const express = require('express');
const { auth, roleAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/inbound
 * 입고 처리 — 재고 증가 + 이력 기록
 *
 * body: {
 *   warehouseId : number | null,
 *   items       : [{ productId, quantity, notes }],
 *   sessionRef  : string   (예: "IN-20240414-001"),
 *   notes       : string
 * }
 */
router.post('/', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  const { StockHistory, Product, ProductWarehouseStock } = global.sequelize.models;
  const { warehouseId, items, sessionRef, notes } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '입고 항목이 없습니다' });
  }

  const reference = sessionRef || `IN-${Date.now()}`;
  const results   = [];
  const errors    = [];

  for (const item of items) {
    const { productId, quantity, notes: itemNote } = item;

    if (!productId || !quantity || quantity <= 0) {
      errors.push({ productId, error: '상품 ID 또는 수량이 유효하지 않습니다' });
      continue;
    }

    try {
      const product = await Product.findByPk(productId);
      if (!product) {
        errors.push({ productId, error: '상품을 찾을 수 없습니다' });
        continue;
      }

      const before = product.currentStock || 0;
      const after  = before + quantity;

      // 재고 업데이트
      await product.update({ currentStock: after });
      if (warehouseId) {
        const whId = parseInt(warehouseId, 10);
        const [pws] = await ProductWarehouseStock.findOrCreate({
          where: { productId, warehouseId: whId },
          defaults: { productId, warehouseId: whId, currentStock: 0, safetyStock: 0 }
        });
        await pws.update({ currentStock: (parseInt(pws.currentStock, 10) || 0) + quantity });
      }

      // 이력 기록
      await StockHistory.create({
        productId,
        type          : 'inbound',
        quantity,
        balanceBefore : before,
        balanceAfter  : after,
        reference,
        referenceType : 'inbound',
        userId        : req.user.id,
        warehouseId   : warehouseId || null,
        reason        : '창고 입고',
        notes         : itemNote || notes || null,
      });

      results.push({
        productId,
        productName  : product.productName,
        productCode  : product.productCode,
        quantity,
        balanceBefore: before,
        balanceAfter : after,
      });
    } catch (err) {
      errors.push({ productId, error: err.message });
    }
  }

  if (results.length === 0) {
    return res.status(400).json({ error: '처리된 항목이 없습니다', errors });
  }

  return res.status(201).json({
    message   : `입고 완료 (${results.length}종)`,
    reference,
    processed : results.length,
    failed    : errors.length,
    results,
    errors    : errors.length > 0 ? errors : undefined,
  });
});

/**
 * GET /api/inbound/today
 * 오늘 입고 건수 조회
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
        type       : 'inbound',
        referenceType: 'inbound',
        createdAt  : { [Op.between]: [start, end] },
      },
    });

    // 고유 reference(세션) 기준 건수
    const sessions = await StockHistory.findAll({
      attributes: [[require('sequelize').fn('DISTINCT', require('sequelize').col('reference')), 'reference']],
      where: {
        type        : 'inbound',
        referenceType: 'inbound',
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
 * GET /api/inbound/sessions
 * 입고 세션 목록 검색 (기간, 참조번호 필터)
 */
router.get('/sessions', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { StockHistory, Product, User } = global.sequelize.models;
    const { Op, fn, col, literal } = require('sequelize');
    const { startDate, endDate, reference } = req.query;

    const where = { type: 'inbound', referenceType: 'inbound' };

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

    // reference 기준으로 그룹핑
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
          warehouseId: r.warehouseId,
          items: [],
        };
      }
      map[key].itemCount += 1;
      map[key].totalQty  += r.quantity;
      map[key].items.push(r);
    });

    res.json(Object.values(map));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/inbound/session/:reference
 * 특정 세션의 품목 상세 조회
 */
router.get('/session/:reference', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { StockHistory, Product } = global.sequelize.models;
    const items = await StockHistory.findAll({
      where: { reference: req.params.reference, type: 'inbound', referenceType: 'inbound' },
      include: [{ model: Product, attributes: ['productName', 'productCode', 'unit', 'barcode', 'currentStock'] }],
      order: [['id', 'ASC']],
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/inbound/session/:reference/item/:id
 * 세션 내 개별 품목 수량 수정 (재고 재계산)
 */
router.put('/session/:reference/item/:id', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { StockHistory, Product, ProductWarehouseStock } = global.sequelize.models;
    const { quantity } = req.body;

    if (!quantity || quantity < 0) return res.status(400).json({ error: '수량 오류' });

    const record = await StockHistory.findByPk(req.params.id);
    if (!record || record.reference !== req.params.reference)
      return res.status(404).json({ error: '기록 없음' });

    const delta = quantity - record.quantity;
    if (delta !== 0) {
      const product = await Product.findByPk(record.productId);
      if (product) await product.update({ currentStock: Math.max(0, product.currentStock + delta) });
      if (record.warehouseId) {
        const [pws] = await ProductWarehouseStock.findOrCreate({
          where: { productId: record.productId, warehouseId: record.warehouseId },
          defaults: { productId: record.productId, warehouseId: record.warehouseId, currentStock: 0, safetyStock: 0 }
        });
        await pws.update({ currentStock: Math.max(0, (parseInt(pws.currentStock, 10) || 0) + delta) });
      }
    }

    await record.update({ quantity, balanceAfter: record.balanceAfter + delta });
    res.json({ message: '수정 완료', delta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/inbound/session/:reference/item/:id
 * 세션 내 품목 삭제 (재고 차감)
 */
router.delete('/session/:reference/item/:id', auth, roleAuth(['warehouse', 'admin']), async (req, res) => {
  try {
    const { StockHistory, Product, ProductWarehouseStock } = global.sequelize.models;

    const record = await StockHistory.findByPk(req.params.id);
    if (!record || record.reference !== req.params.reference)
      return res.status(404).json({ error: '기록 없음' });

    const product = await Product.findByPk(record.productId);
    if (product) await product.update({ currentStock: Math.max(0, product.currentStock - record.quantity) });
    if (record.warehouseId) {
      const [pws] = await ProductWarehouseStock.findOrCreate({
        where: { productId: record.productId, warehouseId: record.warehouseId },
        defaults: { productId: record.productId, warehouseId: record.warehouseId, currentStock: 0, safetyStock: 0 }
      });
      await pws.update({ currentStock: Math.max(0, (parseInt(pws.currentStock, 10) || 0) - record.quantity) });
    }

    await record.destroy();
    res.json({ message: '삭제 완료' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
