import React, { useState, useEffect } from 'react';
import { dashboardAPI } from '../../api/api';
import './Dashboard.css';

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const response = await dashboardAPI.getStats();
      setStats(response.data);
      setError(null);
    } catch (err) {
      setError('대시보드 데이터를 불러오는데 실패했습니다: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num) => {
    return new Intl.NumberFormat('ko-KR').format(num);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency: 'KRW'
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="loading-spinner">데이터 로딩 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-container">
        <div className="error-message">{error}</div>
        <button onClick={loadDashboardData} className="retry-btn">다시 시도</button>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>📊 실시간 대시보드</h1>
        <button onClick={loadDashboardData} className="refresh-btn">🔄 새로고침</button>
      </div>

      <div className="dashboard-tabs">
        <button
          className={activeTab === 'overview' ? 'active' : ''}
          onClick={() => setActiveTab('overview')}
        >
          📈 개요
        </button>
        <button
          className={activeTab === 'inventory' ? 'active' : ''}
          onClick={() => setActiveTab('inventory')}
        >
          📦 재고 현황
        </button>
        <button
          className={activeTab === 'performance' ? 'active' : ''}
          onClick={() => setActiveTab('performance')}
        >
          ⚡ 성능 지표
        </button>
        <button
          className={activeTab === 'trends' ? 'active' : ''}
          onClick={() => setActiveTab('trends')}
        >
          📊 추이 분석
        </button>
        <button
          className={activeTab === 'products' ? 'active' : ''}
          onClick={() => setActiveTab('products')}
        >
          🏆 인기 상품
        </button>
      </div>

      <div className="dashboard-content">
        {activeTab === 'overview' && (
          <div className="overview-section">
            <div className="stats-grid">
              <div className="stat-card">
                <h3>총 요청 수</h3>
                <div className="stat-value">{formatNumber(stats.overview.totalRequests)}</div>
              </div>
              <div className="stat-card">
                <h3>대기 중</h3>
                <div className="stat-value pending">{formatNumber(stats.overview.pendingRequests)}</div>
              </div>
              <div className="stat-card">
                <h3>승인됨</h3>
                <div className="stat-value approved">{formatNumber(stats.overview.approvedRequests)}</div>
              </div>
              <div className="stat-card">
                <h3>출고 완료</h3>
                <div className="stat-value released">{formatNumber(stats.overview.releasedRequests)}</div>
              </div>
              <div className="stat-card">
                <h3>반려됨</h3>
                <div className="stat-value rejected">{formatNumber(stats.overview.rejectedRequests)}</div>
              </div>
              <div className="stat-card">
                <h3>승인율</h3>
                <div className="stat-value">{stats.overview.approvalRate}%</div>
              </div>
            </div>

            <div className="activity-summary">
              <h3>최근 활동 (7일)</h3>
              <div className="activity-stats">
                <div className="activity-item">
                  <span>신규 요청:</span>
                  <strong>{formatNumber(stats.performance.recentRequests)}</strong>
                </div>
                <div className="activity-item">
                  <span>출고 완료:</span>
                  <strong>{formatNumber(stats.performance.recentReleases)}</strong>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'inventory' && (
          <div className="inventory-section">
            <div className="stats-grid">
              <div className="stat-card">
                <h3>총 상품 수</h3>
                <div className="stat-value">{formatNumber(stats.inventory.totalProducts)}</div>
              </div>
              <div className="stat-card">
                <h3>저재고 상품</h3>
                <div className="stat-value warning">{formatNumber(stats.inventory.lowStockProducts)}</div>
              </div>
              <div className="stat-card">
                <h3>품절 상품</h3>
                <div className="stat-value danger">{formatNumber(stats.inventory.outOfStockProducts)}</div>
              </div>
              <div className="stat-card">
                <h3>총 재고 가치</h3>
                <div className="stat-value">{formatCurrency(stats.inventory.totalInventoryValue)}</div>
              </div>
            </div>

            <div className="alerts-section">
              <h3>⚠️ 재고 알림</h3>
              {stats.inventory.lowStockProducts > 0 && (
                <div className="alert warning">
                  {stats.inventory.lowStockProducts}개의 상품이 저재고 상태입니다.
                </div>
              )}
              {stats.inventory.outOfStockProducts > 0 && (
                <div className="alert danger">
                  {stats.inventory.outOfStockProducts}개의 상품이 품절되었습니다.
                </div>
              )}
              {stats.inventory.lowStockProducts === 0 && stats.inventory.outOfStockProducts === 0 && (
                <div className="alert success">
                  모든 상품의 재고가 충분합니다.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'performance' && (
          <div className="performance-section">
            <div className="stats-grid">
              <div className="stat-card">
                <h3>평균 승인 시간</h3>
                <div className="stat-value">{stats.performance.avgApprovalTime}시간</div>
              </div>
              <div className="stat-card">
                <h3>평균 출고 시간</h3>
                <div className="stat-value">{stats.performance.avgReleaseTime}시간</div>
              </div>
            </div>

            <div className="role-activity">
              <h3>역할별 활동량</h3>
              <div className="activity-bars">
                {Object.entries(stats.activityByRole).map(([role, count]) => (
                  <div key={role} className="activity-bar">
                    <div className="role-label">
                      {role === 'admin' && '관리자'}
                      {role === 'applicant' && '신청자'}
                      {role === 'approver' && '승인자'}
                      {role === 'releaser' && '출고자'}
                      {role === 'warehouse' && '창고담당'}
                    </div>
                    <div className="bar-container">
                      <div
                        className="bar"
                        style={{ width: `${Math.min((count / Math.max(...Object.values(stats.activityByRole))) * 100, 100)}%` }}
                      ></div>
                      <span className="count">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'trends' && (
          <div className="trends-section">
            <h3>월별 추이 (최근 6개월)</h3>
            <div className="trends-chart">
              {stats.trends.map((month, index) => (
                <div key={month.month} className="month-bar">
                  <div className="month-label">{month.month}</div>
                  <div className="bars">
                    <div className="bar requests" style={{ height: `${month.requests * 10}px` }}>
                      <span className="value">{month.requests}</span>
                    </div>
                    <div className="bar releases" style={{ height: `${month.releases * 10}px` }}>
                      <span className="value">{month.releases}</span>
                    </div>
                  </div>
                  <div className="legend">
                    <span className="requests">요청</span>
                    <span className="releases">출고</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'products' && (
          <div className="products-section">
            <h3>🏆 가장 많이 요청된 상품 (TOP 10)</h3>
            <div className="products-list">
              {stats.topProducts.map((product, index) => (
                <div key={index} className="product-item">
                  <div className="rank">#{index + 1}</div>
                  <div className="product-info">
                    <div className="name">{product.name}</div>
                    <div className="category">{product.category}</div>
                  </div>
                  <div className="quantity">
                    총 {formatNumber(product.totalQuantity)}개 요청
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;