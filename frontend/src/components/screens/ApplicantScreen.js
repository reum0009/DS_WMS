import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { categoriesAPI, productsAPI, requestsAPI, warehousesAPI } from '../../api/api';

const BG0 = '#0d1117';
const BG1 = '#161b22';
const BG2 = '#1c2128';
const BD = '#30363d';
const BD2 = '#21262d';
const TX = '#e6edf3';
const TX2 = '#8b949e';
const TX3 = '#444c56';
const BLU = '#58a6ff';
const GRN = '#3fb950';
const RED = '#f85149';
const ORG = '#f0883e';

function formatClock(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const flattenCategoryTree = (nodes, out = []) => {
  (nodes || []).forEach(node => {
    out.push(node);
    if (node.children?.length) flattenCategoryTree(node.children, out);
  });
  return out;
};

const defaultExpandedToLevel = (nodes, visibleLevel = 3, out = new Set()) => {
  (nodes || []).forEach(node => {
    if (node.children?.length && node.level < visibleLevel) {
      out.add(node.id);
      defaultExpandedToLevel(node.children, visibleLevel, out);
    }
  });
  return out;
};

const stockStatus = (product) => {
  const stock = Number(product.currentStock || 0);
  if (stock <= 0) return { label: '재고없음', color: RED };
  return { label: '신청가능', color: GRN };
};

const isComputerRootCategory = (node) => {
  const name = String(node?.name || '').replace(/\s+/g, '').toLowerCase();
  const code = String(node?.code || '').replace(/\s+/g, '').toLowerCase();
  if (name.includes('총무') || name.includes('물류')) return false;
  return (
    name.includes('전산') ||
    name.includes('it') ||
    name.includes('정보') ||
    code.includes('it') ||
    code.includes('computer')
  );
};

const filterComputerTree = (tree) => {
  const pruneConsumables = (node) => {
    const name = String(node?.name || '').replace(/\s+/g, '').toLowerCase();
    if (node?.level === 2 && name.includes('집기')) return null;
    if (node?.level === 2 && !name.includes('소모품')) return null;
    return {
      ...node,
      children: (node.children || []).map(pruneConsumables).filter(Boolean),
    };
  };
  const roots = tree || [];
  const included = roots.filter(isComputerRootCategory);
  const targetRoots = included.length > 0 ? included : roots.filter(root => {
    const name = String(root?.name || '').replace(/\s+/g, '').toLowerCase();
    return !name.includes('총무') && !name.includes('물류');
  });
  return targetRoots.map(pruneConsumables).filter(Boolean);
};

function CategoryTreeNode({ node, selectedId, expandedIds, onSelect, onToggle, depth = 0 }) {
  const hasChildren = node.children && node.children.length > 0;
  const open = expandedIds.has(node.id);
  const selected = selectedId === node.id;
  const color = node.color || BLU;

  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 14 }}>
      <div
        onClick={() => onSelect(node.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, minHeight: 34,
          padding: '5px 8px', borderRadius: 6, marginBottom: 2,
          background: selected ? '#0d2040' : 'transparent',
          border: selected ? `1px solid ${BLU}77` : '1px solid transparent',
          cursor: 'pointer',
        }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggle(node.id); }}
          style={{
            background: 'none', border: 'none', color: hasChildren ? TX2 : TX3,
            cursor: hasChildren ? 'pointer' : 'default', fontSize: 12, width: 16,
            flexShrink: 0, padding: 0,
          }}
        >
          {hasChildren ? (open ? '-' : '+') : '-'}
        </button>
        <span style={{
          fontSize: 10, fontWeight: 800, padding: '1px 5px', borderRadius: 3,
          background: `${color}22`, color, border: `1px solid ${color}44`, flexShrink: 0,
        }}>L{node.level}</span>
        <span style={{
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: selected ? TX : (node.level === 1 ? TX : '#c9d1d9'),
          fontSize: 13, fontWeight: selected || node.level === 1 ? 800 : 500,
        }}>
          {node.name}
        </span>
      </div>
      {open && hasChildren && (
        <div style={{ borderLeft: `1px solid ${color}33`, marginLeft: 18, paddingLeft: 4 }}>
          {node.children.map(child => (
            <CategoryTreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApplicantScreen({ user }) {
  const [clock, setClock] = useState(formatClock(new Date()));
  const [activeTab, setActiveTab] = useState('request');
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [catTree, setCatTree] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCatId, setSelectedCatId] = useState(null);
  const [expandedCatIds, setExpandedCatIds] = useState(new Set());
  const [search, setSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [qty, setQty] = useState(1);
  const [memo, setMemo] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2400);
  };

  const selectedProduct = products.find(p => p.id === selectedProductId) || null;
  const selectedWarehouse = warehouses.find(w => String(w.id) === String(selectedWarehouseId)) || null;

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [warehouseRes, categoryRes, historyRes] = await Promise.all([
        warehousesAPI.getAll(),
        categoriesAPI.getTree(),
        requestsAPI.getAll().catch(() => ({ data: [] })),
      ]);
      const warehouseRows = warehouseRes.data || [];
      const tree = filterComputerTree(categoryRes.data || []);
      setWarehouses(warehouseRows);
      setCatTree(tree);
      setCategories(flattenCategoryTree(tree, []));
      setExpandedCatIds(defaultExpandedToLevel(tree, 3));
      setHistory(historyRes.data || []);
      if (!selectedWarehouseId && warehouseRows.length > 0) {
        setSelectedWarehouseId(String(warehouseRows[0].id));
      }
    } catch (err) {
      showToast(err.response?.data?.error || '데이터를 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedWarehouseId]);

  const loadProducts = useCallback(async () => {
    try {
      const params = selectedWarehouseId ? { warehouseId: Number(selectedWarehouseId) } : undefined;
      const res = await productsAPI.getAll(params);
      setProducts(res.data || []);
      setSelectedProductId(null);
    } catch (err) {
      showToast(err.response?.data?.error || '품목을 불러오지 못했습니다.', 'error');
    }
  }, [selectedWarehouseId]);

  useEffect(() => {
    loadData();
    const id = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => clearInterval(id);
  }, [loadData]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const catDescendants = useMemo(() => {
    const idSet = new Set(categories.map(c => c.id));
    const childrenOf = {};
    categories.forEach(c => { childrenOf[c.id] = []; });
    categories.forEach(c => {
      if (c.parentId && idSet.has(c.parentId)) childrenOf[c.parentId].push(c);
    });
    const map = {};
    categories.forEach(c => {
      const ids = new Set([c.id]);
      const stack = [c.id];
      while (stack.length) {
        const cur = stack.pop();
        (childrenOf[cur] || []).forEach(child => {
          if (!ids.has(child.id)) {
            ids.add(child.id);
            stack.push(child.id);
          }
        });
      }
      map[c.id] = ids;
    });
    return map;
  }, [categories]);

  const categoryNameMap = useMemo(() => {
    const map = {};
    categories.forEach(c => { map[c.id] = c.name; });
    return map;
  }, [categories]);

  const filteredProducts = useMemo(() => {
    let list = products;
    const visibleCategoryIds = new Set(categories.map(c => c.id));
    if (visibleCategoryIds.size > 0) {
      list = list.filter(p => visibleCategoryIds.has(p.categoryId));
    }
    if (selectedCatId) {
      const ids = catDescendants[selectedCatId] || new Set([selectedCatId]);
      list = list.filter(p => ids.has(p.categoryId));
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        String(p.productName || '').toLowerCase().includes(q) ||
        String(p.productCode || '').toLowerCase().includes(q) ||
        String(p.barcode || '').toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => String(a.productName || '').localeCompare(String(b.productName || ''), 'ko'));
  }, [products, categories, selectedCatId, catDescendants, search]);

  const toggleCat = (id) => {
    setExpandedCatIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitRequest = async () => {
    if (!selectedWarehouseId) return showToast('신청할 창고를 선택하세요.', 'error');
    if (!selectedProduct) return showToast('신청할 품목을 선택하세요.', 'error');
    if (qty < 1) return showToast('수량은 1개 이상 입력하세요.', 'error');

    try {
      setSubmitting(true);
      await requestsAPI.create({
        type: 'goods',
        category: 'WMS',
        source: 'wms',
        status: 'approved',
        warehouseId: Number(selectedWarehouseId),
        description: memo.trim() || `WMS 신청 - ${selectedProduct.productName}`,
        items: [{ productId: selectedProduct.id, quantity: qty }],
      });
      const historyRes = await requestsAPI.getAll();
      setHistory(historyRes.data || []);
      setMemo('');
      setQty(1);
      setSelectedProductId(null);
      setActiveTab('history');
      showToast('신청이 등록되었습니다. 창고 담당자 신청 목록에 WMS 신청으로 표시됩니다.');
    } catch (err) {
      showToast(err.response?.data?.error || '신청 등록에 실패했습니다.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = (status) => ({
    pending: '승인대기',
    approved: '출고대기',
    rejected: '반려',
    released: '출고완료',
  }[status] || status);

  const statusColor = (status) => ({
    pending: TX2,
    approved: ORG,
    rejected: RED,
    released: GRN,
  }[status] || TX2);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: BG0, color: TX, fontFamily: "'Noto Sans KR', sans-serif", overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', height: 84, background: BG1, borderBottom: `4px solid ${BLU}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <span style={{ fontSize: 24, fontWeight: 900, color: BLU }}>품목 신청</span>
          <span style={{ fontSize: 13, color: GRN, background: '#0d2616', border: `1px solid ${GRN}55`, borderRadius: 6, padding: '4px 10px', fontWeight: 800 }}>WMS 신청</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <span style={{ fontSize: 18, color: TX2, fontFamily: 'monospace', fontWeight: 600 }}>{clock}</span>
          <span style={{ fontSize: 16, color: TX2, fontWeight: 700 }}>신청자 {user?.name || '-'}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 32px', background: BG0, borderBottom: `2px solid ${BD2}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            ['request', '품목 신청'],
            ['history', `신청 이력 (${history.length})`],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id)}
              style={{ padding: '10px 24px', borderRadius: 10, border: `2px solid ${activeTab === id ? BLU : BD}`, background: activeTab === id ? '#0d2040' : BG2, color: activeTab === id ? BLU : TX2, cursor: 'pointer', fontSize: 16, fontWeight: activeTab === id ? 800 : 600 }}>
              {label}
            </button>
          ))}
        </div>
        <select value={selectedWarehouseId} onChange={e => setSelectedWarehouseId(e.target.value)}
          style={{ background: BG2, border: `2px solid ${BD}`, color: TX, borderRadius: 10, padding: '10px 14px', minWidth: 220, fontSize: 15, fontWeight: 700 }}>
          <option value="">창고 선택</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouseName}</option>)}
        </select>
      </div>

      {activeTab === 'request' ? (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ width: 300, borderRight: `2px solid ${BD2}`, background: BG1, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${BD2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15, color: TX, fontWeight: 900 }}>분류</span>
              <button onClick={() => setSelectedCatId(null)} style={{ background: selectedCatId === null ? '#0d2040' : BG2, border: `1px solid ${selectedCatId === null ? BLU : BD}`, color: selectedCatId === null ? BLU : TX2, padding: '5px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>전체</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
              {catTree.length === 0 ? (
                <div style={{ color: TX3, fontSize: 13, textAlign: 'center', padding: 30 }}>등록된 분류가 없습니다.</div>
              ) : catTree.map(root => (
                <CategoryTreeNode key={root.id} node={root} selectedId={selectedCatId} expandedIds={expandedCatIds} onSelect={setSelectedCatId} onToggle={toggleCat} />
              ))}
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '18px 24px', background: BG1, borderBottom: `2px solid ${BD2}`, display: 'flex', gap: 12 }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="품목명 / 품목코드 / 바코드 검색"
                style={{ flex: 1, background: BG2, border: `2px solid ${BD}`, borderRadius: 10, color: TX, padding: '12px 16px', fontSize: 16 }} />
              <button onClick={() => { setSearch(''); setSelectedCatId(null); }} style={{ background: BG2, border: `2px solid ${BD}`, color: TX2, padding: '0 20px', borderRadius: 10, cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>초기화</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 100px 110px 100px', background: BG2, borderBottom: `2px solid ${BD}`, padding: '0 16px', flexShrink: 0 }}>
              {['품목코드', '품목명', '재고', '분류', '상태'].map((h, i) => (
                <div key={h} style={{ padding: '14px 8px', color: TX2, fontSize: 13, fontWeight: 900, textAlign: i >= 2 ? 'right' : 'left' }}>{h}</div>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: 40, color: BLU, textAlign: 'center', fontWeight: 800 }}>데이터 로드 중...</div>
              ) : filteredProducts.length === 0 ? (
                <div style={{ padding: 40, color: TX3, textAlign: 'center', fontWeight: 700 }}>조회된 품목이 없습니다.</div>
              ) : filteredProducts.map((p, i) => {
                const selected = p.id === selectedProductId;
                const st = stockStatus(p);
                return (
                  <div key={p.id} onClick={() => setSelectedProductId(selected ? null : p.id)}
                    style={{ display: 'grid', gridTemplateColumns: '140px 1fr 100px 110px 100px', minHeight: 72, padding: '0 16px', borderBottom: `2px solid ${BD2}`, background: selected ? '#0d2040' : i % 2 === 0 ? BG0 : BG1, borderLeft: selected ? `6px solid ${BLU}` : '6px solid transparent', cursor: 'pointer' }}>
                    <div style={{ padding: '20px 8px', color: TX2, fontFamily: 'monospace', fontWeight: 700 }}>{p.productCode}</div>
                    <div style={{ padding: '15px 8px' }}>
                      <div style={{ color: TX, fontSize: 17, fontWeight: 800 }}>{p.productName}</div>
                      {p.specification && <div style={{ color: TX2, fontSize: 12, marginTop: 3 }}>{p.specification}</div>}
                    </div>
                    <div style={{ padding: '20px 8px', color: st.color, fontSize: 20, fontWeight: 900, textAlign: 'right' }}>{Number(p.currentStock || 0).toLocaleString()}</div>
                    <div style={{ padding: '22px 8px', color: TX2, fontSize: 13, fontWeight: 700, textAlign: 'right' }}>{categoryNameMap[p.categoryId] || '-'}</div>
                    <div style={{ padding: '20px 8px', textAlign: 'right' }}><span style={{ color: st.color, background: `${st.color}22`, border: `1px solid ${st.color}55`, borderRadius: 6, padding: '4px 8px', fontSize: 12, fontWeight: 900 }}>{st.label}</span></div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ width: 380, borderLeft: `2px solid ${BD2}`, background: BG1, padding: 24, flexShrink: 0, overflowY: 'auto' }}>
            <div style={{ fontSize: 13, color: BLU, fontWeight: 900, marginBottom: 10 }}>신청 정보</div>
            <div style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 10, padding: 16, marginBottom: 14 }}>
              <div style={{ color: TX2, fontSize: 13, fontWeight: 700 }}>신청자</div>
              <div style={{ color: TX, fontSize: 18, fontWeight: 900, marginTop: 4 }}>{user?.name || '-'}</div>
              <div style={{ color: TX3, fontSize: 13, marginTop: 4 }}>{user?.email || ''}</div>
            </div>
            <div style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 10, padding: 16, marginBottom: 18 }}>
              <div style={{ color: TX2, fontSize: 13, fontWeight: 700 }}>신청 창고</div>
              <div style={{ color: TX, fontSize: 18, fontWeight: 900, marginTop: 4 }}>{selectedWarehouse?.warehouseName || '창고를 선택하세요'}</div>
              <div style={{ color: TX3, fontSize: 13, marginTop: 4 }}>{selectedWarehouse?.location || ''}</div>
            </div>

            {selectedProduct ? (
              <div style={{ borderTop: `1px solid ${BD2}`, paddingTop: 18 }}>
                <div style={{ fontSize: 22, color: TX, fontWeight: 900, lineHeight: 1.25 }}>{selectedProduct.productName}</div>
                {selectedProduct.specification && <div style={{ color: TX2, fontSize: 13, marginTop: 5 }}>{selectedProduct.specification}</div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0', borderBottom: `1px solid ${BD2}`, marginTop: 12 }}>
                  <span style={{ color: TX2, fontWeight: 700 }}>보유 재고</span>
                  <span style={{ color: GRN, fontSize: 20, fontWeight: 900 }}>{Number(selectedProduct.currentStock || 0).toLocaleString()} {selectedProduct.unit}</span>
                </div>
                <label style={{ display: 'block', color: TX2, fontSize: 13, fontWeight: 800, marginTop: 18, marginBottom: 8 }}>신청 수량</label>
                <input type="number" min="1" max={Math.max(1, Number(selectedProduct.currentStock || 1))} value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  style={{ width: '100%', boxSizing: 'border-box', background: BG0, border: `2px solid ${BD}`, borderRadius: 10, color: TX, padding: '12px 14px', fontSize: 18, fontWeight: 900 }} />
                <label style={{ display: 'block', color: TX2, fontSize: 13, fontWeight: 800, marginTop: 18, marginBottom: 8 }}>메모</label>
                <textarea value={memo} onChange={e => setMemo(e.target.value)} placeholder="필요 시 요청 내용을 입력하세요."
                  style={{ width: '100%', minHeight: 92, resize: 'vertical', boxSizing: 'border-box', background: BG0, border: `2px solid ${BD}`, borderRadius: 10, color: TX, padding: 12, fontSize: 14 }} />
                <button onClick={submitRequest} disabled={submitting || Number(selectedProduct.currentStock || 0) <= 0}
                  style={{ width: '100%', marginTop: 20, padding: 18, borderRadius: 14, border: `2px solid ${BLU}`, background: submitting ? BG2 : 'linear-gradient(135deg, #1a3a6a, #2060cc)', color: '#fff', cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 20, fontWeight: 900 }}>
                  {submitting ? '신청 등록 중...' : '신청'}
                </button>
              </div>
            ) : (
              <div style={{ color: TX3, textAlign: 'center', padding: '80px 20px', fontSize: 15, fontWeight: 700 }}>품목 목록에서 신청할 상품을 선택하세요.</div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 130px 1fr 140px 170px', background: BG2, borderBottom: `2px solid ${BD}`, padding: '0 24px' }}>
            {['신청번호', '창고', '내용', '상태', '신청일'].map(h => <div key={h} style={{ padding: '15px 8px', color: TX2, fontWeight: 900, fontSize: 14 }}>{h}</div>)}
          </div>
          {history.length === 0 ? (
            <div style={{ padding: 50, color: TX3, textAlign: 'center', fontWeight: 700 }}>신청 이력이 없습니다.</div>
          ) : history.map((r, i) => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '160px 130px 1fr 140px 170px', minHeight: 68, padding: '0 24px', borderBottom: `1px solid ${BD2}`, background: i % 2 === 0 ? BG0 : BG1 }}>
              <div style={{ padding: '20px 8px', color: String(r.requestNumber || '').startsWith('WMS-') ? GRN : TX2, fontFamily: 'monospace', fontWeight: 900 }}>{r.requestNumber}</div>
              <div style={{ padding: '20px 8px', color: TX2, fontWeight: 700 }}>{r.warehouse?.warehouseName || '-'}</div>
              <div style={{ padding: '20px 8px', color: TX, fontWeight: 700 }}>{r.description}</div>
              <div style={{ padding: '18px 8px' }}><span style={{ color: statusColor(r.status), background: `${statusColor(r.status)}22`, border: `1px solid ${statusColor(r.status)}55`, borderRadius: 6, padding: '4px 9px', fontSize: 12, fontWeight: 900 }}>{statusLabel(r.status)}</span></div>
              <div style={{ padding: '20px 8px', color: TX2, fontWeight: 700 }}>{r.createdAt ? new Date(r.createdAt).toLocaleString('ko-KR') : '-'}</div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', top: 96, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: toast.type === 'error' ? '#3a1a1a' : '#1a3a2a', border: `3px solid ${toast.type === 'error' ? RED : GRN}`, color: toast.type === 'error' ? RED : GRN, padding: '16px 34px', borderRadius: 50, fontSize: 17, fontWeight: 900, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default ApplicantScreen;
