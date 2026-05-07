const express = require('express');
const { Op } = require('sequelize');
const { auth, roleAuth } = require('../middleware/auth');
const { completeGwDocRelease } = require('../services/gwDocAutomation');

const router = express.Router();

function normName(v) {
  return String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function selectedProductIdFor(body, keys = []) {
  const selections = body?.productSelections || body?.itemProductIds || {};
  for (const key of keys) {
    const v = selections[key];
    const id = parseInt(v, 10);
    if (Number.isInteger(id) && id > 0) return id;
  }
  const fallback = parseInt(body?.productId, 10);
  return Number.isInteger(fallback) && fallback > 0 ? fallback : null;
}

async function warehouseQty(ProductWarehouseStock, productId, warehouseId, transaction) {
  if (!warehouseId) return null;
  const row = await ProductWarehouseStock.findOne({ where: { productId, warehouseId }, transaction });
  return row ? (parseInt(row.currentStock, 10) || 0) : 0;
}

async function totalWarehouseQty(ProductWarehouseStock, productId, transaction) {
  const rows = await ProductWarehouseStock.findAll({ where: { productId }, attributes: ['currentStock'], transaction });
  return rows.reduce((sum, row) => sum + (parseInt(row.currentStock, 10) || 0), 0);
}

async function deductProductStock({ Product, ProductWarehouseStock, product, quantity, warehouseId, transaction }) {
  const qty = Number(quantity) || 0;
  if (qty <= 0) throw new Error('출고 수량을 확인해주세요');

  const scopedQty = await warehouseQty(ProductWarehouseStock, product.id, warehouseId, transaction);
  const available = scopedQty === null ? (parseInt(product.currentStock, 10) || 0) : scopedQty;
  if (available < qty) {
    throw new Error(`재고 부족: ${product.productName}(보유: ${available}, 필요: ${qty})`);
  }

  let pwsBefore = null;
  if (warehouseId) {
    const [pws] = await ProductWarehouseStock.findOrCreate({
      where: { productId: product.id, warehouseId },
      defaults: { productId: product.id, warehouseId, currentStock: 0, safetyStock: 0 },
      transaction,
    });
    pwsBefore = parseInt(pws.currentStock, 10) || 0;
    await pws.update({ currentStock: pwsBefore - qty }, { transaction });
  }

  const totalBefore = parseInt(product.currentStock, 10) || 0;
  const totalAfter = warehouseId
    ? await totalWarehouseQty(ProductWarehouseStock, product.id, transaction)
    : totalBefore - qty;
  await Product.update({ currentStock: totalAfter }, { where: { id: product.id }, transaction });

  return { balanceBefore: warehouseId ? pwsBefore : totalBefore, balanceAfter: warehouseId ? pwsBefore - qty : totalAfter };
}

async function chooseReleaseProduct({ Product, ProductWarehouseStock, products, requestedName, quantity, warehouseId, selectedProductId, transaction }) {
  const requestedKey = normName(requestedName);
  let candidates = Array.isArray(products) ? products.filter(Boolean) : [];

  if (selectedProductId) {
    const selected = await Product.findByPk(selectedProductId, { transaction });
    if (!selected) throw new Error('선택한 출고 품목이 존재하지 않습니다');
    if (requestedKey && normName(selected.productName) !== requestedKey) {
      throw new Error(`선택한 품목명이 요청 품목명과 다릅니다: ${selected.productName}`);
    }
    candidates = [selected, ...candidates.filter(p => Number(p.id) !== Number(selected.id))];
  }

  if (requestedKey) {
    const sameName = await Product.findAll({
      where: { productName: requestedName, isActive: true },
      transaction,
    });
    const seen = new Set(candidates.map(p => Number(p.id)));
    sameName.forEach(p => { if (!seen.has(Number(p.id))) candidates.push(p); });
  }

  if (!candidates.length) throw new Error(`출고 품목을 찾을 수 없습니다: "${requestedName}"`);

  const withStock = [];
  for (const p of candidates) {
    const wh = await warehouseQty(ProductWarehouseStock, p.id, warehouseId, transaction);
    const stock = wh === null ? (parseInt(p.currentStock, 10) || 0) : wh;
    withStock.push({ product: p, stock });
  }

  withStock.sort((a, b) => {
    const aEnough = a.stock >= quantity ? 1 : 0;
    const bEnough = b.stock >= quantity ? 1 : 0;
    if (aEnough !== bEnough) return bEnough - aEnough;
    return b.stock - a.stock;
  });

  const best = withStock[0];
  if (!best || best.stock < quantity) {
    const name = best?.product?.productName || requestedName;
    throw new Error(`재고 부족: ${name}(보유: ${best?.stock || 0}, 필요: ${quantity})`);
  }
  return best.product;
}

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
          include: [{ model: Product, attributes: ['productCode', 'productName', 'specification', 'unit', 'currentStock'] }]
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
  const { Request, RequestItem, Product, StockHistory, GwProductMapping, ProductWarehouseStock } = sequelize.models;
  const { query } = require('../config/groupwareDb');
  let gwActionResult = null;
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

      const candidateDocIds = app26Res.rows.map(r => String(r.id));
      const mappings = candidateDocIds.length > 0
        ? await GwProductMapping.findAll({
          where: { gwDocId: { [Op.in]: candidateDocIds } },
          order: [['updatedAt', 'DESC']],
          transaction
        })
        : [];
      // 후보 중 매핑이 있는 문서를 우선 선택
      const mappedProducts = [];
      for (const m of mappings.filter(m => candidateDocIds.includes(String(m.gwDocId)))) {
        const mapped = await Product.findByPk(m.productId, { transaction });
        if (mapped) mappedProducts.push(mapped);
      }

      if (!existing) {
      const selectedProductId = selectedProductIdFor(req.body, [`item-GW-${gwId}`, `GW-${gwId}`, gwId]);
      const product = await chooseReleaseProduct({
        Product,
        ProductWarehouseStock,
        products: mappedProducts,
        requestedName: itemName,
        quantity,
        warehouseId: targetWarehouseId,
        selectedProductId,
        transaction,
      });

      // 4. 로컬 Request 생성 (released 상태로 바로 생성)
      request = await Request.create({
        requestNumber: req.params.id,
        type: 'goods',
        category: 'Groupware',
        description: vals['_tyziwi30c'] || '',
        quantity: quantity,
        amount: parseFloat(product.unitPrice) * quantity,
        warehouseId: targetWarehouseId,
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
      const { balanceBefore, balanceAfter } = await deductProductStock({
        Product,
        ProductWarehouseStock,
        product,
        quantity,
        warehouseId: targetWarehouseId,
        transaction,
      });

      await StockHistory.create({
        productId: product.id,
        type: 'outbound',
        quantity: quantity,
        balanceBefore,
        balanceAfter,
        reference: req.params.id,
        referenceType: 'request',
        userId: req.user.id,
        warehouseId: targetWarehouseId,
        reason: `GW 출고: ${req.params.id}`,
        notes: `GW문서: ${gwId}, 신청자: ${docRes.rows[0].user_name}`
      }, { transaction });
      } else {
        if (existing.status !== 'released') {
          const selectedProductId = selectedProductIdFor(req.body, [`item-GW-${gwId}`, `GW-${gwId}`, gwId]);
          const product = await chooseReleaseProduct({
            Product,
            ProductWarehouseStock,
            products: mappedProducts,
            requestedName: itemName,
            quantity,
            warehouseId: targetWarehouseId,
            selectedProductId,
            transaction,
          });

          await RequestItem.destroy({ where: { requestId: existing.id }, transaction });
          await RequestItem.create({
            requestId: existing.id,
            productId: product.id,
            quantity,
            unitPrice: product.unitPrice,
            subtotal: parseFloat(product.unitPrice) * quantity
          }, { transaction });

          const { balanceBefore, balanceAfter } = await deductProductStock({
            Product,
            ProductWarehouseStock,
            product,
            quantity,
            warehouseId: targetWarehouseId,
            transaction,
          });

          await StockHistory.create({
            productId: product.id,
            type: 'outbound',
            quantity,
            balanceBefore,
            balanceAfter,
            reference: req.params.id,
            referenceType: 'request',
            userId: req.user.id,
            warehouseId: targetWarehouseId,
            reason: `GW 출고: ${req.params.id}`,
            notes: `GW문서: ${gwId}, 신청자: ${docRes.rows[0].user_name}, 완료취소 후 재출고`
          }, { transaction });

          await existing.update({
            status: 'released',
            quantity,
            amount: parseFloat(product.unitPrice) * quantity,
            warehouseId: targetWarehouseId,
            releaserId: req.user.id,
            releasedAt: new Date(),
          }, { transaction });
          request = existing;
        } else {

        const historyCount = await StockHistory.count({
          where: {
            reference: req.params.id,
            referenceType: 'request',
            type: 'outbound',
          },
          transaction,
        });

        if (historyCount > 0) {
          // GW 완료취소 후 재출고: WMS 재고는 이미 차감된 이력이 있으므로
          // 그룹웨어 출고 액션만 다시 수행한다.
          request = existing;
        } else {
          const selectedProductId = selectedProductIdFor(req.body, [`item-GW-${gwId}`, `GW-${gwId}`, gwId]);
          const product = await chooseReleaseProduct({
            Product,
            ProductWarehouseStock,
            products: [],
            requestedName: itemName,
            quantity,
            warehouseId: targetWarehouseId,
            selectedProductId,
            transaction,
          });

          await RequestItem.create({
            requestId: existing.id,
            productId: product.id,
            quantity,
            unitPrice: product.unitPrice,
            subtotal: parseFloat(product.unitPrice) * quantity
          }, { transaction });

          const { balanceBefore, balanceAfter } = await deductProductStock({
            Product,
            ProductWarehouseStock,
            product,
            quantity,
            warehouseId: targetWarehouseId,
            transaction,
          });

          await StockHistory.create({
            productId: product.id,
            type: 'outbound',
            quantity,
            balanceBefore,
            balanceAfter,
            reference: req.params.id,
            referenceType: 'request',
            userId: req.user.id,
            warehouseId: targetWarehouseId,
            reason: `GW 출고: ${req.params.id}`,
            notes: `GW문서: ${gwId}, 신청자: ${docRes.rows[0].user_name}, 누락 출고이력 보정`
          }, { transaction });

          request = existing;
        }
        }
      }

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

      const reqWarehouseId = request.warehouseId ? parseInt(request.warehouseId, 10) : null;

      for (const item of requestItems) {
        const selectedProductId = selectedProductIdFor(req.body, [String(item.id), `item-${item.id}`]);
        const product = await chooseReleaseProduct({
          Product,
          ProductWarehouseStock,
          products: [item.Product],
          requestedName: item.Product?.productName,
          quantity: item.quantity,
          warehouseId: reqWarehouseId,
          selectedProductId,
          transaction,
        });
        const { balanceBefore, balanceAfter } = await deductProductStock({
          Product,
          ProductWarehouseStock,
          product,
          quantity: item.quantity,
          warehouseId: reqWarehouseId,
          transaction,
        });
        if (Number(product.id) !== Number(item.productId)) {
          await item.update({
            productId: product.id,
            unitPrice: product.unitPrice,
            subtotal: parseFloat(product.unitPrice) * item.quantity,
          }, { transaction });
        }

        await StockHistory.create({
          productId: product.id,
          type: 'outbound',
          quantity: item.quantity,
          balanceBefore,
          balanceAfter,
          reference: req.params.id,
          referenceType: 'request',
          userId: req.user.id,
          warehouseId: reqWarehouseId,
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

    // GW 요청은 커밋 전에 그룹웨어 자동처리 수행
    // → 실패 시 트랜잭션 롤백으로 로컬 DB도 원상복구 (WMS 상태 보존)
    if (isGw && gwDocIdForAction) {
      try {
        gwActionResult = await completeGwDocRelease(gwDocIdForAction);
      } catch (e) {
        await transaction.rollback();
        console.error('GW action failed, transaction rolled back:', e.message);
        return res.status(502).json({
          error: `그룹웨어 자동 처리 실패: ${e.message}`,
          detail: '로컬 출고도 취소되었습니다. 그룹웨어 연결을 확인 후 다시 시도하세요.'
        });
      }
    }

    await transaction.commit();

    res.json({
      success: true,
      message: '출고 완료',
      requestNumber: request.requestNumber,
      gwAction: gwActionResult,
    });
  } catch (err) {
    if (transaction) await transaction.rollback();
    console.error('Release error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
