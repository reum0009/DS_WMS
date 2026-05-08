/**
 * categories.js — 5단계 계층 카테고리 API
 *
 * L1 = 부서(Dept)       예: IT Team, Production
 * L2 = 분류             예: 고정자산, 소모품, 기타
 * L3 = 대분류            예: Computing, Office Furniture
 * L4 = 중분류            예: Laptops, Desks
 * L5 = 소분류            예: Executive, Standing Desk
 *
 * 데이터 사일로:
 *   - admin → 전 부서 조회 가능
 *   - 그 외 → 자신의 deptId 소속 카테고리만 조회
 */
const express = require('express');
const { Op } = require('sequelize');
const { auth, adminOnly, roleAuth } = require('../middleware/auth');
const router = express.Router();

// 사용자 deptId 결정 헬퍼
function userDeptId(req) {
  return (req.user.role === 'admin') ? null : (req.user.deptId || null);
}

function normalizeDeptIds(raw = []) {
  return Array.from(new Set((Array.isArray(raw) ? raw : [])
    .map(v => parseInt(v, 10))
    .filter(v => Number.isInteger(v) && v > 0)));
}

function parseAccessDeptIdsValue(value, fallbackDeptId) {
  let parsed = [];
  if (Array.isArray(value)) {
    parsed = value;
  } else if (typeof value === 'string' && value.trim()) {
    try {
      const json = JSON.parse(value);
      if (Array.isArray(json)) parsed = json;
    } catch (_) {
      parsed = [];
    }
  }
  const normalized = normalizeDeptIds(parsed);
  if (!normalized.length && fallbackDeptId) return [parseInt(fallbackDeptId, 10)];
  return normalized;
}

function accessDeptIdsForCategory(cat) {
  if (!cat || cat.level !== 1) return [];
  return parseAccessDeptIdsValue(cat.accessDeptIds, cat.id);
}

async function findRootDept(Category, categoryId) {
  if (!categoryId) return null;
  let cur = await Category.findByPk(categoryId);
  while (cur) {
    if (cur.level === 1) return cur;
    if (!cur.parentId) return null;
    cur = await Category.findByPk(cur.parentId);
  }
  return null;
}

async function categoryBelongsToDept(Category, categoryId, deptId) {
  if (!categoryId || !deptId) return false;
  const root = await findRootDept(Category, categoryId);
  if (!root) return false;
  return accessDeptIdsForCategory(root).includes(parseInt(deptId, 10));
}

function collectDescendantIds(rootId, byParent) {
  const ids = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop();
    const children = byParent.get(cur) || [];
    for (const childId of children) {
      if (!ids.has(childId)) {
        ids.add(childId);
        stack.push(childId);
      }
    }
  }
  return ids;
}

async function visibleRootDeptIds(Category, req) {
  if (req.user.role === 'admin') {
    const depts = await Category.findAll({ where: { level: 1, isActive: true } });
    return depts.map(d => d.id);
  }
  const deptId = req.user.deptId ? parseInt(req.user.deptId, 10) : null;
  if (!deptId) return [];
  const depts = await Category.findAll({ where: { level: 1, isActive: true } });
  return depts
    .filter(d => accessDeptIdsForCategory(d).includes(deptId))
    .map(d => d.id);
}

function ensureDeptAdminHasDept(req, res) {
  if (req.user.role === 'dept_admin' && !req.user.deptId) {
    res.status(403).json({ error: '부서가 지정되지 않은 부서관리자 계정입니다.' });
    return false;
  }
  return true;
}

