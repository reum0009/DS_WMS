import React, { useState, useEffect, useRef, useCallback } from 'react';
import { warehouseTransferAPI } from '../../api/api';

// ── 날짜 포맷 ─────────────────────────────────────────────────────
function fmtDT(d) {
  if (!d) return '—';
  const dt = new Date(d);
  const p  = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}.${p(dt.getMonth()+1)}.${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}
function fmtD(d) {
  if (!d) return '—';
  const dt = new Date(d);
  const p  = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}.${p(dt.getMonth()+1)}.${p(dt.getDate())}`;
}
function formatClock(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ── 번호 규칙 안내 ───────────────────────────────────────────────
// 출고번호: TO-YYYYMMDD-NNNN  (Transfer Out)
// 입고번호: TI-YYYYMMDD-NNNN  (Transfer In)

// ── 바코드 스캐너 훅 ─────────────────────────────────────────────
const SCANNER_SPEED_MS = 50;
const SCANNER_MIN_LEN  = 3;
const IDLE_RESET_MS    = 280;

function useBarcodeScanner(onScan, enabled = true) {
  const buf   = useRef([]);
  const timer = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    const reset = () => { buf.current = []; };
    const onKey = (e) => {
      const el  = document.activeElement;
      const tag = el?.tagName;
      if (tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (tag === 'INPUT' && el?.dataset?.barcodeManual !== 'true') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key.length > 1 && e.key !== 'Enter') return;
      const now = Date.now();
      if (e.key === 'Enter') {
        const b = buf.current; buf.current = [];
        clearTimeout(timer.current);
        if (b.length < SCANNER_MIN_LEN) return;
        const ok = b.every((it, i) => i === 0 || (it.ts - b[i-1].ts) <= SCANNER_SPEED_MS);
        if (ok) onScan(b.map(x => x.char).join(''));
        return;
      }
      buf.current.push({ char: e.key, ts: now });
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
      <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2, paddingLeft: 20 }}>{sub}</div>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════
export default function WarehouseTransferInbound({ user, onGoHome, onLogout }) {

  const iBase = { fontFamily: "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo',sans-serif" };

  // ── 마스터 데이터 ──────────────────────────────────────────────
  const [pendingList, setPendingList] = useState([]);

  // ── 조회 ──────────────────────────────────────────────────────
  const [outNumber,   setOutNumber]   = useState('');    // 출고번호 입력값
  const [transfer,    setTransfer]    = useState(null);  // 조회된 이동 정보
  const [loading,     setLoading]     = useState(false);

  // ── 실수령 수량 편집 ───────────────────────────────────────────
  const [recvQtyMap, setRecvQtyMap] = useState({});   // { productId: qty }

  // ── 입고 확정 ─────────────────────────────────────────────────
  const [confirming,  setConfirming]  = useState(false);
  const [submitting,  setSubmitting]  = useState(false);

  // ── UI ────────────────────────────────────────────────────────
  const [toast, setToast] = useState(null);
  const [clock, setClock] = useState(formatClock(new Date()));

  const outInputRef = useRef(null);

  // ── 시계 ──────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  // ── 데이터 로드 ───────────────────────────────────────────────
  const loadPending = useCallback(async () => {
    try {
      // 내 창고로 오는 'pending' 상태의 이동 내역만 조회
      const res = await warehouseTransferAPI.getAll({ 
        status: 'pending', 
        toWarehouseId: user?.warehouseId 
      });
      setPendingList(res.data || []);
    } catch (e) {
      console.error('Pending list fail:', e);
    }
  }, [user?.warehouseId]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  // ── 토스트 ───────────────────────────────────────────────────
  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  };

  // ── 출고번호 조회 ─────────────────────────────────────────────
  const searchTransfer = useCallback(async (num) => {
    const q = (num || outNumber).trim().toUpperCase();
    if (!q) return;
    setLoading(true);
    setTransfer(null);
    setRecvQtyMap({});
    try {
      const res = await warehouseTransferAPI.getByOut(q);
      const t   = res.data;
      setTransfer(t);
      // 실수령 수량 초기값 = 출고 수량
      const qmap = {};
      (t.items || []).forEach(it => { qmap[it.productId] = it.quantity; });
      setRecvQtyMap(qmap);
    } catch (e) {
      showToast('조회 실패: ' + (e.response?.data?.error || e.message), 'error');
    } finally { setLoading(false); }
  }, [outNumber]);

  // ── 바코드 스캔 처리 ──────────────────────────────────────────
  // TO-로 시작하면 출고번호 자동 조회, 아니면 품목 바코드 하이라이트
  const [highlightBarcode, setHighlightBarcode] = useState('');

  const handleScan = useCallback((code) => {
    const c = code.trim().toUpperCase();
    if (c.startsWith('TO-')) {
      setOutNumber(c);
      searchTransfer(c);
    } else {
      // 품목 바코드 스캔 → 해당 행 하이라이트
      setHighlightBarcode(c);
      setTimeout(() => setHighlightBarcode(''), 2000);
      showToast(`바코드: ${c}`, 'info');
    }
  }, [searchTransfer]);

  useBarcodeScanner(handleScan, !confirming);

  // ── 입고 확정 ────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (!transfer) return;
    setSubmitting(true);
    try {
      const receivedItems = (transfer.items || []).map(it => ({
        id:               it.id, // backend routes/warehouseTransfer.js expect item.id or it searches for it
        productId:        it.productId,
        receivedQuantity: Number(recvQtyMap[it.productId] ?? it.quantity),
      }));
      const res = await warehouseTransferAPI.confirm(transfer.id, { receivedItems });
      showToast(`입고 확정 완료 — 입고번호: ${res.data.transferInNumber}`);
      // 리스트 및 상세 갱신
      loadPending();
      await searchTransfer(transfer.transferOutNumber);
      setConfirming(false);
    } catch (e) {
      showToast(e.response?.data?.error || '확정 실패', 'error');
    } finally { setSubmitting(false); }
  };

  // ── 키보드 단축키 ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      switch (e.key) {
        case 'Escape':
          if (confirming) { setConfirming(false); return; }
          onGoHome?.();
          return;
        case 'F7':
          e.preventDefault();
          if (transfer && transfer.status === 'pending') setConfirming(true);
          return;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, transfer, onGoHome]);

  // ── 파생값 ───────────────────────────────────────────────────
  const fromWH = transfer?.fromWarehouse?.warehouseName || transfer?.fromWarehouseId || '—';
  const toWH   = transfer?.toWarehouse?.warehouseName   || transfer?.toWarehouseId   || '—';
  const totalItems = (transfer?.items || []).length;
  const totalQty   = (transfer?.items || []).reduce((s, it) => s + it.quantity, 0);
  const totalRecv  = (transfer?.items || []).reduce((s, it) => s + (Number(recvQtyMap[it.productId] ?? it.quantity)), 0);

  // ════════════════════════════════════════════════════════════════
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

      {/* ══ 헤더 ════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 18px', background: '#161b22', borderBottom: '1px solid #21262d', flexShrink: 0, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#e6edf3' }}>🔄 창고간 입고</span>
          <span style={{ fontSize: 11, color: '#8b949e', background: '#1c2128', borderRadius: 4, padding: '2px 8px', border: '1px solid #21262d' }}>
            출고번호: <span style={{ fontFamily: 'monospace', color: '#a371f7' }}>TO-YYYYMMDD-NNNN</span>
            &nbsp;·&nbsp;입고번호: <span style={{ fontFamily: 'monospace', color: '#3fb950' }}>TI-YYYYMMDD-NNNN</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#8b949e', fontVariantNumeric: 'tabular-nums' }}>{clock}</span>
          <button onClick={onGoHome} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>🏠 홈</button>
        </div>
      </div>

      {/* ══ 본문 ════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', alignItems: 'stretch' }}>

        {/* ── 왼쪽: 이동 대기 목록 (320px) ───────────────────────── */}
        <div style={{ width: 320, background: '#0d1117', borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
          
          {/* 수동 검색 상단부 */}
          <div style={{ padding: '14px 12px', background: '#161b22', borderBottom: '1px solid #21262d' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#a371f7', marginBottom: 10 }}>출고번호 직접 조회</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                ref={outInputRef}
                data-barcode-manual="true"
                value={outNumber}
                onChange={e => setOutNumber(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && searchTransfer()}
                placeholder="TO-..."
                style={{
                  flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
                  color: '#e6edf3', padding: '8px 10px', fontSize: 13, fontFamily: 'monospace',
                }}
              />
              <button onClick={() => searchTransfer()} disabled={loading}
                style={{
                  background: '#1158b7', border: 'none', color: '#fff',
                  padding: '0 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                }}>
                🔍
              </button>
            </div>
          </div>

          {/* 대기 목록 타이틀 */}
          <div style={{ padding: '12px', background: '#0d1117', borderBottom: '1px solid #21262d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#8b949e' }}>🚚 입고 대기 목록 ({pendingList.length})</span>
            <button onClick={loadPending} style={{ background: 'none', border: 'none', color: '#58a6ff', fontSize: 11, cursor: 'pointer' }}>새로고침</button>
          </div>

          {/* 리스트 본문 */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {pendingList.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#444c56', fontSize: 12 }}>
                대기 중인 이동 건이 없습니다.
              </div>
            ) : (
              pendingList.map(item => {
                const isSel = transfer?.id === item.id;
                return (
                  <div key={item.id} onClick={() => searchTransfer(item.transferOutNumber)}
                    style={{
                      padding: '12px 14px', borderBottom: '1px solid #21262d', cursor: 'pointer',
                      background: isSel ? '#1f3a5f' : 'transparent',
                      borderLeft: isSel ? '4px solid #58a6ff' : '4px solid transparent',
                      transition: 'all 0.12s',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: isSel ? '#58a6ff' : '#e6edf3', fontFamily: 'monospace' }}>{item.transferOutNumber}</span>
                      <span style={{ fontSize: 11, color: '#8b949e' }}>{fmtD(item.outAt)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#8b949e', display: 'flex', gap: 6 }}>
                      <span>{item.fromWarehouse?.warehouseName}</span>
                      <span>→</span>
                      <span style={{ color: '#e6edf3' }}>{item.items?.length || 0}종</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 하단 안내 */}
          <div style={{ padding: 12, background: '#0d1117', borderTop: '1px solid #21262d', fontSize: 11, color: '#444c56', lineHeight: 1.5 }}>
            ※ 타 창고에서 보낸 "이동 출고" 내역이 이곳에 표시됩니다. 선택하여 입고를 확정하세요.
          </div>
        </div>

        {/* ── 가운데: 이동 정보 + 품목 그리드 ─────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0d1117' }}>

          {/* 이동 정보 카드 (그리드 위에 표시) */}
          {transfer ? (
            <div style={{ padding: '10px 16px', background: '#0d1117', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                {/* 출고번호 */}
                <div>
                  <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 2 }}>출고번호</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#a371f7', fontSize: 14 }}>
                    {transfer.transferOutNumber}
                  </div>
                </div>
                {/* 화살표 */}
                <div style={{ fontSize: 20, color: '#444c56', alignSelf: 'center' }}>→</div>
                {/* 입고번호 */}
                <div>
                  <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 2 }}>입고번호</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14,
                    color: transfer.transferInNumber ? '#3fb950' : '#444c56' }}>
                    {transfer.transferInNumber || '미확정'}
                  </div>
                </div>
                {/* 구분선 */}
                <div style={{ width: 1, height: 36, background: '#21262d' }} />
                {/* 출발 → 도착 */}
                <div>
                  <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 2 }}>이동 경로</div>
                  <div style={{ fontSize: 13, color: '#e6edf3', fontWeight: 600 }}>
                    {fromWH} <span style={{ color: '#444c56' }}>→</span> {toWH}
                  </div>
                </div>
                {/* 구분선 */}
                <div style={{ width: 1, height: 36, background: '#21262d' }} />
                {/* 출고일시 */}
                <div>
                  <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 2 }}>출고일시</div>
                  <div style={{ fontSize: 12, color: '#e6edf3' }}>{fmtDT(transfer.outAt)}</div>
                </div>
                {/* 담당자 */}
                <div>
                  <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 2 }}>출고자</div>
                  <div style={{ fontSize: 12, color: '#e6edf3' }}>{transfer.outUser?.name || '—'}</div>
                </div>
                {/* 입고확정일시 */}
                {transfer.inAt && (
                  <div>
                    <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 2 }}>입고확정일시</div>
                    <div style={{ fontSize: 12, color: '#3fb950' }}>{fmtDT(transfer.inAt)}</div>
                  </div>
                )}
                <div style={{ marginLeft: 'auto' }}>
                  <StatusBadge status={transfer.status} />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ padding: '8px 16px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: '#388bfd' }}>※ 대기 목록에서 선택하거나 출고번호를 직접 입력/스캔하세요.</span>
            </div>
          )}

          {/* 그리드 헤더 */}
          <div style={{
            display: 'grid', gridTemplateColumns: '40px 90px 1fr 70px 80px 90px',
            background: '#1c2128', borderBottom: '2px solid #30363d',
            padding: '0 8px', flexShrink: 0,
          }}>
            {['NO', '품목코드', '품목명', '단위', '출고수량', '실수령수량'].map((h, i) => (
              <div key={h} style={{
                padding: '10px 6px', fontSize: 12, fontWeight: 700, color: '#8b949e',
                textAlign: i >= 4 ? 'right' : 'left',
                borderRight: i < 5 ? '1px solid #30363d' : 'none',
              }}>{h}</div>
            ))}
          </div>

          {/* 품목 리스트 */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!transfer ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#444c56', gap: 10 }}>
                <div style={{ fontSize: 40 }}>🔄</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>출고번호를 조회하세요</div>
                <div style={{ fontSize: 12, color: '#30363d' }}>출고번호 입력 또는 바코드(TO-…) 스캔</div>
              </div>
            ) : transfer.items.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#8b949e', fontSize: 13 }}>이동 품목 없음</div>
            ) : (
              transfer.items.map((item, i) => {
                const prod = item.Product;
                const codes = prod?.codes || [];
                const isHL = highlightBarcode && (
                  prod?.barcode?.toUpperCase() === highlightBarcode || 
                  prod?.productCode?.toUpperCase() === highlightBarcode ||
                  codes.some(c => c.codeValue?.toUpperCase() === highlightBarcode)
                );
                const confirmed = transfer.status === 'confirmed';
                return (
                  <div key={item.id} style={{
                    display: 'grid', gridTemplateColumns: '40px 90px 1fr 70px 80px 90px',
                    padding: '0 8px',
                    background: isHL ? '#1f3a1f' : i % 2 === 0 ? '#0d1117' : '#111720',
                    borderBottom: '1px solid #1c2128',
                    borderLeft: isHL ? '3px solid #3fb950' : '3px solid transparent',
                    transition: 'background 0.3s',
                  }}>
                    <div style={{ padding: '11px 6px', fontSize: 12, color: '#8b949e', borderRight: '1px solid #1c2128' }}>{i + 1}</div>
                    <div style={{ padding: '11px 6px', fontSize: 11, color: '#8b949e', fontFamily: 'monospace', borderRight: '1px solid #1c2128', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {prod?.productCode || '—'}
                    </div>
                    <div style={{ padding: '8px 6px', borderRight: '1px solid #1c2128' }}>
                      <div style={{ fontSize: 14, color: '#e6edf3', fontWeight: 500 }}>{prod?.productName || '—'}</div>
                      {prod?.barcode && <div style={{ fontSize: 10, color: '#8b949e', fontFamily: 'monospace', marginTop: 1 }}>{prod.barcode}</div>}
                    </div>
                    <div style={{ padding: '11px 6px', fontSize: 12, color: '#8b949e', textAlign: 'left', borderRight: '1px solid #1c2128' }}>{prod?.unit || '—'}</div>
                    <div style={{ padding: '11px 6px', fontSize: 14, fontWeight: 700, color: '#a371f7', textAlign: 'right', borderRight: '1px solid #1c2128' }}>
                      {item.quantity.toLocaleString()}
                    </div>
                    {/* 실수령 수량 — 확정 전에만 편집 가능 */}
                    <div style={{ padding: '6px 6px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                      {confirmed ? (
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#3fb950' }}>{item.receivedQuantity ?? item.quantity}</span>
                      ) : (
                        <input
                          type="number" min="0"
                          inputMode="numeric"
                          value={recvQtyMap[item.productId] ?? item.quantity}
                          onChange={e => setRecvQtyMap(p => ({ ...p, [item.productId]: e.target.value }))}
                          onClick={e => e.stopPropagation()}
                          style={{
                            width: 72, background: '#0d1117', border: '1px solid #388bfd',
                            borderRadius: 4, color: '#58a6ff', padding: '4px 6px',
                            fontSize: 14, fontWeight: 700, textAlign: 'right',
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 합계 행 */}
          {transfer && transfer.items.length > 0 && (
            <div style={{
              display: 'grid', gridTemplateColumns: '40px 90px 1fr 70px 80px 90px',
              background: '#1c2128', borderTop: '2px solid #30363d', padding: '0 8px', flexShrink: 0,
            }}>
              <div style={{ padding: '10px 6px', fontSize: 12, color: '#8b949e', gridColumn: '1/5', borderRight: '1px solid #30363d' }}>
                합계 <strong style={{ color: '#e6edf3' }}>{totalItems}종</strong>
              </div>
              <div style={{ padding: '10px 6px', fontSize: 14, fontWeight: 700, color: '#a371f7', textAlign: 'right', borderRight: '1px solid #30363d' }}>
                {totalQty.toLocaleString()}
              </div>
              <div style={{ padding: '10px 6px', fontSize: 14, fontWeight: 700, color: '#3fb950', textAlign: 'right' }}>
                {totalRecv.toLocaleString()}
              </div>
            </div>
          )}
        </div>

        {/* ── 오른쪽: 조작 패널 (170px) ───────────────────── */}
        <div style={{ width: 170, background: '#161b22', borderLeft: '1px solid #21262d', display: 'flex', flexDirection: 'column', padding: '12px 10px', gap: 6, flexShrink: 0 }}>

          {/* 세션 요약 */}
          <div style={{ background: '#1c2128', borderRadius: 6, padding: '10px 10px', marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>이동 정보</div>
            {transfer ? (
              <>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#a371f7' }}>{totalItems}<span style={{ fontSize: 11, fontWeight: 400, color: '#8b949e', marginLeft: 3 }}>종</span></div>
                <div style={{ fontSize: 13, color: '#e6edf3', fontWeight: 600 }}>{totalQty.toLocaleString()}<span style={{ fontSize: 11, fontWeight: 400, color: '#8b949e', marginLeft: 3 }}>개 출고</span></div>
                <div style={{ fontSize: 13, color: '#3fb950', fontWeight: 600 }}>{totalRecv.toLocaleString()}<span style={{ fontSize: 11, fontWeight: 400, color: '#8b949e', marginLeft: 3 }}>개 수령</span></div>
                <div style={{ marginTop: 6 }}><StatusBadge status={transfer.status} /></div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: '#444c56' }}>—</div>
            )}
          </div>

          <div style={{ borderTop: '1px solid #21262d', margin: '4px 0' }} />

          {/* 입고 확정 */}
          <RightBtn
            icon="✅"
            label="입고 확정"
            sub="F7"
            color="#3fb950"
            disabled={!transfer || transfer.status !== 'pending'}
            onClick={() => transfer && transfer.status === 'pending' && setConfirming(true)}
          />

          {/* 초기화 */}
          <RightBtn
            icon="↩"
            label="초기화"
            sub="새 조회"
            color="#8b949e"
            onClick={() => { setTransfer(null); setOutNumber(''); setRecvQtyMap({}); outInputRef.current?.focus(); }}
          />

          <div style={{ flex: 1 }} />

          <div style={{ fontSize: 11, color: '#8b949e', textAlign: 'center', paddingTop: 6, borderTop: '1px solid #21262d', lineHeight: 1.6 }}>
            스캐너 또는<br />직접 입력 가능
          </div>
        </div>
      </div>

      {/* ══ 입고 확정 확인 모달 ═══════════════════════════════ */}
      {confirming && transfer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '24px 28px', width: 420 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#e6edf3', marginBottom: 6 }}>🔄 입고 확정</div>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 14 }}>
              입고번호(<span style={{ color: '#3fb950', fontFamily: 'monospace' }}>TI-YYYYMMDD-NNNN</span>)가 생성됩니다
            </div>
            <div style={{ background: '#1c2128', borderRadius: 6, padding: '10px 12px', marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4 }}>출고번호</div>
              <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: '#a371f7', marginBottom: 8 }}>{transfer.transferOutNumber}</div>
              <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                <span style={{ color: '#e6edf3' }}>{fromWH} → {toWH}</span>
              </div>
              <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: 14 }}>
                <span style={{ color: '#a371f7' }}>{totalItems}종</span>
                <span style={{ color: '#3fb950' }}>{totalRecv.toLocaleString()}개 수령</span>
              </div>
            </div>
            <div style={{ maxHeight: 130, overflowY: 'auto', marginBottom: 16 }}>
              {transfer.items.map(it => (
                <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, borderBottom: '1px solid #21262d' }}>
                  <span style={{ color: '#e6edf3' }}>{it.Product?.productName}</span>
                  <span style={{ color: '#3fb950', fontWeight: 600 }}>+{recvQtyMap[it.productId] ?? it.quantity} {it.Product?.unit}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirming(false)} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '8px 18px', borderRadius: 6, cursor: 'pointer' }}>취소</button>
              <button onClick={handleConfirm} disabled={submitting}
                style={{ background: '#238636', border: '1px solid #2ea043', color: '#fff', padding: '8px 22px', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
                {submitting ? '처리 중…' : '입고 확정'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
