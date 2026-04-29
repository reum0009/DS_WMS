const express = require('express');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get all request items for a specific request
router.get('/request/:requestId', auth, async (req, res) => {
  try {
    const { RequestItem, Product, Warehouse } = global.sequelize.models;
    const items = await RequestItem.findAll({
      where: { requestId: req.params.requestId },
      include: [
        {
          model: Product,
          include: [{ model: Warehouse }]
        }
      ]
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add product to request
router.post('/', auth, async (req, res) => {
  try {
    const { RequestItem, Product, Request } = global.sequelize.models;
    const { requestId, productId, quantity } = req.body;

    if (!requestId || !productId || !quantity) {
      return res.status(400).json({ error: '필수 정보가 누락되었습니다' });
    }

    // 상품 확인
    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ error: '상품을 찾을 수 없습니다' });
    }

    // 신청 확인
    const request = await Request.findByPk(requestId);
    if (!request) {
      return res.status(404).json({ error: '신청을 찾을 수 없습니다' });
    }

    // 신청이 pending 상태인지 확인
    if (request.status !== 'pending') {
      return res.status(400).json({ error: '진행 중인 신청에만 상품을 추가할 수 있습니다' });
    }

    const subtotal = parseFloat(product.unitPrice) * parseInt(quantity);

    // 기존 항목 확인
    const existing = await RequestItem.findOne({
      where: { requestId, productId }
    });

    if (existing) {
      // 기존 항목이면 수량 업데이트
      const newQuantity = parseInt(existing.quantity) + parseInt(quantity);
      const newSubtotal = parseFloat(product.unitPrice) * newQuantity;
      
      await existing.update({
        quantity: newQuantity,
        subtotal: newSubtotal
      });

      return res.json(existing);
    }

    // 새 항목 생성
    const item = await RequestItem.create({
      requestId,
      productId,
      quantity: parseInt(quantity),
      unitPrice: product.unitPrice,
      subtotal
    });

    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update request item quantity
router.put('/:id', auth, async (req, res) => {
  try {
    const { RequestItem, Product } = global.sequelize.models;
    const { quantity } = req.body;

    const item = await RequestItem.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({ error: '항목을 찾을 수 없습니다' });
    }

    if (quantity && quantity > 0) {
      const subtotal = parseFloat(item.unitPrice) * parseInt(quantity);
      await item.update({
        quantity: parseInt(quantity),
        subtotal
      });
    }

    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete request item
router.delete('/:id', auth, async (req, res) => {
  try {
    const { RequestItem } = global.sequelize.models;
    const item = await RequestItem.findByPk(req.params.id);

    if (!item) {
      return res.status(404).json({ error: '항목을 찾을 수 없습니다' });
    }

    await item.destroy();
    res.json({ message: '항목이 삭제되었습니다' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get request total (all items summary)
router.get('/summary/:requestId', auth, async (req, res) => {
  try {
    const { RequestItem } = global.sequelize.models;
    const items = await RequestItem.findAll({
      where: { requestId: req.params.requestId }
    });

    const summary = {
      itemCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      totalAmount: items.reduce((sum, item) => sum + parseFloat(item.subtotal), 0)
    };

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
