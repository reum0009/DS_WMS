const express = require('express');
const ExcelJS = require('exceljs');
const { auth, roleAuth, adminOnly } = require('../middleware/auth');
const { Op } = require('sequelize');

const router = express.Router();

function getPeriodRange(period = 'today') {
  const now = new Date();
  const start = new Date(now);

  if (period === 'month') {
    start.setDate(1);
  } else if (period === 'week') {
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff);
  }

  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function emptySummary(period, warehouseId, start, end) {
  return {
    period,
    warehouseId: warehouseId || null,
    range: { start, end },
    stats: {
      inboundCount: 0,
      outboundCount: 0,
      inboundQty: 0,
      outboundQty: 0,
      inboundAmt: 0,
      outboundAmt: 0,
      netQty: 0,
    },
    byCategory: [],
    byProduct: [],
    recent: [],
  };
}

// Warehouse report summary
router.get('/warehouse-summary', auth, roleAuth(['admin', 'dept_admin', 'warehouse']), async (req, res) => {
  try {
    const { StockHistory, Product, User } = global.sequelize.models;
    const period = ['today', 'week', 'month'].includes(req.query.period) ? req.query.period : 'today';
    const { start, end } = getPeriodRange(period);
    const requestedWarehouseId = req.query.warehouseId ? parseInt(req.query.warehouseId, 10) : null;
    const warehouseId = req.user.role === 'warehouse'
      ? (requestedWarehouseId || req.user.warehouseId || null)
      : requestedWarehouseId;

    const where = {
      createdAt: { [Op.between]: [start, end] },
    };
    if (warehouseId) where.warehouseId = warehouseId;

    const histories = await StockHistory.findAll({
      where,
      include: [
        { model: Product, attributes: ['id', 'productCode', 'productName', 'specification', 'category', 'categoryId', 'unit', 'unitPrice'] },
        { model: User, attributes: ['id', 'name'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: 1000,
    });

    if (!histories.length) {
      return res.json(emptySummary(period, warehouseId, start, end));
    }

    const summary = emptySummary(period, warehouseId, start, end);
    const categoryMap = new Map();
    const productMap = new Map();

    for (const row of histories) {
      const qty = Number(row.quantity) || 0;
      const unitPrice = Number(row.Product?.unitPrice) || 0;
      const amount = qty * unitPrice;
      const isInbound = row.type === 'inbound';
      const isOutbound = row.type === 'outbound';

      if (isInbound) {
        summary.stats.inboundCount += 1;
        summary.stats.inboundQty += qty;
        summary.stats.inboundAmt += amount;
      } else if (isOutbound) {
        summary.stats.outboundCount += 1;
        summary.stats.outboundQty += qty;
        summary.stats.outboundAmt += amount;
      }

      const categoryName = row.Product?.category || '미분류';
      if (!categoryMap.has(categoryName)) {
        categoryMap.set(categoryName, { name: categoryName, inboundQty: 0, outboundQty: 0, inboundAmt: 0, outboundAmt: 0 });
      }
      const category = categoryMap.get(categoryName);
      if (isInbound) {
        category.inboundQty += qty;
        category.inboundAmt += amount;
      } else if (isOutbound) {
        category.outboundQty += qty;
        category.outboundAmt += amount;
      }

      const productId = row.productId;
      if (!productMap.has(productId)) {
        productMap.set(productId, {
          productId,
          productCode: row.Product?.productCode || '',
          productName: row.Product?.productName || '삭제된 품목',
          specification: row.Product?.specification || '',
          unit: row.Product?.unit || '',
          inboundQty: 0,
          outboundQty: 0,
          inboundAmt: 0,
          outboundAmt: 0,
        });
      }
      const product = productMap.get(productId);
      if (isInbound) {
        product.inboundQty += qty;
        product.inboundAmt += amount;
      } else if (isOutbound) {
        product.outboundQty += qty;
        product.outboundAmt += amount;
      }
    }

    summary.stats.netQty = summary.stats.inboundQty - summary.stats.outboundQty;
    summary.byCategory = Array.from(categoryMap.values())
      .map((row) => ({ ...row, netQty: row.inboundQty - row.outboundQty }))
      .sort((a, b) => (b.inboundQty + b.outboundQty) - (a.inboundQty + a.outboundQty));
    summary.byProduct = Array.from(productMap.values())
      .map((row) => ({ ...row, netQty: row.inboundQty - row.outboundQty }))
      .sort((a, b) => (b.inboundQty + b.outboundQty) - (a.inboundQty + a.outboundQty))
      .slice(0, 50);
    summary.recent = histories.slice(0, 50).map((row) => ({
      id: row.id,
      type: row.type,
      quantity: Number(row.quantity) || 0,
      reference: row.reference,
      reason: row.reason,
      notes: row.notes,
      createdAt: row.createdAt,
      userName: row.User?.name || '',
      productCode: row.Product?.productCode || '',
      productName: row.Product?.productName || '삭제된 품목',
      specification: row.Product?.specification || '',
      unit: row.Product?.unit || '',
    }));

    res.json(summary);
  } catch (err) {
    console.error('Warehouse report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get statistics (Admin only)
router.get('/stats', auth, adminOnly, async (req, res) => {
  try {
    const { Request } = global.sequelize.models;
    const totalRequests = await Request.count();
    const pending = await Request.count({ where: { status: 'pending' } });
    const approved = await Request.count({ where: { status: 'approved' } });
    const rejected = await Request.count({ where: { status: 'rejected' } });
    const released = await Request.count({ where: { status: 'released' } });

    const completionRate = totalRequests > 0 ? ((approved + rejected + released) / totalRequests * 100).toFixed(2) : 0;

    res.json({
      totalRequests,
      pending,
      approved,
      rejected,
      released,
      completionRate: `${completionRate}%`
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Get category stats (Admin only)
router.get('/category-stats', auth, adminOnly, async (req, res) => {
  try {
    const { Request, sequelize } = global;
    const stats = await Request.findAll({
      attributes: [
        'category',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['category'],
      raw: true
    });

    // 클라이언트에서 집계하기
    const result = stats.map(s => ({
      category: s.category,
      count: parseInt(s.count),
      completionRate: 0
    }));

    res.json(result);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Export to Excel (Admin only)
router.get('/export', auth, adminOnly, async (req, res) => {
  try {
    const { Request, User } = global.sequelize.models;
    const requests = await Request.findAll({
      include: [
        { model: User, as: 'applicant', attributes: ['name', 'email'] },
        { model: User, as: 'approver', attributes: ['name', 'email'] },
        { model: User, as: 'releaser', attributes: ['name', 'email'] }
      ]
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Requests');

    worksheet.columns = [
      { header: 'Request Number', key: 'requestNumber', width: 15 },
      { header: 'Type', key: 'type', width: 10 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Description', key: 'description', width: 30 },
      { header: 'Amount', key: 'amount', width: 10 },
      { header: 'Quantity', key: 'quantity', width: 10 },
      { header: 'Applicant', key: 'applicant', width: 15 },
      { header: 'Approver', key: 'approver', width: 15 },
      { header: 'Releaser', key: 'releaser', width: 15 },
      { header: 'Status', key: 'status', width: 10 },
      { header: 'Created At', key: 'createdAt', width: 15 },
      { header: 'Approved At', key: 'approvedAt', width: 15 },
      { header: 'Released At', key: 'releasedAt', width: 15 },
      { header: 'Rejection Reason', key: 'rejectionReason', width: 20 }
    ];

    requests.forEach(request => {
      worksheet.addRow({
        requestNumber: request.requestNumber,
        type: request.type,
        category: request.category,
        description: request.description,
        amount: request.amount,
        quantity: request.quantity,
        applicant: request.applicant?.name || '',
        approver: request.approver?.name || '',
        releaser: request.releaser?.name || '',
        status: request.status,
        createdAt: request.createdAt,
        approvedAt: request.approvedAt,
        releasedAt: request.releasedAt,
        rejectionReason: request.rejectionReason
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=requests.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
