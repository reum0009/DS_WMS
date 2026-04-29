import React, { useState, useEffect } from 'react';
import { productsAPI } from '../../api/api';

const CATEGORY_MAP = {
  office:    '사무용품',
  equipment: '전산용품',
  site:      '현장소모품',
  package:   '포장자재',
  facility:  '설비자재',
  fixed:     '비품',
};

function getStatus(product) {
  const stock = product.currentStock || 0;
  const safety = product.safetyStock || 0;
  if (stock === 0) return 'danger';
  if (stock <= safety) return 'danger';
  if (stock <= safety * 1.5) return 'warning';
  return 'safe';
}

function getStatusDisplay(status) {
  switch (status) {
    case 'safe':    return { icon: '✅', color: '#27ae60', text: '정상' };
    case 'warning': return { icon: '⚠️', color: '#f39c12', text: '주의' };
    case 'danger':  return { icon: '🚨', color: '#e74c3c', text: '부족' };
    default:        return { icon: '❓', color: '#95a5a6', text: '미확인' };
  }
}

function StockScreen() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const categories = [
    { id: 'all', name: '전체' },
    { id: 'office', name: '사무용품' },
    { id: 'equipment', name: '전산용품' },
    { id: 'site', name: '현장소모품' },
    { id: 'package', name: '포장자재' },
    { id: 'facility', name: '설비자재' },
    { id: 'fixed', name: '비품' },
  ];

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await productsAPI.getAll();
        setProducts(res.data || []);
      } catch (err) {
        setError('재고 데이터를 불러올 수 없습니다.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filteredStock = products.filter(item => {
    const matchCategory =
      selectedCategory === 'all' || item.category === selectedCategory;
    const name = item.productName || '';
    const code = item.productCode || '';
    const term = searchTerm.toLowerCase();
    const matchSearch = name.toLowerCase().includes(term) || code.toLowerCase().includes(term);
    return matchCategory && matchSearch;
  });

  const dangerCount = filteredStock.filter(p => getStatus(p) === 'danger').length;

  return (
    <div className="warehouse-screen">
      <h2>📋 재고 조회</h2>

      <div className="screen-content">
        {/* 좌측: 검색 및 필터 */}
        <div className="input-panel">
          <div className="search-section">
            <h3>검색</h3>
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="상품명 또는 코드 검색..."
              className="search-input"
            />
          </div>

          <div className="filter-section">
            <h3>카테고리 필터</h3>
            <div className="category-buttons">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  className={`category-btn ${selectedCategory === cat.id ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat.id)}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          <div className="summary">
            <h3>통계</h3>
            <div className="summary-stat">
              <span>검색 결과</span>
              <strong>{filteredStock.length}개</strong>
            </div>
            <div className="summary-stat">
              <span>총 수량</span>
              <strong>
                {filteredStock.reduce((s, p) => s + (p.currentStock || 0), 0).toLocaleString()}개
              </strong>
            </div>
            <div className="summary-stat" style={{ color: '#ff7675' }}>
              <span>부족 상품</span>
              <strong>{dangerCount}개</strong>
            </div>
          </div>
        </div>

        {/* 우측: 재고 목록 */}
        <div className="list-panel">
          <h3>📊 재고 목록</h3>

          {loading && (
            <div className="empty-state">불러오는 중...</div>
          )}
          {error && (
            <div className="empty-state" style={{ color: '#e74c3c' }}>{error}</div>
          )}

          {!loading && !error && (
            <div className="item-list stock-list">
              {filteredStock.length === 0 ? (
                <div className="empty-state">해당하는 상품이 없습니다.</div>
              ) : (
                filteredStock.map(item => {
                  const status = getStatus(item);
                  const statusDisplay = getStatusDisplay(status);
                  const stock = item.currentStock || 0;
                  const safety = item.safetyStock || 0;
                  const pct = safety > 0 ? Math.min(100, (stock / safety) * 100) : 100;
                  return (
                    <div key={item.id} className={`list-item stock-item status-${status}`}>
                      <div className="item-header">
                        <h4>{item.productName}</h4>
                        <span className="status-badge" style={{ color: statusDisplay.color }}>
                          {statusDisplay.icon} {statusDisplay.text}
                        </span>
                      </div>
                      <div className="stock-details">
                        <div className="detail-row">
                          <span className="label">코드</span>
                          <span className="value" style={{ fontFamily: 'monospace' }}>
                            {item.productCode}
                          </span>
                        </div>
                        <div className="detail-row">
                          <span className="label">카테고리</span>
                          <span className="value">{CATEGORY_MAP[item.category] || item.category}</span>
                        </div>
                        <div className="detail-row">
                          <span className="label">현재 재고</span>
                          <span className="value"
                            style={{ color: status === 'danger' ? '#e74c3c' : 'inherit', fontWeight: 700 }}>
                            {stock.toLocaleString()} {item.unit || '개'}
                          </span>
                        </div>
                        <div className="detail-row">
                          <span className="label">안전재고</span>
                          <span className="value">{safety.toLocaleString()} {item.unit || '개'}</span>
                        </div>
                        {item.warehouse && (
                          <div className="detail-row">
                            <span className="label">위치</span>
                            <span className="value location">📍 {item.warehouse.warehouseName}</span>
                          </div>
                        )}
                      </div>
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${pct}%`,
                            background: status === 'danger' ? '#e74c3c'
                              : status === 'warning' ? '#f39c12'
                              : '#27ae60',
                          }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StockScreen;
