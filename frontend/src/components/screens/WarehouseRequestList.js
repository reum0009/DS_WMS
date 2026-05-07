import React, { useState, useEffect, useCallback } from 'react';
import { requestsAPI, releasesAPI, gwRequestsAPI, productsAPI } from '../../api/api';

const BG0='#0d1117',BG1='#161b22',BG2='#1c2128',BD='#30363d',BD2='#21262d';
const TX='#e6edf3',TX2='#8b949e',TX3='#444c56';
const RED='#f85149',GRN='#3fb950',ORG='#f0883e',BLU='#58a6ff',YLW='#e3b341';

function formatClock(d){const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;}
function parseDateSafe(v){
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function CalendarPicker({ value, onChange, onClose, label }) {
  const today = new Date();
  const init = value ? new Date(value) : today;
  const [y, setY] = useState(init.getFullYear());
  const [m, setM] = useState(init.getMonth());
  const daysInM = new Date(y, m + 1, 0).getDate();
  const firstDow = new Date(y, m, 1).getDay();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInM; d++) cells.push(d);
  const p2 = n => String(n).padStart(2, '0');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div style={{ background: BG1, border: `1px solid ${BD}`, borderRadius: 12, padding: 16, width: 300, boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
        <div style={{ fontSize: 12, color: TX2, marginBottom: 8 }}>{label}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <button onClick={() => m === 0 ? (setM(11), setY(y - 1)) : setM(m - 1)} style={{ background: BG2, border: `1px solid ${BD}`, color: TX, borderRadius: 4, cursor: 'pointer', padding: '4px 9px' }}>◀</button>
          <span style={{ color: TX, fontWeight: 700 }}>{y}년 {m + 1}월</span>
          <button onClick={() => m === 11 ? (setM(0), setY(y + 1)) : setM(m + 1)} style={{ background: BG2, border: `1px solid ${BD}`, color: TX, borderRadius: 4, cursor: 'pointer', padding: '4px 9px' }}>▶</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
          {['일','월','화','수','목','금','토'].map(d => <div key={d} style={{ textAlign: 'center', fontSize: 11, color: TX2 }}>{d}</div>)}
          {cells.map((d, i) => d
            ? <button key={i} onClick={() => { onChange(`${y}-${p2(m + 1)}-${p2(d)}`); onClose(); }} style={{ background: BG2, border: `1px solid ${BD2}`, color: TX, borderRadius: 4, padding: '6px 0', cursor: 'pointer' }}>{d}</button>
            : <div key={i} />
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={() => { onChange(`${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`); onClose(); }} style={{ flex: 1, background: '#0d2044', border: `1px solid ${BLU}`, color: BLU, borderRadius: 6, padding: '8px 10px', cursor: 'pointer' }}>오늘</button>
          <button onClick={onClose} style={{ flex: 1, background: BG2, border: `1px solid ${BD}`, color: TX2, borderRadius: 6, padding: '8px 10px', cursor: 'pointer' }}>닫기</button>
        </div>
      </div>
    </div>
  );
}

const STATUS_META = {
  pending:   { label: '승인대기', color: TX2, bg: BG2 },
  approved:  { label: '출고대기', color: ORG, bg: '#2d1800' },
  rejected:  { label: '반려',     color: RED, bg: '#2d0d0b' },
  released:  { label: '출고완료', color: GRN, bg: '#0d2616' },
};

const requestTitle = (r) => {
  if (!r) return '';
  if (!r.isGw) return r.requestNumber || '-';
  return r.itemName || r.items?.[0]?.Product?.productName || r.requestNumber || '-';
};

const sourceMeta = (r) => {
  if (r?.isGw) return { label: '그룹웨어 요청', color: BLU, bg: '#0d2044' };
  if (String(r?.requestNumber || '').startsWith('WMS-') || r?.category === 'WMS') {
    return { label: 'WMS 신청', color: GRN, bg: '#0d2616' };
  }
  return null;
};

const normName = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();

const itemChoiceKey = (request, item) => `${request?.id || request?.requestNumber}:${item?.id}`;

const productLabel = (p) => {
  const spec = p?.specification ? ` / ${p.specification}` : '';
  return `${p?.productName || '-'}${spec}`;
};

const requestItemName = (item, request) => (
  item?.requestedProductName ||
  item?.Product?.productName ||
  request?.itemName ||
  ''
);

const refreshRequestProductMatches = (request, products, choices = {}) => {
  const rows = Array.isArray(products) ? products : [];
  const cloned = {
    ...request,
    items: (request.items || []).map(item => {
      const name = requestItemName(item, request);
      const key = normName(name);
      const candidates = rows
        .filter(p => normName(p.productName) === key)
        .map(p => ({ ...p, currentStock: Number(p.currentStock || 0) }))
        .sort((a, b) => {
          const qty = Number(item.quantity || 0);
          const aEnough = a.currentStock >= qty ? 1 : 0;
          const bEnough = b.currentStock >= qty ? 1 : 0;
          if (aEnough !== bEnough) return bEnough - aEnough;
          if (a.currentStock !== b.currentStock) return b.currentStock - a.currentStock;
          return String(a.productCode || '').localeCompare(String(b.productCode || ''), 'ko');
        });
      const chosenId = Number(choices[itemChoiceKey(request, item)] || 0);
      const selected = candidates.find(p => Number(p.id) === chosenId) || candidates[0] || null;
      return {
        ...item,
        requestedProductName: name,
        productId: selected?.id || item.productId,
        Product: selected ? { ...item.Product, ...selected } : item.Product,
        matchCandidates: candidates,
        matchedProductId: selected?.id || item.productId || null,
        matchedStock: selected ? Number(selected.currentStock || 0) : Number(item.Product?.currentStock || 0),
        hasMultipleMatches: candidates.length > 1,
        hasStockMatch: !!selected && Number(selected.currentStock || 0) > 0,
      };
    })
  };
  return cloned;
};

const WarehouseRequestList = ({ user, onGoHome }) => {
  const [clock,    setClock]    = useState(formatClock(new Date()));
  const [requests, setRequests] = useState([]);
  const [selId,    setSelId]    = useState(null);
  const [filter,   setFilter]   = useState('approved'); // 기본값: 출고대기
  const [toast,    setToast]    = useState(null);
  const [processing, setProc]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [dupCheck, setDupCheck] = useState(null); // { target, duplicates }
  const [gwError, setGwError] = useState(null);
  const [gwDiag, setGwDiag] = useState(null);
  const [stockProducts, setStockProducts] = useState([]);
  const [productChoices, setProductChoices] = useState({});
  const [matchModal, setMatchModal] = useState(null); // { requestId, itemId, item, candidates }

  // ── 날짜 범위 상태 (기본 1달) ──────────────────────────────────
  const [dateRange, setDateRange] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 1);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate:   end.toISOString().slice(0, 10)
    };
  });
  const [calPicker, setCalPicker] = useState(null); // { field: 'startDate'|'endDate', label }

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [resLocal, resGw, resGwHealth, resProducts] = await Promise.all([
        requestsAPI.getAll(),
        gwRequestsAPI.getAll().catch((err) => {
          const message = err.response?.data?.error || err.message || '그룹웨어 요청 조회 실패';
          setGwError(message);
          return { data: [] };
        }),
        gwRequestsAPI.health().catch((err) => ({
          data: {
            ok: false,
            error: err.response?.data?.error || err.message || '그룹웨어 상태 진단 실패',
            code: err.response?.data?.code || null,
            db: err.response?.data?.db || null,
          }
        })),
        productsAPI.getAll(user?.warehouseId ? { warehouseId: Number(user.warehouseId) } : undefined).catch(() => ({ data: [] }))
      ]);
      const productRows = resProducts.data || [];
      setStockProducts(productRows);
      if (resGw.data?.length >= 0) setGwError(null);
      setGwDiag({
        ...(resGwHealth.data || {}),
        rows: Array.isArray(resGw.data) ? resGw.data.length : 0,
        mappedCounts: Array.isArray(resGw.data)
          ? resGw.data.reduce((acc, row) => {
            const key = `${row.gwStatusName || row.gwStatusId || 'unknown'} / ${row.status || 'unknown'}`;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {})
          : {},
      });

      const byKey = new Map();
      const mergeRows = [...(resLocal.data || []), ...(resGw.data || [])];
      mergeRows.forEach((row) => {
        const gwKey = String(row?.requestNumber || '').trim();
        const key = gwKey ? `REQ:${gwKey}` : `ID:${String(row?.id || '')}`;
        const prev = byKey.get(key);
        if (!prev) {
          byKey.set(key, row);
          return;
        }

        // 같은 요청번호가 중복되면 GW 원본(isGw=true)을 우선 채택
        if (!!row?.isGw && !prev?.isGw) {
          byKey.set(key, row);
          return;
        }
        if (!!prev?.isGw && !row?.isGw) {
          return;
        }

        // 동일 타입이면 더 최신 createdAt을 유지
        const prevTs = parseDateSafe(prev?.createdAt)?.getTime() || 0;
        const rowTs = parseDateSafe(row?.createdAt)?.getTime() || 0;
        if (rowTs >= prevTs) byKey.set(key, row);
      });

      const merged = Array.from(byKey.values()).map(r => refreshRequestProductMatches(r, productRows, productChoices)).sort((a, b) => {
        const ta = parseDateSafe(a.createdAt)?.getTime() || 0;
        const tb = parseDateSafe(b.createdAt)?.getTime() || 0;
        return tb - ta;
      });
      setRequests(merged);
    } catch (err) {
      console.error('Requests load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.warehouseId, productChoices]);

  useEffect(() => {
    loadData();
    const id = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => clearInterval(id);
  }, [loadData]);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape' && !processing) onGoHome(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [processing, onGoHome]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const norm = (v) => String(v || '').replace(/\s+/g, '').toLowerCase();
  const recipientKeyOf = (r) => norm(r?.userName || r?.applicant?.name || '');
  const productKeysOf = (r) => {
    const keys = new Set();
    (r?.items || []).forEach((it) => {
      if (it?.productId) keys.add(`id:${it.productId}`);
      else if (it?.Product?.productName) keys.add(`nm:${norm(it.Product.productName)}`);
    });
    return keys;
  };
  const hasIntersect = (aSet, bSet) => {
    for (const v of aSet) if (bSet.has(v)) return true;
    return false;
  };
  const findDuplicateReleased = (target) => {
    const targetRecipient = recipientKeyOf(target);
    if (!targetRecipient) return [];
    const targetProducts = productKeysOf(target);
    if (targetProducts.size === 0) return [];

    return (requests || [])
      .filter(r => r.id !== target.id && r.status === 'released')
      .filter(r => recipientKeyOf(r) === targetRecipient)
      .filter(r => hasIntersect(productKeysOf(r), targetProducts))
      .sort((a, b) => (parseDateSafe(b.createdAt)?.getTime() || 0) - (parseDateSafe(a.createdAt)?.getTime() || 0));
  };

  const selReq = requests.find(r => r.id === selId);

  // ── 필터링 로직 수정 ───────────────────────────────────────────
  const filtered = requests.filter(r => {
    // 1. 창고 필터링 (사용자의 창고와 일치하는 것만)
    // r.warehouseId가 있으면 비교, 없으면(로컬 요청 등) 일단 통과 (필요시 로직 확장)
    if (user?.warehouseId && r.warehouseId && Number(r.warehouseId) !== Number(user.warehouseId)) {
      return false;
    }

    // 2. 탭 필터 (전체가 아니면 상태 매칭)
    if (filter !== 'all' && r.status !== filter) return false;

    // 3. 기간 필터 (출고완료 항목만 적용)
    if (r.status === 'released') {
      if (!r.createdAt) return false;
      const d = String(r.createdAt).slice(0, 10);
      return d >= dateRange.startDate && d <= dateRange.endDate;
    }

    // 4. 승인대기, 출고대기 등은 기간 무관하게 표시
    return true;
  });

  // approved 또는 pending GW 요청 모두 출고 가능
  const canProcess = (r) => r && (r.status === 'approved' || (r.isGw && r.status === 'pending'));

  const handleProcess = async () => {
    if (!selReq || !canProcess(selReq)) return;

    // GW 요청인 경우 품목 매핑 확인 (approved 상태에서만 items 배열이 있음)
    if (!selReq.items || selReq.items.some(it => !it.matchedProductId && !it.productId)) {
      showToast('출고할 시스템 품목을 먼저 선택하세요.', 'error');
      setProc(false);
      return;
    }
    const lacking = selReq.items.find(it => Number(it.matchedStock || 0) < Number(it.quantity || 0));
    if (lacking) {
      showToast(`${requestItemName(lacking, selReq)} 보유수량이 부족합니다.`, 'error');
      setProc(false);
      return;
    }

    try {
      setLoading(true);
      const targetId = selReq.isGw ? selReq.requestNumber : selReq.id;
      const productSelections = {};
      (selReq.items || []).forEach(it => {
        const id = productChoices[itemChoiceKey(selReq, it)] || it.matchedProductId || it.productId;
        if (id) productSelections[it.id] = id;
      });
      await releasesAPI.release(targetId, { productSelections });
      showToast(`${selReq.requestNumber} 출고 처리 완료`);
      await loadData();
      setSelId(null);
      setProc(false);
    } catch (err) {
      showToast(err.response?.data?.error || '출고 처리 실패', 'error');
    } finally {
      setLoading(false);
    }
  };

  const statCounts = {
    total: requests.filter(r => !user?.warehouseId || !r.warehouseId || Number(r.warehouseId) === Number(user.warehouseId)).length,
    approved: requests.filter(r => r.status === 'approved' && (!user?.warehouseId || !r.warehouseId || Number(r.warehouseId) === Number(user.warehouseId))).length,
    pending: requests.filter(r => r.status === 'pending' && (!user?.warehouseId || !r.warehouseId || Number(r.warehouseId) === Number(user.warehouseId))).length,
    released: requests.filter(r => {
      const isMyWh = !user?.warehouseId || !r.warehouseId || Number(r.warehouseId) === Number(user.warehouseId);
      if (!r.createdAt) return false;
      const d = String(r.createdAt).slice(0, 10);
      return isMyWh && r.status === 'released' && d >= dateRange.startDate && d <= dateRange.endDate;
    }).length,
  };

  const openProcessFlow = () => {
    if (!selReq || !canProcess(selReq)) return;
    const duplicates = findDuplicateReleased(selReq);
    if (duplicates.length > 0) {
      setDupCheck({ target: selReq, duplicates });
      return;
    }
    setProc(true);
  };

  const handleRejectByDuplicate = async () => {
    if (!dupCheck?.target) return;
    const target = dupCheck.target;
    try {
      setLoading(true);
      const targetId = target.isGw ? target.requestNumber : target.id;
      await releasesAPI.reject(targetId, { reason: '중복 출고 이력 확인 후 창고 담당자 반려' });
      setDupCheck(null);
      setProc(false);
      showToast(`${requestTitle(target)} 요청 반려 처리 완료`);
      await loadData();
      setSelId(null);
    } catch (err) {
      showToast(err.response?.data?.error || '반려 처리 실패', 'error');
    } finally {
      setLoading(false);
    }
  };

  const tabStyle = (id) => ({
    padding: '10px 24px', borderRadius: 10, border: `2px solid ${filter === id ? ORG : BD}`,
    background: filter === id ? '#2d1800' : BG2, color: filter === id ? ORG : TX2,
    cursor: 'pointer', fontSize: 16, fontWeight: filter === id ? 800 : 500,
    whiteSpace: 'nowrap'
  });

  const dateBtnStyle = (field) => ({
    background: BG2, border: `2px solid ${calPicker?.field === field ? ORG : BD}`,
    color: TX, padding: '10px 18px', borderRadius: 10, cursor: 'pointer',
    fontSize: 15, fontFamily: 'monospace', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG0, color: TX, fontFamily: "'Noto Sans KR', sans-serif", overflow: 'hidden' }}>

      {/* 달력 팝업 */}
      {calPicker && (
        <CalendarPicker
          label={calPicker.label}
          value={dateRange[calPicker.field]}
          onChange={v => setDateRange(p => ({ ...p, [calPicker.field]: v }))}
          onClose={() => setCalPicker(null)}
        />
      )}

      {/* TOP BAR */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', height: 84, background: BG1, borderBottom: `4px solid ${ORG}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <span style={{ fontSize: 24, fontWeight: 900, color: ORG }}>📋 요청목록</span>
          <span style={{ fontSize: 14, color: ORG, background: '#2d1800', border: `1px solid ${ORG}55`, borderRadius: 6, padding: '4px 12px', fontWeight: 700 }}>F4</span>
          {statCounts.approved > 0 && <span style={{ fontSize: 14, color: '#fff', background: ORG, borderRadius: 10, padding: '4px 12px', fontWeight: 800 }}>{statCounts.approved} 출고대기</span>}
          {gwError && <span style={{ fontSize: 13, color: RED, background: '#2d0d0b', border: `1px solid ${RED}`, borderRadius: 8, padding: '4px 10px', fontWeight: 800 }}>GW 연결 오류</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <span style={{ fontSize: 18, color: TX2, fontFamily: 'monospace', fontWeight: 600 }}>{clock}</span>
          <span style={{ fontSize: 16, color: TX2, fontWeight: 600 }}>👤 {user?.name || '창고담당'}</span>
          <button onClick={onGoHome} style={{ background: BG2, border: `2px solid ${BD}`, color: TX, padding: '10px 24px', borderRadius: 10, cursor: 'pointer', fontSize: 16, fontWeight: 700 }}>🏠 홈</button>
        </div>
      </div>

      {/* 필터 바 & 기간 선택 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 32px', background: BG0, borderBottom: `2px solid ${BD2}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={tabStyle('approved')} onClick={() => setFilter('approved')}>출고대기 ({statCounts.approved})</button>
          <button style={tabStyle('pending')}  onClick={() => setFilter('pending')}>승인대기 ({statCounts.pending})</button>
          <button style={tabStyle('released')} onClick={() => setFilter('released')}>완료 ({statCounts.released})</button>
          <button style={tabStyle('all')}      onClick={() => setFilter('all')}>전체</button>
        </div>

        {/* 기간 선택 영역 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: TX2, fontWeight: 700 }}>조회기간:</span>
          <button onClick={() => setCalPicker({ field: 'startDate', label: '시작일' })} style={dateBtnStyle('startDate')}>
            📅 {dateRange.startDate.replace(/-/g, '.')}
          </button>
          <span style={{ color: TX3 }}>~</span>
          <button onClick={() => setCalPicker({ field: 'endDate', label: '종료일' })} style={dateBtnStyle('endDate')}>
            📅 {dateRange.endDate.replace(/-/g, '.')}
          </button>
          <button onClick={loadData} style={{ background: BD, border: 'none', color: TX, padding: '10px 18px', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>↻ 갱신</button>
        </div>
      </div>

      {gwDiag && (
        <div style={{ padding: '10px 32px', background: gwDiag.ok ? '#0d2616' : '#2d0d0b', borderBottom: `1px solid ${gwDiag.ok ? GRN : RED}55`, color: gwDiag.ok ? GRN : RED, fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>GW {gwDiag.ok ? '연결 정상' : '연결 실패'}</span>
            <span>조회 {gwDiag.rows || 0}건</span>
            {gwDiag.elapsedMs !== undefined && <span>{gwDiag.elapsedMs}ms</span>}
            {gwDiag.error && <span>{gwDiag.code ? `[${gwDiag.code}] ` : ''}{gwDiag.error}</span>}
            {gwDiag.db?.candidates?.[0] && (
              <span>{gwDiag.db.candidates[0].host}:{gwDiag.db.candidates[0].port}/{gwDiag.db.candidates[0].database}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6, color: TX2 }}>
            {Object.entries(gwDiag.mappedCounts || {}).map(([k, v]) => (
              <span key={k} style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 6, padding: '2px 7px' }}>{k}: {v}</span>
            ))}
            {gwDiag.ok && Object.keys(gwDiag.mappedCounts || {}).length === 0 && (
              <span style={{ color: YLW }}>GW 연결은 됐지만 요청 데이터가 0건입니다.</span>
            )}
          </div>
        </div>
      )}

      {/* BODY */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── 좌: 요청 목록 ── */}
        <div style={{ width: 420, borderRight: `2px solid ${BD2}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading && requests.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: ORG, fontSize: 18, fontWeight: 700 }}>데이터 로드 중...</div>
            ) : filtered.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: TX3, fontSize: 16 }}>해당 항목이 없습니다.</div>
            ) : filtered.map(r => {
              const sm = STATUS_META[r.status] || STATUS_META.pending;
              const isSelected = r.id === selId;
              const dt = parseDateSafe(r.createdAt);
              const timeStr = dt ? `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}` : '--:--';
              const dateStr = dt ? `${dt.getMonth() + 1}/${dt.getDate()}` : '-/-';
              const isUnmapped = r.isGw && (!r.items || !r.items[0]?.productId);
              const src = sourceMeta(r);

              return (
                <div key={r.id} onClick={() => setSelId(isSelected ? null : r.id)}
                  style={{ padding: '20px 24px', borderBottom: `2px solid ${BD2}`, cursor: 'pointer',
                    background: isSelected ? '#1a1008' : BG0, borderLeft: isSelected ? `8px solid ${ORG}` : '8px solid transparent', minHeight: 110 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 18, fontWeight: 800, color: r.isGw ? BLU : TX, fontFamily: 'monospace' }}>{requestTitle(r)}</span>
                      {src && <span style={{ fontSize: 11, color: src.color, background: src.bg, border: `1px solid ${src.color}66`, borderRadius: 6, padding: '2px 7px', fontWeight: 800 }}>{src.label}</span>}
                      <span style={{ fontSize: 12, color: sm.color, background: sm.bg, border: `1px solid ${sm.color}55`, borderRadius: 6, padding: '2px 8px', fontWeight: 800 }}>{sm.label}</span>
                      {isUnmapped && <span style={{ fontSize: 11, color: '#fff', background: RED, borderRadius: 4, padding: '2px 6px', fontWeight: 700 }}>매핑필요</span>}
                    </div>
                    <span style={{ fontSize: 13, color: TX3, fontWeight: 600 }}>{dateStr} {timeStr}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 15, color: TX2, fontWeight: 600 }}>👤 {r.applicant?.name || '—'} · {r.category}</span>
                    <span style={{ fontSize: 15, color: TX, fontWeight: 700 }}>{r.items?.length || 0}종</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 우: 요청 상세 ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selReq ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <div style={{ fontSize: 64, opacity: 0.15 }}>📋</div>
              <div style={{ fontSize: 18, color: TX3, fontWeight: 600 }}>목록에서 요청을 선택하세요.</div>
            </div>
          ) : (
            <>
              <div style={{ padding: '24px 32px', background: BG1, borderBottom: `2px solid ${BD2}`, flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
                    <span style={{ fontSize: 24, fontWeight: 900, color: selReq.isGw ? BLU : TX, fontFamily: 'monospace' }}>{requestTitle(selReq)}</span>
                    {(() => { const sm = STATUS_META[selReq.status] || STATUS_META.pending; return <span style={{ fontSize: 14, color: sm.color, background: sm.bg, border: `2px solid ${sm.color}55`, borderRadius: 8, padding: '4px 12px', fontWeight: 800 }}>{sm.label}</span>; })()}
                  </div>
                  <span style={{ fontSize: 15, color: TX2, fontWeight: 600 }}>
                    {parseDateSafe(selReq.createdAt)?.toLocaleString('ko-KR') || '-'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 20 }}>
                  <div style={{ fontSize: 18, color: TX2, fontWeight: 600 }}>👤 신청자: {selReq.applicant?.name || '—'}</div>
                  {selReq.userName && <div style={{ fontSize: 18, color: TX2, fontWeight: 600 }}>👤 실사용자: {selReq.userName}</div>}
                </div>
                {selReq.approverName && <div style={{ marginTop: 6, fontSize: 15, color: TX3 }}>결재승인: {selReq.approverName}</div>}
                {selReq.description && <div style={{ marginTop: 10, fontSize: 15, color: TX3 }}>메모: {selReq.description}</div>}
              </div>

              {/* 아이템 목록 */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 120px 120px 120px', background: BG2, borderBottom: `2px solid ${BD}`, padding: '0 32px' }}>
                  {['#', '품목명', '요청수량', '보유수량', '현황'].map((h, i) => (
                    <div key={h} style={{ padding: '15px 5px', fontSize: 14, fontWeight: 800, color: TX2, textAlign: i >= 2 ? 'right' : 'left' }}>{h}</div>
                  ))}
                </div>
                {(selReq.items || []).map((it, i) => {
                  const isUnmapped = !it.matchedProductId && !it.productId;
                  const stockQty = Number(it.matchedStock || 0);
                  const reqQty = Number(it.quantity || 0);
                  const stockOk = stockQty >= reqQty;
                  return (
                    <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 120px 120px 120px', padding: '0 32px', borderBottom: `2px solid ${BD2}`, background: i % 2 === 0 ? BG0 : BG1, minHeight: 90 }}>
                      <div style={{ padding: '30px 5px', fontSize: 14, color: TX3 }}>{i + 1}</div>
                      <div style={{ padding: '20px 5px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <button
                            onClick={() => it.matchCandidates?.length > 0 && setMatchModal({ requestId: selReq.id, itemId: it.id, item: it, candidates: it.matchCandidates })}
                            disabled={!it.matchCandidates?.length}
                            style={{ background: 'none', border: 'none', padding: 0, color: isUnmapped ? RED : TX, cursor: it.matchCandidates?.length ? 'pointer' : 'default', fontSize: 18, fontWeight: 700, textAlign: 'left' }}>
                            {productLabel(it.Product) || '품목정보없음'}
                          </button>
                          {it.hasMultipleMatches && <span style={{ fontSize: 11, color: BLU, background: '#0d2044', border: `1px solid ${BLU}`, borderRadius: 4, padding: '2px 6px', fontWeight: 700 }}>선택 가능</span>}
                          {isUnmapped && <span style={{ fontSize: 11, color: RED, background: '#2d0d0b', border: `1px solid ${RED}`, borderRadius: 4, padding: '2px 6px', fontWeight: 700 }}>매칭 없음</span>}
                        </div>
                        <div style={{ fontSize: 14, color: TX2, marginTop: 4 }}>
                          {it.Product?.productCode || '—'} · {it.Product?.unit || '개'}
                          {it.requestedProductName && it.Product?.productName !== it.requestedProductName && (
                            <span style={{ color: TX3 }}> · 요청명: {it.requestedProductName}</span>
                          )}
                        </div>
                      </div>
                      <div style={{ padding: '30px 5px', textAlign: 'right', fontSize: 22, fontWeight: 900, color: ORG }}>{it.quantity}</div>
                      <div style={{ padding: '30px 5px', textAlign: 'right', fontSize: 22, fontWeight: 900, color: stockOk ? GRN : RED }}>{stockQty.toLocaleString()}</div>
                      <div style={{ padding: '30px 5px', textAlign: 'right', fontSize: 16, fontWeight: 700, color: selReq.status === 'released' ? GRN : TX3 }}>
                        {selReq.status === 'released' ? '출고완료' : stockOk ? '출고가능' : '재고부족'}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 출고 처리 버튼 */}
              <div style={{ padding: '30px 32px', background: BG1, borderTop: `2px solid ${BD}`, flexShrink: 0 }}>
                {selReq.status === 'released' ? (
                  <div style={{ textAlign: 'center', padding: '20px', background: '#0d2616', border: `2px solid ${GRN}`, borderRadius: 12, color: GRN, fontSize: 18, fontWeight: 800 }}>
                    ✅ 이미 출고가 완료된 요청입니다.
                  </div>
                ) : selReq.status === 'pending' ? (
                  selReq.isGw ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ padding: '14px 20px', background: '#1a1008', border: `1px solid ${ORG}44`, borderRadius: 10, color: TX2, fontSize: 14, fontWeight: 600 }}>
                        ⚠️ 그룹웨어 승인 대기 중입니다. 아래 버튼으로 관리자가 직접 출고할 수 있습니다.
                      </div>
                      <button onClick={openProcessFlow}
                        style={{ width: '100%', padding: '22px', fontSize: 22, fontWeight: 900,
                          background: 'linear-gradient(135deg, #1a3a6a, #2060cc)', border: `2px solid ${BLU}`,
                          color: '#fff', borderRadius: 15, cursor: 'pointer', boxShadow: '0 8px 24px rgba(88,166,255,0.25)' }}>
                        🏢 운영자 출고 처리
                      </button>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '20px', background: BG2, border: `2px solid ${BD}`, borderRadius: 12, color: TX2, fontSize: 18, fontWeight: 700 }}>
                      ⏳ 관리자의 승인이 필요한 요청입니다.
                    </div>
                  )
                ) : selReq.status === 'rejected' ? (
                   <div style={{ textAlign: 'center', padding: '20px', background: '#2d0d0b', border: `2px solid ${RED}`, borderRadius: 12, color: RED, fontSize: 18, fontWeight: 800 }}>
                    ❌ 반려된 요청입니다.
                  </div>
                ) : (
                  <button onClick={openProcessFlow}
                    style={{ width: '100%', padding: '22px', fontSize: 22, fontWeight: 900,
                      background: 'linear-gradient(135deg, #b35900, #f0883e)', border: `2px solid ${ORG}`,
                      color: '#fff', borderRadius: 15, cursor: 'pointer', boxShadow: '0 8px 24px rgba(240, 136, 62, 0.3)' }}>
                    📤 출고 처리 확정 (Release)
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {matchModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2100 }}
          onClick={e => e.target === e.currentTarget && setMatchModal(null)}>
          <div style={{ width: 620, maxHeight: '78vh', overflow: 'hidden', background: BG1, border: `2px solid ${BLU}`, borderRadius: 12, boxShadow: '0 18px 50px rgba(0,0,0,0.55)' }}>
            <div style={{ padding: '18px 20px', borderBottom: `1px solid ${BD2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 18, color: TX, fontWeight: 900 }}>출고 품목 선택</div>
                <div style={{ fontSize: 13, color: TX2, marginTop: 4 }}>
                  요청명: {matchModal.item?.requestedProductName || matchModal.item?.Product?.productName} · 요청수량 {matchModal.item?.quantity} {matchModal.item?.Product?.unit || '개'}
                </div>
              </div>
              <button onClick={() => setMatchModal(null)} style={{ background: BG2, border: `1px solid ${BD}`, color: TX2, borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>닫기</button>
            </div>
            <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
              {matchModal.candidates.map(p => {
                const qty = Number(matchModal.item?.quantity || 0);
                const stock = Number(p.currentStock || 0);
                const ok = stock >= qty;
                const selected = Number(matchModal.item?.matchedProductId) === Number(p.id);
                return (
                  <button key={p.id}
                    onClick={() => {
                      const choiceKey = `${matchModal.requestId}:${matchModal.itemId}`;
                      setProductChoices(prev => ({ ...prev, [choiceKey]: p.id }));
                      setRequests(prev => prev.map(r => {
                        if (String(r.id) !== String(matchModal.requestId)) return r;
                        return refreshRequestProductMatches(r, stockProducts, { ...productChoices, [choiceKey]: p.id });
                      }));
                      setMatchModal(null);
                    }}
                    style={{
                      width: '100%', display: 'grid', gridTemplateColumns: '1fr 110px 90px', gap: 12,
                      alignItems: 'center', padding: '14px 18px', border: 'none', borderBottom: `1px solid ${BD2}`,
                      background: selected ? '#0d2040' : BG1, cursor: 'pointer', textAlign: 'left',
                    }}>
                    <div>
                      <div style={{ color: TX, fontSize: 15, fontWeight: 800 }}>{productLabel(p)}</div>
                      <div style={{ color: TX2, fontSize: 12, marginTop: 3 }}>{p.productCode || '—'} · {p.unit || '개'}</div>
                    </div>
                    <div style={{ color: ok ? GRN : RED, fontSize: 20, fontWeight: 900, textAlign: 'right' }}>{stock.toLocaleString()}</div>
                    <div style={{ color: ok ? GRN : RED, fontSize: 12, fontWeight: 800, textAlign: 'right' }}>{ok ? '출고가능' : '재고부족'}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM */}
      <div style={{ height: 54, background: '#010409', borderTop: `2px solid ${BD2}`, display: 'flex', alignItems: 'center', gap: 24, padding: '0 32px', flexShrink: 0 }}>
        {[['F4', '요청목록'], ['ESC', '홈으로']].map(([k, l]) => (
          <span key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <kbd style={{ background: BG2, border: `2px solid ${BD}`, borderRadius: 6, padding: '3px 10px', fontSize: 14, color: TX2, fontFamily: 'monospace', fontWeight: 800 }}>{k}</kbd>
            <span style={{ fontSize: 16, color: TX3, fontWeight: 700 }}>{l}</span>
          </span>
        ))}
      </div>

      {toast && <div style={{ position: 'fixed', top: 100, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
        background: toast.type === 'error' ? '#3a1a1a' : '#1a3a2a', border: `3px solid ${toast.type === 'error' ? RED : GRN}`,
        color: toast.type === 'error' ? RED : GRN, padding: '18px 40px', borderRadius: 50, fontSize: 20, fontWeight: 800, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>{toast.msg}</div>}

      {/* 출고 처리 확인 모달 */}
      {processing && selReq && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5000 }}>
          <div style={{ background: BG1, border: `3px solid ${selReq.isGw && selReq.status === 'pending' ? BLU : ORG}`, borderRadius: 24, padding: '40px', width: 600 }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: selReq.isGw && selReq.status === 'pending' ? BLU : ORG, marginBottom: 12 }}>
              {selReq.isGw && selReq.status === 'pending' ? '🏢 운영자 출고 최종 확인' : '📤 출고 처리 최종 확인'}
            </div>
            <div style={{ fontSize: 18, color: TX2, marginBottom: 24, lineHeight: 1.6 }}>
              <b style={{color:TX}}>{requestTitle(selReq)}</b> 건을 출고하시겠습니까?<br/>
              {selReq.isGw && selReq.status === 'pending'
                ? '확인 즉시 재고가 차감되고 그룹웨어에 운영자 출고가 처리됩니다.'
                : '확인 즉시 전산 재고가 차감됩니다.'}
            </div>
            <div style={{ background: BG2, borderRadius: 15, padding: '20px', marginBottom: 30, maxHeight: 300, overflowY: 'auto' }}>
              {(selReq.items || []).map(it => (
                <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${BD2}` }}>
                  <span style={{ fontSize: 16, color: TX, fontWeight: 700 }}>
                    <span>{it.Product?.productName}</span>
                    {it.Product?.specification && <span style={{ display: 'block', color: TX2, fontSize: 12, marginTop: 2 }}>{it.Product.specification}</span>}
                  </span>
                  <span style={{ fontSize: 18, fontWeight: 900, color: ORG }}>{it.quantity} {it.Product?.unit || '개'}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 15 }}>
              <button onClick={() => setProc(false)} style={{ flex: 1, background: 'none', border: `2px solid ${BD}`, color: TX2, padding: '18px', borderRadius: 12, cursor: 'pointer', fontSize: 18, fontWeight: 700 }}>취소</button>
              <button onClick={handleProcess} disabled={loading}
                style={{ flex: 2, background: ORG, border: `2px solid ${ORG}`, color: '#fff', padding: '18px', borderRadius: 12, cursor: 'pointer', fontWeight: 900, fontSize: 20 }}>
                {loading ? '처리 중...' : '✅ 출고 확정'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 중복 출고 이력 확인 팝업 (최종확인 이전) */}
      {dupCheck && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5100 }}>
          <div style={{ background: BG1, border: `3px solid ${RED}`, borderRadius: 24, padding: '30px', width: 760, maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: RED, marginBottom: 10 }}>⚠️ 중복 출고 이력 확인</div>
            <div style={{ fontSize: 16, color: TX2, lineHeight: 1.6, marginBottom: 16 }}>
              동일 사용자 + 동일 품목 출고 이력이 있습니다.<br />
              출고를 진행할지, 반려 처리할지 선택하세요.
            </div>
            <div style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 14, color: TX, fontWeight: 700 }}>대상: {requestTitle(dupCheck.target)}</div>
              <div style={{ fontSize: 13, color: TX2, marginTop: 4 }}>
                사용자: {dupCheck.target?.userName || dupCheck.target?.applicant?.name || '-'}
              </div>
            </div>
            <div style={{ background: BG0, border: `1px solid ${BD2}`, borderRadius: 10, overflow: 'hidden', marginBottom: 18 }}>
              {(dupCheck.duplicates || []).slice(0, 8).map((r) => (
                <div key={r.id} style={{ padding: '10px 12px', borderBottom: `1px solid ${BD2}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ color: TX, fontWeight: 700 }}>{requestTitle(r)}</span>
                    <span style={{ color: TX2, fontSize: 12 }}>{parseDateSafe(r.createdAt)?.toLocaleString('ko-KR') || '-'}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={handleRejectByDuplicate}
                disabled={loading}
                style={{ flex: 1, background: 'none', border: `2px solid ${RED}`, color: RED, padding: '16px', borderRadius: 12, cursor: 'pointer', fontSize: 18, fontWeight: 800 }}
              >
                {loading ? '반려 처리 중...' : '반려 처리'}
              </button>
              <button
                onClick={() => {
                  setDupCheck(null);
                  setProc(true);
                }}
                style={{ flex: 1, background: 'linear-gradient(135deg, #b35900, #f0883e)', border: `2px solid ${ORG}`, color: '#fff', padding: '16px', borderRadius: 12, cursor: 'pointer', fontSize: 18, fontWeight: 800 }}
              >
                확인 후 진행
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WarehouseRequestList;