// ── 플랫 목록 ─────────────────────────────────────────────────────
// GET /api/categories[?deptId=N]
router.get('/', auth, async (req, res) => {
  try {
    const { Category } = global.sequelize.models;

    const where = { isActive: true };
    const qDeptId = req.query.deptId ? parseInt(req.query.deptId, 10) : null;

    if (req.user.role === 'admin' && qDeptId) {
      const all = await Category.findAll({ where: { isActive: true }, order: [['level', 'ASC']] });
      const map = {};
      all.forEach(c => { map[c.id] = c; });

      const belongs = (c) => {
        let cur = c;
        while (cur) {
          if (cur.level === 1) return cur.id === qDeptId;
          cur = cur.parentId ? map[cur.parentId] : null;
        }
        return false;
      };
      return res.json(all.filter(c => c.level === 1 ? c.id === qDeptId : belongs(c)));
    }

    if (req.user.role !== 'admin') {
      if (!ensureDeptAdminHasDept(req, res)) return;
      const allowedRootIds = await visibleRootDeptIds(Category, req);
      const all = await Category.findAll({ where: { isActive: true }, order: [['level', 'ASC']] });
      const map = {};
      all.forEach(c => { map[c.id] = c; });

      const belongs = (c) => {
        let cur = c;
        while (cur) {
          if (cur.level === 1) return allowedRootIds.includes(cur.id);
          cur = cur.parentId ? map[cur.parentId] : null;
        }
        return false;
      };
      return res.json(all.filter(c => c.level === 1 ? allowedRootIds.includes(c.id) : belongs(c)));
    }

    const rows = await Category.findAll({
      where,
      order: [['level', 'ASC'], ['sortOrder', 'ASC'], ['name', 'ASC']],
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 트리 구조 ─────────────────────────────────────────────────────
// GET /api/categories/tree[?deptId=N]
router.get('/tree', auth, async (req, res) => {
  try {
    const { Category } = global.sequelize.models;

    const all = await Category.findAll({
      where: { isActive: true },
      order: [['level', 'ASC'], ['sortOrder', 'ASC'], ['name', 'ASC']],
    });

    const map = {};
    all.forEach(c => { map[c.id] = { ...c.toJSON(), children: [] }; });

    const roots = [];
    all.forEach(c => {
      if (c.parentId && map[c.parentId]) {
        map[c.parentId].children.push(map[c.id]);
      } else if (c.level === 1) {
        roots.push(map[c.id]);
      }
    });

    if (req.user.role === 'admin') {
      const deptId = req.query.deptId ? parseInt(req.query.deptId, 10) : null;
      if (deptId) return res.json(roots.filter(r => r.id === deptId));
      return res.json(roots);
    }

    const allowedRootIds = await visibleRootDeptIds(Category, req);
    if (allowedRootIds.length === 0 && req.user.role !== 'dept_admin') {
      return res.json(roots);
    }
    if (!ensureDeptAdminHasDept(req, res)) return;
    return res.json(roots.filter(r => allowedRootIds.includes(r.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── L1 부서 목록 (드롭다운용) ─────────────────────────────────────
// GET /api/categories/depts
router.get('/depts', auth, async (req, res) => {
  try {
    const { Category } = global.sequelize.models;
    const where = { level: 1, isActive: true };

    const depts = await Category.findAll({ where, order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
    if (req.user.role === 'admin') return res.json(depts);
    if (!ensureDeptAdminHasDept(req, res)) return;

    const deptId = parseInt(req.user.deptId, 10);
    const filtered = depts.filter(d => accessDeptIdsForCategory(d).includes(deptId));
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 전체 L1 부서 목록 (권한설정용, admin only) ────────────────────
// GET /api/categories/depts-all
router.get('/depts-all', auth, adminOnly, async (req, res) => {
  try {
    const { Category } = global.sequelize.models;
    const depts = await Category.findAll({
      where: { level: 1, isActive: true },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']]
    });
    res.json(depts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 부서(L1) 등록 ──────────────────────────────────────────────────
// POST /api/categories/dept
router.post('/dept', auth, adminOnly, async (req, res) => {
  try {
    const { Category } = global.sequelize.models;
    const { name, code, color = '#58a6ff', accessDeptIds, safetyStock = 0 } = req.body;
    if (!name) return res.status(400).json({ error: '부서명은 필수입니다' });

    const dup = await Category.findOne({ where: { name, level: 1, isActive: true } });
    if (dup) return res.status(409).json({ error: '이미 존재하는 부서명입니다' });

    const count = await Category.count({ where: { level: 1 } });

    const dept = await Category.create({
      name, level: 1, code: code || null, color, safetyStock: Math.max(0, parseInt(safetyStock, 10) || 0), sortOrder: count + 1,
    });

    const allowedDeptIds = normalizeDeptIds([...(Array.isArray(accessDeptIds) ? accessDeptIds : []), dept.id]);
    await dept.update({ accessDeptIds: JSON.stringify(allowedDeptIds) });

    res.status(201).json(dept);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── 일반 카테고리 등록 (L2~L5) ────────────────────────────────────
// POST /api/categories
router.post('/', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    if (!ensureDeptAdminHasDept(req, res)) return;
    const { Category } = global.sequelize.models;
    const { name, level, parentId, safetyStock = 0 } = req.body;

    if (!name || !level || !parentId)
      return res.status(400).json({ error: '이름, 레벨, 상위 카테고리는 필수입니다' });

    if (level < 2 || level > 5)
      return res.status(400).json({ error: 'L2~L5 만 직접 생성 가능합니다 (L1=부서는 /dept 엔드포인트 사용)' });

    const parent = await Category.findByPk(parentId);
    if (!parent) return res.status(404).json({ error: '상위 카테고리를 찾을 수 없습니다' });
    if (parent.level !== level - 1)
      return res.status(400).json({ error: `L${level}은 L${level - 1} 아래에만 추가할 수 있습니다` });
    if (req.user.role === 'dept_admin') {
      const ok = await categoryBelongsToDept(Category, parent.id, req.user.deptId);
      if (!ok) return res.status(403).json({ error: '본인 부서 카테고리만 관리할 수 있습니다.' });
    }

    const sortOrder = await Category.count({ where: { parentId } });
    const cat = await Category.create({ name, level, parentId, safetyStock: Math.max(0, parseInt(safetyStock, 10) || 0), sortOrder: sortOrder + 1 });
    res.status(201).json(cat);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── 카테고리 이동 (부모 변경) ─────────────────────────────────────
// PUT /api/categories/:id/move
router.put('/:id/move', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const t = await global.sequelize.transaction();
  try {
    if (!ensureDeptAdminHasDept(req, res)) { await t.rollback(); return; }
    const { Category } = global.sequelize.models;
    const { newParentId } = req.body;

    const cat = await Category.findByPk(req.params.id, { transaction: t });
    if (!cat) { await t.rollback(); return res.status(404).json({ error: '카테고리를 찾을 수 없습니다' }); }
    if (cat.level === 1) { await t.rollback(); return res.status(400).json({ error: '부서(L1)는 이동할 수 없습니다' }); }

    const newParent = await Category.findByPk(newParentId, { transaction: t });
    if (!newParent || !newParent.isActive)
      { await t.rollback(); return res.status(404).json({ error: '대상 카테고리를 찾을 수 없습니다' }); }
    if (newParent.level >= 5)
      { await t.rollback(); return res.status(400).json({ error: 'L5 아래로는 이동할 수 없습니다.' }); }
    if (newParent.id === cat.parentId)
      { await t.rollback(); return res.status(400).json({ error: '이미 해당 부모 아래에 있습니다' }); }
    if (req.user.role === 'dept_admin') {
      const inScopeCat = await categoryBelongsToDept(Category, cat.id, req.user.deptId);
      const inScopeParent = await categoryBelongsToDept(Category, newParent.id, req.user.deptId);
      if (!inScopeCat || !inScopeParent) {
        await t.rollback();
        return res.status(403).json({ error: '본인 부서 카테고리만 이동할 수 있습니다.' });
      }
    }

    const all = await Category.findAll({
      attributes: ['id', 'parentId', 'level'],
      transaction: t,
    });
    const byParent = new Map();
    all.forEach(r => {
      const pid = r.parentId || 0;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(r.id);
    });
    const subtreeIds = collectDescendantIds(cat.id, byParent);
    if (subtreeIds.has(newParent.id)) {
      await t.rollback();
      return res.status(400).json({ error: '자기 자신 또는 하위 카테고리 아래로는 이동할 수 없습니다.' });
    }

    const delta = (newParent.level + 1) - cat.level;
    const subtreeRows = all.filter(r => subtreeIds.has(r.id));
    const tooDeep = subtreeRows.find(r => (r.level + delta) > 5 || (r.level + delta) < 1);
    if (tooDeep) {
      await t.rollback();
      return res.status(400).json({ error: '이동하면 카테고리 레벨이 L5를 초과합니다. 다른 위치를 선택하세요.' });
    }

    const sortOrder = await Category.count({ where: { parentId: newParentId, isActive: true }, transaction: t });
    // 부모의 color 상속 (L1의 color를 전체 하위에 전파)
    const updates = { parentId: newParentId, sortOrder: sortOrder + 1 };
    if (newParent.color) updates.color = newParent.color;
    await cat.update(updates, { transaction: t });
    if (delta !== 0) {
      for (const row of subtreeRows) {
        if (row.id === cat.id) continue;
        await Category.update(
          { level: row.level + delta },
          { where: { id: row.id }, transaction: t }
        );
      }
      await cat.update({ level: cat.level + delta }, { transaction: t });
    }
    await t.commit();
    res.json(cat);
  } catch (err) {
    await t.rollback();
    res.status(400).json({ error: err.message });
  }
});

// ── 특정 노드 뒤에 배치 (같은/다른 부모 모두 지원) ─────────────────
// PUT /api/categories/:id/move-after  body: { afterId }
// afterId=null 이면 afterId의 부모 아래 맨 앞에 배치
router.put('/:id/move-after', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const t = await global.sequelize.transaction();
  try {
    if (!ensureDeptAdminHasDept(req, res)) { await t.rollback(); return; }
    const { Category } = global.sequelize.models;
    const { afterId } = req.body;

    const cat = await Category.findByPk(req.params.id, { transaction: t });
    if (!cat) { await t.rollback(); return res.status(404).json({ error: '카테고리를 찾을 수 없습니다' }); }

    const afterNode = await Category.findByPk(afterId, { transaction: t });
    if (!afterNode) { await t.rollback(); return res.status(404).json({ error: '기준 노드를 찾을 수 없습니다' }); }
    if (afterNode.level !== cat.level) { await t.rollback(); return res.status(400).json({ error: '같은 레벨의 노드 뒤에만 배치할 수 있습니다' }); }
    if (afterNode.id === cat.id) { await t.rollback(); return res.status(400).json({ error: '자기 자신 뒤에 배치할 수 없습니다' }); }
    if (req.user.role === 'dept_admin') {
      const inScopeCat = await categoryBelongsToDept(Category, cat.id, req.user.deptId);
      const inScopeAfter = await categoryBelongsToDept(Category, afterNode.id, req.user.deptId);
      if (!inScopeCat || !inScopeAfter) {
        await t.rollback();
        return res.status(403).json({ error: '본인 부서 카테고리만 재정렬할 수 있습니다.' });
      }
    }

    const newParentId = afterNode.parentId;

    // 새 부모의 활성 형제 (자신 제외), sortOrder 순
    const siblings = await Category.findAll({
      where: { parentId: newParentId, isActive: true, id: { [Op.ne]: cat.id } },
      order: [['sortOrder', 'ASC'], ['id', 'ASC']],
      transaction: t,
    });

    const afterIdx = siblings.findIndex(s => s.id === afterNode.id);
    const newOrder = [
      ...siblings.slice(0, afterIdx + 1),
      cat,
      ...siblings.slice(afterIdx + 1),
    ];

    for (let i = 0; i < newOrder.length; i++) {
      await newOrder[i].update({ sortOrder: i + 1 }, { transaction: t });
    }

    // 부모 변경 + color 상속
    const catUpdates = { parentId: newParentId };
    const newParent = newParentId ? await Category.findByPk(newParentId, { transaction: t }) : null;
    if (newParent?.color) catUpdates.color = newParent.color;
    await cat.update(catUpdates, { transaction: t });

    await t.commit();
    res.json({ message: '이동 완료' });
  } catch (err) {
    await t.rollback();
    res.status(400).json({ error: err.message });
  }
});

// ── 카테고리 수정 ─────────────────────────────────────────────────
// PUT /api/categories/:id
router.put('/:id', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    if (!ensureDeptAdminHasDept(req, res)) return;
    const { Category } = global.sequelize.models;
    const cat = await Category.findByPk(req.params.id);
    if (!cat) return res.status(404).json({ error: '카테고리를 찾을 수 없습니다' });
    if (req.user.role === 'dept_admin') {
      const ok = await categoryBelongsToDept(Category, cat.id, req.user.deptId);
      if (!ok) return res.status(403).json({ error: '본인 부서 카테고리만 수정할 수 있습니다.' });
      if (cat.level === 1) return res.status(403).json({ error: '부서관리자는 부서(L1)를 수정할 수 없습니다.' });
    }

    const allowed = ['name', 'code', 'color', 'sortOrder', 'safetyStock'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    if (updates.safetyStock !== undefined) updates.safetyStock = Math.max(0, parseInt(updates.safetyStock, 10) || 0);
    if (cat.level === 1 && req.user.role === 'admin' && req.body.accessDeptIds !== undefined) {
      updates.accessDeptIds = JSON.stringify(
        normalizeDeptIds([...(Array.isArray(req.body.accessDeptIds) ? req.body.accessDeptIds : []), cat.id])
      );
    }

    await cat.update(updates);
    res.json(cat);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── 카테고리 비활성화 ─────────────────────────────────────────────
// DELETE /api/categories/:id
router.delete('/:id', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    if (!ensureDeptAdminHasDept(req, res)) return;
    const { Category } = global.sequelize.models;
    const cat = await Category.findByPk(req.params.id);
    if (!cat) return res.status(404).json({ error: '카테고리를 찾을 수 없습니다' });
    if (req.user.role === 'dept_admin') {
      const ok = await categoryBelongsToDept(Category, cat.id, req.user.deptId);
      if (!ok) return res.status(403).json({ error: '본인 부서 카테고리만 비활성화할 수 있습니다.' });
      if (cat.level === 1) return res.status(403).json({ error: '부서관리자는 부서(L1)를 비활성화할 수 없습니다.' });
    }

    await cat.update({ isActive: false });
    res.json({ message: '비활성화 완료' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 카테고리 복구 ─────────────────────────────────────────────────
// PUT /api/categories/:id/restore
router.put('/:id/restore', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    if (!ensureDeptAdminHasDept(req, res)) return;
    const { Category } = global.sequelize.models;
    const cat = await Category.findByPk(req.params.id);
    if (!cat) return res.status(404).json({ error: '카테고리를 찾을 수 없습니다' });
    if (req.user.role === 'dept_admin') {
      const ok = await categoryBelongsToDept(Category, cat.id, req.user.deptId);
      if (!ok) return res.status(403).json({ error: '본인 부서 카테고리만 복구할 수 있습니다.' });
      if (cat.level === 1) return res.status(403).json({ error: '부서관리자는 부서(L1)를 복구할 수 없습니다.' });
    }
    await cat.update({ isActive: true });
    res.json(cat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 카테고리별 창고 안전재고 조회 ─────────────────────────────────
// GET /api/categories/:id/warehouse-stocks
router.get('/:id/warehouse-stocks', auth, async (req, res) => {
  try {
    const { CategoryWarehouseStock, Warehouse } = global.sequelize.models;
    const rows = await CategoryWarehouseStock.findAll({
      where: { categoryId: req.params.id },
      include: [{ model: Warehouse, as: 'warehouse', attributes: ['id', 'warehouseName', 'deptId'], required: false }],
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 카테고리별 창고 안전재고 저장 (upsert) ────────────────────────
// PUT /api/categories/:id/warehouse-stocks
// body: [{ warehouseId, safetyStock }, ...]
router.put('/:id/warehouse-stocks', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const t = await global.sequelize.transaction();
  try {
    if (!ensureDeptAdminHasDept(req, res)) { await t.rollback(); return; }
    const { Category, CategoryWarehouseStock } = global.sequelize.models;
    const categoryId = parseInt(req.params.id, 10);
    const cat = await Category.findByPk(categoryId, { transaction: t });
    if (!cat) { await t.rollback(); return res.status(404).json({ error: '카테고리를 찾을 수 없습니다' }); }
    if (req.user.role === 'dept_admin') {
      const ok = await categoryBelongsToDept(Category, categoryId, req.user.deptId);
      if (!ok) { await t.rollback(); return res.status(403).json({ error: '본인 부서 카테고리만 수정할 수 있습니다.' }); }
    }

    const stocks = Array.isArray(req.body) ? req.body : [];
    const valid = stocks
      .map(s => ({ warehouseId: parseInt(s.warehouseId, 10), safetyStock: Math.max(0, parseInt(s.safetyStock, 10) || 0) }))
      .filter(s => Number.isInteger(s.warehouseId) && s.warehouseId > 0);

    // 기존 삭제 후 재삽입
    await CategoryWarehouseStock.destroy({ where: { categoryId }, transaction: t });
    if (valid.length) {
      await CategoryWarehouseStock.bulkCreate(
        valid.map(s => ({ categoryId, warehouseId: s.warehouseId, safetyStock: s.safetyStock })),
        { transaction: t }
      );
    }
    // categories.safetyStock을 창고별 최대값으로 동기화 (품목 목록의 안전재고 기준값)
    const maxSafety = valid.length > 0 ? Math.max(...valid.map(s => s.safetyStock)) : 0;
    await cat.update({ safetyStock: maxSafety }, { transaction: t });
    await t.commit();
    res.json({ message: '저장 완료', count: valid.length });
  } catch (err) {
    await t.rollback();
    res.status(400).json({ error: err.message });
  }
});

// ── 카테고리 영구 삭제 ────────────────────────────────────────────
// DELETE /api/categories/:id/permanent
router.delete('/:id/permanent', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const t = await global.sequelize.transaction();
  try {
    if (!ensureDeptAdminHasDept(req, res)) { await t.rollback(); return; }
    const { Category, CategoryWarehouseStock, Product } = global.sequelize.models;
    const cat = await Category.findByPk(req.params.id, { transaction: t });
    if (!cat) { await t.rollback(); return res.status(404).json({ error: '카테고리를 찾을 수 없습니다' }); }
    if (req.user.role === 'dept_admin') {
      const ok = await categoryBelongsToDept(Category, cat.id, req.user.deptId);
      if (!ok) { await t.rollback(); return res.status(403).json({ error: '본인 부서 카테고리만 삭제할 수 있습니다.' }); }
      if (cat.level === 1) { await t.rollback(); return res.status(403).json({ error: '부서관리자는 부서(L1)를 영구 삭제할 수 없습니다.' }); }
    }

    const allCats = await Category.findAll({ attributes: ['id', 'parentId'], transaction: t });
    const byParent = new Map();
    allCats.forEach(row => {
      const parentId = row.parentId == null ? null : parseInt(row.parentId, 10);
      if (!byParent.has(parentId)) byParent.set(parentId, []);
      byParent.get(parentId).push(row);
    });
    const ids = [parseInt(cat.id, 10), ...collectDescendantIds(cat.id, byParent)];

    const productCount = Product ? await Product.count({ where: { categoryId: ids }, transaction: t }) : 0;
    if (productCount > 0) {
      await t.rollback();
      return res.status(400).json({ error: `이 카테고리를 사용하는 품목 ${productCount}개가 있어 영구 삭제할 수 없습니다.` });
    }

    if (CategoryWarehouseStock) {
      await CategoryWarehouseStock.destroy({ where: { categoryId: ids }, transaction: t });
    }
    await Category.destroy({ where: { id: ids }, transaction: t });
    await t.commit();
    res.json({ message: '영구 삭제 완료' });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
});

// ── 비활성 카테고리 목록 ──────────────────────────────────────────
// GET /api/categories/inactive
router.get('/inactive', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    if (!ensureDeptAdminHasDept(req, res)) return;
    const { Category } = global.sequelize.models;
    const rows = await Category.findAll({
      where: { isActive: false },
      order: [['level', 'ASC'], ['updatedAt', 'DESC']],
    });
    if (req.user.role !== 'dept_admin') return res.json(rows);
    const filtered = [];
    for (const r of rows) {
      const ok = await categoryBelongsToDept(Category, r.id, req.user.deptId);
      if (ok) filtered.push(r);
    }
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 부서 커스텀 필드 목록 ─────────────────────────────────────────
// GET /api/categories/dept-fields/:deptId
router.get('/dept-fields/:deptId', auth, async (req, res) => {
  try {
    if (req.user.role === 'dept_admin' && String(req.user.deptId || '') !== String(req.params.deptId || '')) {
      return res.status(403).json({ error: '본인 부서 필드만 조회할 수 있습니다.' });
    }
    const { DeptCustomField } = global.sequelize.models;
    const fields = await DeptCustomField.findAll({
      where: { deptId: req.params.deptId, isActive: true },
      order: [['sortOrder', 'ASC']],
    });
    res.json(fields);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 부서 커스텀 필드 등록 ─────────────────────────────────────────
// POST /api/categories/dept-fields
router.post('/dept-fields', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    if (!ensureDeptAdminHasDept(req, res)) return;
    const { DeptCustomField } = global.sequelize.models;
    const { deptId, fieldName, fieldKey, fieldType = 'text', options, isRequired = false } = req.body;
    if (!deptId || !fieldName || !fieldKey)
      return res.status(400).json({ error: 'deptId, fieldName, fieldKey는 필수입니다' });
    if (req.user.role === 'dept_admin' && String(req.user.deptId) !== String(deptId)) {
      return res.status(403).json({ error: '본인 부서 필드만 등록할 수 있습니다.' });
    }

    const count = await DeptCustomField.count({ where: { deptId } });
    const field = await DeptCustomField.create({
      deptId, fieldName, fieldKey, fieldType,
      options: options ? JSON.stringify(options) : null,
      isRequired, sortOrder: count + 1,
    });
    res.status(201).json(field);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── 부서 커스텀 필드 삭제 ─────────────────────────────────────────
// DELETE /api/categories/dept-fields/:id
router.delete('/dept-fields/:id', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    if (!ensureDeptAdminHasDept(req, res)) return;
    const { DeptCustomField } = global.sequelize.models;
    const f = await DeptCustomField.findByPk(req.params.id);
    if (!f) return res.status(404).json({ error: '필드를 찾을 수 없습니다' });
    if (req.user.role === 'dept_admin' && String(req.user.deptId) !== String(f.deptId)) {
      return res.status(403).json({ error: '본인 부서 필드만 삭제할 수 있습니다.' });
    }
    await f.update({ isActive: false });
    res.json({ message: '삭제 완료' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
