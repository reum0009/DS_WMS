import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { productsAPI, categoriesAPI } from '../../api/api';

const BG0='#0d1117',BG1='#161b22',BG2='#1c2128',BD='#30363d',BD2='#21262d';
const TX='#e6edf3',TX2='#8b949e',TX3='#444c56';
const RED='#f85149',GRN='#3fb950',BLU='#58a6ff',YLW='#e3b341';

function formatClock(d){const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;}

const STATUS_OPTS=[{v:'all',l:'전체 상태'},{v:'ok',l:'정상'},{v:'low',l:'부족'},{v:'empty',l:'소진'}];

const stockStatus=(p)=> {
  const stock = p.currentStock || 0;
  const safety = p.safetyStock || 0;
  if (stock === 0) return { label: '소진', color: RED };
  if (stock <= safety) return { label: '부족', color: YLW };
  return { label: '정상', color: GRN };
};

const WarehouseInventory = ({user, onGoHome}) => {
  const [clock,  setClock]  = useState(formatClock(new Date()));
  const [search, setSearch] = useState('');
  const [catTab, setCatTab] = useState('전체');
  const [status, setStatus] = useState('all');
  const [selId,  setSelId]  = useState(null);
  const [sortBy, setSortBy] = useState('code'); // code | name | stock | status
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [pRes, cRes] = await Promise.all([
        productsAPI.getAll(user?.warehouseId ? { warehouseId: Number(user.warehouseId) } : undefined),
        categoriesAPI.getAll()
      ]);
      const rows = (pRes.data || []).map(p => ({
        ...p,
        unitPrice: parseInt(p.unitPrice, 10) || 0,
      }));
      setProducts(rows);
      setCategories(cRes.data || []);
    } catch (err) {
      console.error('Inventory load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.warehouseId]);

  useEffect(() => {
    loadData();
    const id = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => clearInterval(id);
  }, [loadData]);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onGoHome(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onGoHome]);

  const catMap = useMemo(() => {
    const map = {};
    categories.forEach(c => { map[c.id] = c.name; });
    return map;
  }, [categories]);

  const filtered = useMemo(() => {
    let list = products;
    if (catTab !== '전체') {
      list = list.filter(p => catMap[p.categoryId] === catTab);
    }
    if (status === 'ok')    list = list.filter(p => (p.currentStock || 0) > (p.safetyStock || 0));
    if (status === 'low')   list = list.filter(p => (p.currentStock || 0) > 0 && (p.currentStock || 0) <= (p.safetyStock || 0));
    if (status === 'empty') list = list.filter(p => (p.currentStock || 0) === 0);
    
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.productName.toLowerCase().includes(q) ||
        p.productCode.toLowerCase().includes(q) ||
        (p.barcode || '').includes(q) ||
        (p.codes || []).some(c => (c.codeValue || '').includes(q))
      );
    }
    
    return [...list].sort((a, b) => {
      if (sortBy === 'code')  return (a.productCode || '').localeCompare(b.productCode || '');
      if (sortBy === 'name')  return (a.productName || '').localeCompare(b.productName || '');
      if (sortBy === 'stock') return (a.currentStock || 0) - (b.currentStock || 0);
      if (sortBy === 'status') {
        const score = p => (p.currentStock || 0) === 0 ? 0 : (p.currentStock || 0) <= (p.safetyStock || 0) ? 1 : 2;
        return score(a) - score(b);
      }
      return 0;
    });
  }, [products, catTab, status, search, sortBy, catMap]);

  const selProduct = products.find(p => p.id === selId);

  const totalValue = products.reduce((s, p) => s + (p.currentStock || 0) * (p.unitPrice || 0), 0);
  const emptyCnt = products.filter(p => (p.currentStock || 0) === 0).length;
  const lowCnt = products.filter(p => (p.currentStock || 0) > 0 && (p.currentStock || 0) <= (p.safetyStock || 0)).length;

  const colHdr = (label, key) => (
    <div onClick={() => setSortBy(key)} style={{ cursor: 'pointer', color: sortBy === key ? BLU : TX2, display: 'inline-flex', alignItems: 'center', gap: 3, userSelect: 'none' }}>
      {label}{sortBy === key ? <span style={{ fontSize: 10 }}>▲</span> : null}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG0, color: TX, fontFamily: "'Noto Sans KR', sans-serif", overflow: 'hidden' }}>

      {/* TOP BAR */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', height: 84, background: BG1, borderBottom: `4px solid ${BLU}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <span style={{ fontSize: 24, fontWeight: 900, color: BLU }}>🔍 재고조회</span>
          <span style={{ fontSize: 14, color: BLU, background: '#0a1f40', border: `1px solid ${BLU}55`, borderRadius: 6, padding: '4px 12px', fontWeight: 700 }}>F5</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <span style={{ fontSize: 14, color: RED, fontWeight: 700 }}>소진 {emptyCnt}종</span>
            <span style={{ fontSize: 14, color: YLW, fontWeight: 700 }}>부족 {lowCnt}종</span>
            <span style={{ fontSize: 14, color: GRN, fontWeight: 700 }}>가치 ₩{(totalValue / 10000).toLocaleString(undefined, {maximumFractionDigits:0})}만</span>
          </div>
          <span style={{ fontSize: 18, color: TX2, fontFamily: 'monospace', fontWeight: 600 }}>{clock}</span>
          <button onClick={onGoHome} style={{ background: BG2, border: `2px solid ${BD}`, color: TX, padding: '10px 24px', borderRadius: 10, cursor: 'pointer', fontSize: 16, fontWeight: 700 }}>🏠 홈</button>
        </div>
      </div>

      {/* 검색 + 필터 */}
      <div style={{ padding: '20px 24px', background: BG1, borderBottom: `2px solid ${BD2}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 15 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 품목명 / 품목코드 / 바코드 검색"
            style={{ flex: 1, background: BG2, border: `2px solid ${BD}`, borderRadius: 10, color: TX, padding: '14px 20px', fontSize: 18 }} />
          <select value={status} onChange={e => setStatus(e.target.value)}
            style={{ background: BG2, border: `2px solid ${BD}`, borderRadius: 10, color: TX, padding: '0 15px', fontSize: 16, cursor: 'pointer', minWidth: 160 }}>
            {STATUS_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <button onClick={() => { setSearch(''); setCatTab('전체'); setStatus('all'); }}
            style={{ background: BG2, border: `2px solid ${BD}`, color: TX2, padding: '0 24px', borderRadius: 10, cursor: 'pointer', fontSize: 16, fontWeight: 600 }}>초기화</button>
        </div>
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 5 }}>
          {['전체', ...new Set(categories.map(c => c.name))].map(c => (
            <button key={c} onClick={() => setCatTab(c)}
              style={{ padding: '8px 24px', borderRadius: 25, border: `2px solid ${catTab === c ? BLU : BD}`,
                background: catTab === c ? '#0a1f40' : BG2, color: catTab === c ? BLU : TX2, cursor: 'pointer', fontSize: 15, fontWeight: catTab === c ? 800 : 500, whiteSpace: 'nowrap' }}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* BODY */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── 제품 테이블 ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 100px 120px 120px 100px', background: BG2, borderBottom: `2px solid ${BD}`, padding: '0 12px', flexShrink: 0 }}>
            <div style={{ padding: '15px 10px', fontSize: 14, fontWeight: 800, color: TX2 }}>{colHdr('품목코드', 'code')}</div>
            <div style={{ padding: '15px 10px', fontSize: 14, fontWeight: 800, color: TX2 }}>{colHdr('품목명', 'name')}</div>
            <div style={{ padding: '15px 10px', fontSize: 14, fontWeight: 800, color: TX2, textAlign: 'right' }}>{colHdr('현재고', 'stock')}</div>
            <div style={{ padding: '15px 10px', fontSize: 14, fontWeight: 800, color: TX2, textAlign: 'right' }}>안전재고</div>
            <div style={{ padding: '15px 10px', fontSize: 14, fontWeight: 800, color: TX2, textAlign: 'right' }}>단가</div>
            <div style={{ padding: '15px 10px', fontSize: 14, fontWeight: 800, color: TX2, textAlign: 'center' }}>{colHdr('상태', 'status')}</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: BLU, fontSize: 18, fontWeight: 700 }}>데이터 동기화 중...</div>
            ) : filtered.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: TX3, fontSize: 16 }}>검색 결과가 없습니다.</div>
            ) : filtered.map((p, i) => {
              const st = stockStatus(p);
              const barPct = Math.min(100, (p.safetyStock || 0) > 0 ? Math.round((p.currentStock || 0) / (p.safetyStock || 0) * 100) : 100);
              const isSel = p.id === selId;
              return (
                <div key={p.id} onClick={() => setSelId(isSel ? null : p.id)}
                  style={{ display: 'grid', gridTemplateColumns: '140px 1fr 100px 120px 120px 100px', padding: '0 12px', borderBottom: `2px solid ${BD2}`, cursor: 'pointer',
                    background: isSel ? '#0d2040' : i % 2 === 0 ? BG0 : BG1, borderLeft: isSel ? `6px solid ${BLU}` : '6px solid transparent', minHeight: 80 }}>
                  <div style={{ padding: '20px 10px', fontSize: 14, color: TX2, fontFamily: 'monospace', fontWeight: 600 }}>{p.productCode}</div>
                  <div style={{ padding: '15px 10px' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: TX }}>{p.productName}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                      <div style={{ flex: 1, height: 6, background: BD2, borderRadius: 3 }}>
                        <div style={{ width: `${barPct}%`, height: '100%', background: st.color, borderRadius: 3, transition: 'width 0.3s' }} />
                      </div>
                      <span style={{ fontSize: 13, color: TX3, fontWeight: 600 }}>{catMap[p.categoryId] || '미분류'}</span>
                    </div>
                  </div>
                  <div style={{ padding: '20px 10px', textAlign: 'right', fontSize: 22, fontWeight: 900, color: st.color }}>{(p.currentStock || 0).toLocaleString()}</div>
                  <div style={{ padding: '20px 10px', textAlign: 'right', fontSize: 16, color: TX2 }}>{(p.safetyStock || 0).toLocaleString()} <span style={{fontSize:12}}>{p.unit}</span></div>
                  <div style={{ padding: '20px 10px', textAlign: 'right', fontSize: 16, color: TX, fontWeight: 600 }}>₩{(p.unitPrice || 0).toLocaleString()}</div>
                  <div style={{ padding: '20px 10px', textAlign: 'center' }}>
                    <span style={{ fontSize: 13, color: st.color, background: `${st.color}22`, border: `2px solid ${st.color}55`, borderRadius: 6, padding: '4px 10px', fontWeight: 800 }}>{st.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: '15px 24px', background: BG1, borderTop: `2px solid ${BD2}`, flexShrink: 0, display: 'flex', gap: 30, fontSize: 16, color: TX2, fontWeight: 600 }}>
            <span>총 <b style={{ color: TX }}>{filtered.length}</b>종 표시</span>
            <span>소진 <b style={{ color: RED }}>{filtered.filter(p => p.currentStock === 0).length}</b></span>
            <span>부족 <b style={{ color: YLW }}>{filtered.filter(p => p.currentStock > 0 && p.currentStock <= p.safetyStock).length}</b></span>
            <span>정상 <b style={{ color: GRN }}>{filtered.filter(p => p.currentStock > p.safetyStock).length}</b></span>
          </div>
        </div>

        {/* ── 우: 상세 패널 ── */}
        {selProduct && (
          <div style={{ width: 380, borderLeft: `2px solid ${BD2}`, background: BG1, padding: '24px', flexShrink: 0, overflowY: 'auto' }}>
            <div style={{ fontSize: 13, color: BLU, fontWeight: 800, textTransform: 'uppercase', marginBottom: 10 }}>Product Detail</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: TX, marginBottom: 20, lineHeight: 1.3 }}>{selProduct.productName}</div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                ['품목코드', selProduct.productCode],
                ['바코드', selProduct.barcode || (selProduct.codes && selProduct.codes.length > 0 ? selProduct.codes[0].codeValue : '—')],
                ['분류', catMap[selProduct.categoryId] || '미분류'],
                ['단위', selProduct.unit],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${BD2}` }}>
                  <span style={{ fontSize: 15, color: TX2, fontWeight: 600 }}>{k}</span>
                  <span style={{ fontSize: 16, color: TX, fontFamily: 'monospace', fontWeight: 700 }}>{v}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 30, padding: '20px', background: BG2, borderRadius: 15, textAlign: 'center', border: `2px solid ${stockStatus(selProduct).color}33` }}>
              <div style={{ fontSize: 42, fontWeight: 900, color: stockStatus(selProduct).color }}>{(selProduct.currentStock || 0).toLocaleString()}</div>
              <div style={{ fontSize: 16, color: TX2, fontWeight: 600, marginTop: 4 }}>{selProduct.unit} 현재고</div>
              <div style={{ marginTop: 15, height: 10, background: BD2, borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (selProduct.safetyStock || 0) > 0 ? Math.round((selProduct.currentStock || 0) / (selProduct.safetyStock || 0) * 100) : 100)}%`, height: '100%', background: stockStatus(selProduct).color, borderRadius: 5 }} />
              </div>
              <div style={{ fontSize: 14, color: TX3, marginTop: 12, fontWeight: 700 }}>안전재고: {(selProduct.safetyStock || 0).toLocaleString()} {selProduct.unit}</div>
            </div>

            <div style={{ marginTop: 20, padding: '20px', background: BG2, borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 15, color: TX2, fontWeight: 600 }}>단가</span>
                <span style={{ fontSize: 18, color: TX, fontWeight: 800 }}>₩{(selProduct.unitPrice || 0).toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 15, color: TX2, fontWeight: 600 }}>총 재고가치</span>
                <span style={{ fontSize: 20, color: BLU, fontWeight: 900 }}>₩{((selProduct.currentStock || 0) * (selProduct.unitPrice || 0)).toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM */}
      <div style={{ height: 54, background: '#010409', borderTop: `2px solid ${BD2}`, display: 'flex', alignItems: 'center', gap: 24, padding: '0 32px', flexShrink: 0 }}>
        {[['F5', '재고조회'], ['ESC', '홈으로']].map(([k, l]) => (
          <span key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <kbd style={{ background: BG2, border: `2px solid ${BD}`, borderRadius: 6, padding: '3px 10px', fontSize: 14, color: TX2, fontFamily: 'monospace', fontWeight: 800 }}>{k}</kbd>
            <span style={{ fontSize: 16, color: TX3, fontWeight: 700 }}>{l}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

export default WarehouseInventory;
