import React, { useState } from 'react';

function ReportScreen() {
  const [reportType, setReportType] = useState('daily');

  const reportTypes = [
    { id: 'daily', name: '📅 일일 리포트' },
    { id: 'weekly', name: '📊 주간 리포트' },
    { id: 'category', name: '📈 카테고리별 분석' },
    { id: 'user', name: '👤 사용자별 통계' },
  ];

  const dailyData = [
    { time: '08:00', inbound: 0, outbound: 0 },
    { time: '09:00', inbound: 5, outbound: 2 },
    { time: '10:00', inbound: 10, outbound: 8 },
    { time: '11:00', inbound: 15, outbound: 12 },
    { time: '12:00', inbound: 20, outbound: 18 },
    { time: '13:00', inbound: 8, outbound: 15 },
    { time: '14:00', inbound: 12, outbound: 10 },
    { time: '15:00', inbound: 6, outbound: 9 },
  ];

  const categoryStats = [
    { name: '사무용품', inbound: 145, outbound: 89 },
    { name: '전산용품', inbound: 78, outbound: 56 },
    { name: '현장소모품', inbound: 234, outbound: 167 },
    { name: '포장자재', inbound: 567, outbound: 412 },
    { name: '설비자재', inbound: 45, outbound: 23 },
    { name: '비품', inbound: 34, outbound: 18 },
  ];

  const renderDailyReport = () => (
    <div className="report-content">
      <div className="chart-container">
        <h3>오늘의 입출고 추이</h3>
        <div className="mini-chart">
          {dailyData.map((data, idx) => (
            <div key={idx} className="chart-column">
              <div className="column-bars">
                <div 
                  className="bar inbound"
                  style={{ height: `${Math.min(100, data.inbound * 5)}px` }}
                  title={`입고: ${data.inbound}`}
                />
                <div 
                  className="bar outbound"
                  style={{ height: `${Math.min(100, data.outbound * 5)}px` }}
                  title={`출고: ${data.outbound}`}
                />
              </div>
              <span className="column-label">{data.time}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="stats-summary">
        <div className="stat-block">
          <h4>📥 총 입고</h4>
          <p className="value">{dailyData.reduce((sum, d) => sum + d.inbound, 0)}건</p>
        </div>
        <div className="stat-block">
          <h4>📤 총 출고</h4>
          <p className="value">{dailyData.reduce((sum, d) => sum + d.outbound, 0)}건</p>
        </div>
        <div className="stat-block">
          <h4>⏰ 평균 처리시간</h4>
          <p className="value">2.5분</p>
        </div>
      </div>
    </div>
  );

  const renderCategoryReport = () => (
    <div className="report-content">
      <h3>카테고리별 통계</h3>
      <div className="category-report-table">
        <table>
          <thead>
            <tr>
              <th>카테고리</th>
              <th>📥 입고</th>
              <th>📤 출고</th>
              <th>합계</th>
              <th>비율</th>
            </tr>
          </thead>
          <tbody>
            {categoryStats.map((cat, idx) => {
              const total = cat.inbound + cat.outbound;
              const percent = ((total / categoryStats.reduce((sum, c) => sum + c.inbound + c.outbound, 0)) * 100).toFixed(1);
              return (
                <tr key={idx}>
                  <td className="category-name">{cat.name}</td>
                  <td className="number blue">{cat.inbound}</td>
                  <td className="number green">{cat.outbound}</td>
                  <td className="number bold">{total}</td>
                  <td>
                    <div className="bar-small">
                      <div 
                        className="bar-fill" 
                        style={{ width: `${percent}%` }}>
                        {percent}%
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="warehouse-screen">
      <h2>📈 레포트</h2>

      <div className="screen-content">
        {/* 좌측: 레포트 유형 선택 */}
        <div className="input-panel">
          <h3>레포트 유형</h3>
          <div className="report-buttons">
            {reportTypes.map(type => (
              <button
                key={type.id}
                className={`report-btn ${reportType === type.id ? 'active' : ''}`}
                onClick={() => setReportType(type.id)}
              >
                {type.name}
              </button>
            ))}
          </div>

          <div className="export-section">
            <h3>내보내기</h3>
            <button className="btn btn-primary btn-large">
              📄 PDF 다운로드
            </button>
            <button className="btn btn-secondary btn-large">
              📊 Excel 다운로드
            </button>
          </div>
        </div>

        {/* 우측: 레포트 내용 */}
        <div className="list-panel">
          {reportType === 'daily' && renderDailyReport()}
          {reportType === 'category' && renderCategoryReport()}
          {reportType === 'weekly' && (
            <div className="report-content">
              <h3>주간 요약</h3>
              <p>📊 주간 리포트는 추후 구현 예정입니다.</p>
            </div>
          )}
          {reportType === 'user' && (
            <div className="report-content">
              <h3>사용자 통계</h3>
              <p>👤 사용자별 통계는 추후 구현 예정입니다.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ReportScreen;
