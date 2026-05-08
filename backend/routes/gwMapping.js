const express = require('express');
const { query } = require('../config/groupwareDb');
const { auth, roleAuth } = require('../middleware/auth');
const { Op, DataTypes } = require('sequelize');

const router = express.Router();
let gwMappingTableReady = false;

async function ensureGwMappingTable() {
  if (gwMappingTableReady) return;
  const { GwProductMapping } = global.sequelize.models;
  await GwProductMapping.sync();
  const qi = global.sequelize.getQueryInterface();
  const desc = await qi.describeTable('gw_product_mappings');
  if (!desc.status) {
    await qi.addColumn('gw_product_mappings', 'status', {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'mapped'
    });
  }
  gwMappingTableReady = true;
}

// ── ITM-XXXXXX 자동 코드 생성 ────────────────────────────────
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

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isComparableCategory(value) {
  const normalized = normalizeText(value);
  return !!normalized && !/^\d+$/.test(normalized);
}

function getMappingIssues(gwItem, product) {
  const issues = [];
  if (!product) {
    issues.push('매핑된 시스템 품목 없음');
    return issues;
  }

  if (product.isActive === false) issues.push('매핑된 시스템 품목 비활성');
  if (normalizeText(product.productName) !== normalizeText(gwItem.itemName)) {
    issues.push('품목명 불일치');
  }

  const gwCategory = normalizeText(gwItem.category);
  const productCategory = normalizeText(product.categoryInfo?.name);
  if (isComparableCategory(gwItem.category) && productCategory && gwCategory !== productCategory) {
    issues.push('카테고리 불일치');
  }

  return issues;
}

