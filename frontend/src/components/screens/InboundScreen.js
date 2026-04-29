import React, { useState } from 'react';

function InboundScreen() {
  const [barcode, setBarcode] = useState('');
  const [quantity, setQuantity] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('office');
  const [items, setItems] = useState([]);

  const categories = [
    { id: 'office', name: '사무용품', color: '#3498db' },
    { id: 'equipment', name: '전산용품', color: '#2980b9' },
    { id: 'site', name: '현장소모품', color: '#e74c3c' },
    { id: 'package', name: '포장자재', color: '#f39c12' },
    { id: 'facility', name: '설비자재', color: '#9b59b6' },
    { id: 'fixed', name: '비품', color: '#1abc9c' },
  ];

  const handleBarcodeSubmit = (e) => {
    e.preventDefault();
    if (barcode && quantity) {
      const newItem = {
        id: Date.now(),
        barcode,
        quantity: parseInt(quantity),
        category: selectedCategory,
        timestamp: new Date().toLocaleTimeString()
      };
      setItems([newItem, ...items]);
      setBarcode('');
      setQuantity('');
    }
  };

  const handleComplete = () => {
    if (items.length > 0) {
      alert(`${items.length}개 상품 입고 완료!`);
      setItems([]);
    }
  };

  const handleRemoveItem = (id) => {
    setItems(items.filter(item => item.id !== id));
  };

  return (
    <div className="warehouse-screen">
      <h2>📥 입고 관리</h2>

      <div className="screen-content">
        {/* 좌측: 입력 영역 */}
        <div className="input-panel">
          <div className="category-selector">
            <h3>카테고리 선택</h3>
            <div className="category-buttons">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  className={`category-btn ${selectedCategory === cat.id ? 'active' : ''}`}
                  style={{
                    borderColor: cat.color,
                    backgroundColor: selectedCategory === cat.id ? cat.color : 'transparent',
                    color: selectedCategory === cat.id ? 'white' : cat.color
                  }}
                  onClick={() => setSelectedCategory(cat.id)}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleBarcodeSubmit} className="barcode-form">
            <h3>입고 정보 입력</h3>
            <div className="form-group">
              <label>🔍 바코드 스캔</label>
              <input
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="바코드를 스캔하세요..."
                className="barcode-input"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>📦 수량</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="수량을 입력하세요..."
                className="quantity-input"
                min="1"
              />
            </div>
            <button type="submit" className="btn btn-primary btn-large">
              ➕ 항목 추가
            </button>
          </form>

          <div className="summary">
            <h3>입고 요약</h3>
            <div className="summary-stat">
              <strong>총 항목:</strong> {items.length}개
            </div>
            <div className="summary-stat">
              <strong>총 수량:</strong> {items.reduce((sum, item) => sum + item.quantity, 0)}개
            </div>
            <button 
              onClick={handleComplete}
              className="btn btn-success btn-large"
              disabled={items.length === 0}
            >
              ✅ 입고 완료
            </button>
          </div>
        </div>

        {/* 우측: 목록 영역 */}
        <div className="list-panel">
          <h3>📋 입고 목록</h3>
          <div className="item-list">
            {items.length === 0 ? (
              <div className="empty-state">
                <p>입고된 상품이 없습니다.</p>
              </div>
            ) : (
              items.map(item => (
                <div key={item.id} className="list-item">
                  <div className="item-info">
                    <div className="barcode">{item.barcode}</div>
                    <div className="details">
                      <span className="category">{categories.find(c => c.id === item.category)?.name}</span>
                      <span className="quantity-badge">{item.quantity}개</span>
                    </div>
                    <div className="timestamp">{item.timestamp}</div>
                  </div>
                  <button 
                    onClick={() => handleRemoveItem(item.id)}
                    className="btn-remove"
                  >
                    ❌
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default InboundScreen;
