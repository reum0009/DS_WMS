const express = require('express');
const { auth, roleAuth } = require('../middleware/auth');
const { Op } = require('sequelize');

const router = express.Router();

function parseWarehouseScope(req) {
  const q = req.query?.warehouseId;
  if (q !== undefined && q !== null && String(q).trim() !== '') {
    const v = parseInt(q, 10);
    if (Number.isInteger(v) && v > 0) return v;
  }
  if (req.user?.role === 'warehouse' && req.user?.warehouseId) {
    const v = parseInt(req.user.warehouseId, 10);
    if (Number.isInteger(v) && v > 0) return v;
  }
  return null;
}

// Get dashboard statistics
router.get('/stats', auth, roleAuth(['admin', 'warehouse']), async (req, res) => {
  try {
    const { Request, RequestItem, Product, User, Warehouse, StockHistory } = global.sequelize.models;
    const sequelize = global.sequelize;
    const { Op } = require('sequelize');

    // Today's stats (KST 기준 오늘 0시 계산)
    const nowKST = new Date(new Date().getTime() + (9 * 60 * 60 * 1000)); // UTC -> KST 보정 (필요한 경우만)
    // 하지만 보통 서버 환경에서는 아래 방식이 더 안전합니다.
    const todayKST = new Date();
    todayKST.setHours(todayKST.getHours() + 9); // 서버가 UTC일 경우 KST로 변환
    
    const start = new Date();
    start.setHours(0, 0, 0, 0); 
    // 만약 서버 시간이 UTC라면, 한국 시간 0시는 서버 시간으로 전날 15시입니다.
    // 안전하게 "현재 시간 기준 최근 24시간"이 아닌 "달력상 오늘"을 잡기 위해 
    // DB의 date_format 기능을 활용하거나 아래와 같이 범위를 넉넉히 잡습니다.
    
    const todayStart = new Date();
    todayStart.setHours(0,0,0,0);

    const todayInbound = await StockHistory.sum('quantity', {
      where: {
        type: 'inbound',
        createdAt: { [Op.gte]: todayStart }
      }
    }) || 0;

    const todayOutbound = await StockHistory.sum('quantity', {
      where: {
        type: 'outbound',
        createdAt: { [Op.gte]: todayStart }
      }
    }) || 0;

    // Request statistics
    const totalRequests = await Request.count();
    const pendingRequests = await Request.count({ where: { status: 'pending' } });
    const approvedRequests = await Request.count({ where: { status: 'approved' } });
    const rejectedRequests = await Request.count({ where: { status: 'rejected' } });
    const releasedRequests = await Request.count({ where: { status: 'released' } });

    // Approval rate calculation
    const totalProcessed = approvedRequests + rejectedRequests;
    const approvalRate = totalProcessed > 0 ? ((approvedRequests / totalProcessed) * 100).toFixed(1) : 0;

    // Inventory statistics
    const totalProducts = await Product.count();
    const lowStockProducts = await Product.count({
      where: sequelize.literal('currentStock <= safetyStock')
    });
    const outOfStockProducts = await Product.count({ where: { currentStock: 0 } });
    const totalInventoryValue = await Product.sum('currentStock') || 0;

    // Recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentRequestsCount = await Request.count({
      where: {
        createdAt: { [Op.gte]: sevenDaysAgo }
      }
    });

    const recentReleasesCount = await Request.count({
      where: {
        status: 'released',
        releasedAt: { [Op.gte]: sevenDaysAgo }
      }
    });

    // Average processing times
    const avgApprovalTime = await Request.findAll({
      attributes: [
        [sequelize.fn('AVG', sequelize.fn('TIMESTAMPDIFF', sequelize.literal('HOUR'), sequelize.col('createdAt'), sequelize.col('approvedAt'))), 'avgHours']
      ],
      where: {
        status: { [Op.in]: ['approved', 'rejected'] },
        approvedAt: { [Op.ne]: null }
      },
      raw: true
    });

    const avgReleaseTime = await Request.findAll({
      attributes: [
        [sequelize.fn('AVG', sequelize.fn('TIMESTAMPDIFF', sequelize.literal('HOUR'), sequelize.col('approvedAt'), sequelize.col('releasedAt'))), 'avgHours']
      ],
      where: {
        status: 'released',
        releasedAt: { [Op.ne]: null }
      },
      raw: true
    });

    // Monthly trends (last 6 months)
    const monthlyData = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);

      const monthRequests = await Request.count({
        where: {
          createdAt: { [Op.between]: [monthStart, monthEnd] }
        }
      });

      const monthReleases = await Request.count({
        where: {
          status: 'released',
          releasedAt: { [Op.between]: [monthStart, monthEnd] }
        }
      });

      monthlyData.push({
        month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        requests: monthRequests,
        releases: monthReleases
      });
    }

    // Top requested products
    const topProducts = await RequestItem.findAll({
      attributes: [
        'productId',
        [sequelize.fn('SUM', sequelize.col('quantity')), 'totalQuantity']
      ],
      include: [{
        model: Product,
        attributes: ['productName', 'category']
      }],
      group: ['productId', 'Product.id'],
      order: [[sequelize.fn('SUM', sequelize.col('quantity')), 'DESC']],
      limit: 10,
      raw: true
    });

    // User activity by role
    const userActivity = await User.findAll({
      attributes: [
        'role',
        [sequelize.fn('COUNT', sequelize.col('Requests.id')), 'requestCount']
      ],
      include: [{
        model: Request,
        as: 'requests', // added alias if needed or check association
        required: false,
        attributes: []
      }],
      group: ['User.id', 'role'],
      raw: true
    });

    const activityByRole = {};
    userActivity.forEach(activity => {
      const role = activity.role;
      if (!activityByRole[role]) {
        activityByRole[role] = 0;
      }
      activityByRole[role] += parseInt(activity.requestCount) || 0;
    });

    res.json({
      overview: {
        totalRequests,
        pendingRequests,
        approvedRequests,
        rejectedRequests,
        releasedRequests,
        approvalRate: parseFloat(approvalRate),
        todayInbound,
        todayOutbound
      },
      inventory: {
        totalProducts,
        lowStockProducts,
        outOfStockProducts,
        totalInventoryValue
      },
      performance: {
        avgApprovalTime: avgApprovalTime[0]?.avgHours ? parseFloat(avgApprovalTime[0].avgHours).toFixed(1) : 0,
        avgReleaseTime: avgReleaseTime[0]?.avgHours ? parseFloat(avgReleaseTime[0].avgHours).toFixed(1) : 0,
        recentRequests: recentRequestsCount,
        recentReleases: recentReleasesCount
      },
      trends: monthlyData,
      topProducts: topProducts.map(item => ({
        name: item['Product.productName'],
        category: item['Product.category'],
        totalQuantity: parseInt(item.totalQuantity)
      })),
      activityByRole
    });

  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: '통계 조회 중 오류가 발생했습니다: ' + err.message });
  }
});

