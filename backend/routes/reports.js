const express = require('express');
const ExcelJS = require('exceljs');
const { auth, roleAuth, adminOnly } = require('../middleware/auth');
const { Op } = require('sequelize');

const router = express.Router();

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