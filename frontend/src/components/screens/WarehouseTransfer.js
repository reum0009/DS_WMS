import React, { useState, useEffect, useRef, useCallback } from 'react';
import { warehouseTransferAPI, warehousesAPI, productsAPI } from '../../api/api';

// ── 날짜 포맷 ────────────────────────────────────────────────────
function fmtDT(d) {
  if (!d) return '—';
  const dt = new Date(d), p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}.${p(dt.getMonth()+1)}.${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}
function fmtD(d) {
  if (!d) return '—';
  const dt = new Date(d), p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}.${p(dt.getMonth()+1)}.${p(dt.getDate())}`;
}
function formatClock(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ── 바코드 스캐너 훅 ─────────────────────────────────────────────
const SCANNER_SPEED_MS = 50;
const SCANNER_MIN_LEN  = 3;
const IDLE_RESET_MS    = 280;
function useBarcodeScanner(onScan, enabled = true) {
  const buf = useRef([]);
  const timer = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    const reset = () => { buf.current = []; };
    const onKey = (e) => {
      const el = document.activeElement, tag = el?.tagName;
      if (tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (tag === 'INPUT' && el?.dataset?.barcodeManual !== 'true') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key.length > 1 && e.key !== 'Enter') return;
      if (e.key === 'Enter') {
        const b = buf.current; buf.current = []; clearTimeout(timer.current);
        if (b.length < SCANNER_MIN_LEN) return;
        if (b.every((it, i) => i === 0 || (it.ts - b[i-1].ts) <= SCANNER_SPEED_MS))
          onScan(b.map(x => x.char).join(''));
        return;
      }
      buf.current.push({ char: e.key, ts: Date.now() });
      clearTimeout(timer.current);
      timer.current = setTimeout(reset, IDLE_RESET_MS);
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); clearTimeout(timer.current); };
  }, [enabled, onScan]);
}

// ── 상태 뱃지 ────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const cfg = {
    pending:   { label: '이동 대기', color: '#e3b341', bg: '#2d2000' },
    confirmed: { label: '입고 완료', color: '#3fb950', bg: '#0d2616' },
    cancelled: { label: '취소',     color: '#f85149', bg: '#2d0d0b' },
  }[status] || { label: status, color: '#8b949e', bg: '#1c2128' };
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.color}44`, borderRadius: 4, padding: '2px 8px' }}>
      {cfg.label}
    </span>
  );
}

// ── 오른쪽 패널 버튼 ─────────────────────────────────────────────
function RightBtn({ icon, label, sub, color, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', background: '#1c2128',
      border: `1px solid ${disabled ? '#21262d' : color + '55'}`,
      borderRadius: 6, padding: '9px 8px', cursor: disabled ? 'default' : 'pointer',
      textAlign: 'left', opacity: disabled ? 0.35 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14, color }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: disabled ? '#444c56' : '#e6edf3' }}>{label}</span>
      </div>
      {sub && <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2, paddingLeft: 20 }}>{sub}</div>}
    </button>
  );
}

// ── 숫자 키패드 ──────────────────────────────────────────────────
function NumKeypad({ label, value, onConfirm, onClose }) {
  const [val, setVal] = useState(String(value ?? '1'));
  const press = (k) => {
    if (k === '←') { setVal(v => v.length > 1 ? v.slice(0, -1) : '0'); return; }
    if (k === 'C')  { setVal('0'); return; }
    if (k === 'OK') { onConfirm(Number(val) || 1); return; }
    setVal(v => v === '0' ? k : v + k);
  };
  const keys = ['7','8','9','4','5','6','1','2','3','C','0','←'];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: 20, width: 240 }}>
        <div style={{ fontSize: 13, color: '#8b949e', marginBottom: 6 }}>{label}</div>
        <div style={{ background: '#0d1117', border: '1px solid #388bfd', borderRadius: 6, padding: '10px 14px', fontSize: 24, fontWeight: 700, color: '#58a6ff', textAlign: 'right', marginBottom: 12, fontFamily: 'monospace' }}>{val}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {keys.map(k => (
            <button key={k} onClick={() => press(k)} style={{
              padding: 14, background: k === 'C' ? '#3a1a1a' : k === '←' ? '#1a2d1a' : '#1c2128',
              border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3',
              fontSize: 16, fontWeight: 700, cursor: 'pointer',
            }}>{k}</button>
          ))}
        </div>
        <button onClick={() => press('OK')} style={{
          width: '100%', marginTop: 8, padding: 14, background: '#1158b7', border: 'none',
          borderRadius: 6, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer',
        }}>확인</button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// ─ 창고간 입고 탭 ────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════
