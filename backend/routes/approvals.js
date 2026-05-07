const express = require('express');
const { auth, roleAuth } = require('../middleware/auth');

const router = express.Router();

// Get pending requests for approval
router.get('/pending', auth, roleAuth(['approver', 'admin']), async (req, res) => {
  try {
    const { Request, User, RequestItem, Product } = global.sequelize.models;
    const requests = await Request.findAll({
      where: { status: 'pending' },
      include: [
        { model: User, as: 'applicant', attributes: ['name', 'email'] },
        {
          model: RequestItem,
          as: 'items',
          include: [{ model: Product, attributes: ['productCode', 'productName', 'specification', 'currentStock', 'unit'] }]
        }
      ]
    });
    res.json(requests);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Approve request with stock validation
router.put('/:id/approve', auth, roleAuth(['approver', 'admin']), async (req, res) => {
  const sequelize = global.sequelize;
  const transaction = await sequelize.transaction();
  
  try {
    const { Request, RequestItem, Product } = sequelize.models;
    const request = await Request.findByPk(req.params.id, { transaction });
    
    if (!request) {
      await transaction.rollback();
      return res.status(404).json({ error: '요청을 찾을 수 없습니다' });
    }
    if (request.status !== 'pending') {
      await transaction.rollback();
      return res.status(400).json({ error: '대기 중인 요청만 승인할 수 있습니다' });
    }

    // RequestItem과 Product 정보 조회
    const requestItems = await RequestItem.findAll({
      where: { requestId: req.params.id },
      include: [{ model: Product }],
      transaction
    });

    // 재고 유효성 검증 (승인 시점)
    const stockIssues = [];
    for (const item of requestItems) {
      if (item.Product.currentStock < item.quantity) {
        stockIssues.push({
          productName: item.Product.productName,
          required: item.quantity,
          available: item.Product.currentStock
        });
      }
    }

    if (stockIssues.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: '재고 부족으로 승인할 수 없습니다',
        details: stockIssues
      });
    }

    // Request 승인 상태 업데이트
    await request.update({
      status: 'approved',
      approverId: req.user.id,
      approvedAt: new Date()
    }, { transaction });

    await transaction.commit();
    res.json({
      success: true,
      message: '요청이 승인되었습니다',
      request: {
        id: request.id,
        requestNumber: request.requestNumber,
        status: request.status,
        approvedAt: request.approvedAt
      }
    });
  } catch (err) {
    await transaction.rollback();
    console.error('Approval error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Reject request
router.put('/:id/reject', auth, roleAuth(['approver', 'admin']), async (req, res) => {
  const { rejectionReason } = req.body;
  const sequelize = global.sequelize;
  const transaction = await sequelize.transaction();
  
  try {
    const { Request } = sequelize.models;
    const request = await Request.findByPk(req.params.id, { transaction });
    
    if (!request) {
      await transaction.rollback();
      return res.status(404).json({ error: '요청을 찾을 수 없습니다' });
    }
    if (request.status !== 'pending') {
      await transaction.rollback();
      return res.status(400).json({ error: '대기 중인 요청만 반려할 수 있습니다' });
    }

    await request.update({
      status: 'rejected',
      approverId: req.user.id,
      rejectionReason: rejectionReason || '관리자 판단',
      approvedAt: new Date()
    }, { transaction });

    await transaction.commit();
    res.json({
      success: true,
      message: '요청이 반려되었습니다',
      request: {
        id: request.id,
        requestNumber: request.requestNumber,
        status: request.status,
        rejectionReason: request.rejectionReason
      }
    });
  } catch (err) {
    await transaction.rollback();
    console.error('Rejection error:', err);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
