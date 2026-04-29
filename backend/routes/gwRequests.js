const express = require('express');
const { Op } = require('sequelize');
const { auth } = require('../middleware/auth');
const { query } = require('../config/groupwareDb');

const router = express.Router();

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
        AND d.status_id IN (140, 68, 111, 157)
      ORDER BY d.created_at DESC 
      LIMIT 1000
    `);

    const docs = (docsRes.rows || []).sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
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
      attributes: ['requestNumber', 'status']
    });
    const localStatusMap = {};
    localRequests.forEach(r => {
      localStatusMap[r.requestNumber] = r.status;
    });

    // 4. Format for frontend
    const formatted = docs.map(d => {
      const vals = valuesMap[d.id] || {};
      const gwReqNum = `GW-${d.id}`;
      const itemName = String(vals['_qurowdx20'] || '').trim();
      const app26Item = applet26Map[norm(itemName)] || {};
      const sId = parseInt(d.status_id); // Ensure sId is a number for comparison
      
      // Mapping logic:
      // status_id 68 -> 'approved' (Ready for release)
      // status_id 140 -> 'pending' (Waiting for approval/action)
      // status_id 111, 157 -> 'released'
      let status = localStatusMap[gwReqNum];
      if (!status) {
        if ([111, 157].includes(sId)) {
          status = 'released';
        } else if (sId === 68) {
          status = 'approved';
        } else if (sId === 140) {
          status = 'pending';
        } else {
          status = 'pending'; // Default
        }
      }
      
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
    });

    res.json(formatted);
  } catch (err) {
    console.error('GW Request error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
