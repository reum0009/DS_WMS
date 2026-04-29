import React, { useState, useEffect } from 'react';
import { requestsAPI, requestItemsAPI, releasesAPI, productsAPI } from '../../api/api';

function ReleaserScreen() {
  const [activeTab, setActiveTab] = useState('approved');
  const [requests, setRequests] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [requestItems, setRequestItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState('');

  // 요청 목록 조회
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [requestsRes, productsRes] = await Promise.all([
          requestsAPI.getAll(),
          productsAPI.getAll()
        ]);
        setRequests(requestsRes.data || []);
        setProducts(productsRes.data || []);
        setError('');
      } catch (err) {
        setError('데이터를 불러올 수 없습니다');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // 필터된 요청 목록
  const getFilteredRequests = () => {
    return requests.filter(req => {
      if (activeTab === 'approved') return req.status === 'approved';
      if (activeTab === 'released') return req.status === 'released';
      return false;
    });
  };

  // 요청 상세 조회
  const handleViewDetails = async (request) => {
    try {
      setLoading(true);
      setSelectedRequest(request);
      
      // 요청 항목 조회
      const itemsResponse = await requestItemsAPI.getByRequest(request.id);
      setRequestItems(itemsResponse.data || []);
      
      setShowDetailModal(true);
      setReleaseNotes('');
    } catch (err) {
      alert('상세 정보를 불러올 수 없습니다: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 요청 출고
  const handleRelease = async () => {
    if (!selectedRequest) return;

    if (!window.confirm(`신청 #${selectedRequest.requestNumber}을(를) 출고하시겠습니까?`)) {
      return;
    }

    try {
      setLoading(true);
      
      // 출고 처리
      await releasesAPI.release(selectedRequest.id, {
        releaseNotes: releaseNotes.trim()
      });

      // 각 상품의 재고 감소
      for (const item of requestItems) {
        const product = products.find(p => p.id === item.productId);
        if (product) {
          const newStock = product.currentStock - item.quantity;
          await productsAPI.update(product.id, {
            ...product,
            currentStock: Math.max(0, newStock)
          });
        }
      }

      // 요청 목록 새로고침
      const response = await requestsAPI.getAll();
      setRequests(response.data || []);
      
      setShowDetailModal(false);
      setSelectedRequest(null);
      setRequestItems([]);
      setReleaseNotes('');
      alert('요청이 출고되었습니다');
    } catch (err) {
      alert('출고 실패: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusLabel = (status) => {
    const map = { 'pending': '대기', 'approved': '승인', 'rejected': '반려', 'released': '출고완료' };
    return map[status] || status;
  };

  const getStatusColor = (status) => {
    const colors = { 'pending': '#f39c12', 'approved': '#27ae60', 'rejected': '#e74c3c', 'released': '#3498db' };
    return colors[status] || '#95a5a6';
  };

  const filteredRequests = getFilteredRequests();
  const totalAmount = requestItems.reduce((sum, item) => sum + parseFloat(item.subtotal || 0), 0);

  return (
    <div className="releaser-screen">
      <h2>📦 출고담당자 대시보드</h2>

      <div className="releaser-tabs">
        <button 
          className={`tab-btn ${activeTab === 'approved' ? 'active' : ''}`}
          onClick={() => setActiveTab('approved')}
        >
          ✓ 승인됨 ({requests.filter(r => r.status === 'approved').length})
        </button>
        <button 
          className={`tab-btn ${activeTab === 'released' ? 'active' : ''}`}
          onClick={() => setActiveTab('released')}
        >
          📦 출고완료 ({requests.filter(r => r.status === 'released').length})
        </button>
      </div>

      {/* 요청 목록 */}
      <div className="releaser-content">
        {loading && <p>로딩 중...</p>}
        {error && <p style={{ color: '#e74c3c' }}>⚠️ {error}</p>}

        {filteredRequests.length === 0 ? (
          <p style={{ color: '#7f8c8d' }}>요청이 없습니다</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>신청번호</th>
                <th>신청자</th>
                <th>카테고리</th>
                <th>신청일</th>
                <th>승인일</th>
                <th>상태</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.map(req => (
                <tr key={req.id}>
                  <td><strong>{req.requestNumber}</strong></td>
                  <td>{req.applicant?.name || '미확인'}</td>
                  <td>{req.category}</td>
                  <td>{new Date(req.createdAt).toLocaleDateString()}</td>
                  <td>{req.approvedAt ? new Date(req.approvedAt).toLocaleDateString() : '-'}</td>
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
                  <td>
                    <button
                      onClick={() => handleViewDetails(req)}
                      style={{
                        padding: '6px 10px',
                        backgroundColor: '#3498db',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      📋 상세
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 상세 모달 */}
      {showDetailModal && selectedRequest && (
        <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3>📦 출고 상세</h3>
              <button className="close-btn" onClick={() => setShowDetailModal(false)}>✕</button>
            </div>

            <div style={{ padding: '20px' }}>
              {/* 신청 기본 정보 */}
              <div style={{ marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px solid #ecf0f1' }}>
                <h4>신청 정보</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', fontSize: '14px' }}>
                  <div>
                    <span style={{ color: '#7f8c8d' }}>신청번호:</span> <strong>{selectedRequest.requestNumber}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#7f8c8d' }}>신청자:</span> <strong>{selectedRequest.applicant?.name || '미확인'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#7f8c8d' }}>카테고리:</span> <strong>{selectedRequest.category}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#7f8c8d' }}>신청일:</span> <strong>{new Date(selectedRequest.createdAt).toLocaleDateString()}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#7f8c8d' }}>승인자:</span> <strong>{selectedRequest.approver?.name || '미확인'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#7f8c8d' }}>상태:</span>
                    <span style={{
                      backgroundColor: getStatusColor(selectedRequest.status),
                      color: 'white',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      marginLeft: '5px',
                      fontSize: '12px'
                    }}>
                      {getStatusLabel(selectedRequest.status)}
                    </span>
                  </div>
                </div>
              </div>

              {/* 상품 목록 */}
              <div style={{ marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px solid #ecf0f1' }}>
                <h4>출고 상품 목록</h4>
                {requestItems.length === 0 ? (
                  <p style={{ color: '#7f8c8d' }}>상품이 없습니다</p>
                ) : (
                  <table style={{ width: '100%', fontSize: '13px' }}>
                    <thead style={{ borderBottom: '1px solid #bdc3c7' }}>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '8px 0' }}>상품</th>
                        <th style={{ textAlign: 'center', padding: '8px 0' }}>수량</th>
                        <th style={{ textAlign: 'center', padding: '8px 0' }}>현재재고</th>
                        <th style={{ textAlign: 'right', padding: '8px 0' }}>금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requestItems.map(item => {
                        const product = products.find(p => p.id === item.productId);
                        const stockAfterRelease = (product?.currentStock || 0) - item.quantity;
                        return (
                          <tr key={item.id} style={{ borderBottom: '1px solid #ecf0f1' }}>
                            <td style={{ padding: '8px 0' }}>
                              <strong>{item.Product?.productName}</strong>
                              <div style={{ fontSize: '11px', color: '#7f8c8d' }}>
                                {item.Product?.productCode}
                              </div>
                            </td>
                            <td style={{ textAlign: 'center', padding: '8px 0' }}>
                              {item.quantity} {item.Product?.unit}
                            </td>
                            <td style={{ textAlign: 'center', padding: '8px 0' }}>
                              <div>{product?.currentStock || 0}</div>
                              <div style={{ fontSize: '11px', color: '#7f8c8d' }}>
                                → {Math.max(0, stockAfterRelease)}
                              </div>
                            </td>
                            <td style={{ textAlign: 'right', padding: '8px 0' }}>
                              ₩{item.subtotal?.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #bdc3c7', textAlign: 'right', fontWeight: 'bold' }}>
                  합계: ₩{totalAmount.toLocaleString()}
                </div>
              </div>

              {/* 출고 처리 - approved 상태일 때만 */}
              {selectedRequest.status === 'approved' && (
                <div>
                  <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>출고 메모 (선택사항)</label>
                    <textarea
                      value={releaseNotes}
                      onChange={(e) => setReleaseNotes(e.target.value)}
                      placeholder="배송 정보, 특별 지시사항 등을 입력해주세요"
                      style={{
                        width: '100%',
                        height: '80px',
                        padding: '10px',
                        border: '1px solid #bdc3c7',
                        borderRadius: '4px',
                        fontFamily: 'inherit'
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={handleRelease}
                      style={{
                        flex: 1,
                        padding: '10px',
                        backgroundColor: '#3498db',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 'bold'
                      }}
                      disabled={loading}
                    >
                      {loading ? '처리 중...' : '📦 출고하기'}
                    </button>
                    <button
                      onClick={() => setShowDetailModal(false)}
                      style={{
                        flex: 1,
                        padding: '10px',
                        backgroundColor: '#95a5a6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      닫기
                    </button>
                  </div>
                </div>
              )}

              {/* 이미 처리된 요청 정보 */}
              {selectedRequest.status === 'released' && (
                <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#d5f4e6', borderRadius: '4px' }}>
                  <strong>★ 이미 출고된 요청입니다</strong>
                  <div style={{ marginTop: '10px', fontSize: '13px' }}>
                    <span style={{ color: '#7f8c8d' }}>출고일:</span> <strong>{new Date(selectedRequest.releasedAt).toLocaleDateString()}</strong>
                  </div>
                  {selectedRequest.releaseNotes && (
                    <div style={{ marginTop: '10px', fontSize: '13px' }}>
                      <span style={{ color: '#7f8c8d' }}>출고 메모:</span><br />
                      {selectedRequest.releaseNotes}
                    </div>
                  )}
                  <button
                    onClick={() => setShowDetailModal(false)}
                    style={{
                      marginTop: '10px',
                      padding: '8px 15px',
                      backgroundColor: '#95a5a6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    닫기
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReleaserScreen;