function InboundContent({ user, showToast, onGoHome }) {
  const [pendingList, setPendingList] = useState([]);
  const [outNumber,   setOutNumber]   = useState('');
  const [transfer,    setTransfer]    = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [recvQtyMap,  setRecvQtyMap]  = useState({});
  const [confirming,  setConfirming]  = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [highlightBarcode, setHighlightBarcode] = useState('');
  const outInputRef = useRef(null);

  const loadPending = useCallback(async () => {
    try {
      const res = await warehouseTransferAPI.getAll({ status: 'pending', toWarehouseId: user?.warehouseId });
      setPendingList(res.data || []);
    } catch {}
  }, [user?.warehouseId]);

  useEffect(() => { loadPending(); }, [loadPending]);

  const searchTransfer = useCallback(async (num) => {
    const q = (num || outNumber).trim().toUpperCase();
    if (!q) return;
    setLoading(true); setTransfer(null); setRecvQtyMap({});
    try {
      const res = await warehouseTransferAPI.getByOut(q);
      const t = res.data;
      setTransfer(t);
      const qmap = {};
      (t.items || []).forEach(it => { qmap[it.productId] = it.quantity; });
      setRecvQtyMap(qmap);
    } catch (e) { showToast('조회 실패: ' + (e.response?.data?.error || e.message), 'error'); }
    finally { setLoading(false); }
  }, [outNumber, showToast]);

  const handleScan = useCallback((code) => {
    const c = code.trim().toUpperCase();
    if (c.startsWith('TO-')) { setOutNumber(c); searchTransfer(c); }
    else {
      setHighlightBarcode(c);
      setTimeout(() => setHighlightBarcode(''), 2000);
      showToast(`바코드: ${c}`, 'info');
    }
  }, [searchTransfer, showToast]);

  useBarcodeScanner(handleScan, !confirming);

  const handleConfirm = async () => {
    if (!transfer) return;
    setSubmitting(true);
    try {
      const receivedItems = (transfer.items || []).map(it => ({
        id: it.id, productId: it.productId,
        receivedQuantity: Number(recvQtyMap[it.productId] ?? it.quantity),
      }));
      const res = await warehouseTransferAPI.confirm(transfer.id, { receivedItems });
      showToast(`입고 확정 완료 — 입고번호: ${res.data.transferInNumber}`);
      loadPending();
      await searchTransfer(transfer.transferOutNumber);
      setConfirming(false);
    } catch (e) { showToast(e.response?.data?.error || '확정 실패', 'error'); }
    finally { setSubmitting(false); }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Escape') { if (confirming) { setConfirming(false); return; } onGoHome?.(); }
      if (e.key === 'F7') { e.preventDefault(); if (transfer?.status === 'pending') setConfirming(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, transfer, onGoHome]);

  const fromWH  = transfer?.fromWarehouse?.warehouseName || '—';
  const toWH    = transfer?.toWarehouse?.warehouseName   || '—';
  const totalItems = (transfer?.items || []).length;
  const totalQty   = (transfer?.items || []).reduce((s, it) => s + it.quantity, 0);
  const totalRecv  = (transfer?.items || []).reduce((s, it) => s + Number(recvQtyMap[it.productId] ?? it.quantity), 0);

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

      {/* 확정 확인 다이얼로그 */}
      {confirming && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div style={{ background: '#161b22', border: '2px solid #3fb950', borderRadius: 12, padding: 32, textAlign: 'center', width: 340 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#e6edf3', marginBottom: 8 }}>입고 확정</div>
            <div style={{ fontSize: 14, color: '#8b949e', marginBottom: 8 }}>{transfer?.transferOutNumber}</div>
            <div style={{ fontSize: 15, color: '#3fb950', marginBottom: 24 }}>총 {totalRecv}개 입고 처리하시겠습니까?</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirming(false)} style={{ flex: 1, padding: 12, background: 'none', border: '1px solid #30363d', color: '#8b949e', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}>취소</button>
              <button onClick={handleConfirm} disabled={submitting} style={{ flex: 1, padding: 12, background: '#1a5c1a', border: '2px solid #3fb950', color: '#3fb950', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
                {submitting ? '처리 중...' : '✅ 확정'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 왼쪽: 대기 목록 */}
      <div style={{ width: 300, background: '#0d1117', borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ padding: '12px', background: '#161b22', borderBottom: '1px solid #21262d' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#a371f7', marginBottom: 8 }}>출고번호 직접 조회</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input ref={outInputRef} data-barcode-manual="true"
              value={outNumber} onChange={e => setOutNumber(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && searchTransfer()}
              placeholder="TO-..."
              style={{ flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', padding: '7px 10px', fontSize: 13, fontFamily: 'monospace' }} />
            <button onClick={() => searchTransfer()} disabled={loading}
              style={{ background: '#1158b7', border: 'none', color: '#fff', padding: '0 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>🔍</button>
          </div>
        </div>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #21262d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#8b949e' }}>입고 대기 ({pendingList.length})</span>
          <button onClick={loadPending} style={{ background: 'none', border: 'none', color: '#58a6ff', fontSize: 11, cursor: 'pointer' }}>새로고침</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {pendingList.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#444c56', fontSize: 12 }}>대기 중인 이동 건이 없습니다</div>
          ) : pendingList.map(item => {
            const isSel = transfer?.id === item.id;
            return (
              <div key={item.id} onClick={() => searchTransfer(item.transferOutNumber)}
                style={{ padding: '11px 14px', borderBottom: '1px solid #21262d', cursor: 'pointer',
                  background: isSel ? '#1f3a5f' : 'transparent',
                  borderLeft: isSel ? '4px solid #58a6ff' : '4px solid transparent' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: isSel ? '#58a6ff' : '#e6edf3', fontFamily: 'monospace' }}>{item.transferOutNumber}</span>
                  <span style={{ fontSize: 11, color: '#8b949e' }}>{fmtD(item.outAt)}</span>
                </div>
                <div style={{ fontSize: 11, color: '#8b949e' }}>
                  {item.fromWarehouse?.warehouseName} → <span style={{ color: '#e6edf3' }}>{item.items?.length || 0}종</span>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: 10, borderTop: '1px solid #21262d', fontSize: 11, color: '#444c56', lineHeight: 1.5 }}>
          ※ 타 창고에서 보낸 이동 내역. 선택 후 입고 확정하세요.
        </div>
      </div>

      {/* 가운데: 이동 상세 + 그리드 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0d1117' }}>
        {transfer ? (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 10, color: '#8b949e', marginBottom: 2 }}>출고번호</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#a371f7', fontSize: 14 }}>{transfer.transferOutNumber}</div></div>
              <div style={{ fontSize: 18, color: '#444c56' }}>→</div>
              <div><div style={{ fontSize: 10, color: '#8b949e', marginBottom: 2 }}>입고번호</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: transfer.transferInNumber ? '#3fb950' : '#444c56' }}>
                  {transfer.transferInNumber || '미확정'}</div></div>
              <div style={{ width: 1, height: 36, background: '#21262d' }} />
              <div><div style={{ fontSize: 10, color: '#8b949e', marginBottom: 2 }}>이동 경로</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{fromWH} → {toWH}</div></div>
              <div><div style={{ fontSize: 10, color: '#8b949e', marginBottom: 2 }}>출고일시</div>
                <div style={{ fontSize: 12 }}>{fmtDT(transfer.outAt)}</div></div>
              <div style={{ marginLeft: 'auto' }}><StatusBadge status={transfer.status} /></div>
            </div>
          </div>
        ) : (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
            <span style={{ fontSize: 12, color: '#388bfd' }}>※ 대기 목록에서 선택하거나 출고번호(TO-…)를 입력/스캔하세요.</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '40px 90px 1fr 60px 80px 90px', background: '#1c2128', borderBottom: '2px solid #30363d', padding: '0 8px', flexShrink: 0 }}>
          {['NO', '품목코드', '품목명', '단위', '출고수량', '실수령수량'].map((h, i) => (
            <div key={h} style={{ padding: '10px 6px', fontSize: 12, fontWeight: 700, color: '#8b949e', textAlign: i >= 4 ? 'right' : 'left', borderRight: i < 5 ? '1px solid #30363d' : 'none' }}>{h}</div>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {!transfer ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#444c56', gap: 10 }}>
              <div style={{ fontSize: 40 }}>📥</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>출고번호를 조회하세요</div>
            </div>
          ) : transfer.items.map((item, i) => {
            const prod = item.Product;
            const isHL = highlightBarcode && (prod?.barcode?.toUpperCase() === highlightBarcode || prod?.productCode?.toUpperCase() === highlightBarcode);
            const confirmed = transfer.status === 'confirmed';
            return (
              <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '40px 90px 1fr 60px 80px 90px', padding: '0 8px',
                background: isHL ? '#1f3a1f' : i % 2 === 0 ? '#0d1117' : '#111720', borderBottom: '1px solid #1c2128', borderLeft: isHL ? '3px solid #3fb950' : '3px solid transparent' }}>
                <div style={{ padding: '11px 6px', fontSize: 12, color: '#8b949e', borderRight: '1px solid #1c2128' }}>{i + 1}</div>
                <div style={{ padding: '11px 6px', fontSize: 11, color: '#8b949e', fontFamily: 'monospace', borderRight: '1px solid #1c2128', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prod?.productCode || '—'}</div>
                <div style={{ padding: '8px 6px', borderRight: '1px solid #1c2128' }}>
                  <div style={{ fontSize: 14, color: '#e6edf3', fontWeight: 500 }}>{prod?.productName || '—'}</div>
                  {prod?.barcode && <div style={{ fontSize: 10, color: '#8b949e', fontFamily: 'monospace', marginTop: 1 }}>{prod.barcode}</div>}
                </div>
                <div style={{ padding: '11px 6px', fontSize: 12, color: '#8b949e', borderRight: '1px solid #1c2128' }}>{prod?.unit || '—'}</div>
                <div style={{ padding: '11px 6px', fontSize: 14, fontWeight: 700, color: '#a371f7', textAlign: 'right', borderRight: '1px solid #1c2128' }}>{item.quantity.toLocaleString()}</div>
                <div style={{ padding: '6px 6px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  {confirmed ? (
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#3fb950' }}>{item.receivedQuantity ?? item.quantity}</span>
                  ) : (
                    <input type="number" min="0" inputMode="numeric"
                      value={recvQtyMap[item.productId] ?? item.quantity}
                      onChange={e => setRecvQtyMap(p => ({ ...p, [item.productId]: e.target.value }))}
                      onClick={e => e.stopPropagation()}
                      style={{ width: 72, background: '#0d1117', border: '1px solid #388bfd', borderRadius: 4, color: '#58a6ff', padding: '4px 6px', fontSize: 14, fontWeight: 700, textAlign: 'right' }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {transfer && transfer.items.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '40px 90px 1fr 60px 80px 90px', background: '#1c2128', borderTop: '2px solid #30363d', padding: '0 8px', flexShrink: 0 }}>
            <div style={{ padding: '10px 6px', fontSize: 12, color: '#8b949e', gridColumn: '1/5', borderRight: '1px solid #30363d' }}>합계 <strong style={{ color: '#e6edf3' }}>{totalItems}종</strong></div>
            <div style={{ padding: '10px 6px', fontSize: 14, fontWeight: 700, color: '#a371f7', textAlign: 'right', borderRight: '1px solid #30363d' }}>{totalQty.toLocaleString()}</div>
            <div style={{ padding: '10px 6px', fontSize: 14, fontWeight: 700, color: '#3fb950', textAlign: 'right' }}>{totalRecv.toLocaleString()}</div>
          </div>
        )}
      </div>

      {/* 오른쪽: 조작 패널 */}
      <div style={{ width: 160, background: '#161b22', borderLeft: '1px solid #21262d', display: 'flex', flexDirection: 'column', padding: '12px 10px', gap: 6, flexShrink: 0 }}>
        <div style={{ background: '#1c2128', borderRadius: 6, padding: '10px', marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>이동 정보</div>
          {transfer ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#a371f7' }}>{totalItems}<span style={{ fontSize: 11, fontWeight: 400, color: '#8b949e', marginLeft: 3 }}>종</span></div>
              <div style={{ fontSize: 13, color: '#e6edf3', fontWeight: 600 }}>{totalQty.toLocaleString()}<span style={{ fontSize: 11, color: '#8b949e', marginLeft: 3 }}>개 출고</span></div>
              <div style={{ fontSize: 13, color: '#3fb950', fontWeight: 600 }}>{totalRecv.toLocaleString()}<span style={{ fontSize: 11, color: '#8b949e', marginLeft: 3 }}>개 수령</span></div>
              <div style={{ marginTop: 6 }}><StatusBadge status={transfer.status} /></div>
            </>
          ) : <div style={{ fontSize: 12, color: '#444c56' }}>—</div>}
        </div>
        <div style={{ borderTop: '1px solid #21262d', margin: '4px 0' }} />
        <RightBtn icon="✅" label="입고 확정" sub="F7" color="#3fb950"
          disabled={!transfer || transfer.status !== 'pending'}
          onClick={() => transfer?.status === 'pending' && setConfirming(true)} />
        <RightBtn icon="↩" label="초기화" color="#8b949e"
          onClick={() => { setTransfer(null); setOutNumber(''); setRecvQtyMap({}); }} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// ─ 창고간 출고 탭 ────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════
function OutboundContent({ user, showToast, warehouses }) {
  const [subTab,   setSubTab]   = useState('new'); // 'new' | 'history'
  const [products, setProducts] = useState([]);
  const [search,   setSearch]   = useState('');
  const [items,    setItems]    = useState([]); // [{productId, product, quantity}]
  const [destWH,   setDestWH]   = useState('');
  const [loading,  setLoading]  = useState(false);
  const [qtyPad,   setQtyPad]   = useState(null); // product

  // 이동 내역
  const [pendingList,   setPendingList]   = useState([]);
  const [selectedTrans, setSelectedTrans] = useState(null);
  const [editQtyMap,    setEditQtyMap]    = useState({});
  const [histLoading,   setHistLoading]   = useState(false);

  const deptWHs = warehouses.filter(w => w.deptId === user?.deptId && w.id !== user?.warehouseId);

  useEffect(() => {
    productsAPI.getAll(user?.warehouseId ? { warehouseId: user.warehouseId } : undefined)
      .then(r => setProducts(r.data || []))
      .catch(() => {});
  }, [user?.warehouseId]);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const res = await warehouseTransferAPI.getAll({ status: 'pending', fromWarehouseId: user?.warehouseId });
      setPendingList(res.data || []);
    } catch { showToast('내역 로드 실패', 'error'); }
    finally { setHistLoading(false); }
  }, [user?.warehouseId, showToast]);

  useEffect(() => { if (subTab === 'history') loadHistory(); }, [subTab, loadHistory]);

  const addProduct = (prod, qty) => {
    const q = Math.max(1, Number(qty) || 1);
    setItems(prev => {
      const idx = prev.findIndex(it => it.productId === prod.id);
      if (idx >= 0) return prev.map((it, i) => i === idx ? { ...it, quantity: it.quantity + q } : it);
      return [...prev, { productId: prod.id, product: prod, quantity: q }];
    });
  };

  const removeItem = (productId) => setItems(prev => prev.filter(it => it.productId !== productId));

  const handleCreate = async () => {
    if (!destWH)   { showToast('목적지 창고를 선택하세요', 'error'); return; }
    if (!items.length) { showToast('이동할 품목이 없습니다', 'error'); return; }
    setLoading(true);
    try {
      await warehouseTransferAPI.create({
        fromWarehouseId: user.warehouseId,
        toWarehouseId: Number(destWH),
        items: items.map(it => ({ productId: it.productId, quantity: it.quantity })),
      });
      showToast('창고간 이동 출고 완료');
      setItems([]); setDestWH('');
    } catch (e) { showToast(e.response?.data?.error || '이동 등록 실패', 'error'); }
    finally { setLoading(false); }
  };

  const handleUpdateTransfer = async () => {
    if (!selectedTrans) return;
    setHistLoading(true);
    try {
      const updateItems = selectedTrans.items.map(it => ({ id: it.id, quantity: Number(editQtyMap[it.id] ?? it.quantity) }));
      await warehouseTransferAPI.update(selectedTrans.id, { items: updateItems });
      showToast('수량 수정 완료');
      loadHistory(); setSelectedTrans(null);
    } catch (e) { showToast(e.response?.data?.error || '수정 실패', 'error'); }
    finally { setHistLoading(false); }
  };

  const handleCancel = async (id) => {
    if (!window.confirm('이동을 취소하시겠습니까?\n출고 창고의 재고가 복구됩니다.')) return;
    setHistLoading(true);
    try {
      await warehouseTransferAPI.cancel(id);
      showToast('이동 취소 완료');
      loadHistory();
      if (selectedTrans?.id === id) setSelectedTrans(null);
    } catch { showToast('취소 실패', 'error'); }
    finally { setHistLoading(false); }
  };

  const filtered = products.filter(p =>
    !search || p.productName?.includes(search) || (p.barcode || '').includes(search) || (p.productCode || '').includes(search)
  );

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

      {/* 수량 키패드 */}
      {qtyPad && (
        <NumKeypad label={`${qtyPad.productName} 이동 수량`} value={1}
          onConfirm={qty => { addProduct(qtyPad, qty); setQtyPad(null); }}
          onClose={() => setQtyPad(null)} />
      )}

      {/* 왼쪽: 품목 목록 */}
      <div style={{ width: 280, background: '#0d1117', borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #21262d', background: '#161b22' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#f0883e', marginBottom: 6 }}>품목 선택 (클릭하여 추가)</div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="품목명 / 바코드 검색..."
            style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', padding: '7px 10px', fontSize: 12, boxSizing: 'border-box' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#444c56', fontSize: 12 }}>품목 없음</div>
          ) : filtered.map(prod => {
            const inList = items.some(it => it.productId === prod.id);
            return (
              <div key={prod.id} onClick={() => setQtyPad(prod)}
                style={{ padding: '10px 12px', borderBottom: '1px solid #1c2128', cursor: 'pointer',
                  background: inList ? '#1a2d1a' : 'transparent',
                  borderLeft: inList ? '3px solid #3fb950' : '3px solid transparent' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3' }}>{prod.productName}</div>
                <div style={{ fontSize: 11, color: '#8b949e', display: 'flex', gap: 8, marginTop: 2 }}>
                  <span>재고: <span style={{ color: prod.currentStock <= (prod.safetyStock || 0) ? '#f85149' : '#3fb950' }}>{prod.currentStock}</span> {prod.unit}</span>
                  {prod.productCode && <span style={{ fontFamily: 'monospace' }}>{prod.productCode}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 오른쪽: 이동 작업 영역 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0d1117' }}>

        {/* 서브탭 */}
        <div style={{ display: 'flex', borderBottom: '2px solid #21262d', flexShrink: 0, background: '#161b22' }}>
          {[['new', '🚚 신규 이동'], ['history', '📋 이동 내역/수정']].map(([id, label]) => (
            <button key={id} onClick={() => setSubTab(id)} style={{
              padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
              color: subTab === id ? '#f0883e' : '#8b949e', fontWeight: subTab === id ? 700 : 400,
              borderBottom: subTab === id ? '2px solid #f0883e' : '2px solid transparent',
              fontSize: 13, fontFamily: 'inherit', marginBottom: -2,
            }}>{label}</button>
          ))}
        </div>

        {subTab === 'new' ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 20, gap: 16 }}>
            {/* 목적지 창고 */}
            <div>
              <label style={{ display: 'block', fontSize: 12, color: '#8b949e', marginBottom: 6 }}>목적지 창고 선택</label>
              <select value={destWH} onChange={e => setDestWH(e.target.value)}
                style={{ width: '100%', maxWidth: 360, background: '#161b22', border: `2px solid ${destWH ? '#f0883e' : '#30363d'}`, color: '#e6edf3', padding: '10px 12px', borderRadius: 8, fontSize: 14 }}>
                <option value="">-- 창고 선택 --</option>
                {deptWHs.length > 0 ? deptWHs.map(w => <option key={w.id} value={w.id}>{w.warehouseName}</option>)
                  : warehouses.filter(w => w.id !== user?.warehouseId).map(w => <option key={w.id} value={w.id}>{w.warehouseName}</option>)}
              </select>
              {deptWHs.length === 0 && warehouses.length > 1 && (
                <div style={{ fontSize: 11, color: '#e3b341', marginTop: 4 }}>※ 같은 부서 창고가 없어 전체 창고를 표시합니다.</div>
              )}
            </div>

            {/* 이동 품목 목록 */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6 }}>이동 품목 ({items.length}종)</div>
              {items.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444c56', fontSize: 13, border: '1px dashed #21262d', borderRadius: 8 }}>
                  좌측 품목 목록에서 클릭하여 추가하세요
                </div>
              ) : (
                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #21262d', borderRadius: 8 }}>
                  {/* 헤더 */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 60px 36px', background: '#1c2128', padding: '8px 12px', borderBottom: '1px solid #21262d' }}>
                    {['품목명', '수량', '단위', ''].map((h, i) => <div key={i} style={{ fontSize: 11, fontWeight: 700, color: '#8b949e', textAlign: i === 1 ? 'right' : 'left' }}>{h}</div>)}
                  </div>
                  {items.map(it => (
                    <div key={it.productId} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 60px 36px', padding: '8px 12px', borderBottom: '1px solid #21262d', alignItems: 'center' }}>
                      <div style={{ fontSize: 13, color: '#e6edf3', fontWeight: 500 }}>{it.product.productName}</div>
                      <div style={{ textAlign: 'right' }}>
                        <input type="number" min="1"
                          value={it.quantity}
                          onChange={e => setItems(prev => prev.map(x => x.productId === it.productId ? { ...x, quantity: Number(e.target.value) || 1 } : x))}
                          style={{ width: 80, background: '#0d1117', border: '1px solid #388bfd', borderRadius: 4, color: '#58a6ff', padding: '4px 6px', fontSize: 14, fontWeight: 700, textAlign: 'right' }} />
                      </div>
                      <div style={{ fontSize: 12, color: '#8b949e', textAlign: 'center' }}>{it.product.unit}</div>
                      <button onClick={() => removeItem(it.productId)}
                        style={{ background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 16, padding: 2 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 출고 버튼 */}
            <button onClick={handleCreate} disabled={loading || !destWH || !items.length}
              style={{ padding: '14px 0', background: items.length && destWH ? '#f0883e' : '#1c2128',
                border: 'none', color: items.length && destWH ? '#fff' : '#444c56',
                borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: items.length && destWH ? 'pointer' : 'default' }}>
              {loading ? '처리 중...' : `🚚 창고간 이동 출고 (${items.length}종 / ${items.reduce((s, it) => s + it.quantity, 0)}개)`}
            </button>
          </div>
        ) : (
          /* 이동 내역 탭 */
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* 내역 목록 */}
            <div style={{ width: 320, borderRight: '1px solid #21262d', overflowY: 'auto', flexShrink: 0 }}>
              <div style={{ padding: '10px 12px', borderBottom: '1px solid #21262d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#8b949e' }}>이동 대기 ({pendingList.length}건)</span>
                <button onClick={loadHistory} style={{ background: 'none', border: 'none', color: '#58a6ff', fontSize: 11, cursor: 'pointer' }}>새로고침</button>
              </div>
              {histLoading ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#8b949e', fontSize: 12 }}>로딩 중...</div>
              ) : pendingList.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', color: '#444c56', fontSize: 12 }}>이동 중인 내역이 없습니다</div>
              ) : pendingList.map(t => (
                <div key={t.id}
                  onClick={() => { setSelectedTrans(t); const qm = {}; t.items.forEach(it => qm[it.id] = it.quantity); setEditQtyMap(qm); }}
                  style={{ padding: '12px 14px', borderBottom: '1px solid #21262d', cursor: 'pointer',
                    background: selectedTrans?.id === t.id ? '#2d2000' : 'transparent',
                    borderLeft: selectedTrans?.id === t.id ? '4px solid #f0883e' : '4px solid transparent' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#f0883e', fontFamily: 'monospace' }}>{t.transferOutNumber}</span>
                    <span style={{ fontSize: 11, color: '#8b949e' }}>{fmtD(t.outAt)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#8b949e' }}>
                    → <span style={{ color: '#e6edf3' }}>{t.toWarehouse?.warehouseName}</span>
                    &nbsp;|&nbsp;{t.items?.length || 0}종 / {t.items?.reduce((s, it) => s + it.quantity, 0)}개
                  </div>
                </div>
              ))}
            </div>

            {/* 상세 */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0a0d13' }}>
              {!selectedTrans ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444c56', fontSize: 13 }}>목록에서 내역을 선택하세요</div>
              ) : (
                <>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid #21262d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#f0883e', fontFamily: 'monospace' }}>{selectedTrans.transferOutNumber}</span>
                    <button onClick={() => handleCancel(selectedTrans.id)}
                      style={{ background: 'none', border: '1px solid #f85149', color: '#f85149', padding: '5px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>🚫 이동 전체 취소</button>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {selectedTrans.items.map(it => {
                      const cur = editQtyMap[it.id] ?? it.quantity;
                      const changed = Number(cur) !== it.quantity;
                      return (
                        <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 60px', padding: '10px 16px', borderBottom: '1px solid #21262d', alignItems: 'center' }}>
                          <div style={{ fontSize: 13, color: '#e6edf3' }}>{it.Product?.productName}</div>
                          <div style={{ textAlign: 'right' }}>
                            <input type="number" min="1"
                              value={cur}
                              onChange={e => setEditQtyMap(p => ({ ...p, [it.id]: e.target.value }))}
                              style={{ width: 70, background: '#0d1117', border: `1px solid ${changed ? '#58a6ff' : '#30363d'}`, borderRadius: 4, color: changed ? '#58a6ff' : '#e6edf3', padding: '4px 6px', fontSize: 14, fontWeight: 700, textAlign: 'right' }} />
                          </div>
                          <div style={{ fontSize: 12, color: '#8b949e', textAlign: 'center' }}>{it.Product?.unit}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ padding: 12, borderTop: '1px solid #21262d' }}>
                    <button onClick={handleUpdateTransfer} disabled={histLoading}
                      style={{ width: '100%', padding: 12, background: '#1158b7', border: 'none', color: '#fff', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
                      수정 사항 저장
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// ─ 메인 컴포넌트 ─────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════
export default function WarehouseTransfer({ user, onGoHome, onLogout, initialTab = 'inbound' }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [clock,     setClock]     = useState(formatClock(new Date()));
  const [toast,     setToast]     = useState(null);
  const [warehouses, setWarehouses] = useState([]);

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    warehousesAPI.getAll().then(r => setWarehouses(r.data || [])).catch(() => {});
  }, []);

  const iBase = { fontFamily: "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo',sans-serif" };

  return (
    <div style={{ ...iBase, height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d1117', color: '#e6edf3' }}>

      {/* 토스트 */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 20, zIndex: 9999,
          background: toast.type === 'error' ? '#3a1a1a' : toast.type === 'info' ? '#0d2044' : '#1a3a2a',
          border: `1px solid ${toast.type === 'error' ? '#f85149' : toast.type === 'info' ? '#58a6ff' : '#3fb950'}`,
          color: toast.type === 'error' ? '#f85149' : toast.type === 'info' ? '#58a6ff' : '#3fb950',
          padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
        }}>{toast.msg}</div>
      )}

      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', height: 52, background: '#161b22', borderBottom: '2px solid #a371f755', flexShrink: 0, gap: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#e6edf3', flexShrink: 0 }}>🔀 창고간 입출고</span>

        {/* 탭 버튼 */}
        <div style={{ display: 'flex', background: '#0d1117', borderRadius: 8, padding: 3, gap: 2 }}>
          {[['inbound', '📥 창고간 입고', '#3fb950'], ['outbound', '📤 창고간 출고', '#f0883e']].map(([id, label, color]) => (
            <button key={id} onClick={() => setActiveTab(id)} style={{
              padding: '7px 18px', borderRadius: 6, border: 'none',
              background: activeTab === id ? color + '22' : 'none',
              color: activeTab === id ? color : '#8b949e',
              fontWeight: activeTab === id ? 700 : 400,
              outline: activeTab === id ? `2px solid ${color}55` : 'none',
              cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', transition: 'all 0.15s',
            }}>{label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: '#8b949e', fontFamily: 'monospace' }}>{clock}</span>
          <span style={{ fontSize: 12, color: '#8b949e' }}>👤 {user?.name}</span>
          <button onClick={onGoHome} style={{ background: '#1c2128', border: '1px solid #30363d', color: '#8b949e', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>🏠 홈</button>
        </div>
      </div>

      {/* 탭 콘텐츠 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {activeTab === 'inbound'
          ? <InboundContent  user={user} showToast={showToast} onGoHome={onGoHome} />
          : <OutboundContent user={user} showToast={showToast} warehouses={warehouses} />}
      </div>
    </div>
  );
}
