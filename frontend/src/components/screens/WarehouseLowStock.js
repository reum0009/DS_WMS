import React, { useState, useEffect, useCallback } from 'react';
import { dashboardAPI } from '../../api/api';

const BG0='#0d1117',BG1='#161b22',BG2='#1c2128',BD='#30363d',BD2='#21262d';
const TX='#e6edf3',TX2='#8b949e',TX3='#444c56';
const RED='#f85149',GRN='#3fb950',YLW='#e3b341',ORG='#f0883e',BLU='#58a6ff';

function formatClock(d){const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;}

const isEmpty  = p => (p.currentStock || 0) === 0;
const isLow    = p => (p.currentStock || 0) > 0 && (p.currentStock || 0) <= (p.safetyStock || 0) / 2;
const isOrder  = p => (p.currentStock || 0) === 1;

const WarehouseLowStock = ({user, onGoHome}) => {
  const [clock, setClock] = useState(formatClock(new Date()));
  const [selId, setSelId] = useState(null);
  const [ordered, setOrdered] = useState(new Set());
  const [toast, setToast] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState(null); // null=전체 'empty' 'low' 'order' 'ordered'

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await dashboardAPI.getLowStockAlerts(user?.warehouseId ? { warehouseId: Number(user.warehouseId) } : undefined);
      const rows = (res.data || []).map(p => ({
        ...p,
        unitPrice: parseInt(p.unitPrice, 10) || 0,
      }));
      setProducts(rows);
    } catch (err) {
      console.error('Low stock alerts load failed:', err);
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

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const emptyCnt   = products.filter(isEmpty).length;
  const lowCnt     = products.filter(isLow).length;
  const orderCnt   = products.filter(isOrder).length;
  const orderedCnt = ordered.size;

  const sorted = [...products].sort((a, b) => {
    const aStock = a.currentStock || 0;
    const bStock = b.currentStock || 0;
    const aSafety = a.safetyStock || 1;
    const bSafety = b.safetyStock || 1;
    if (aStock === 0 && bStock !== 0) return -1;
    if (aStock !== 0 && bStock === 0) return 1;
    return (aStock / aSafety) - (bStock / bSafety);
  });

  const displayed = sorted.filter(p => {
    if (tab === 'empty')   return isEmpty(p);
    if (tab === 'low')     return isLow(p);
    if (tab === 'order')   return isOrder(p);
    if (tab === 'ordered') return ordered.has(p.id);
    return true;
  });

  const handleOrder = (p) => {
    setOrdered(prev => { const n = new Set(prev); n.add(p.id); return n; });
    showToast(`"${p.productName}" 발주 요청 완료`);
  };

  const sel = products.find(p => p.id === selId);

  const CARDS = [
    { key: 'empty',   label: '소진 품목',  value: emptyCnt,   color: RED, bg: '#2d0d0b', icon: '🔴', desc: '재고 0개' },
    { key: 'low',     label: '부족 품목',  value: lowCnt,     color: YLW, bg: '#2d2000', icon: '⚠️', desc: '안전재고 ½ 이하' },
    { key: 'order',   label: '발주 필요',  value: orderCnt,   color: ORG, bg: '#2d1800', icon: '📦', desc: '잔여 1개' },
    { key: 'ordered', label: '발주 완료',  value: orderedCnt, color: GRN, bg: '#0d2616', icon: '✅', desc: '발주 처리됨' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG0, color: TX, fontFamily: "'Noto Sans KR', sans-serif", overflow: 'hidden' }}>

      {/* TOP BAR */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', height: 84, background: BG1, borderBottom: `4px solid ${YLW}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <span style={{ fontSize: 24, fontWeight: 900, color: YLW }}>⚠️ 저재고 경보</span>
          <span style={{ fontSize: 14, color: YLW, background: '#2d2000', border: `1px solid ${YLW}55`, borderRadius: 6, padding: '4px 12px', fontWeight: 700 }}>F6</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <span style={{ fontSize: 18, color: TX2, fontFamily: 'monospace', fontWeight: 600 }}>{clock}</span>
          <button onClick={onGoHome} style={{ background: BG2, border: `2px solid ${BD}`, color: TX, padding: '10px 24px', borderRadius: 10, cursor: 'pointer', fontSize: 16, fontWeight: 700 }}>🏠 홈</button>
        </div>
      </div>

      {/* 요약 카드 (클릭 필터) */}
      <div style={{ display: 'flex', gap: 15, padding: '20px 32px', background: BG1, borderBottom: `2px solid ${BD2}`, flexShrink: 0 }}>
        {/* 전체 카드 */}
        <div onClick={() => setTab(null)}
          style={{ flex: 1, background: tab === null ? '#1a2332' : BG2, border: `2px solid ${tab === null ? BLU : BD}`, borderRadius: 15, padding: '15px', textAlign: 'center', cursor: 'pointer', transition: 'border 0.15s' }}>
          <div style={{ fontSize: 28, marginBottom: 5 }}>📋</div>
          <div style={{ fontSize: 32, fontWeight: 900, color: tab === null ? BLU : TX }}>{products.length}</div>
          <div style={{ fontSize: 14, color: TX2, fontWeight: 600 }}>전체 품목</div>
          <div style={{ fontSize: 11, color: TX3, marginTop: 3 }}>경보 전체</div>
        </div>
        {CARDS.map(c => (
          <div key={c.key} onClick={() => setTab(prev => prev === c.key ? null : c.key)}
            style={{ flex: 1, background: tab === c.key ? c.bg : BG2, border: `2px solid ${tab === c.key ? c.color : BD}`, borderRadius: 15, padding: '15px', textAlign: 'center', cursor: 'pointer', transition: 'border 0.15s' }}>
            <div style={{ fontSize: 28, marginBottom: 5 }}>{c.icon}</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: tab === c.key ? c.color : TX }}>{c.value}</div>
            <div style={{ fontSize: 14, color: TX2, fontWeight: 600 }}>{c.label}</div>
            <div style={{ fontSize: 11, color: TX3, marginTop: 3 }}>{c.desc}</div>
          </div>
        ))}
      </div>

      {/* 현재 필터 표시 */}
      {tab && (
        <div style={{ padding: '8px 32px', background: BG2, borderBottom: `1px solid ${BD2}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14, color: TX2 }}>필터:</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: CARDS.find(c=>c.key===tab)?.color }}>
            {CARDS.find(c=>c.key===tab)?.icon} {CARDS.find(c=>c.key===tab)?.label} ({displayed.length}종)
          </span>
          <button onClick={() => setTab(null)} style={{ fontSize: 12, color: TX3, background: 'none', border: `1px solid ${BD}`, borderRadius: 6, padding: '2px 10px', cursor: 'pointer' }}>✕ 초기화</button>
        </div>
      )}

      {/* BODY */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── 목록 ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr 160px 120px 120px 120px', background: BG2, borderBottom: `2px solid ${BD}`, padding: '0 20px', flexShrink: 0 }}>
            {['#', '품목명', '현재고 / 안전', '상태', '단가', '액션'].map((h, i) => (
              <div key={h} style={{ padding: '15px 5px', fontSize: 14, fontWeight: 800, color: TX2, textAlign: i >= 2 ? 'center' : 'left' }}>{h}</div>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: YLW, fontSize: 18, fontWeight: 700 }}>조회 중...</div>
            ) : displayed.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: TX3, fontSize: 16 }}>
                {tab ? '해당 조건의 품목이 없습니다.' : '저재고 품목이 없습니다.'}
              </div>
            ) : displayed.map((p, i) => {
              const aStock = p.currentStock || 0;
              const aSafety = p.safetyStock || 0;
              const _isEmpty  = aStock === 0;
              const _isLow    = aStock > 0 && aSafety > 0 && aStock <= aSafety / 2;
              const _isOrder  = aStock === 1;
              const isOrdered = ordered.has(p.id);
              const pct = Math.min(100, aSafety > 0 ? Math.round(aStock / aSafety * 100) : 0);
              const color = _isEmpty ? RED : _isOrder ? ORG : _isLow ? YLW : TX2;
              const isSel = p.id === selId;

              let statusLabel = '저재고';
              let statusColor = TX2;
              if (_isEmpty)  { statusLabel = '소진';    statusColor = RED; }
              else if (_isOrder && _isLow) { statusLabel = '발주필요·부족'; statusColor = ORG; }
              else if (_isOrder) { statusLabel = '발주필요';  statusColor = ORG; }
              else if (_isLow)   { statusLabel = '부족';    statusColor = YLW; }

              return (
                <div key={p.id} onClick={() => setSelId(isSel ? null : p.id)}
                  style={{ display: 'grid', gridTemplateColumns: '50px 1fr 160px 120px 120px 120px', padding: '0 20px', borderBottom: `2px solid ${BD2}`, cursor: 'pointer',
                    background: isSel ? '#1a1800' : i % 2 === 0 ? BG0 : BG1, borderLeft: isSel ? `6px solid ${color}` : '6px solid transparent',
                    opacity: isOrdered ? 0.55 : 1, minHeight: 90 }}>
                  <div style={{ padding: '25px 5px', fontSize: 14, color: TX3 }}>{i + 1}</div>
                  <div style={{ padding: '15px 5px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 10, color }}>●</span>
                      <span>
                        <span style={{ fontSize: 18, color: TX, fontWeight: 700 }}>{p.productName}</span>
                        {p.specification && <span style={{ display: 'block', color: TX2, fontSize: 12, marginTop: 2 }}>{p.specification}</span>}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                      <div style={{ width: 120, height: 6, background: BD2, borderRadius: 3 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 13, color: TX3, fontWeight: 600 }}>{p.productCode}</span>
                    </div>
                  </div>
                  <div style={{ padding: '25px 5px', textAlign: 'center' }}>
                    <span style={{ fontSize: 20, fontWeight: 900, color }}>{aStock}</span>
                    <span style={{ fontSize: 14, color: TX3, fontWeight: 600 }}> / {aSafety} {p.unit}</span>
                  </div>
                  <div style={{ padding: '20px 5px', textAlign: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: statusColor, background: `${statusColor}22`, border: `2px solid ${statusColor}55`, borderRadius: 8, padding: '5px 10px' }}>
                      {statusLabel}
                    </span>
                  </div>
                  <div style={{ padding: '25px 5px', textAlign: 'center', fontSize: 15, color: TX2, fontWeight: 600 }}>
                    ₩{(p.unitPrice || 0).toLocaleString()}
                  </div>
                  <div style={{ padding: '20px 5px', textAlign: 'center' }}>
                    {isOrdered ? (
                      <span style={{ fontSize: 13, color: GRN, background: '#0d2616', border: `2px solid ${GRN}55`, borderRadius: 8, padding: '6px 12px', fontWeight: 800 }}>발주완료</span>
                    ) : (
                      <button onClick={e => { e.stopPropagation(); handleOrder(p); }}
                        style={{ fontSize: 14, padding: '10px 16px', background: '#2d2000', border: `2px solid ${YLW}`, color: YLW, borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}>
                        📦 발주
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: '12px 24px', background: BG1, borderTop: `2px solid ${BD2}`, flexShrink: 0, display: 'flex', gap: 24, fontSize: 14, color: TX2, fontWeight: 600 }}>
            <span>표시 <b style={{ color: TX }}>{displayed.length}</b>종</span>
            <span>소진 <b style={{ color: RED }}>{displayed.filter(isEmpty).length}</b></span>
            <span>부족 <b style={{ color: YLW }}>{displayed.filter(isLow).length}</b></span>
            <span>발주필요 <b style={{ color: ORG }}>{displayed.filter(isOrder).length}</b></span>
          </div>
        </div>

        {/* ── 우: 상세 ── */}
        {sel && (
          <div style={{ width: 340, borderLeft: `2px solid ${BD2}`, background: BG1, padding: '24px', flexShrink: 0, overflowY: 'auto' }}>
            <div style={{ fontSize: 12, color: YLW, fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 }}>Item Alert</div>
            <div style={{ marginBottom: 20, lineHeight: 1.3 }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: TX }}>{sel.productName}</div>
              {sel.specification && <div style={{ color: TX2, fontSize: 12, marginTop: 2 }}>{sel.specification}</div>}
            </div>

            <div style={{ padding: '20px', background: isEmpty(sel) ? '#2d0d0b' : isOrder(sel) ? '#2d1800' : '#2d2000',
              border: `2px solid ${isEmpty(sel) ? RED : isOrder(sel) ? ORG : YLW}33`, borderRadius: 15, marginBottom: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 48, fontWeight: 900, color: isEmpty(sel) ? RED : isOrder(sel) ? ORG : YLW }}>{sel.currentStock || 0}</div>
              <div style={{ fontSize: 16, color: TX2, fontWeight: 600, marginTop: 4 }}>{sel.unit} / 안전재고 {sel.safetyStock}{sel.unit}</div>
              <div style={{ marginTop: 15, height: 10, background: BD2, borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (sel.safetyStock||0) > 0 ? (sel.currentStock||0)/(sel.safetyStock||1)*100 : 0)}%`,
                  height: '100%', background: isEmpty(sel) ? RED : isOrder(sel) ? ORG : YLW, borderRadius: 5 }} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                ['품목코드', sel.productCode],
                ['단가', `₩${(sel.unitPrice || 0).toLocaleString()}`],
                ['상태', isEmpty(sel) ? '소진' : isOrder(sel) ? '발주필요(잔여1개)' : isLow(sel) ? '부족(½이하)' : '저재고'],
                ['부족량', isEmpty(sel) ? '전량소진'
                  : ((sel.safetyStock || 0) - (sel.currentStock || 0)) > 0
                    ? `${(sel.safetyStock||0)-(sel.currentStock||0)}${sel.unit}`
                    : '저재고'],
                ['권장발주량', `${(sel.safetyStock || 0) * 2}${sel.unit}`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${BD2}` }}>
                  <span style={{ fontSize: 15, color: TX2, fontWeight: 600 }}>{k}</span>
                  <span style={{ fontSize: 16, color: TX, fontFamily: 'monospace', fontWeight: 700 }}>{v}</span>
                </div>
              ))}
            </div>

            {!ordered.has(sel.id) && (
              <button onClick={() => handleOrder(sel)}
                style={{ width: '100%', marginTop: 30, padding: '18px', background: 'linear-gradient(135deg, #855d00, #b8860b)', border: `2px solid ${YLW}`, color: '#fff', borderRadius: 12, cursor: 'pointer', fontWeight: 800, fontSize: 18 }}>
                📦 발주 요청하기
              </button>
            )}
          </div>
        )}
      </div>

      {/* BOTTOM */}
      <div style={{ height: 54, background: '#010409', borderTop: `2px solid ${BD2}`, display: 'flex', alignItems: 'center', gap: 24, padding: '0 32px', flexShrink: 0 }}>
        {[['F6', '저재고'], ['ESC', '홈으로']].map(([k, l]) => (
          <span key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <kbd style={{ background: BG2, border: `2px solid ${BD}`, borderRadius: 6, padding: '3px 10px', fontSize: 14, color: TX2, fontFamily: 'monospace', fontWeight: 800 }}>{k}</kbd>
            <span style={{ fontSize: 16, color: TX3, fontWeight: 700 }}>{l}</span>
          </span>
        ))}
      </div>

      {toast && <div style={{ position: 'fixed', top: 100, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
        background: toast.type === 'error' ? '#3a1a1a' : '#1a3a2a', border: `3px solid ${toast.type === 'error' ? RED : GRN}`,
        color: toast.type === 'error' ? RED : GRN, padding: '18px 40px', borderRadius: 50, fontSize: 20, fontWeight: 800, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>{toast.msg}</div>}
    </div>
  );
};

export default WarehouseLowStock;
