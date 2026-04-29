const express = require('express');
const { Op } = require('sequelize');
const { auth, roleAuth } = require('../middleware/auth');
const { runGwDocAction } = require('../services/gwDocAutomation');

const router = express.Router();

// Get approved requests for release
router.get('/approved', auth, roleAuth(['warehouse', 'releaser', 'admin', 'dept_admin']), async (req, res) => {
  try {
    const { Request, User, RequestItem, Product } = global.sequelize.models;
    const requests = await Request.findAll({
      where: { status: 'approved' },
      include: [
        { model: User, as: 'applicant', attributes: ['name', 'email'] },
        { model: User, as: 'approver', attributes: ['name', 'email'] },
        {
          model: RequestItem,
          as: 'items',
          include: [{ model: Product, attributes: ['productCode', 'productName', 'unit', 'currentStock'] }]
        }
      ]
    });
    res.json(requests);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Reject approved request before release (duplicate prevention flow)
router.put('/:id/reject', auth, roleAuth(['warehouse', 'releaser', 'admin', 'dept_admin']), async (req, res) => {
  const sequelize = global.sequelize;
  const transaction = await sequelize.transaction();
  const { Request } = sequelize.models;
  const { query } = require('../config/groupwareDb');
  const reason = String(req.body?.reason || '중복 출고 이력 확인 후 반려').trim();

  try {
    const isGw = String(req.params.id || '').startsWith('GW-');

    if (isGw) {
      const gwId = String(req.params.id).replace('GW-', '');
      const requestNumber = `GW-${gwId}`;
      let localReq = await Request.findOne({ where: { requestNumber }, transaction });

      if (localReq && localReq.status === 'released') {
        await transaction.rollback();
        return res.status(400).json({ error: '이미 출고 완료된 GW 요청은 반려할 수 없습니다' });
      }

      if (!localReq) {
        const docRes = await query(`
          SELECT d.id, u.name as user_name
          FROM go_applet_docs d
          JOIN go_users u ON d.created_by_id = u.id
          WHERE d.id = $1 AND d.applet_id = 22
          LIMIT 1
        `, [gwId]);

        if (!docRes.rows.length) {
          await transaction.rollback();
          return res.status(404).json({ error: 'GW 요청을 찾을 수 없습니다' });
        }

        localReq = await Request.create({
          requestNumber,
          type: 'goods',
          category: 'Groupware',
          description: reason,
          quantity: 0,
          amount: 0,
          applicantId: req.user.id,
          status: 'rejected',
          approverId: req.user.id,
          rejectionReason: reason,
          approvedAt: new Date(),
        }, { transaction });
      } else {
        await localReq.update({
          status: 'rejected',
          approverId: req.user.id,
          rejectionReason: reason,
          approvedAt: new Date(),
        }, { transaction });
      }

      await transaction.commit();
      return res.json({
        success: true,
        message: 'GW 요청이 반려 처리되었습니다',
        requestNumber: localReq.requestNumber,
        status: localReq.status,
      });
    }

    const request = await Request.findByPk(req.params.id, { transaction });
    if (!request) {
      await transaction.rollback();
      return res.status(404).json({ error: '요청을 찾을 수 없습니다' });
    }

    if (request.status !== 'approved') {
      await transaction.rollback();
      return res.status(400).json({ error: '출고대기(approved) 상태만 반려할 수 있습니다' });
    }

    if (request.releaserId || request.releasedAt) {
      await transaction.rollback();
      return res.status(400).json({ error: '이미 출고 완료된 요청은 반려할 수 없습니다' });
    }

    await request.update({
      status: 'rejected',
      approverId: req.user.id,
      rejectionReason: reason,
      approvedAt: new Date(),
    }, { transaction });

    await transaction.commit();
    res.json({
      success: true,
      message: '요청이 반려 처리되었습니다',
      requestNumber: request.requestNumber,
      status: request.status,
    });
  } catch (err) {
    if (transaction) await transaction.rollback();
    console.error('Release reject error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Release request with transaction handling
router.put('/:id/release', auth, roleAuth(['warehouse', 'releaser', 'admin', 'dept_admin']), async (req, res) => {
  const sequelize = global.sequelize;
  const transaction = await sequelize.transaction();
  const { Request, RequestItem, Product, StockHistory, GwProductMapping } = sequelize.models;
  const { query } = require('../config/groupwareDb');
  let gwActionResult = null;
  let gwActionError = null;
  let gwDocIdForAction = null;

  try {
    let request;
    const isGw = req.params.id.startsWith('GW-');

    if (isGw) {
      // ── GW 요청 처리 ──
      const gwId = req.params.id.replace('GW-', '');
      gwDocIdForAction = gwId;
      
      // 1. 이미 처리되었는지 확인
      const existing = await Request.findOne({ where: { requestNumber: req.params.id }, transaction });
      if (existing) {
        await transaction.rollback();
        return res.status(400).json({ error: '이미 출고된 GW 요청입니다' });
      }

      // 2. GW DB에서 데이터 가져오기
      const docRes = await query(`
        SELECT d.id, d.status_id, u.name as user_name
        FROM go_applet_docs d
        JOIN go_users u ON d.created_by_id = u.id
        WHERE d.id = $1 AND d.applet_id = 22
      `, [gwId]);

      if (docRes.rows.length === 0) {
        await transaction.rollback();
        return res.status(404).json({ error: 'GW 요청을 찾을 수 없습니다' });
      }

      const valRes = await query(`
        SELECT adv.values_key, v.string_value, v.double_value, v.text_value, v.long_value, v.type
        FROM go_applet_doc_values adv
        JOIN go_applet_vals v ON adv.value_id = v.id
        WHERE adv.applet_doc_id = $1
      `, [gwId]);

      const vals = {};
      valRes.rows.forEach(v => {
        let val = null;
        switch(v.type) {
          case 'STRING': val = v.string_value; break;
          case 'DOUBLE': val = v.double_value; break;
          case 'LONG': val = v.long_value; break;
          case 'TEXT': val = v.text_value; break;
        }
        vals[v.values_key] = val;
      });

      const regionVal = String(vals['_qiv4azya2'] ?? '');
      const itemName = String(vals['_qurowdx20'] || '').trim();
      const quantity = parseFloat(vals['_93b51vcyy']) || 0;

      // 지역 매핑: 0 -> 평택, 1 -> 김제
      let targetWarehouseId = null;
      if (regionVal === '0') targetWarehouseId = 1;
      else if (regionVal === '1') targetWarehouseId = 2;

      // 3. 매핑된 품목 찾기 (Applet 26 기반, 이름 정규화/중복 대응)
      const app26Res = await query(`
        SELECT d.id
        FROM go_applet_docs d
        JOIN go_applet_doc_values adv ON d.id = adv.applet_doc_id
        JOIN go_applet_vals v ON adv.value_id = v.id
        WHERE d.applet_id = 26
          AND adv.values_key = '_qn79b0gno'
          AND LOWER(TRIM(v.string_value)) = LOWER(TRIM($1))
        ORDER BY d.id DESC
        LIMIT 200
      `, [itemName]);

      if (app26Res.rows.length === 0) {
        await transaction.rollback();
        return res.status(400).json({ error: `GW 품목 매핑 실패: "${itemName}" (Applet 26에서 찾을 수 없음)` });
      }

      const candidateDocIds = app26Res.rows.map(r => String(r.id));
      const mappings = await GwProductMapping.findAll({
        where: { gwDocId: { [Op.in]: candidateDocIds } },
        order: [['updatedAt', 'DESC']],
        transaction
      });
      // 후보 중 매핑이 있는 문서를 우선 선택
      const mapping = mappings.find(m => candidateDocIds.includes(String(m.gwDocId))) || null;

      if (!mapping) {
        await transaction.rollback();
        return res.status(400).json({ error: `GW 품목 매핑 필요: "${itemName}" (시스템 품목과 연결되어 있지 않음)` });
      }

      const product = await Product.findByPk(mapping.productId, { transaction });
      if (!product) {
        await transaction.rollback();
        return res.status(400).json({ error: '매핑된 시스템 품목이 존재하지 않습니다' });
      }
      if (product.currentStock < quantity) {
        await transaction.rollback();
        return res.status(400).json({ error: `재고 부족: ${product.productName}(현재: ${product.currentStock}, 필요: ${quantity})` });
      }

      // 4. 로컬 Request 생성 (released 상태로 바로 생성)
      request = await Request.create({
        requestNumber: req.params.id,
        type: 'goods',
        category: 'Groupware',
        description: vals['_tyziwi30c'] || '',
        quantity: quantity,
        amount: parseFloat(product.unitPrice) * quantity,
        applicantId: req.user.id, // 실제로는 GW 사용자 정보 매핑 필요
        status: 'released',
        releaserId: req.user.id,
        releasedAt: new Date()
      }, { transaction });

      // 5. RequestItem 생성
      await RequestItem.create({
        requestId: request.id,
        productId: product.id,
        quantity: quantity,
        unitPrice: product.unitPrice,
        subtotal: parseFloat(product.unitPrice) * quantity
      }, { transaction });

      // 6. 재고 차감 및 히스토리
      const balanceBefore = product.currentStock;
      const balanceAfter = balanceBefore - quantity;
      await product.update({ currentStock: balanceAfter }, { transaction });

      await StockHistory.create({
        productId: product.id,
        type: 'outbound',
        quantity: quantity,
        balanceBefore,
        balanceAfter,
        reference: req.params.id,
        referenceType: 'request',
        userId: req.user.id,
        reason: `GW 출고: ${req.params.id}`,
        notes: `GW문서: ${gwId}, 신청자: ${docRes.rows[0].user_name}`
      }, { transaction });

    } else {
      // ── 일반(로컬) 요청 처리 ──
      request = await Request.findByPk(req.params.id, { transaction });
      
      if (!request) {
        await transaction.rollback();
        return res.status(404).json({ error: '요청을 찾을 수 없습니다' });
      }
      
      if (request.status !== 'approved') {
        await transaction.rollback();
        return res.status(400).json({ error: '승인된 요청만 출고할 수 있습니다' });
      }

      if (request.releaserId) {
        await transaction.rollback();
        return res.status(400).json({ error: '이미 출고된 요청입니다' });
      }

      const requestItems = await RequestItem.findAll({
        where: { requestId: req.params.id },
        include: [{ model: Product }],
        transaction
      });

      if (!requestItems || requestItems.length === 0) {
        await transaction.rollback();
        return res.status(400).json({ error: '출고할 품목이 없습니다' });
      }

      for (const item of requestItems) {
        const product = item.Product;
        if (product.currentStock < item.quantity) {
          await transaction.rollback();
          return res.status(400).json({ error: `재고 부족: ${product.productName}` });
        }
        const balanceBefore = product.currentStock;
        const balanceAfter = balanceBefore - item.quantity;
        await product.update({ currentStock: balanceAfter }, { transaction });
        await StockHistory.create({
          productId: product.id,
          type: 'outbound',
          quantity: item.quantity,
          balanceBefore,
          balanceAfter,
          reference: req.params.id,
          referenceType: 'request',
          userId: req.user.id,
          reason: `출고: ${request.requestNumber}`,
          notes: `요청항목: ${item.id}`
        }, { transaction });
      }

      await request.update({
        status: 'released',
        releaserId: req.user.id,
        releasedAt: new Date()
      }, { transaction });
    }

    await transaction.commit();

    // 요청사항: 로컬 출고처리 완료 후 그룹웨어 자동처리 수행
    if (isGw && gwDocIdForAction) {
      try {
        gwActionResult = await runGwDocAction(gwDocIdForAction);
      } catch (e) {
        gwActionError = e.message;
        console.error('GW post-release action failed:', e.message);
      }
    }

    res.json({
      success: true,
      message: gwActionError ? '출고 완료 (그룹웨어 자동 처리 실패)' : '출고 완료',
      requestNumber: request.requestNumber,
      gwAction: gwActionResult,
      gwActionError
    });
  } catch (err) {
    if (transaction) await transaction.rollback();
    console.error('Release error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
