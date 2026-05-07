const express = require('express');
const { Op }  = require('sequelize');
const { auth, roleAuth } = require('../middleware/auth');
const multer  = require('multer');
const csv     = require('csv-parser');
const fs      = require('fs');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });
const DAY_MS = 24 * 60 * 60 * 1000;
const SAFETY_REVIEW_DAYS = 14;   // 월 2회 발주 기준
const SAFETY_WINDOW_DAYS = 60;   // 최근 2개월

function parseWarehouseScope(req) {
  const q = req.query?.warehouseId;
  if (q !== undefined && q !== null && String(q).trim() !== '') {
    const v = parseInt(q, 10);
    if (Number.isInteger(v) && v > 0) return v;
  }
  if (req.user?.role === 'warehouse' && req.user?.warehouseId) {
    const v = parseInt(req.user.warehouseId, 10);
    if (Number.isInteger(v) && v > 0) return v;
  }
  return null;
}

function categorySafetyFromMap(categoryMap, categoryId) {
  if (!categoryMap || !categoryId) return 0;
  const row = categoryMap.get(parseInt(categoryId, 10));
  return Math.max(0, parseInt(row?.safetyStock, 10) || 0);
}

function getWarehouseSafety(categoryWhStockMap, categoryId, warehouseId, defaultSafety) {
  if (!categoryWhStockMap || !categoryId || !warehouseId) return defaultSafety;
  const catId = parseInt(categoryId, 10);
  const whId = parseInt(warehouseId, 10);
  const whMap = categoryWhStockMap.get(catId);
  if (!whMap) return defaultSafety;
  const val = whMap.get(whId);
  return val !== undefined ? val : defaultSafety;
}

function applyCategorySafetyToProduct(product, categoryMap, categoryWhStockMap = null) {
  const p = product.toJSON ? product.toJSON() : { ...product };
  const catSafety = categorySafetyFromMap(categoryMap, p.categoryId);
  const productSafety = parseInt(p.safetyStock, 10) || 0;
  // 창고별 카테고리 안전재고가 있으면 최대값을 카테고리 기준으로 사용
  let catWhMax = 0;
  if (categoryWhStockMap && p.categoryId) {
    const whMap = categoryWhStockMap.get(parseInt(p.categoryId, 10));
    if (whMap && whMap.size > 0) catWhMax = Math.max(0, ...Array.from(whMap.values()));
  }
  const effectiveCatSafety = catSafety > 0 ? catSafety : catWhMax;
  // 우선순위: 카테고리값 > 창고별최대값 > 품목자체값
  const defaultSafety = effectiveCatSafety > 0 ? effectiveCatSafety : productSafety;
  p.categorySafetyStock = effectiveCatSafety;
  p.safetyStock = defaultSafety;
  if (Array.isArray(p.warehouseStocks)) {
    p.warehouseStocks = p.warehouseStocks.map(ws => {
      const whSafety = getWarehouseSafety(categoryWhStockMap, p.categoryId, ws.warehouseId, defaultSafety);
      return { ...ws, categorySafetyStock: whSafety, safetyStock: whSafety };
    });
  }
  return p;
}

function applyWarehouseScopeToProduct(product, warehouseId, categoryMap = null, categoryWhStockMap = null) {
  if (!warehouseId) return product;
  const p = product.toJSON ? product.toJSON() : { ...product };
  const stocks = Array.isArray(p.warehouseStocks) ? p.warehouseStocks : [];
  const row = stocks.find(ws => parseInt(ws.warehouseId, 10) === parseInt(warehouseId, 10));
  if (!row) return null;
  let scopedCurrent = parseInt(row.currentStock, 10) || 0;
  if (scopedCurrent === 0 && stocks.length === 1 && (parseInt(p.currentStock, 10) || 0) > 0) {
    // 기존 단일창고 데이터 호환: 창고별 현재고 컬럼 초기화 전 데이터면 총현재고를 임시 상속
    scopedCurrent = parseInt(p.currentStock, 10) || 0;
  }
  p.currentStock = scopedCurrent;
  const catSafety = categorySafetyFromMap(categoryMap, p.categoryId);
  const productSafety = parseInt(p.safetyStock, 10) || 0;
  let catWhMax = 0;
  if (categoryWhStockMap && p.categoryId) {
    const whMap = categoryWhStockMap.get(parseInt(p.categoryId, 10));
    if (whMap && whMap.size > 0) catWhMax = Math.max(0, ...Array.from(whMap.values()));
  }
  const effectiveCatSafety = catSafety > 0 ? catSafety : catWhMax;
  const baseSafety = effectiveCatSafety > 0 ? effectiveCatSafety : productSafety;
  const whSafety = getWarehouseSafety(categoryWhStockMap, p.categoryId, warehouseId, baseSafety);
  p.categorySafetyStock = effectiveCatSafety;
  p.safetyStock = whSafety;
  p.warehouseId = parseInt(warehouseId, 10);
  return p;
}

