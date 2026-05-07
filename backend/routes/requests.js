const express = require('express');
const { auth, roleAuth, verifyRequestOwnership } = require('../middleware/auth');

const router = express.Router();

// Create request with RequestItems (transaction handling)
router.post('/', auth, roleAuth(['applicant', 'admin']), async (req, res) => {
  const sequelize = global.sequelize;
  const transaction = await sequelize.transaction();
  
  const { type, category, description, items, warehouseId, status, source } = req.body;
  const isWmsRequest = source === 'wms' || category === 'WMS';
  const requestNumber = `${isWmsRequest ? 'WMS' : 'REQ'}-${Date.now()}`;
  const parsedWarehouseId = warehouseId ? parseInt(warehouseId, 10) : null;
  
  try {
    const { Request, RequestItem, Product, Warehouse } = sequelize.models;
    
    // 입력 검증
    if (!items || !Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ error: '최소 1개 이상의 품목이 필요합니다' });
    }

    // 모든 상품 존재 여부 검증
    const productIds = items.map(item => item.productId);
    const products = await Product.findAll({
      where: { id: productIds },
      transaction
    });

    if (products.length !== items.length) {
      await transaction.rollback();
      return res.status(400).json({ error: '존재하지 않는 상품이 있습니다' });
    }

    // 상품 맵 생성 (빠른 조회용)
    if (parsedWarehouseId) {
      const warehouse = await Warehouse.findByPk(parsedWarehouseId, { transaction });
      if (!warehouse) {
        await transaction.rollback();
        return res.status(400).json({ error: '선택한 창고를 찾을 수 없습니다.' });
      }
    }

    const productMap = {};
    products.forEach(p => {
      productMap[p.id] = p;
    });

    // 총액 계산
    let totalAmount = 0;
    const validatedItems = [];
    
    for (const item of items) {
      const product = productMap[item.productId];
      if (!product) {
        await transaction.rollback();
        return res.status(400).json({ error: `상품 ${item.productId}을(를) 찾을 수 없습니다` });
      }
      if (item.quantity <= 0) {
        await transaction.rollback();
        return res.status(400).json({ error: '수량은 1 이상이어야 합니다' });
      }

      const subtotal = parseFloat(product.unitPrice) * item.quantity;
      totalAmount += subtotal;
      
      validatedItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: product.unitPrice,
        subtotal: subtotal
      });
    }

    // Request 생성
    const request = await Request.create({
      requestNumber,
      type,
      category,
      description: description || '',
      quantity: validatedItems.reduce((sum, item) => sum + item.quantity, 0),
      amount: totalAmount,
      applicantId: req.user.id,
      warehouseId: parsedWarehouseId,
      status: status === 'approved' ? 'approved' : 'pending',
      approvedAt: status === 'approved' ? new Date() : null
    }, { transaction });

    // RequestItem 다중 생성 (bulkCreate)
    const requestItems = await RequestItem.bulkCreate(
      validatedItems.map(item => ({
        requestId: request.id,
        ...item
      })),
      { transaction }
    );

    // 트랜잭션 커밋
    await transaction.commit();

    // 응답 - 생성된 Request와 Items 포함
    res.status(201).json({
      success: true,
      request: {
        id: request.id,
        requestNumber: request.requestNumber,
        type: request.type,
        category: request.category,
        quantity: request.quantity,
        amount: request.amount,
        status: request.status,
        applicantId: request.applicantId,
        warehouseId: request.warehouseId,
        items: validatedItems
      }
    });
  } catch (err) {
    await transaction.rollback();
    console.error('Request creation error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Get all requests for user
router.get('/', auth, async (req, res) => {
  try {
    const { Request, User, RequestItem, Product, Warehouse } = global.sequelize.models;
    let requests;
    if (['admin', 'warehouse', 'releaser', 'dept_admin'].includes(req.user.role)) {
      requests = await Request.findAll({
        include: [
          { model: User, as: 'applicant', attributes: ['name', 'email'] },
          { model: User, as: 'approver', attributes: ['name', 'email'] },
          { model: User, as: 'releaser', attributes: ['name', 'email'] },
          { model: Warehouse, as: 'warehouse', attributes: ['id', 'warehouseName', 'location'] },
          {
            model: RequestItem,
            as: 'items',
            include: [{ model: Product, attributes: ['productCode', 'productName', 'specification', 'unit'] }]
          }
        ]
      });
    } else {
      requests = await Request.findAll({
        where: { applicantId: req.user.id },
        include: [
          { model: User, as: 'applicant', attributes: ['name', 'email'] },
          { model: User, as: 'approver', attributes: ['name', 'email'] },
          { model: User, as: 'releaser', attributes: ['name', 'email'] },
          { model: Warehouse, as: 'warehouse', attributes: ['id', 'warehouseName', 'location'] },
          {
            model: RequestItem,
            as: 'items',
            include: [{ model: Product, attributes: ['productCode', 'productName', 'specification', 'unit'] }]
          }
        ]
      });
    }
    res.json(requests);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Get request by id
router.get('/:id', auth, verifyRequestOwnership, async (req, res) => {
  try {
    const { Request, User, RequestItem, Product, Warehouse } = global.sequelize.models;
    const request = await Request.findByPk(req.params.id, {
      include: [
        { model: User, as: 'applicant', attributes: ['name', 'email'] },
        { model: User, as: 'approver', attributes: ['name', 'email'] },
        { model: User, as: 'releaser', attributes: ['name', 'email'] },
        { model: Warehouse, as: 'warehouse', attributes: ['id', 'warehouseName', 'location'] },
        {
          model: RequestItem,
          as: 'items',
          include: [{ model: Product, attributes: ['productCode', 'productName', 'specification', 'unit', 'currentStock'] }]
        }
      ]
    });
    if (!request) return res.status(404).send('Request not found');
    res.json(request);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Update request
router.put('/:id', auth, verifyRequestOwnership, roleAuth(['applicant', 'admin']), async (req, res) => {
  try {
    const { Request } = global.sequelize.models;
    const request = await Request.findByPk(req.params.id);
    if (!request) return res.status(404).send('Request not found');
    if (request.applicantId !== req.user.id && req.user.role !== 'admin') return res.status(403).send('Access denied');
    if (request.status !== 'pending') return res.status(400).send('Cannot update non-pending request');

    const updates = req.body;
    await request.update(updates);
    res.json(request);
  } catch (err) {
    res.status(400).send(err.message);
  }
});

// Delete request
router.delete('/:id', auth, verifyRequestOwnership, roleAuth(['applicant', 'admin']), async (req, res) => {
  try {
    const { Request } = global.sequelize.models;
    const request = await Request.findByPk(req.params.id);
    if (!request) return res.status(404).send('Request not found');
    if (request.applicantId !== req.user.id && req.user.role !== 'admin') return res.status(403).send('Access denied');
    if (request.status !== 'pending') return res.status(400).send('Cannot delete non-pending request');

    await request.destroy();
    res.send('Request deleted');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
