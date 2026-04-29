const express = require('express');
const { auth, roleAuth } = require('../middleware/auth');

const router = express.Router();

function ensureDeptAdminHasDept(req, res) {
  if (req.user.role === 'dept_admin' && !req.user.deptId) {
    res.status(403).json({ error: '부서가 지정되지 않은 부서관리자 계정입니다.' });
    return false;
  }
  return true;
}

function buildScopeWhere(req) {
  if (req.user.role === 'dept_admin') return { deptId: req.user.deptId };
  const qDept = req.query.deptId ? parseInt(req.query.deptId, 10) : null;
  return qDept ? { deptId: qDept } : {};
}

// Get all warehouses
router.get('/', auth, async (req, res) => {
  try {
    if (!ensureDeptAdminHasDept(req, res)) return;
    const { Warehouse } = global.sequelize.models;
    const warehouses = await Warehouse.findAll({ where: buildScopeWhere(req) });
    res.json(warehouses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get warehouse by id
router.get('/:id', auth, async (req, res) => {
  try {
    if (!ensureDeptAdminHasDept(req, res)) return;
    const { Warehouse } = global.sequelize.models;
    const where = { id: req.params.id, ...buildScopeWhere(req) };
    const warehouse = await Warehouse.findOne({ where });
    if (!warehouse) return res.status(404).json({ error: '창고를 찾을 수 없습니다' });
    res.json(warehouse);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create warehouse (Admin / Dept Admin)
router.post('/', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    if (!ensureDeptAdminHasDept(req, res)) return;
    const { Warehouse } = global.sequelize.models;
    const { warehouseName, location, capacity, manager, deptId } = req.body;

    if (!warehouseName || !location || !capacity) {
      return res.status(400).json({ error: '필수 정보가 누락되었습니다' });
    }
    const resolvedDeptId = req.user.role === 'dept_admin'
      ? req.user.deptId
      : (deptId ? parseInt(deptId, 10) : null);

    const warehouse = await Warehouse.create({
      warehouseName,
      location,
      capacity,
      currentUsage: 0,
      manager,
      deptId: resolvedDeptId,
      isActive: true
    });

    res.status(201).json(warehouse);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update warehouse (Admin / Dept Admin)
router.put('/:id', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    if (!ensureDeptAdminHasDept(req, res)) return;
    const { Warehouse } = global.sequelize.models;
    const where = { id: req.params.id, ...buildScopeWhere(req) };
    const warehouse = await Warehouse.findOne({ where });
    if (!warehouse) return res.status(404).json({ error: '창고를 찾을 수 없습니다' });

    const updates = req.body;
    if (req.user.role === 'dept_admin') {
      updates.deptId = req.user.deptId;
    }
    await warehouse.update(updates);
    res.json(warehouse);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete warehouse (Admin / Dept Admin)
router.delete('/:id', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    if (!ensureDeptAdminHasDept(req, res)) return;
    const { Warehouse } = global.sequelize.models;
    const where = { id: req.params.id, ...buildScopeWhere(req) };
    const warehouse = await Warehouse.findOne({ where });
    if (!warehouse) return res.status(404).json({ error: '창고를 찾을 수 없습니다' });

    await warehouse.destroy();
    res.json({ message: '창고가 삭제되었습니다' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