// ── GW 품목 리스트 및 매핑 상태 조회 ─────────────────────────────
// GET /api/gw-mapping/items
router.get('/items', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    const { Product, GwProductMapping, Category } = global.sequelize.models;
    await ensureGwMappingTable();

    // 1. GW 데이터 가져오기 (PostgreSQL)
    let gwItemsRes;
    try {
      gwItemsRes = await query(`
        SELECT 
           d.id AS doc_id,
           MAX(CASE WHEN adv.values_key = '_qn79b0gno' THEN COALESCE(v.string_value, v.text_value, CAST(v.double_value AS TEXT), CAST(v.long_value AS TEXT)) END) AS item_name,
           MAX(CASE WHEN adv.values_key = '_ctaobkqok' THEN COALESCE(v.string_value, v.text_value, CAST(v.long_value AS TEXT), CAST(v.double_value AS TEXT)) END) AS category,
           MAX(CASE WHEN adv.values_key = '_gzrb0l9d7' THEN COALESCE(v.string_value, v.text_value, CAST(v.double_value AS TEXT), CAST(v.long_value AS TEXT)) END) AS sub_category,
           MAX(CASE WHEN adv.values_key = '_ooulrkyau' THEN COALESCE(v.string_value, v.text_value, CAST(v.double_value AS TEXT), CAST(v.long_value AS TEXT)) END) AS base_qty,
           MAX(CASE WHEN adv.values_key = '_zte1sknlo' THEN COALESCE(v.string_value, v.text_value, CAST(v.double_value AS TEXT), CAST(v.long_value AS TEXT)) END) AS current_stock,
           MAX(d.created_at) AS created_at
        FROM go_applet_docs d
        JOIN go_applet_doc_values adv ON d.id = adv.applet_doc_id
        JOIN go_applet_vals v ON adv.value_id = v.id
        WHERE d.applet_id = 26
        GROUP BY d.id
      `);
    } catch (pgErr) {
      console.error('PostgreSQL Query Error:', pgErr);
      return res.status(500).json({ error: '그룹웨어 DB 조회 실패: ' + pgErr.message });
    }

    // 2. 중간 테이블 매핑 정보 가져오기 (MySQL)
    const mappings = await GwProductMapping.findAll({
      include: [{
        model: Product,
        as: 'product',
        include: [{ model: Category, as: 'categoryInfo' }]
      }]
    }).catch(err => {
      console.error('GwProductMapping Query Error:', err);
      return []; // 테이블이 아직 없거나 에러 시 빈 배열 처리
    });

    const mappingMap = {};
    const excludedDocIds = new Set();
    mappings.forEach(m => {
      if (m.status === 'excluded') {
        excludedDocIds.add(String(m.gwDocId));
        return;
      }
      if (m.product) mappingMap[String(m.gwDocId)] = m.product.toJSON ? m.product.toJSON() : m.product;
    });

    const allProducts = await Product.findAll({
      include: [{ model: Category, as: 'categoryInfo' }]
    });
    const productsByName = {};
    allProducts.forEach(productModel => {
      const product = productModel.toJSON ? productModel.toJSON() : productModel;
      const key = normalizeText(product.productName);
      if (!key) return;
      if (!productsByName[key]) productsByName[key] = {};
      productsByName[key][product.id] = product;
    });

    // 3. 데이터 정제 (GW 품목명 기준 집계 + 동일 품목명의 시스템 품목 목록 구성)
    const groupedMap = {};
    (gwItemsRes.rows || []).forEach(doc => {
      const itemName = (doc.item_name || '이름 없음').trim();
      const category = (doc.category || '').trim();
      const mappedProduct = mappingMap[String(doc.doc_id)] || null;
      const isExcluded = excludedDocIds.has(String(doc.doc_id));
      
      const key = itemName;

      if (!groupedMap[key]) {
        groupedMap[key] = {
          gwDocId: String(doc.doc_id),
          itemName,
          category,
          baseQty: 0,
          currentStock: 0,
          createdAt: doc.created_at,
          mappedProduct: null,
          mappedProducts: [],
          mappedProductMap: {},
          excluded: false
        };
      } else {
        const existing = groupedMap[key];
        if (parseInt(doc.doc_id, 10) > parseInt(existing.gwDocId, 10)) {
          existing.gwDocId = String(doc.doc_id);
          existing.createdAt = doc.created_at;
        }
      }

      if (isExcluded) groupedMap[key].excluded = true;
      if (mappedProduct && !groupedMap[key].mappedProductMap[mappedProduct.id]) {
        groupedMap[key].mappedProductMap[mappedProduct.id] = mappedProduct;
      }
      Object.values(productsByName[normalizeText(itemName)] || {}).forEach(product => {
        groupedMap[key].mappedProductMap[product.id] = product;
      });

      groupedMap[key].baseQty += parseFloat(doc.base_qty) || 0;
      groupedMap[key].currentStock += parseFloat(doc.current_stock) || 0;
    });

    const result = Object.values(groupedMap).sort((a, b) => parseInt(b.gwDocId) - parseInt(a.gwDocId));
    result.forEach(item => {
      item.mappedProducts = Object.values(item.mappedProductMap);
      item.mappedProduct = item.mappedProducts[0] || null;
      delete item.mappedProductMap;

      const issues = item.mappedProducts.length
        ? [...new Set(item.mappedProducts.flatMap(product => getMappingIssues(item, product)))]
        : getMappingIssues(item, null);
      const onlyInactiveIssue = issues.length > 0 && issues.every(issue => issue === '매핑된 시스템 품목 비활성');
      if (onlyInactiveIssue || item.mappedProduct?.isActive === false) item.excluded = true;
      item.mappingNeedsReview = !item.excluded && issues.length > 0;
      item.mappingIssues = issues;
    });
    res.json(result);
  } catch (err) {
    console.error('General Fetch Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GW 품목 매핑 생성/수정 (Sync는 버튼 삭제에 맞춰 제거) ─────────────────────
router.post('/map', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const t = await global.sequelize.transaction();
  try {
    const { Product, GwProductMapping } = global.sequelize.models;
    await ensureGwMappingTable();
    const { gwDocId, productId, productName, specification, categoryId, unit } = req.body;

    let targetProduct;
    if (productId) {
      targetProduct = await Product.findByPk(productId, { transaction: t });
      if (!targetProduct) throw new Error('품목을 찾을 수 없습니다.');
      await targetProduct.update({
        productName: productName.trim(),
        specification: specification ? specification.trim() : null,
        categoryId: categoryId ? parseInt(categoryId) : null,
        unit: unit || targetProduct.unit || '개',
        isActive: true
      }, { transaction: t });
    } else {
      const productCode = await nextItemCode();
      targetProduct = await Product.create({
        productCode,
        productName: productName.trim(),
        specification: specification ? specification.trim() : null,
        categoryId: categoryId ? parseInt(categoryId) : null,
        unit: unit || '개',
        unitPrice: 0,
        safetyStock: 0,
        isActive: true,
        isDraft: true,
        currentStock: 0
      }, { transaction: t });
    }

    // 매핑 테이블 업데이트
    await GwProductMapping.destroy({
      where: { gwDocId: String(gwDocId) },
      transaction: t
    });

    await GwProductMapping.create({
      gwDocId: String(gwDocId),
      productId: targetProduct.id,
      status: 'mapped'
    }, { transaction: t });

    await t.commit();
    res.json({ success: true, product: targetProduct });
  } catch (err) {
    if (t) await t.rollback();
    res.status(400).json({ error: err.message });
  }
});

router.post('/exclude', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const t = await global.sequelize.transaction();
  try {
    const { GwProductMapping } = global.sequelize.models;
    await ensureGwMappingTable();
    const { gwDocId, productId } = req.body;
    if (!gwDocId || !productId) return res.status(400).json({ error: 'gwDocId와 productId가 필요합니다.' });

    await GwProductMapping.destroy({
      where: { gwDocId: String(gwDocId) },
      transaction: t
    });
    await GwProductMapping.create({
      gwDocId: String(gwDocId),
      productId,
      status: 'excluded'
    }, { transaction: t });

    await t.commit();
    res.json({ success: true });
  } catch (err) {
    if (t) await t.rollback();
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
