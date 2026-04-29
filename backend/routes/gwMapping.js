const express = require('express');
const { query } = require('../config/groupwareDb');
const { auth, roleAuth } = require('../middleware/auth');
const { Op } = require('sequelize');

const router = express.Router();
let gwMappingTableReady = false;

async function ensureGwMappingTable() {
  if (gwMappingTableReady) return;
  const { GwProductMapping } = global.sequelize.models;
  await GwProductMapping.sync();
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

// ── GW 품목 리스트 및 매핑 상태 조회 ─────────────────────────────
// GET /api/gw-mapping/items
router.get('/items', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    const { Product, GwProductMapping } = global.sequelize.models;
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
      include: [{ model: Product, as: 'product' }]
    }).catch(err => {
      console.error('GwProductMapping Query Error:', err);
      return []; // 테이블이 아직 없거나 에러 시 빈 배열 처리
    });

    const mappingMap = {};
    mappings.forEach(m => {
      if (m.product) mappingMap[String(m.gwDocId)] = m.product;
    });

    // 3. 데이터 정제 (중복 제거 및 수량 합산)
    const groupedMap = {};
    (gwItemsRes.rows || []).forEach(doc => {
      const itemName = (doc.item_name || '이름 없음').trim();
      const subCategory = (doc.sub_category || '').trim();
      const category = (doc.category || '').trim();
      
      const key = `${itemName}|${subCategory}`;

      if (!groupedMap[key]) {
        groupedMap[key] = {
          gwDocId: String(doc.doc_id),
          itemName,
          category,
          subCategory,
          baseQty: 0,
          currentStock: 0,
          createdAt: doc.created_at,
          mappedProduct: mappingMap[String(doc.doc_id)] || null
        };
      } else {
        const existing = groupedMap[key];
        // 더 최신 문서거나 매핑 정보가 있는 문서를 대표 ID로 설정
        if (!existing.mappedProduct && mappingMap[String(doc.doc_id)]) {
          existing.gwDocId = String(doc.doc_id);
          existing.mappedProduct = mappingMap[String(doc.doc_id)];
        }
      }

      groupedMap[key].baseQty += parseFloat(doc.base_qty) || 0;
      groupedMap[key].currentStock += parseFloat(doc.current_stock) || 0;
    });

    const result = Object.values(groupedMap).sort((a, b) => parseInt(b.gwDocId) - parseInt(a.gwDocId));
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
      productId: targetProduct.id
    }, { transaction: t });

    await t.commit();
    res.json({ success: true, product: targetProduct });
  } catch (err) {
    if (t) await t.rollback();
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
