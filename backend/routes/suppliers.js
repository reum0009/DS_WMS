const express = require('express');
const { auth } = require('../middleware/auth');
const router = express.Router();

// GET all suppliers
router.get('/', auth, async (req, res) => {
  try {
    const { Supplier } = global.sequelize.models;
    const rows = await Supplier.findAll({ order: [['supplierName', 'ASC']] });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single supplier
router.get('/:id', auth, async (req, res) => {
  try {
    const { Supplier } = global.sequelize.models;
    const s = await Supplier.findByPk(req.params.id);
    if (!s) return res.status(404).json({ error: '공급업체를 찾을 수 없습니다' });
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create supplier
router.post('/', auth, async (req, res) => {
  try {
    const { Supplier } = global.sequelize.models;
    const { supplierName, contactPerson, phone, email, address } = req.body;
    if (!supplierName) return res.status(400).json({ error: '공급업체명은 필수입니다' });

    // auto-generate code
    const count = await Supplier.count();
    const supplierCode = `SUP-${String(count + 1).padStart(4, '0')}`;

    const s = await Supplier.create({ supplierCode, supplierName, contactPerson, phone, email, address });
    res.status(201).json(s);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update supplier
router.put('/:id', auth, async (req, res) => {
  try {
    const { Supplier } = global.sequelize.models;
    const s = await Supplier.findByPk(req.params.id);
    if (!s) return res.status(404).json({ error: '공급업체를 찾을 수 없습니다' });
    await s.update(req.body);
    res.json(s);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE (soft)
router.delete('/:id', auth, async (req, res) => {
  try {
    const { Supplier } = global.sequelize.models;
    const s = await Supplier.findByPk(req.params.id);
    if (!s) return res.status(404).json({ error: '공급업체를 찾을 수 없습니다' });
    await s.update({ isActive: false });
    res.json({ message: '비활성화 완료' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
