const express = require('express');
const { Op } = require('sequelize');
const { auth } = require('../middleware/auth');
const { query, getConnectionInfo } = require('../config/groupwareDb');

const router = express.Router();
const GW_APPROVED_STATUS_IDS = new Set([68, 49]);
const GW_RELEASED_STATUS_IDS = new Set([111, 157]);

function summarizeRows(rows, keyFn) {
  const counts = {};
  rows.forEach(row => {
    const key = keyFn(row);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function mapGwStatus(statusId, statusName, localStatus = null) {
  const sId = parseInt(statusId, 10);
  const name = String(statusName || '').trim();

  // GW 원본 상태를 우선한다. 완료취소 등으로 GW 문서가 다시 신청/대기 상태가 되면
  // 로컬 WMS에 남아 있는 released 기록 때문에 완료 목록에 계속 남지 않도록 한다.
  if (GW_RELEASED_STATUS_IDS.has(sId) || /(?:출고|지급).*완료/.test(name)) return 'released';
  if (GW_APPROVED_STATUS_IDS.has(sId) || /^(?:승인|지급승인)$/.test(name)) return 'approved';
  if (sId === 140 || /(?:신청|승인대기|대기)/.test(name)) return 'pending';
  if (/반려/.test(name)) return 'rejected';

  if (localStatus) return localStatus;
  return null;
}

async function syncProductTotalStock(Product, ProductWarehouseStock, productId, transaction) {
  const total = Number(await ProductWarehouseStock.sum('currentStock', { where: { productId }, transaction })) || 0;
  await Product.update({ currentStock: total }, { where: { id: productId }, transaction });
}

async function restoreReleasedGwRequest(request, nextStatus, transaction) {
  const { Request, StockHistory, Product, ProductWarehouseStock } = global.sequelize.models;
  const histories = await StockHistory.findAll({
    where: {
      reference: request.requestNumber,
      referenceType: 'request',
      type: 'outbound',
      [Op.or]: [
        { notes: null },
        { notes: { [Op.notLike]: '%GW 완료취소 감지로 재고 복구 처리%' } },
      ],
    },
    transaction,
  });

  for (const h of histories) {
    const productId = h.productId;
    const qty = Number(h.quantity) || 0;
    const warehouseId = h.warehouseId ? parseInt(h.warehouseId, 10) : null;
    if (!productId || qty <= 0) continue;

    if (warehouseId) {
      const [row] = await ProductWarehouseStock.findOrCreate({
        where: { productId, warehouseId },
        defaults: { productId, warehouseId, currentStock: 0, safetyStock: 0 },
        transaction,
      });
      const before = parseInt(row.currentStock, 10) || 0;
      await row.update({ currentStock: before + qty }, { transaction });
      await syncProductTotalStock(Product, ProductWarehouseStock, productId, transaction);
    } else {
      const product = await Product.findByPk(productId, { transaction });
      if (!product) continue;
      const before = parseInt(product.currentStock, 10) || 0;
      await product.update({ currentStock: before + qty }, { transaction });
    }

    await h.update({
      notes: `${h.notes || ''}\nGW 완료취소 감지로 재고 복구 처리`,
    }, { transaction });
  }

  await Request.update({
    status: nextStatus,
    releaserId: null,
    releasedAt: null,
  }, { where: { id: request.id }, transaction });
}

router.get('/health', auth, async (req, res) => {
  try {
    const started = Date.now();
    const dbRes = await query(`
      SELECT d.status_id, s.name, COUNT(*)::int AS count
      FROM go_applet_docs d
      JOIN go_applet_statuses s ON d.status_id = s.id
      WHERE d.applet_id = 22
      GROUP BY d.status_id, s.name
      ORDER BY d.status_id
    `);

    res.json({
      ok: true,
      elapsedMs: Date.now() - started,
      db: {
        candidates: getConnectionInfo(),
      },
      statuses: dbRes.rows,
    });
  } catch (err) {
    console.error('GW health error:', err);
    res.status(500).json({
      ok: false,
      error: err.message,
      code: err.code || null,
      db: {
        candidates: getConnectionInfo(),
      },
    });
  }
});

// Get requests from Groupware (Applet 22)
router.get('/', auth, async (req, res) => {
  try {
    // 1. Fetch documents from Applet 22 (Consolidated Query)
    const docsRes = await query(`
      SELECT 
        d.id, 
        d.status_id, 
        to_char(d.created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS.MS') as created_at, 
        d.created_by_id, 
        s.name as status_name, 
        u.name as user_name
      FROM go_applet_docs d
      JOIN go_applet_statuses s ON d.status_id = s.id
      JOIN go_users u ON d.created_by_id = u.id
      WHERE d.applet_id = 22 
      ORDER BY d.created_at DESC 
      LIMIT 1000
    `);

    const docs = (docsRes.rows || []).sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });
    console.log('[GW Requests] fetched docs:', {
      total: docs.length,
      rawStatusCounts: summarizeRows(docs, d => `${d.status_id}:${d.status_name || ''}`),
    });
    
    // 2. Fetch values for these docs (Applet 22)
    const docIds = docs.map(d => d.id);
    if (docIds.length === 0) return res.json([]);

    const valuesRes = await query(`
      SELECT adv.applet_doc_id, adv.values_key, v.string_value, v.double_value, v.text_value, v.long_value, v.date_value, v.type
      FROM go_applet_doc_values adv
      JOIN go_applet_vals v ON adv.value_id = v.id
      WHERE adv.applet_doc_id = ANY($1::int[])
    `, [docIds]);

    const valuesMap = {};
    const itemNames = new Set();
    const norm = (v) => String(v || '').trim().toLowerCase();
    valuesRes.rows.forEach(v => {
      if (!valuesMap[v.applet_doc_id]) valuesMap[v.applet_doc_id] = {};
      
      let val = null;
      switch(v.type) {
        case 'STRING': val = v.string_value; break;
        case 'DOUBLE': val = v.double_value; break;
        case 'LONG': val = v.long_value; break;
        case 'TEXT': val = v.text_value; break;
        case 'DATE': val = v.date_value; break;
      }
      valuesMap[v.applet_doc_id][v.values_key] = val;
      if (v.values_key === '_qurowdx20' && val) itemNames.add(norm(val));
    });

    // 2.5 Fetch item details from Applet 26 by name matching
    let applet26Map = {};
    if (itemNames.size > 0) {
      const names = Array.from(itemNames);
      const applet26Res = await query(`
        SELECT d.id as doc_id, adv.values_key, v.string_value, v.long_value, v.type
        FROM go_applet_docs d
        JOIN go_applet_doc_values adv ON d.id = adv.applet_doc_id
        JOIN go_applet_vals v ON adv.value_id = v.id
        WHERE d.applet_id = 26 
        AND d.id IN (
          SELECT applet_doc_id 
          FROM go_applet_doc_values adv2
          JOIN go_applet_vals v2 ON adv2.value_id = v2.id
          WHERE adv2.values_key = '_qn79b0gno' AND LOWER(TRIM(v2.string_value)) = ANY($1::text[])
        )
      `, [names]);

      applet26Res.rows.forEach(r => {
        if (!applet26Map[r.doc_id]) applet26Map[r.doc_id] = { doc_id: r.doc_id };
        let val = (r.type === 'STRING' ? r.string_value : (r.type === 'LONG' ? r.long_value : r.string_value));
        applet26Map[r.doc_id][r.values_key] = val;
      });

      // Fetch local mappings for these Applet 26 docs
      const { GwProductMapping } = global.sequelize.models;
      const app26DocIds = Object.keys(applet26Map);
      const mappings = await GwProductMapping.findAll({
        where: { gwDocId: { [Op.in]: app26DocIds } }
      });
      const mappingMap = {};
      mappings.forEach(m => {
        mappingMap[m.gwDocId] = m.productId;
      });

      // Transform to name-based map for easy lookup
      const nameMap = {};
      Object.values(applet26Map).forEach(m => {
        const nameKey = norm(m['_qn79b0gno']);
        if (nameKey) {
          m.productId = mappingMap[String(m.doc_id)] || null;
          const existing = nameMap[nameKey];
          if (!existing) {
            nameMap[nameKey] = m;
          } else {
            const score = (x) => (x?.productId ? 1000000 : 0) + (parseInt(x?.doc_id, 10) || 0);
            if (score(m) > score(existing)) nameMap[nameKey] = m;
          }
        }
      });
      applet26Map = nameMap;
    }

    // 3. Check which ones are already released in our local DB
    const { Request } = global.sequelize.models;
    const localRequests = await Request.findAll({
      where: {
        requestNumber: {
          [Op.like]: 'GW-%'
        }
      },
      attributes: ['id', 'requestNumber', 'status']
    });
    const localStatusMap = {};
    localRequests.forEach(r => {
      localStatusMap[r.requestNumber] = r.status;
    });
    const localRequestMap = {};
    localRequests.forEach(r => {
      localRequestMap[r.requestNumber] = r;
    });

    const tx = await global.sequelize.transaction();
    try {
      for (const d of docs) {
        const gwReqNum = `GW-${d.id}`;
        const local = localRequestMap[gwReqNum];
        if (!local || local.status !== 'released') continue;
        const gwStatus = mapGwStatus(parseInt(d.status_id, 10), d.status_name, null);
        if (gwStatus && gwStatus !== 'released') {
          await restoreReleasedGwRequest(local, gwStatus, tx);
          localStatusMap[gwReqNum] = gwStatus;
        }
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }

    // 4. Format for frontend
    const formatted = docs.map(d => {
      const vals = valuesMap[d.id] || {};
      const gwReqNum = `GW-${d.id}`;
      const itemName = String(vals['_qurowdx20'] || '').trim();
      const app26Item = applet26Map[norm(itemName)] || {};
      const sId = parseInt(d.status_id); // Ensure sId is a number for comparison
      
      const status = mapGwStatus(sId, d.status_name, localStatusMap[gwReqNum]);
      if (!status) return null;
      
      const regionVal = String(vals['_qiv4azya2'] ?? ''); // 구분 필드 (_qiv4azya2)
      let targetWarehouseId = null;
      let classification = '';

      // 매핑: 0 -> 평택, 1 -> 김제
      if (regionVal === '0') {
        targetWarehouseId = 1;
        classification = '평택';
      } else if (regionVal === '1') {
        targetWarehouseId = 2;
        classification = '김제';
      }
      
      return {
        id: `GW-${d.id}`, // Prefix with GW- to avoid collision
        gwDocId: d.id,
        isGw: true,
        warehouseId: targetWarehouseId, // 매핑된 창고 ID
        gwStatusId: sId,
        gwStatusName: d.status_name,
        requestNumber: gwReqNum,
        status: status,
        createdAt: d.created_at || null,
        applicant: {
          name: d.user_name || 'Groupware' // [등록자]
        },
        userName: vals['_qn79b0gno'] || d.user_name || '기재없음', // [사용자]
        approverName: vals['_approver_name'] || null, // [결재자] 값이 없으면 표시하지 않음
        category: 'Groupware',
        description: vals['_tyziwi30c'] || '', 
        itemName: itemName || '알 수 없는 품목',
        itemClassification: classification, // 평택/김제 텍스트 반영
        items: [
          {
            id: `item-GW-${d.id}`,
            productId: app26Item.productId,
            Product: {
              productName: itemName || '알 수 없는 품목',
              productCode: app26Item['_gzrb0l9d7'] || 'GW-ITEM',
              unit: 'EA'
            },
            quantity: parseFloat(vals['_93b51vcyy']) || 0
          }
        ]
      };
    }).filter(Boolean);

    console.log('[GW Requests] formatted rows:', {
      total: formatted.length,
      mappedStatusCounts: summarizeRows(formatted, r => `${r.gwStatusId}:${r.gwStatusName || ''}:${r.status}`),
    });

    res.json(formatted);
  } catch (err) {
    console.error('GW Request error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