// Get low stock alerts
router.get('/alerts/low-stock', auth, roleAuth(['admin', 'warehouse']), async (req, res) => {
  try {
    const { Product, Warehouse, ProductWarehouseStock } = global.sequelize.models;
    const warehouseId = parseWarehouseScope(req);

    // 창고 스코프가 지정된 경우: 창고별 현재고/안전재고 기준 저재고
    if (warehouseId) {
      const rows = await ProductWarehouseStock.findAll({
        where: {
          warehouseId,
          [Op.and]: global.sequelize.where(
            global.sequelize.col('ProductWarehouseStock.currentStock'),
            '<',
            global.sequelize.col('ProductWarehouseStock.safetyStock')
          )
        },
        include: [
          {
            model: Product,
            required: true,
            where: { isActive: true },
            attributes: ['id', 'productCode', 'productName', 'unit', 'unitPrice', 'categoryId']
          },
          { model: Warehouse, as: 'warehouse', attributes: ['id', 'warehouseName'], required: false }
        ],
        order: [['currentStock', 'ASC']]
      });
      const list = rows.map(r => ({
        id: r.Product.id,
        productCode: r.Product.productCode,
        productName: r.Product.productName,
        unit: r.Product.unit,
        unitPrice: r.Product.unitPrice,
        categoryId: r.Product.categoryId,
        currentStock: r.currentStock,
        safetyStock: r.safetyStock,
        warehouseId: r.warehouseId,
        warehouse: r.warehouse || null,
      }));
      return res.json(list);
    }

    // 관리자 통합 조회(기존 호환)
    const lowStockProducts = await Product.findAll({
      where: global.sequelize.literal('currentStock < safetyStock'),
      include: [{ model: Warehouse, attributes: ['warehouseName'] }],
      order: [['currentStock', 'ASC']]
    });
    res.json(lowStockProducts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get recent activity
router.get('/activity/recent', auth, roleAuth(['admin']), async (req, res) => {
  try {
    const { Request, User } = global.sequelize.models;

    const recentActivity = await Request.findAll({
      include: [
        { model: User, as: 'applicant', attributes: ['name'] },
        { model: User, as: 'approver', attributes: ['name'] },
        { model: User, as: 'releaser', attributes: ['name'] }
      ],
      order: [['updatedAt', 'DESC']],
      limit: 20
    });

    res.json(recentActivity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
