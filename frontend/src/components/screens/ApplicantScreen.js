import React, { useState, useEffect } from 'react';
import { requestsAPI, productsAPI, requestItemsAPI } from '../../api/api';

function ApplicantScreen() {
  const [activeTab, setActiveTab] = useState('request');
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newRequestId, setNewRequestId] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('office');

  const categories = [
    { id: 'office', name: '사무용품', color: '#3498db' },
    { id: 'equipment', name: '전산용품', color: '#2980b9' },
    { id: 'site', name: '현장소모품', color: '#e74c3c' },
    { id: 'package', name: '포장자재', color: '#f39c12' },
    { id: 'facility', name: '설비자재', color: '#9b59b6' },
    { id: 'fixed', name: '비품', color: '#1abc9c' },
  ];

  // 상품 목록 조회
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await productsAPI.getAll();
        setProducts(response.data || []);
      } catch (err) {
        console.error('상품 로드 실패:', err);
      }
    };

    fetchProducts();
  }, []);

  // 요청 목록 조회
  useEffect(() => {
    const fetchRequests = async () => {
      try {
        setLoading(true);
        const response = await requestsAPI.getAll();
        const userRequests = response.data || [];
        setMyRequests(userRequests);
        setError('');
      } catch (err) {
        setError('요청 목록을 불러올 수 없습니다');
      } finally {
        setLoading(false);
      }
    };

    fetchRequests();
  }, []);

  // 상품 추가
  const handleAddToCart = async (product) => {
    if (!newRequestId) {
      alert('먼저 요청을 생성해주세요.');
      return;
    }

    try {
      await requestItemsAPI.addItem({
        requestId: newRequestId,
        productId: product.id,
        quantity: quantity
      });

      // 장바구니 새로고침
      const itemsResponse = await requestItemsAPI.getByRequest(newRequestId);
      setCart(itemsResponse.data || []);

      alert(`${product.productName}이(가) 장바구니에 추가되었습니다.`);
    } catch (err) {
      alert('장바구니 추가 실패: ' + err.message);
    }
  };

  // 상품 제거
  const handleRemoveFromCart = async (itemId) => {
    try {
      await requestItemsAPI.deleteItem(itemId);

      // 장바구니 새로고침
      const itemsResponse = await requestItemsAPI.getByRequest(newRequestId);
      setCart(itemsResponse.data || []);
    } catch (err) {
      alert('상품 제거 실패: ' + err.message);
    }
  };

  // 요청 생성
  const handleCreateRequest = async () => {
    try {
      const response = await requestsAPI.create({
        type: 'goods',
        category: 'office',
        description: '상품 신청',
        amount: 0,
        quantity: 0
      });

      setNewRequestId(response.data.id);
      setCart([]);
      alert('새 요청이 생성되었습니다. 상품을 추가해주세요.');
    } catch (err) {
      alert('요청 생성 실패: ' + err.message);
    }
  };

  // 요청 제출
  const handleSubmitRequest = async () => {
    if (cart.length === 0) {
      alert('장바구니에 상품을 추가해주세요.');
      return;
    }

    try {
      await requestsAPI.update(newRequestId, {
        status: 'pending',
        description: `상품 ${cart.length}개 신청`
      });

      setNewRequestId(null);
      setCart([]);

      // 요청 목록 새로고침
      const response = await requestsAPI.getAll();
      setMyRequests(response.data || []);

      alert('요청이 성공적으로 제출되었습니다.');
    } catch (err) {
      alert('요청 제출 실패: ' + err.message);
    }
  };

  // 상태 레이블
  const getStatusLabel = (status) => {
    switch (status) {
      case 'pending': return '대기';
      case 'approved': return '승인';
      case 'rejected': return '반려';
      case 'released': return '출고';
      default: return status;
    }
  };

  // 상태 색상
  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return '#ffc107';
      case 'approved': return '#28a745';
      case 'rejected': return '#dc3545';
      case 'released': return '#007bff';
      default: return '#6c757d';
    }
  };

  // 필터링된 상품
  const filteredProducts = products.filter(product => {
    const matchesCategory = selectedCategory === 'all' || product.category === selectedCategory;
    const matchesSearch = product.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         product.productCode.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="applicant-container">
      <div className="applicant-header">
        <h1>🛒 상품 신청</h1>
      </div>

      <div className="applicant-tabs">
        <button
          className={activeTab === 'request' ? 'active' : ''}
          onClick={() => setActiveTab('request')}
        >
          상품 신청
        </button>
        <button
          className={activeTab === 'history' ? 'active' : ''}
          onClick={() => setActiveTab('history')}
        >
          신청 이력
        </button>
      </div>

      {activeTab === 'request' && (
        <div className="request-section">
          {/* 요청 생성 버튼 */}
          {!newRequestId && (
            <div className="create-request-section">
              <button onClick={handleCreateRequest} className="create-request-btn">
                + 새 요청 생성
              </button>
            </div>
          )}

          {newRequestId && (
            <div className="shopping-section">
              {/* 상품 목록 */}
              <div className="products-section">
                <h3>상품 목록</h3>

                {/* 카테고리 필터 */}
                <div className="category-filter">
                  <button
                    className={selectedCategory === 'all' ? 'active' : ''}
                    onClick={() => setSelectedCategory('all')}
                  >
                    전체
                  </button>
                  {categories.map(cat => (
                    <button
                      key={cat.id}
                      className={selectedCategory === cat.id ? 'active' : ''}
                      onClick={() => setSelectedCategory(cat.id)}
                      style={{ backgroundColor: selectedCategory === cat.id ? cat.color : '#f8f9fa' }}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>

                {/* 검색 */}
                <div className="search-section">
                  <input
                    type="text"
                    placeholder="상품명 또는 코드 검색..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                  />
                </div>

                {/* 상품 그리드 */}
                <div className="products-grid">
                  {filteredProducts.map(product => (
                    <div key={product.id} className="product-card">
                      <div className="product-info">
                        <h4>{product.productName}</h4>
                        <p className="product-code">코드: {product.productCode}</p>
                        <p className="product-category">카테고리: {product.category}</p>
                        <p className="product-stock">재고: {product.currentStock}개</p>
                      </div>
                      <div className="product-actions">
                        <input
                          type="number"
                          min="1"
                          value={quantity}
                          onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                          className="quantity-input"
                        />
                        <button
                          onClick={() => handleAddToCart(product)}
                          className="add-to-cart-btn"
                          disabled={product.currentStock < quantity}
                        >
                          장바구니 추가
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 장바구니 */}
              <div className="cart-section">
                <h3>장바구니</h3>
                {cart.length === 0 ? (
                  <p className="empty-cart">장바구니가 비어있습니다.</p>
                ) : (
                  <div className="cart-items">
                    {cart.map(item => (
                      <div key={item.id} className="cart-item">
                        <div className="item-info">
                          <h4>{item.Product?.productName}</h4>
                          <p>수량: {item.quantity}개</p>
                          <p>단가: ₩{item.unitPrice?.toLocaleString()}</p>
                          <p>합계: ₩{item.subtotal?.toLocaleString()}</p>
                        </div>
                        <button
                          onClick={() => handleRemoveFromCart(item.id)}
                          className="remove-btn"
                        >
                          제거
                        </button>
                      </div>
                    ))}
                    <div className="cart-total">
                      <strong>총 금액: ₩{cart.reduce((sum, item) => sum + (item.subtotal || 0), 0).toLocaleString()}</strong>
                    </div>
                    <button onClick={handleSubmitRequest} className="submit-request-btn">
                      요청 제출
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="history-section">
          <h3>신청 이력</h3>
          {loading ? (
            <p>로딩 중...</p>
          ) : error ? (
            <p className="error">{error}</p>
          ) : myRequests.length === 0 ? (
            <p>신청 이력이 없습니다.</p>
          ) : (
            <table className="requests-table">
              <thead>
                <tr>
                  <th>요청 번호</th>
                  <th>카테고리</th>
                  <th>설명</th>
                  <th>상태</th>
                  <th>신청일</th>
                </tr>
              </thead>
              <tbody>
                {myRequests.map(req => (
                  <tr key={req.id}>
                    <td>{req.requestNumber}</td>
                    <td>{req.category}</td>
                    <td>{req.description}</td>
                    <td>
                      <span style={{
                        backgroundColor: getStatusColor(req.status),
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '3px',
                        fontSize: '12px'
                      }}>
                        {getStatusLabel(req.status)}
                      </span>
                    </td>
                    <td>{new Date(req.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default ApplicantScreen;