function normalizeWarehouseStocks(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const rows = [];
  for (const item of list) {
    const warehouseId = parseInt(item?.warehouseId, 10);
    const safetyStock = parseInt(item?.safetyStock, 10);
    if (!Number.isInteger(warehouseId) || warehouseId <= 0) continue;
    if (seen.has(warehouseId)) continue;
    seen.add(warehouseId);
    rows.push({
      warehouseId,
      safetyStock: Number.isInteger(safetyStock) && safetyStock >= 0 ? safetyStock : 0,
    });
  }
  return rows;
}

function parseUnitPriceInteger(raw) {
  const s = String(raw ?? '').trim();
  if (!/^\d+$/.test(s)) {
    return { error: '기준 단가는 소수점 없는 정수만 입력 가능합니다.' };
  }
  return { value: parseInt(s, 10) };
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function calcSafetyFromOutboundDaily(rows, windowStart, windowEnd) {
  const dayMap = new Map();
  for (const r of rows || []) {
    const qty = Math.max(0, parseInt(r.quantity, 10) || 0);
    if (qty <= 0) continue;
    const key = new Date(r.createdAt).toISOString().slice(0, 10);
    dayMap.set(key, (dayMap.get(key) || 0) + qty);
  }

  const daily = Array.from(dayMap.values());
  if (!daily.length) {
    return { hasData: false, recommended: 0, avgDaily: 0, excludedOutlierDays: 0, outlierThreshold: 0 };
  }

  const sorted = [...daily].sort((a, b) => a - b);
  const p95 = quantile(sorted, 0.95);
  const outlierThreshold = Math.max(10, Math.ceil(p95 * 2));
  const filtered = daily.filter(v => v <= outlierThreshold);
  const excludedOutlierDays = daily.length - filtered.length;

  const days = Math.max(1, Math.floor((startOfDay(windowEnd) - startOfDay(windowStart)) / DAY_MS) + 1);
  const sum = filtered.reduce((s, v) => s + v, 0);
  const avgDaily = sum / days;
  const recommended = Math.max(0, Math.ceil(avgDaily * SAFETY_REVIEW_DAYS));

  return { hasData: true, recommended, avgDaily, excludedOutlierDays, outlierThreshold };
}

async function findRootDeptId(Category, categoryId) {
  if (!categoryId) return null;
  let cur = await Category.findByPk(categoryId);
  while (cur) {
    if (cur.level === 1) return cur.id;
    if (!cur.parentId) return null;
    cur = await Category.findByPk(cur.parentId);
  }
  return null;
}

function parseAccessDeptIdsForL1(rootDept) {
  if (!rootDept) return [];
  let parsed = [];
  if (Array.isArray(rootDept.accessDeptIds)) {
    parsed = rootDept.accessDeptIds;
  } else if (typeof rootDept.accessDeptIds === 'string' && rootDept.accessDeptIds.trim()) {
    try {
      const json = JSON.parse(rootDept.accessDeptIds);
      if (Array.isArray(json)) parsed = json;
    } catch (_) {
      parsed = [];
    }
  }
  const normalized = Array.from(new Set(parsed.map(v => parseInt(v, 10)).filter(v => Number.isInteger(v) && v > 0)));
  if (!normalized.length && rootDept.id) return [parseInt(rootDept.id, 10)];
  return normalized;
}

async function findRootDeptCategory(Category, categoryId) {
  if (!categoryId) return null;
  let cur = await Category.findByPk(categoryId);
  while (cur) {
    if (cur.level === 1) return cur;
    if (!cur.parentId) return null;
    cur = await Category.findByPk(cur.parentId);
  }
  return null;
}

async function validateWarehouseStocksByDept({ Warehouse, Category, categoryId, warehouseStocks, transaction }) {
  if (!warehouseStocks.length) return;
  const rootDept = await findRootDeptCategory(Category, categoryId);
  if (!rootDept) {
    throw new Error('카테고리의 상위 부서를 찾을 수 없습니다.');
  }
  const allowedDeptIds = parseAccessDeptIdsForL1(rootDept);
  const warehouses = await Warehouse.findAll({
    where: { id: warehouseStocks.map(w => w.warehouseId) },
    transaction,
  });
  if (warehouses.length !== warehouseStocks.length) {
    throw new Error('선택한 창고 중 존재하지 않는 항목이 있습니다.');
  }
  const invalid = warehouses.find(w => !allowedDeptIds.includes(parseInt(w.deptId || 0, 10)));
  if (invalid) {
    throw new Error('선택한 창고가 카테고리(L1) 권한 범위에 없습니다.');
  }
}

// ── ITM-XXXXXX 자동 코드 생성 ──────────────────────────────────────
async function nextItemCode() {
  const { Product } = global.sequelize.models;
  const last = await Product.findOne({
    where: { productCode: { [Op.like]: 'ITM-%' } },
    order: [['productCode', 'DESC']],
  });
  if (!last) return 'ITM-000001';
  const seq = parseInt(last.productCode.replace('ITM-', ''), 10) || 0;
  return `ITM-${String(seq + 1).padStart(6, '0')}`;
}

// ── 중복 감지 (동일 스펙 = 동일 품목) ────────────────────────────
// POST /api/products/check-duplicate
router.post('/check-duplicate', auth, async (req, res) => {
  const { productName, specification, categoryId, unit, excludeId } = req.body;
  if (!productName || !unit) return res.json({ similar: [] });

  const { Product } = global.sequelize.models;
  const where = {
    productName: { [Op.like]: `%${productName.trim()}%` },
    unit,
    isActive: true,
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };

  const items = await Product.findAll({ where, limit: 5 });

  // 완전 일치 (이름+규격+카테고리+단위)
  const exact = items.filter(p =>
    p.productName === productName.trim() &&
    (p.specification || '') === (specification || '').trim() &&
    String(p.categoryId || '') === String(categoryId || '') &&
    p.unit === unit,
  );

  res.json({ exact: exact.map(p => p.id), similar: items });
});

// ── 품목 전체 조회 (ItemCode 포함) ───────────────────────────────
// GET /api/products?inactive=1  → 비활성 목록
// GET /api/products              → 활성 목록 (기본)
router.get('/', auth, async (req, res) => {
  try {
    const { Product, ItemCode, Supplier, ProductWarehouseStock, Warehouse, Category } = global.sequelize.models;
    const warehouseScopeId = parseWarehouseScope(req);
    const isActive = req.query.inactive === '1' ? false : true;
    const products = await Product.findAll({
      where: { isActive },
      include: [{
        model: ItemCode,
        as: 'codes',
        required: false,
        include: [{ model: Supplier, as: 'supplier', attributes: ['supplierName'], required: false }],
      }, {
        model: ProductWarehouseStock,
        as: 'warehouseStocks',
        required: false,
        include: [{ model: Warehouse, as: 'warehouse', attributes: ['id', 'warehouseName', 'deptId'], required: false }],
      }
      ],
      order: [['productCode', 'ASC']],
    });
    const { CategoryWarehouseStock } = global.sequelize.models;
    const [categories, cwsRows] = await Promise.all([
      Category.findAll({ attributes: ['id', 'safetyStock'] }),
      CategoryWarehouseStock.findAll({ attributes: ['categoryId', 'warehouseId', 'safetyStock'] }),
    ]);
    const categoryMap = new Map(categories.map(c => [parseInt(c.id, 10), c]));
    const categoryWhStockMap = new Map();
    for (const r of cwsRows) {
      const catId = parseInt(r.categoryId, 10);
      if (!categoryWhStockMap.has(catId)) categoryWhStockMap.set(catId, new Map());
      categoryWhStockMap.get(catId).set(parseInt(r.warehouseId, 10), parseInt(r.safetyStock, 10) || 0);
    }
    if (!warehouseScopeId) return res.json(products.map(p => applyCategorySafetyToProduct(p, categoryMap, categoryWhStockMap)));
    const scoped = products
      .map(p => applyWarehouseScopeToProduct(p, warehouseScopeId, categoryMap, categoryWhStockMap))
      .filter(Boolean);
    res.json(scoped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 품목 단건 조회 ────────────────────────────────────────────────
// GET /api/products/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const { Product, ItemCode, Supplier, ProductWarehouseStock, Warehouse, Category, CategoryWarehouseStock } = global.sequelize.models;
    const warehouseScopeId = parseWarehouseScope(req);
    const product = await Product.findByPk(req.params.id, {
      include: [{ model: ItemCode, as: 'codes', required: false,
        include: [{ model: Supplier, as: 'supplier', attributes: ['supplierName'], required: false }] },
      {
        model: ProductWarehouseStock,
        as: 'warehouseStocks',
        required: false,
        include: [{ model: Warehouse, as: 'warehouse', attributes: ['id', 'warehouseName', 'deptId'], required: false }],
      }],
    });
    if (!product) return res.status(404).json({ error: '품목을 찾을 수 없습니다' });
    const [categories, cwsRows] = await Promise.all([
      Category.findAll({ attributes: ['id', 'safetyStock'] }),
      CategoryWarehouseStock.findAll({ attributes: ['categoryId', 'warehouseId', 'safetyStock'] }),
    ]);
    const categoryMap = new Map(categories.map(c => [parseInt(c.id, 10), c]));
    const categoryWhStockMap = new Map();
    for (const r of cwsRows) {
      const catId = parseInt(r.categoryId, 10);
      if (!categoryWhStockMap.has(catId)) categoryWhStockMap.set(catId, new Map());
      categoryWhStockMap.get(catId).set(parseInt(r.warehouseId, 10), parseInt(r.safetyStock, 10) || 0);
    }
    if (!warehouseScopeId) return res.json(applyCategorySafetyToProduct(product, categoryMap, categoryWhStockMap));
    const scoped = applyWarehouseScopeToProduct(product, warehouseScopeId, categoryMap, categoryWhStockMap);
    if (!scoped) return res.status(404).json({ error: '해당 창고에 배정되지 않은 품목입니다.' });
    res.json(scoped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 품목 등록 ─────────────────────────────────────────────────────
// POST /api/products
// body: { productName, specification, categoryId, unit, unitPrice, safetyStock,
//         warehouseId, notes, codes: [{codeType, codeValue, supplierId}] }
router.post('/', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const t = await global.sequelize.transaction();
  try {
    const { Product, ItemCode, ProductWarehouseStock, Warehouse, Category } = global.sequelize.models;
    const {
      productName, specification, categoryId, unit,
      unitPrice, safetyStock, warehouseId,
      warehouseStocks,
      notes, codes = [], force = false,
    } = req.body;

    if (!productName || !unit)
      return res.status(400).json({ error: '품목명과 단위는 필수입니다' });

    if (unitPrice === undefined || unitPrice === null || unitPrice === '')
      return res.status(400).json({ error: '기준 단가는 필수 입력 항목입니다.' });
    const parsedUnitPrice = parseUnitPriceInteger(unitPrice);
    if (parsedUnitPrice.error) return res.status(400).json({ error: parsedUnitPrice.error });

    const normalizedWarehouseStocks = normalizeWarehouseStocks(warehouseStocks);

    // ── 바코드/코드 중복 체크 추가 ──
    if (codes.length > 0) {
      const { ItemCode, Product } = global.sequelize.models;
      for (const c of codes) {
        if (!c.codeValue || !c.codeValue.trim()) continue;
        
        const existingCode = await ItemCode.findOne({
          where: { codeValue: c.codeValue.trim() },
          include: [{ model: Product, as: 'product', where: { isActive: true } }],
          transaction: t
        });

        if (existingCode) {
          await t.rollback();
          return res.status(409).json({
            error: `중복 코드 에러: "${c.codeValue}" 코드는 이미 "${existingCode.product.productName}" 품목에서 사용 중입니다.`
          });
        }
      }
    }

    // 완전 중복 방어 (force=false 일 때만)
    if (!force) {
      const dup = await Product.findOne({
        where: {
          productName: productName.trim(),
          specification: specification ? specification.trim() : null,
          categoryId:    categoryId    ? parseInt(categoryId) : null,
          unit,
          isActive: true,
        },
        transaction: t,
      });
      if (dup) {
        await t.rollback();
        return res.status(409).json({
          error: '동일 규격의 품목이 이미 존재합니다',
          existing: dup,
        });
      }
    }

    const productCode = await nextItemCode();
    const category = categoryId ? await Category.findByPk(parseInt(categoryId, 10), { transaction: t }) : null;
    const effectiveSafetyStock = Math.max(0, parseInt(category?.safetyStock, 10) || 0);

    if (normalizedWarehouseStocks.length) {
      await validateWarehouseStocksByDept({
        Warehouse, Category,
        categoryId: categoryId ? parseInt(categoryId, 10) : null,
        warehouseStocks: normalizedWarehouseStocks,
        transaction: t,
      });
    }

    const product = await Product.create({
      productCode,
      productName:   productName.trim(),
      specification: specification ? specification.trim() : null,
      categoryId:    categoryId ? parseInt(categoryId) : null,
      category:      'office',   // 레거시 ENUM 기본값 유지
      unit,
      unitPrice: parsedUnitPrice.value,
      safetyStock:   Number.isInteger(effectiveSafetyStock) ? effectiveSafetyStock : 0,
      warehouseId:   warehouseId || null,
      notes:         notes || null,
      currentStock:  0,
      isActive:      true,
    }, { transaction: t });

    if (normalizedWarehouseStocks.length) {
      await ProductWarehouseStock.bulkCreate(
        normalizedWarehouseStocks.map(w => ({
          productId: product.id,
          warehouseId: w.warehouseId,
          currentStock: 0,
          safetyStock: w.safetyStock,
          safetyStockMode: 'manual',
          manualSafetyStock: w.safetyStock,
          autoSafetyStock: 0,
          leadTimeDays: 3,
          serviceLevel: 95.00,
          zValue: 1.650,
        })),
        { transaction: t }
      );
    }

    // 다중 코드 저장
    if (codes.length > 0) {
      const codeRows = codes
        .filter(c => c.codeValue && c.codeValue.trim())
        .map(c => ({
          itemId:     product.id,
          codeType:   c.codeType || 'barcode',
          codeValue:  c.codeValue.trim(),
          supplierId: c.supplierId || null,
          notes:      c.notes || null,
        }));
      if (codeRows.length) await ItemCode.bulkCreate(codeRows, { transaction: t });
    }

    await t.commit();

    const created = await Product.findByPk(product.id, {
      include: [
        { model: ItemCode, as: 'codes', required: false },
        {
          model: ProductWarehouseStock,
          as: 'warehouseStocks',
          required: false,
          include: [{ model: Warehouse, as: 'warehouse', attributes: ['id', 'warehouseName', 'deptId'], required: false }],
        },
      ],
    });
    res.status(201).json(created);
  } catch (err) {
    await t.rollback();
    res.status(400).json({ error: err.message });
  }
});

// ── 품목 수정 ─────────────────────────────────────────────────────
// PUT /api/products/:id
// body: 품목 필드 + codes 배열 (전체 교체)
router.put('/:id', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const t = await global.sequelize.transaction();
  try {
    const { Product, ItemCode, ProductWarehouseStock, Warehouse, Category } = global.sequelize.models;
    const product = await Product.findByPk(req.params.id, { transaction: t });
    if (!product) { await t.rollback(); return res.status(404).json({ error: '품목을 찾을 수 없습니다' }); }

    const {
      productName, specification, categoryId, unit,
      unitPrice, safetyStock, warehouseId, warehouseStocks, notes, codes, currentStock,
    } = req.body;

    let parsedUnitPrice = null;
    if (unitPrice !== undefined) {
      if (unitPrice === null || unitPrice === '') {
        await t.rollback();
        return res.status(400).json({ error: '기준 단가는 필수 입력 항목입니다.' });
      }
      parsedUnitPrice = parseUnitPriceInteger(unitPrice);
      if (parsedUnitPrice.error) {
        await t.rollback();
        return res.status(400).json({ error: parsedUnitPrice.error });
      }
    }

    const hasWarehouseStocksField = Array.isArray(warehouseStocks);
    const normalizedWarehouseStocks = hasWarehouseStocksField ? normalizeWarehouseStocks(warehouseStocks) : [];

    if (normalizedWarehouseStocks.length) {
      await validateWarehouseStocksByDept({
        Warehouse, Category,
        categoryId: categoryId !== undefined ? (categoryId ? parseInt(categoryId, 10) : null) : product.categoryId,
        warehouseStocks: normalizedWarehouseStocks,
        transaction: t,
      });
    }

    const updates = {};
    if (productName     !== undefined) updates.productName     = productName.trim();
    if (specification   !== undefined) updates.specification   = specification ? specification.trim() : null;
    if (categoryId      !== undefined) updates.categoryId      = categoryId ? parseInt(categoryId) : null;
    if (unit            !== undefined) updates.unit            = unit;
    if (unitPrice       !== undefined) updates.unitPrice       = parsedUnitPrice.value;
    if (currentStock    !== undefined) updates.currentStock    = Math.max(0, parseInt(currentStock, 10) || 0);
    // 카테고리 기반 안전재고: categoryId가 변경될 때 새 카테고리 값으로 동기화
    if (updates.categoryId !== undefined) {
      const newCat = updates.categoryId ? await Category.findByPk(parseInt(updates.categoryId, 10), { transaction: t }) : null;
      updates.safetyStock = Math.max(0, parseInt(newCat?.safetyStock, 10) || 0);
    }
    if (warehouseId     !== undefined) updates.warehouseId     = warehouseId || null;
    if (notes           !== undefined) updates.notes           = notes;

    // 수정 시 무조건 임시 상태 해제 (매핑 탭에서 수정 저장 시 정식 등록됨)
    updates.isDraft = false;

    await product.update(updates, { transaction: t });

    if (Array.isArray(warehouseStocks)) {
      const prevRows = await ProductWarehouseStock.findAll({
        where: { productId: product.id },
        transaction: t,
      });
      const prevStockMap = new Map(prevRows.map(r => [parseInt(r.warehouseId, 10), parseInt(r.currentStock, 10) || 0]));
      await ProductWarehouseStock.destroy({ where: { productId: product.id }, transaction: t });
      if (normalizedWarehouseStocks.length) {
        await ProductWarehouseStock.bulkCreate(
          normalizedWarehouseStocks.map(w => ({
            productId: product.id,
            warehouseId: w.warehouseId,
            currentStock: prevStockMap.get(parseInt(w.warehouseId, 10)) || 0,
            safetyStock: w.safetyStock,
            safetyStockMode: 'manual',
            manualSafetyStock: w.safetyStock,
            autoSafetyStock: 0,
            leadTimeDays: 3,
            serviceLevel: 95.00,
            zValue: 1.650,
          })),
          { transaction: t }
        );
      }
    }


    // ── 바코드/코드 중복 체크 추가 (수정 시) ──
    if (Array.isArray(codes)) {
      const { ItemCode, Product } = global.sequelize.models;
      for (const c of codes) {
        if (!c.codeValue || !c.codeValue.trim()) continue;

        const existingCode = await ItemCode.findOne({
          where: { 
            codeValue: c.codeValue.trim(),
            itemId: { [Op.ne]: product.id } // 현재 수정 중인 품목은 제외
          },
          include: [{ model: Product, as: 'product', where: { isActive: true } }],
          transaction: t
        });

        if (existingCode) {
          await t.rollback();
          return res.status(409).json({
            error: `중복 코드 에러: "${c.codeValue}" 코드는 이미 "${existingCode.product.productName}" 품목에서 사용 중입니다.`
          });
        }
      }

      // 코드 배열이 전달된 경우 전체 교체
      await ItemCode.destroy({ where: { itemId: product.id }, transaction: t });
      const codeRows = codes
        .filter(c => c.codeValue && c.codeValue.trim())
        .map(c => ({
          itemId:     product.id,
          codeType:   c.codeType || 'barcode',
          codeValue:  c.codeValue.trim(),
          supplierId: c.supplierId || null,
          notes:      c.notes || null,
        }));
      if (codeRows.length) await ItemCode.bulkCreate(codeRows, { transaction: t });
    }

    await t.commit();

    const updated = await Product.findByPk(product.id, {
      include: [
        { model: ItemCode, as: 'codes', required: false },
        {
          model: ProductWarehouseStock,
          as: 'warehouseStocks',
          required: false,
          include: [{ model: Warehouse, as: 'warehouse', attributes: ['id', 'warehouseName', 'deptId'], required: false }],
        },
      ],
    });
    res.json(updated);
  } catch (err) {
    await t.rollback();
    res.status(400).json({ error: err.message });
  }
});

// ── 안전재고 자동 재계산 (최근 2개월 평균, 대량출고 제외) ───────────────
// POST /api/products/recalculate-safety-stock
// body: { productId?: number }
router.post('/recalculate-safety-stock', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const t = await global.sequelize.transaction();
  try {
    const { Product, ProductWarehouseStock, StockHistory } = global.sequelize.models;
    const productId = req.body?.productId ? parseInt(req.body.productId, 10) : null;
    const now = new Date();
    const windowEnd = now;
    const windowStart = new Date(now.getTime() - ((SAFETY_WINDOW_DAYS - 1) * DAY_MS));

    const where = { isActive: true };
    if (productId) where.id = productId;

    const products = await Product.findAll({
      where,
      include: [{ model: ProductWarehouseStock, as: 'warehouseStocks', required: false }],
      transaction: t,
    });

    const summary = {
      total: products.length,
      updated: 0,
      keptInitial: 0,
      noUsageData: 0,
      details: [],
    };

    for (const p of products) {
      const firstOutbound = await StockHistory.findOne({
        where: { productId: p.id, type: 'outbound' },
        attributes: ['createdAt'],
        order: [['createdAt', 'ASC']],
        transaction: t,
      });

      // 출고 이력이 없으면 초기 설정값 유지
      if (!firstOutbound) {
        summary.keptInitial += 1;
        summary.details.push({
          productId: p.id,
          productName: p.productName,
          action: 'kept_initial',
          reason: 'no_outbound_history',
          appliedSafetyStock: parseInt(p.safetyStock, 10) || 0,
        });
        continue;
      }

      const firstOutboundAt = new Date(firstOutbound.createdAt);
      const ageDaysFromFirstOutbound = Math.floor((startOfDay(now) - startOfDay(firstOutboundAt)) / DAY_MS);

      // 첫 출고 후 2개월(60일) 미만이면 초기 설정값 유지
      if (ageDaysFromFirstOutbound < SAFETY_WINDOW_DAYS) {
        summary.keptInitial += 1;
        summary.details.push({
          productId: p.id,
          productName: p.productName,
          action: 'kept_initial',
          reason: 'first_outbound_under_60d',
          ageDaysFromFirstOutbound,
          firstOutboundAt,
          appliedSafetyStock: parseInt(p.safetyStock, 10) || 0,
        });
        continue;
      }

      const stocks = Array.isArray(p.warehouseStocks) ? p.warehouseStocks : [];
      if (!stocks.length) {
        const rows = await StockHistory.findAll({
          where: {
            productId: p.id,
            type: 'outbound',
            createdAt: { [Op.gte]: windowStart, [Op.lte]: windowEnd },
          },
          attributes: ['quantity', 'createdAt'],
          transaction: t,
        });
        const calc = calcSafetyFromOutboundDaily(rows, windowStart, windowEnd);
        if (!calc.hasData) {
          summary.noUsageData += 1;
          summary.details.push({
            productId: p.id,
            productName: p.productName,
            action: 'no_usage_data',
            appliedSafetyStock: parseInt(p.safetyStock, 10) || 0,
          });
          continue;
        }

        await p.update({ safetyStock: calc.recommended }, { transaction: t });
        summary.updated += 1;
        summary.details.push({
          productId: p.id,
          productName: p.productName,
          action: 'updated',
          avgDaily: Number(calc.avgDaily.toFixed(3)),
          excludedOutlierDays: calc.excludedOutlierDays,
          outlierThreshold: calc.outlierThreshold,
          appliedSafetyStock: calc.recommended,
        });
        continue;
      }

      let productSafetySum = 0;
      let hasAnyUsage = false;
      let excludedSum = 0;

      for (const ws of stocks) {
        const rows = await StockHistory.findAll({
          where: {
            productId: p.id,
            warehouseId: ws.warehouseId,
            type: 'outbound',
            createdAt: { [Op.gte]: windowStart, [Op.lte]: windowEnd },
          },
          attributes: ['quantity', 'createdAt'],
          transaction: t,
        });
        const calc = calcSafetyFromOutboundDaily(rows, windowStart, windowEnd);
        const currentSafety = parseInt(ws.safetyStock, 10) || 0;
        const nextSafety = calc.hasData ? calc.recommended : currentSafety;

        if (calc.hasData) hasAnyUsage = true;
        excludedSum += calc.excludedOutlierDays || 0;
        productSafetySum += nextSafety;

        await ws.update({
          safetyStock: nextSafety,
          safetyStockMode: 'auto',
          autoSafetyStock: nextSafety,
          avgDailyUsage3m: Number((calc.avgDaily || 0).toFixed(4)),
          anomalyExcludedCount3m: calc.excludedOutlierDays || 0,
          newItemRuleApplied: false,
          lastAutoCalculatedAt: now,
        }, { transaction: t });
      }

      await p.update({ safetyStock: productSafetySum }, { transaction: t });

      if (hasAnyUsage) summary.updated += 1;
      else summary.noUsageData += 1;

      summary.details.push({
        productId: p.id,
        productName: p.productName,
        action: hasAnyUsage ? 'updated' : 'no_usage_data',
        excludedOutlierDays: excludedSum,
        appliedSafetyStock: productSafetySum,
      });
    }

    await t.commit();
    res.json({
      message: '안전재고 자동 재계산 완료',
      windowDays: SAFETY_WINDOW_DAYS,
      reviewDays: SAFETY_REVIEW_DAYS,
      ...summary,
    });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
});

// ── 품목 비활성화 ─────────────────────────────────────────────────
// DELETE /api/products/:id
router.delete('/:id', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    const { Product } = global.sequelize.models;
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: '품목을 찾을 수 없습니다' });
    await product.update({ isActive: false });
    res.json({ message: '비활성화 완료' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 품목 복구 ─────────────────────────────────────────────────────
// PUT /api/products/:id/restore
router.put('/:id/restore', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    const { Product } = global.sequelize.models;
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: '품목을 찾을 수 없습니다' });
    await product.update({ isActive: true });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 품목 영구 삭제 ────────────────────────────────────────────────
// DELETE /api/products/:id/permanent
router.delete('/:id/permanent', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const t = await global.sequelize.transaction();
  try {
    const { Product, ItemCode, ProductAttribute, StockHistory, RequestItem } = global.sequelize.models;
    const product = await Product.findByPk(req.params.id, { transaction: t });
    if (!product) { await t.rollback(); return res.status(404).json({ error: '품목을 찾을 수 없습니다' }); }

    // 연관 데이터 삭제
    await ItemCode.destroy({ where: { itemId: req.params.id }, transaction: t });
    if (ProductAttribute) await ProductAttribute.destroy({ where: { itemId: req.params.id }, transaction: t });
    await product.destroy({ transaction: t });
    await t.commit();
    res.json({ message: '영구 삭제 완료' });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
});

// ── 임시 등록 (창고 작업자) ───────────────────────────────────────
// POST /api/products/quick-add
router.post('/quick-add', auth, async (req, res) => {
  try {
    const { Product } = global.sequelize.models;
    const { productName, barcode, categoryId, unit } = req.body;
    if (!productName || !unit)
      return res.status(400).json({ error: '품목명과 단위는 필수입니다' });

    const productCode = await nextItemCode();

    const product = await Product.create({
      productCode,
      productName,
      barcode: barcode || null,
      categoryId: categoryId || null,
      category: 'office',
      unit,
      unitPrice: 0,
      currentStock: 0,
      safetyStock: 0,
      isDraft: true,
      isActive: true,
    });
    res.status(201).json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── CSV 업로드 ────────────────────────────────────────────────────
// POST /api/products/upload/csv
router.post('/upload/csv', auth, roleAuth(['admin', 'dept_admin']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일을 업로드해주세요' });

    const { Product } = global.sequelize.models;
    const results = [];
    const errors  = [];
    let row = 1;

    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', (data) => {
        row++;
        if (!data.productName || !data.unit) {
          errors.push(`${row}행: 필수 정보 누락 (productName, unit)`);
          return;
        }
        const unitPriceRaw = String(data.unitPrice ?? '').trim();
        if (unitPriceRaw && !/^\d+$/.test(unitPriceRaw)) {
          errors.push(`${row}행: 기준 단가는 소수점 없는 정수만 입력 가능합니다.`);
          return;
        }
        results.push({
          productName:   data.productName.trim(),
          specification: data.specification ? data.specification.trim() : null,
          categoryId:    data.categoryId ? parseInt(data.categoryId) : null,
          unit:          data.unit.trim(),
          unitPrice:     unitPriceRaw ? parseInt(unitPriceRaw, 10) : 0,
          safetyStock:   parseInt(data.safetyStock)  || 0,
          warehouseId:   data.warehouseId ? parseInt(data.warehouseId) : null,
          notes:         data.notes || null,
          category:      'office',
          currentStock:  0,
          isActive:      true,
        });
      })
      .on('end', async () => {
        try {
          let created = 0;
          let skipped = 0;

          for (const item of results) {
            const exists = await Product.findOne({
              where: {
                productName:   item.productName,
                specification: item.specification,
                unit:          item.unit,
                isActive:      true,
              },
            });
            if (exists) { skipped++; continue; }
            const code = await nextItemCode();
            await Product.create({ ...item, productCode: code });
            created++;
          }

          fs.unlinkSync(req.file.path);
          res.json({ message: '파일 처리 완료', created, skipped, errors: errors.length ? errors : undefined });
        } catch (err) {
          fs.unlinkSync(req.file.path);
          res.status(500).json({ error: err.message });
        }
      })
      .on('error', (err) => {
        fs.unlinkSync(req.file.path);
        res.status(400).json({ error: 'CSV 처리 오류: ' + err.message });
      });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
