import React, { useState, useEffect } from 'react';

function Dashboard() {
  const [stats, setStats] = useState({
    totalInbound: 0,
    totalOutbound: 0,
    currentStock: 0,
    pendingRequests: 0,
    lowStockItems: 0
  });

  useEffect(() => {
    // Mock data - will be replaced with API calls
    setStats({
      totalInbound: 156,
      totalOutbound: 89,
      currentStock: 2458,
      pendingRequests: 12,
      lowStockItems: 5
    });
  }, []);

  const StatCard = ({ title, value, color, unit }) => (
    <div className={`stat-card stat-${color}`}>
      <h3>{title}</h3>
      <div className="stat-value">{value}</div>
      {unit && <div className="stat-unit">{unit}</div>}
    </div>
  );

  return (
    <div className="dashboard">
      <h2>대시보드</h2>
      
      <div className="stats-grid">
        <StatCard title="오늘 입고" value={stats.totalInbound} color="blue" unit="건" />
        <StatCard title="오늘 출고" value={stats.totalOutbound} color="green" unit="건" />
        <StatCard title="현재 재고" value={stats.currentStock} color="purple" unit="개" />
        <StatCard title="승인 대기" value={stats.pendingRequests} color="orange" unit="건" />
        <StatCard title="부족 상품" value={stats.lowStockItems} color="red" unit="개" />
      </div>

      <div className="quick-actions">
        <h3>최근 활동</h3>
        <div className="activity-list">
          <div className="activity-item">
            <span className="time">14:30</span>
            <span className="action">사무용품 입고 (50개)</span>
            <span className="status success">완료</span>
          </div>
          <div className="activity-item">
            <span className="time">13:45</span>
            <span className="action">계약서 파일 출고 (10개)</span>
            <span className="status success">완료</span>
          </div>
          <div className="activity-item">
            <span className="time">12:15</span>
            <span className="action">현장소모품 카테고리 입고</span>
            <span className="status pending">대기중</span>
          </div>
          <div className="activity-item">
            <span className="time">11:00</span>
            <span className="action">포장자재 재고 조회</span>
            <span className="status success">완료</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
