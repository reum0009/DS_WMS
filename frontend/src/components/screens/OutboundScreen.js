import React, { useState } from 'react';

function OutboundScreen() {
  const [requestId, setRequestId] = useState('');
  const [items, setItems] = useState([]);

  const mockRequests = [
    { id: 'REQ-001', requester: '영업팀', items: 10, total: '사무용품' },
    { id: 'REQ-002', requester: '운영팀', items: 5, total: '현장소모품' },
    { id: 'REQ-003', requester: '기획팀', items: 3, total: '포장자재' },
  ];

  const handleSelectRequest = (req) => {
    setRequestId(req.id);
    // Mock data - will be replaced with API call
    setItems([
      { id: 1, name: '노트북', quantity: 5, location: '2층-B구간' },
      { id: 2, name: '펜', quantity: 5, location: '1층-A구간' }
    ]);
  };

  const handleReleaseComplete = () => {
    if (items.length > 0) {
      alert(`요청 ${requestId} 출고 완료!`);
      setRequestId('');
      setItems([]);
    }
  };

  return (
    <div className="warehouse-screen">
      <h2>📤 출고 관리</h2>

      <div className="screen-content">
        {/* 좌측: 요청 선택 */}
        <div className="input-panel">
          <div className="request-selector">
            <h3>승인 대기 요청</h3>
            <div className="request-list">
              {mockRequests.map(req => (
                <button
                  key={req.id}
                  className={`request-item ${requestId === req.id ? 'active' : ''}`}
                  onClick={() => handleSelectRequest(req)}
                >
                  <div className="req-header">
                    <span className="req-id">{req.id}</span>
                    <span className="req-status">👁 대기</span>
                  </div>
                  <div className="req-info">
                    <span className="req-requester">신청: {req.requester}</span>
                    <span className="req-items">{req.items}개</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {requestId && (
            <div className="release-actions">
              <h3>출고 작업</h3>
              <button className="btn btn-success btn-large" onClick={handleReleaseComplete}>
                ✅ 출고 완료
              </button>
              <button className="btn btn-danger btn-large">
                ❌ 불가능 (부분)
              </button>
              <button 
                className="btn btn-secondary btn-large"
                onClick={() => {
                  setRequestId('');
                  setItems([]);
                }}
              >
                초기화
              </button>
            </div>
          )}
        </div>

        {/* 우측: 출고 목록 */}
        <div className="list-panel">
          <h3>📦 출고 상품 목록</h3>
          <div className="item-list">
            {items.length === 0 ? (
              <div className="empty-state">
                <p>요청을 선택해주세요.</p>
              </div>
            ) : (
              items.map(item => (
                <div key={item.id} className="list-item">
                  <div className="item-info">
                    <div className="product-name">{item.name}</div>
                    <div className="details">
                      <span className="quantity-badge">{item.quantity}개</span>
                      <span className="location">📍 {item.location}</span>
                    </div>
                  </div>
                  <div className="check-box">
                    <input type="checkbox" defaultChecked />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default OutboundScreen;
