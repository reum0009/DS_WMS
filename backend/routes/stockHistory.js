const express = require('express');
const { auth, roleAuth } = require('../middleware/auth');

const router = express.Router();

// Get stock history for a product
router.get('/product/:productId', auth, roleAuth(['admin', 'warehouse']), async (req, res) => {
  try {
    const { StockHistory, User, Product } = global.sequelize.models;
    const history = await StockHistory.findAll({
      where: { productId: req.params.productId },
      include: [
        { model: User, attributes: ['name', 'email'] },
        { model: Product, attributes: ['productCode', 'productName', 'specification'] }
      ],
      order: [['createdAt', 'DESC']],
      limit: 100
    });
    res.json(history);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Get all stock history with filters
router.get('/', auth, roleAuth(['admin']), async (req, res) => {
  try {
    const { StockHistory, User, Product } = global.sequelize.models;
    const { type, startDate, endDate } = req.query;
    
    const where = {};
    if (type) where.type = type;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.$lte = end;
      }
    }

    const history = await StockHistory.findAll({
      where,
      include: [
        { model: User, attributes: ['name', 'email', 'role'] },
        { model: Product, attributes: ['productCode', 'productName', 'specification', 'category'] }
      ],
      order: [['createdAt', 'DESC']],
      limit: 500
    });
    res.json(history);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Get stock history by reference (request ID)
router.get('/reference/:reference', auth, roleAuth(['admin', 'warehouse']), async (req, res) => {
  try {
    const { StockHistory, User, Product } = global.sequelize.models;
    const history = await StockHistory.findAll({
      where: { reference: req.params.reference },
      include: [
        { model: User, attributes: ['name', 'email'] },
        { model: Product, attributes: ['productCode', 'productName', 'specification'] }
      ],
      order: [['createdAt', 'DESC']]
    });
    res.json(history);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
