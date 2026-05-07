const express = require('express');
const { Op } = require('sequelize');
const { auth, roleAuth } = require('../middleware/auth');

const router = express.Router();

function todayYmd() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function scopedWarehouseIds(req) {
  const { Warehouse } = global.sequelize.models;
  if (req.user.role === 'admin') return null;
  if (req.user.role === 'dept_admin') {
    const rows = await Warehouse.findAll({ where: { deptId: req.user.deptId }, attributes: ['id'] });
    return rows.map(w => w.id);
  }
  if (req.user.role === 'warehouse' && req.user.warehouseId) return [req.user.warehouseId];
  return [];
}

router.get('/', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    const { WarehouseNotice, Warehouse, User } = global.sequelize.models;
    const where = {};
    const ids = await scopedWarehouseIds(req);
    if (ids) where.warehouseId = { [Op.in]: ids };

    const notices = await WarehouseNotice.findAll({
      where,
      include: [
        { model: Warehouse, as: 'warehouse', attributes: ['id', 'warehouseName'] },
        { model: User, as: 'creator', attributes: ['id', 'name'] },
      ],
      order: [['createdAt', 'DESC']],
    });
    res.json(notices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/active', auth, roleAuth(['warehouse', 'admin', 'dept_admin']), async (req, res) => {
  try {
    const { WarehouseNotice, Warehouse } = global.sequelize.models;
    const requestedWarehouseId = req.query.warehouseId ? parseInt(req.query.warehouseId, 10) : null;
    const warehouseId = req.user.role === 'warehouse'
      ? parseInt(req.user.warehouseId, 10)
      : requestedWarehouseId;

    if (!warehouseId) return res.json([]);

    const ids = await scopedWarehouseIds(req);
    if (ids && !ids.map(Number).includes(Number(warehouseId))) return res.json([]);

    const notices = await WarehouseNotice.findAll({
      where: {
        warehouseId,
        isActive: true,
        startDate: { [Op.lte]: todayYmd() },
        endDate: { [Op.gte]: todayYmd() },
      },
      include: [{ model: Warehouse, as: 'warehouse', attributes: ['id', 'warehouseName'] }],
      order: [['startDate', 'ASC'], ['createdAt', 'DESC']],
    });
    res.json(notices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    const { WarehouseNotice, Warehouse } = global.sequelize.models;
    const warehouseIds = Array.isArray(req.body?.warehouseIds)
      ? req.body.warehouseIds
      : [req.body?.warehouseId];
    const normalizedWarehouseIds = [...new Set(warehouseIds
      .map(id => parseInt(id, 10))
      .filter(id => Number.isInteger(id) && id > 0))];
    const content = String(req.body?.content || '').trim();
    const startDate = String(req.body?.startDate || '').slice(0, 10);
    const endDate = String(req.body?.endDate || '').slice(0, 10);

    if (normalizedWarehouseIds.length === 0) return res.status(400).json({ error: '창고를 선택하세요' });
    if (!content) return res.status(400).json({ error: '공지사항 내용을 입력하세요' });
    if (!startDate || !endDate) return res.status(400).json({ error: '공지 기간을 입력하세요' });
    if (startDate > endDate) return res.status(400).json({ error: '시작일은 종료일보다 늦을 수 없습니다' });

    const warehouseWhere = { id: { [Op.in]: normalizedWarehouseIds } };
    if (req.user.role === 'dept_admin') warehouseWhere.deptId = req.user.deptId;
    const warehouses = await Warehouse.findAll({ where: warehouseWhere, attributes: ['id'] });
    if (warehouses.length !== normalizedWarehouseIds.length) {
      return res.status(404).json({ error: '선택한 창고 중 접근할 수 없는 창고가 있습니다' });
    }

    const rows = await WarehouseNotice.bulkCreate(warehouses.map(w => ({
      warehouseId: w.id,
      content,
      startDate,
      endDate,
      isActive: req.body?.isActive !== false,
      createdBy: req.user.id,
    })));
    res.status(201).json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    const { WarehouseNotice, Warehouse } = global.sequelize.models;
    const notice = await WarehouseNotice.findByPk(req.params.id);
    if (!notice) return res.status(404).json({ error: '공지사항을 찾을 수 없습니다' });

    const updates = {};
    if (req.body?.warehouseId !== undefined) updates.warehouseId = parseInt(req.body.warehouseId, 10);
    if (req.body?.content !== undefined) updates.content = String(req.body.content || '').trim();
    if (req.body?.startDate !== undefined) updates.startDate = String(req.body.startDate || '').slice(0, 10);
    if (req.body?.endDate !== undefined) updates.endDate = String(req.body.endDate || '').slice(0, 10);
    if (req.body?.isActive !== undefined) updates.isActive = !!req.body.isActive;

    if (updates.warehouseId) {
      const warehouseWhere = { id: updates.warehouseId };
      if (req.user.role === 'dept_admin') warehouseWhere.deptId = req.user.deptId;
      const warehouse = await Warehouse.findOne({ where: warehouseWhere });
      if (!warehouse) return res.status(404).json({ error: '선택한 창고를 찾을 수 없습니다' });
    }
    if (updates.startDate && updates.endDate && updates.startDate > updates.endDate) {
      return res.status(400).json({ error: '시작일은 종료일보다 늦을 수 없습니다' });
    }
    if (updates.content !== undefined && !updates.content) {
      return res.status(400).json({ error: '공지사항 내용을 입력하세요' });
    }

    await notice.update(updates);
    res.json(notice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    const { WarehouseNotice } = global.sequelize.models;
    const notice = await WarehouseNotice.findByPk(req.params.id);
    if (!notice) return res.status(404).json({ error: '공지사항을 찾을 수 없습니다' });
    await notice.destroy();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
