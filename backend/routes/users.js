const express = require('express');
const { auth, roleAuth } = require('../middleware/auth');

const router = express.Router();
const FORBIDDEN_BY_DEPT_ADMIN = new Set(['admin', 'dept_admin']);
const ALLOWED_ROLES = new Set(['admin', 'dept_admin', 'applicant', 'warehouse']);

function parseNullableInt(raw, fieldName) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return { error: `${fieldName} 값이 올바르지 않습니다.` };
  return { value: n };
}

async function resolveDeptAndWarehouse({ req, targetRole, requestedDeptId, requestedWarehouseId }) {
  const { Warehouse } = global.sequelize.models;
  let resolvedDeptId = req.user.role === 'dept_admin' ? req.user.deptId : requestedDeptId;
  let resolvedWarehouseId = requestedWarehouseId;

  if (targetRole === 'dept_admin' && !resolvedDeptId) {
    return { status: 400, error: '부서관리자 계정은 소속 부서 지정이 필요합니다.' };
  }

  if (targetRole === 'warehouse') {
    if (!resolvedWarehouseId) {
      return { status: 400, error: '창고작업자 계정은 소속 창고 선택이 필요합니다.' };
    }

    const warehouse = await Warehouse.findByPk(resolvedWarehouseId);
    if (!warehouse) return { status: 400, error: '선택한 창고를 찾을 수 없습니다.' };
    if (!warehouse.deptId) return { status: 400, error: '선택한 창고에 소속 부서가 지정되지 않았습니다.' };

    if (req.user.role === 'dept_admin' && warehouse.deptId !== req.user.deptId) {
      return { status: 403, error: '부서관리자는 본인 부서 창고만 지정할 수 있습니다.' };
    }
    if (resolvedDeptId && warehouse.deptId !== resolvedDeptId) {
      return { status: 400, error: '선택한 창고가 소속 부서와 일치하지 않습니다.' };
    }

    resolvedDeptId = resolvedDeptId || warehouse.deptId;
  } else {
    resolvedWarehouseId = null;
  }

  return { deptId: resolvedDeptId, warehouseId: resolvedWarehouseId };
}

const buildDeptScope = (req) => {
  if (req.user.role === 'admin') return null;
  if (req.user.role === 'dept_admin') return { deptId: req.user.deptId || null };
  return null;
};

const denyIfNoDeptScope = (req, res) => {
  if (req.user.role === 'dept_admin' && !req.user.deptId) {
    res.status(403).json({ error: '부서가 지정되지 않은 부서관리자 계정입니다.' });
    return true;
  }
  return false;
};

// Create user (Admin / Dept Admin)
router.post('/', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const { email, password, name, role, deptId, warehouseId } = req.body;
  try {
    if (denyIfNoDeptScope(req, res)) return;
    if (!email || !password || !name)
      return res.status(400).json({ error: '이름, 이메일, 비밀번호는 필수입니다.' });
    const bcrypt = require('bcryptjs');
    const { User } = global.sequelize.models;

    const targetRole = role || 'warehouse';
    if (!ALLOWED_ROLES.has(targetRole)) {
      return res.status(400).json({ error: '허용되지 않은 역할입니다.' });
    }
    if (req.user.role === 'dept_admin' && FORBIDDEN_BY_DEPT_ADMIN.has(targetRole)) {
      return res.status(403).json({ error: '부서관리자는 시스템/부서 관리자 권한을 부여할 수 없습니다.' });
    }

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser)
      return res.status(400).json({ error: '이미 사용 중인 이메일입니다.' });

    const parsedDept = parseNullableInt(deptId, 'deptId');
    if (parsedDept.error) return res.status(400).json({ error: parsedDept.error });
    const parsedWarehouse = parseNullableInt(warehouseId, 'warehouseId');
    if (parsedWarehouse.error) return res.status(400).json({ error: parsedWarehouse.error });

    const resolved = await resolveDeptAndWarehouse({
      req,
      targetRole,
      requestedDeptId: parsedDept.value,
      requestedWarehouseId: parsedWarehouse.value,
    });
    if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });

    const hashedPassword = await bcrypt.hash(password, 10);
    const createData = { email, password: hashedPassword, name, role: targetRole };
    createData.deptId = resolved.deptId;
    createData.warehouseId = resolved.warehouseId;
    const user = await User.create(createData);

    const userResponse = user.toJSON();
    delete userResponse.password;
    res.status(201).json(userResponse);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get all users (Admin / Dept Admin)
router.get('/', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    if (denyIfNoDeptScope(req, res)) return;
    const { User } = global.sequelize.models;
    const where = buildDeptScope(req) || {};
    const users = await User.findAll({ where, attributes: { exclude: ['password'] } });
    res.json(users);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Get user by id (Admin / Dept Admin)
router.get('/:id', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    if (denyIfNoDeptScope(req, res)) return;
    const { User } = global.sequelize.models;
    const where = { id: req.params.id, ...(buildDeptScope(req) || {}) };
    const user = await User.findOne({ where, attributes: { exclude: ['password'] } });
    if (!user) return res.status(404).send('User not found');
    res.json(user);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Update user (Admin / Dept Admin)
router.put('/:id', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    if (denyIfNoDeptScope(req, res)) return;
    const { User } = global.sequelize.models;
    const where = { id: req.params.id, ...(buildDeptScope(req) || {}) };
    const user = await User.findOne({ where });
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });

    const { name, role, password, deptId, warehouseId } = req.body;
    if (role && !ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ error: '허용되지 않은 역할입니다.' });
    }
    if (req.user.role === 'dept_admin' && role && FORBIDDEN_BY_DEPT_ADMIN.has(role)) {
      return res.status(403).json({ error: '부서관리자는 시스템/부서 관리자 권한을 부여할 수 없습니다.' });
    }

    const nextRole = role || user.role;

    const parsedDept = parseNullableInt(
      deptId !== undefined ? deptId : user.deptId,
      'deptId'
    );
    if (parsedDept.error) return res.status(400).json({ error: parsedDept.error });
    const parsedWarehouse = parseNullableInt(
      warehouseId !== undefined ? warehouseId : user.warehouseId,
      'warehouseId'
    );
    if (parsedWarehouse.error) return res.status(400).json({ error: parsedWarehouse.error });

    const resolved = await resolveDeptAndWarehouse({
      req,
      targetRole: nextRole,
      requestedDeptId: parsedDept.value,
      requestedWarehouseId: parsedWarehouse.value,
    });
    if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });

    const updates = {};
    if (name)     updates.name = name;
    if (role)     updates.role = role;
    updates.deptId = resolved.deptId;
    updates.warehouseId = resolved.warehouseId;
    if (password) {
      const bcrypt = require('bcryptjs');
      updates.password = await bcrypt.hash(password, 10);
    }

    await user.update(updates);

    const updated = user.toJSON();
    delete updated.password;
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete user (Admin / Dept Admin)
router.delete('/:id', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    if (denyIfNoDeptScope(req, res)) return;
    const { User } = global.sequelize.models;
    const where = { id: req.params.id, ...(buildDeptScope(req) || {}) };
    const user = await User.findOne({ where });
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    if (req.user.role === 'dept_admin' && FORBIDDEN_BY_DEPT_ADMIN.has(user.role)) {
      return res.status(403).json({ error: '부서관리자는 관리자 계정을 삭제할 수 없습니다.' });
    }

    await user.destroy();
    res.json({ message: '삭제 완료' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
