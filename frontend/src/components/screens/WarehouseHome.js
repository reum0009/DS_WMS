import React, { useState, useEffect, useCallback, useRef } from 'react';
import { productsAPI, warehousesAPI, requestsAPI, dashboardAPI } from '../../api/api';
import './WarehouseHome.css';

// ══════════════════════════════════════════════════════════════════
// 바코드 스캐너 vs 키보드 입력 구분 훅
//
// 원리:
//   바코드 스캐너는 모든 문자를 ~20-50ms 간격으로 연속 입력하고
//   마지막에 Enter 를 보낸다.
//   키보드 타이핑은 문자 간 간격이 통상 100ms 이상이다.
//
// 동작:
//   1. 포커스된 input/textarea 가 없을 때만 전역 keydown 을 수집
//   2. 마지막 keydown 으로부터 IDLE_MS 이상 경과하면 버퍼 리셋
//   3. Enter 수신 시 버퍼 전체를 검토:
//      - 문자 수 >= MIN_LEN
//      - 모든 키 간 간격 < SPEED_MS  → 스캐너로 판정 → onScan(barcode)
//      - 위 조건 미충족              → 키보드 입력으로 간주 → 버퍼만 리셋
// ══════════════════════════════════════════════════════════════════
const SCANNER_SPEED_MS = 50;   // 이 속도 이하이면 스캐너
const SCANNER_MIN_LEN  = 3;    // 최소 문자 수
const IDLE_RESET_MS    = 300;  // 이 시간 동안 입력 없으면 버퍼 초기화

function useBarcodeScanner(onScan, enabled = true) {
  const bufRef   = useRef([]);   // [{ char, ts }]
  const timerRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;

    const resetBuf = () => { bufRef.current = []; };

    const handleKey = (e) => {
      // 포커스된 입력 필드가 있으면 무시 (정상 타이핑 허용)
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // 특수키 무시 (Ctrl, Alt, Meta, Shift, F-keys 등)
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key.length > 1 && e.key !== 'Enter') return;

      const now = Date.now();

      if (e.key === 'Enter') {
        const buf = bufRef.current;
        bufRef.current = [];
        clearTimeout(timerRef.current);

        if (buf.length < SCANNER_MIN_LEN) return;

        // 모든 인접 키 간격이 SCANNER_SPEED_MS 이하인지 확인
        const isScanner = buf.every((item, idx) => {
          if (idx === 0) return true;
          return (item.ts - buf[idx - 1].ts) <= SCANNER_SPEED_MS;
        });

        if (isScanner) {
          const code = buf.map(b => b.char).join('');
          onScan(code);
        }
        return;
      }

      // 일반 문자 버퍼링
      bufRef.current.push({ char: e.key, ts: now });

      // 유휴 타이머: 일정 시간 내 Enter 없으면 → 키보드 입력으로 버퍼 리셋
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(resetBuf, IDLE_RESET_MS);
    };

    window.addEventListener('keydown', handleKey, true);
    return () => {
      window.removeEventListener('keydown', handleKey, true);
      clearTimeout(timerRef.current);
    };
  }, [enabled, onScan]);
}

// ── DS 로고 SVG (인라인) ──────────────────────────────────────────
const DSLogo = ({ size = 52 }) => (
  <svg width={size} height={size} viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" className="ds-logo-svg">
    <defs>
      <pattern id="cf" patternUnits="userSpaceOnUse" width="4" height="4">
        <rect width="4" height="4" fill="#111"/>
        <rect width="2" height="2" fill="#1a1a1a"/>
        <rect x="2" y="2" width="2" height="2" fill="#1a1a1a"/>
      </pattern>
      <linearGradient id="dGold" x1="0%" y1="0%" x2="20%" y2="100%">
        <stop offset="0%"   stopColor="#6b4f00"/>
        <stop offset="18%"  stopColor="#b8860b"/>
        <stop offset="42%"  stopColor="#f5d68a"/>
        <stop offset="62%"  stopColor="#d4a843"/>
        <stop offset="100%" stopColor="#7a5600"/>
      </linearGradient>
      <linearGradient id="sBlue" x1="0%" y1="0%" x2="20%" y2="100%">
        <stop offset="0%"   stopColor="#0d2a56"/>
        <stop offset="30%"  stopColor="#1e4fa0"/>
        <stop offset="55%"  stopColor="#6090d8"/>
        <stop offset="100%" stopColor="#0d2a56"/>
      </linearGradient>
      <filter id="glow">
        <feGaussianBlur stdDeviation="1.2" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="60" height="60" rx="10" fill="url(#cf)" stroke="#2a2a2a" strokeWidth="1.5"/>
    <rect width="60" height="60" rx="10" fill="none" stroke="#8B6914" strokeWidth="1" opacity="0.6"/>
    <text x="2"  y="50" fontFamily="Georgia, 'Times New Roman', serif" fontSize="54"
      fontWeight="900" fill="url(#dGold)" filter="url(#glow)" letterSpacing="-3">D</text>
    <text x="27" y="50" fontFamily="Georgia, 'Times New Roman', serif" fontSize="48"
      fontWeight="900" fill="url(#sBlue)" filter="url(#glow)" letterSpacing="-3">S</text>
  </svg>
);

// ── 메뉴 정의 ─────────────────────────────────────────────────────
const HOME_MENU = [
  { id: 'inbound',          label: '입고',     sub: 'Inbound',          key: 'F1',  icon: '📥', color: '#3fb950', bg: '#0d2616' },
  { id: 'outbound',         label: '출고',     sub: 'Outbound',         key: 'F2',  icon: '📤', color: '#f85149', bg: '#2d0d0b' },
  { id: 'transfer',         label: '창고간 입출고', sub: 'Transfer I/O', key: 'F3',  icon: '🔀', color: '#a371f7', bg: '#1e0d40' },
  { id: 'req-outbound',     label: '요청목록', sub: 'Request List',     key: 'F4',  icon: '📋', color: '#f0883e', bg: '#2d1800' },
  { id: 'inventory',        label: '재고조회', sub: 'Inventory',        key: 'F5',  icon: '🔍', color: '#58a6ff', bg: '#0a1f40' },
  { id: 'low-stock',        label: '저재고',   sub: 'Low Stock',        key: 'F6',  icon: '⚠️', color: '#e3b341', bg: '#2d2000' },
  { id: 'report',           label: '리포트',   sub: 'Report',           key: null,  icon: '📊', color: '#d2a8ff', bg: '#1e0d40' },
  { id: 'settings',         label: '설정',     sub: 'Settings',         key: 'F10', icon: '⚙️', color: '#8b949e', bg: '#161b22' },
];

const QUICK_ACTIONS = [
  { id: 'transfer-inbound',  label: '창고간 입고', icon: '📥', color: '#3fb950' },
  { id: 'transfer-outbound', label: '창고간 출고', icon: '📤', color: '#f0883e' },
  { id: 'outbound',     label: '직접 출고',  icon: '🚀', color: '#f85149' },
  { id: 'req-outbound', label: '요청 검색',  icon: '🔎', color: '#f0883e' },
  { id: 'inbound',      label: '입고 처리',  icon: '📥', color: '#3fb950' },
  { id: 'inventory',    label: '재고 조회',  icon: '🔍', color: '#58a6ff' },
];

const CAT_TABS = [
  { id: 'all',      label: '전체' },
  { id: '소모품',   label: '소모품' },
  { id: '비품',     label: '비품' },
  { id: '유지보수', label: '유지보수' },
  { id: 'low',      label: '저재고' },
  { id: 'recent',   label: '최근출고' },
  { id: 'frequent', label: '자주사용' },
];

// ─── 스캔 팝업: 일치 품목 있을 때 ───────────────────────────────
function ScanMatchPopup({ product, barcode, onInbound, onOutbound, onClose }) {
  const stockColor = product.currentStock === 0 ? '#f85149' : product.currentStock <= (product.safetyStock || 0) ? '#e3b341' : '#3fb950';
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.80)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: '28px 32px', width: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4, fontFamily: 'monospace' }}>{barcode}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e6edf3', marginBottom: 8 }}>{product.productName}</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: stockColor, marginBottom: 4 }}>
          {product.currentStock} <span style={{ fontSize: 14, fontWeight: 400 }}>{product.unit}</span>
        </div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 24 }}>현재 재고</div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 12 }}>
          <button onClick={onInbound} style={{ flex: 1, background: '#0d2616', border: '2px solid #3fb950', color: '#3fb950', padding: '14px 0', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 700 }}>
            📥 입고
          </button>
          <button onClick={onOutbound} style={{ flex: 1, background: '#2d0d0b', border: '2px solid #f85149', color: '#f85149', padding: '14px 0', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 700 }}>
            📤 출고
          </button>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: 13, cursor: 'pointer' }}>취소 (ESC)</button>
      </div>
    </div>
  );
}

// ─── 스캔 팝업: 미등록 품목 ──────────────────────────────────────
function ScanNewPopup({ barcode, onRegisterIn, onRegisterOut, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.80)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: '28px 32px', width: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e3b341', marginBottom: 8 }}>등록되지 않은 바코드</div>
        <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#8b949e', marginBottom: 20, wordBreak: 'break-all' }}>{barcode}</div>
        <p style={{ fontSize: 13, color: '#8b949e', marginBottom: 24 }}>
          데이터베이스에 없는 품목입니다.<br />
          새 품목으로 등록 후 입/출고를 진행하시겠습니까?
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 12 }}>
          <button onClick={onRegisterIn} style={{ flex: 1, background: '#0d2616', border: '2px solid #3fb950', color: '#3fb950', padding: '14px 0', borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>
            📥 등록 후 입고
          </button>
          <button onClick={onRegisterOut} style={{ flex: 1, background: '#2d0d0b', border: '2px solid #f85149', color: '#f85149', padding: '14px 0', borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>
            📤 등록 후 출고
          </button>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: 13, cursor: 'pointer' }}>취소 (ESC)</button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
const WarehouseHome = ({ user, onLogout, onEnterPOS }) => {

  const [currentTime, setCurrentTime] = useState('');
  const [stats,       setStats]       = useState({ inbound: 0, outbound: 0, pending: 0, lowStock: 0, empty: 0, total: 0 });
  const [warehouses,  setWarehouses]  = useState([]);
  const [products,    setProducts]    = useState([]);
  // eslint-disable-next-line no-unused-vars
  const [notices,     setNotices]     = useState([
    { id: 1, text: '오늘 14:00 정기 재고실사가 예정되어 있습니다.', type: 'info' },
    { id: 2, text: '소모품 A4용지(80g) 재고 부족 — 즉시 발주 필요', type: 'warn' },
  ]);
  const [catTab,      setCatTab]      = useState('all');
  const [loading,     setLoading]     = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  // ── 스캐너 팝업 상태 ──────────────────────────────────────────
  const [scanPopup, setScanPopup] = useState(null); // null | { type: 'match'|'new', product?, barcode }

  // ── 스캐너 감지 콜백 ──────────────────────────────────────────
  const handleScan = useCallback((code) => {
    const q = String(code || '').toLowerCase().trim();
    if (!q) return;

    const found = products.find(p => {
      const b = String(p.barcode || '').toLowerCase().trim();
      const pc = String(p.productCode || '').toLowerCase().trim();
      const hasCodes = (p.codes || []).some(c => String(c.codeValue || '').toLowerCase().trim() === q);
      return b === q || pc === q || hasCodes;
    });

    if (found) {
      setScanPopup({ type: 'match', product: found, barcode: code });
    } else {
      setScanPopup({ type: 'new', barcode: code });
    }
  }, [products]);

  // 스캐너 훅 연결 (팝업이 열려 있을 때는 비활성)
  useBarcodeScanner(handleScan, !scanPopup);

  // ESC로 팝업 닫기
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setScanPopup(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── 시계 (YYYY.MM.DD HH:MM:SS) ───────────────────────────────
  useEffect(() => {
    const fmt = () => {
      const d = new Date(), p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    setCurrentTime(fmt());
    const id = setInterval(() => setCurrentTime(fmt()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── 데이터 로드 ───────────────────────────────────────────────
  const loadData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const [pRes, wRes, rRes, sRes] = await Promise.all([
        productsAPI.getAll(),
        warehousesAPI.getAll(),
        requestsAPI.getAll(),
        dashboardAPI.getStats(),
      ]);
      const products  = pRes.data || [];
      const wList     = wRes.data || [];
      // eslint-disable-next-line no-unused-vars
      const requests  = rRes.data || [];
      const backendStats = sRes.data || {};
      
      setProducts(products);
      setWarehouses(wList);

      const overview = backendStats.overview || {};
      const inventory = backendStats.inventory || {};

      setStats({
        inbound: overview.todayInbound || 0,
        outbound: overview.todayOutbound || 0,
        pending: overview.pendingRequests || 0,
        lowStock: inventory.lowStockProducts || 0,
        empty: inventory.outOfStockProducts || 0,
        total: inventory.totalProducts || products.length
      });
    } catch {
      // silent
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // 30초마다 자동 갱신
    const id = setInterval(() => loadData(true), 30000);
    return () => clearInterval(id);
  }, [loadData]);

  // ── 전체화면 ──────────────────────────────────────────────────
  useEffect(() => {
    const enter = () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    const onFirst = () => { enter(); window.removeEventListener('click', onFirst); };
    window.addEventListener('click', onFirst);
    return () => window.removeEventListener('click', onFirst);
  }, []);

  // ── 키보드 핸들러 ─────────────────────────────────────────────
  const handleMenu = useCallback((id) => {
    onEnterPOS(id);
  }, [onEnterPOS]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
        else document.exitFullscreen();
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (/^F\d+$/.test(e.key)) e.preventDefault();

      switch (e.key) {
        case 'F1':  handleMenu('inbound');          break;
        case 'F2':  handleMenu('outbound');         break;
        case 'F3':  handleMenu('transfer');         break;
        case 'F4':  handleMenu('req-outbound');     break;
        case 'F5':  handleMenu('inventory');        break;
        case 'F6':  handleMenu('low-stock');        break;
        case 'F10': handleMenu('settings');         break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleMenu]);

  const warehouseName = warehouses[0]?.warehouseName || '제1창고';

  return (
    <div className="home-root">

      {/* ═══ TOP BAR ══════════════════════════════════════════════ */}
      <div className="home-top">
        <div className="home-top__brand">
          <DSLogo size={44} />
          <div className="home-top__title-block">
            <span className="home-top__title">WMS 창고관리시스템</span>
            <span className="home-top__subtitle">Warehouse Management System</span>
          </div>
        </div>

        <div className="home-top__divider" />

        <div className="home-top__meta">
          <span className="home-top__warehouse">📦 {warehouseName}</span>
          <span className="home-top__sep">|</span>
          <span className="home-top__user">👤 {user?.name || '사용자'}</span>
        </div>

        <div className="home-top__right">
          {loading && <span className="home-top__loading">⟳</span>}
          <div className="home-top__status">
            <span className="home-top__dot home-top__dot--on" />
            <span className="home-top__status-text">온라인</span>
          </div>
          <span className="home-top__time">{currentTime}</span>
          <button className="home-logout" onClick={onLogout}>로그아웃</button>
        </div>
      </div>

      {/* ═══ BODY ════════════════════════════════════════════════ */}
      <div className="home-body">

        {/* ── LEFT INFO PANEL ─────────────────────────────────── */}
        <aside className={`home-left${leftCollapsed ? ' home-left--collapsed' : ''}`}>

          {/* 접기/펼치기 탭 */}
          <button
            className="home-left__toggle"
            onClick={() => setLeftCollapsed(v => !v)}
            title={leftCollapsed ? '패널 펼치기' : '패널 접기'}
          >
            {leftCollapsed ? '›' : '‹'}
            {leftCollapsed && (stats.empty > 0 || stats.lowStock > 0) && (
              <span className="home-left__toggle-dot" />
            )}
          </button>

          {/* DS 로고 + 시스템 명칭 */}
          <div className="home-left__brand">
            <DSLogo size={64} />
            <div className="home-left__brand-name">DS WMS</div>
            <div className="home-left__brand-sub">v1.0 · {warehouseName}</div>
          </div>

          {/* 오늘의 현황 */}
          <div className="home-left__section">
            <div className="home-left__section-title">📋 오늘의 현황</div>
            <div className="home-stat-grid">
              <div className="home-stat-card home-stat-card--green">
                <span className="home-stat-card__val">{stats.inbound}</span>
                <span className="home-stat-card__lbl">입고 건</span>
              </div>
              <div className="home-stat-card home-stat-card--red">
                <span className="home-stat-card__val">{stats.outbound}</span>
                <span className="home-stat-card__lbl">출고 건</span>
              </div>
            </div>
          </div>

          {/* 창고 현황 */}
          <div className="home-left__section">
            <div className="home-left__section-title">📦 창고 현황</div>
            <div className="home-info-list">
              <div className="home-info-row">
                <span className="home-info-row__lbl">전체 품목</span>
                <span className="home-info-row__val home-info-row__val--blue">{stats.total}</span>
              </div>
              <div className="home-info-row">
                <span className="home-info-row__lbl">출고 대기</span>
                <span className="home-info-row__val" style={{ color: stats.pending > 0 ? '#f0883e' : '#3fb950' }}>
                  {stats.pending}
                </span>
              </div>
              <div className="home-info-row">
                <span className="home-info-row__lbl">저재고 품목</span>
                <span className="home-info-row__val" style={{ color: stats.lowStock > 0 ? '#e3b341' : '#3fb950' }}>
                  {stats.lowStock}
                </span>
              </div>
              <div className="home-info-row">
                <span className="home-info-row__lbl">소진 품목</span>
                <span className="home-info-row__val" style={{ color: stats.empty > 0 ? '#f85149' : '#3fb950' }}>
                  {stats.empty}
                </span>
              </div>
            </div>
          </div>

          {/* 알림/공지 */}
          <div className="home-left__section home-left__section--notices">
            <div className="home-left__section-title">📢 공지사항</div>
            <div className="home-notices">
              {notices.map(n => (
                <div key={n.id} className={`home-notice home-notice--${n.type}`}>
                  <span className="home-notice__dot" />
                  <span className="home-notice__text">{n.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 경고 뱃지 */}
          {(stats.lowStock > 0 || stats.empty > 0) && (
            <div className="home-alert-strip">
              {stats.empty   > 0 && <span className="home-alert-badge home-alert-badge--empty">🔴 소진 {stats.empty}종</span>}
              {stats.lowStock > 0 && <span className="home-alert-badge home-alert-badge--low">⚠️ 부족 {stats.lowStock}종</span>}
            </div>
          )}
        </aside>

        {/* ── CENTER MENU BLOCKS ──────────────────────────────── */}
        <main className="home-center">

          {/* 시스템 타이틀 배너 */}
          <div className="home-center__banner">
            <DSLogo size={40} />
            <div className="home-center__banner-text">
              <span className="home-center__banner-main">창고 운영 메인 메뉴</span>
              <span className="home-center__banner-sub">기능을 선택하거나 단축키를 누르세요</span>
            </div>
            {stats.pending > 0 && (
              <div className="home-center__pending-alert">
                <span className="home-pending-badge">{stats.pending}</span>
                <span>출고 대기 요청</span>
              </div>
            )}
          </div>

          {/* 메뉴 블록 그리드 */}
          <div className="home-menu-grid">
            {HOME_MENU.map(item => (
              <button
                key={item.id}
                className="home-menu-block"
                style={{ '--menu-color': item.color, '--menu-bg': item.bg }}
                onClick={() => handleMenu(item.id)}
              >
                <span className="home-menu-block__icon">{item.icon}</span>
                <span className="home-menu-block__label">{item.label}</span>
                <span className="home-menu-block__sub">{item.sub}</span>
                {item.key && (
                  <span className="home-menu-block__key">{item.key}</span>
                )}
                {item.id === 'low-stock' && stats.lowStock > 0 && (
                  <span className="home-menu-block__badge">{stats.lowStock}</span>
                )}
                {item.id === 'req-outbound' && stats.pending > 0 && (
                  <span className="home-menu-block__badge">{stats.pending}</span>
                )}
              </button>
            ))}
          </div>

          {/* 요청 상태 범례 */}
          <div className="home-status-legend">
            <span className="home-legend-title">요청 상태:</span>
            {[
              ['신청', '#8b949e'],
              ['출고대기', '#f0883e'],
              ['부분출고', '#e3b341'],
              ['출고완료', '#3fb950'],
              ['취소', '#f85149'],
            ].map(([label, color]) => (
              <span key={label} className="home-legend-item" style={{ '--lc': color }}>
                <span className="home-legend-dot" />
                {label}
              </span>
            ))}
          </div>
        </main>

        {/* ── RIGHT QUICK ACTIONS ─────────────────────────────── */}
        <aside className="home-right">
          <div className="home-right__title">빠른 실행</div>

          <div className="home-quick-actions">
            {QUICK_ACTIONS.map(qa => (
              <button
                key={qa.id}
                className="home-quick-btn"
                style={{ '--qa-color': qa.color }}
                onClick={() => handleMenu(qa.id)}
              >
                <span className="home-quick-btn__icon">{qa.icon}</span>
                <span className="home-quick-btn__label">{qa.label}</span>
              </button>
            ))}
          </div>

          <div className="home-right__divider" />

          {/* 시스템 상태 */}
          <div className="home-right__title">시스템 정보</div>
          <div className="home-sys-info">
            <div className="home-sys-row">
              <span className="home-sys-row__lbl">서버</span>
              <span className="home-sys-row__val home-sys-row__val--on">● 온라인</span>
            </div>
            <div className="home-sys-row">
              <span className="home-sys-row__lbl">데이터베이스</span>
              <span className="home-sys-row__val home-sys-row__val--on">● 연결됨</span>
            </div>
            <div className="home-sys-row">
              <span className="home-sys-row__lbl">창고</span>
              <span className="home-sys-row__val">{warehouseName}</span>
            </div>
            <div className="home-sys-row">
              <span className="home-sys-row__lbl">버전</span>
              <span className="home-sys-row__val home-sys-row__val--muted">v1.0.0</span>
            </div>
            <div className="home-sys-row">
              <span className="home-sys-row__lbl">역할</span>
              <span className="home-sys-row__val">창고 담당자</span>
            </div>
          </div>

          <div className="home-right__divider" />

          {/* 로그아웃 / 종료 */}
          <button className="home-exit-btn" onClick={onLogout}>
            <span>🚪</span>
            <span>로그아웃 / 종료</span>
          </button>
        </aside>

      </div>

      {/* ═══ CATEGORY BAR ════════════════════════════════════════ */}
      <div className="home-cat-bar">
        <span className="home-cat-bar__label">빠른 분류</span>
        {CAT_TABS.map(tab => (
          <button
            key={tab.id}
            className={`home-cat-tab${catTab === tab.id ? ' home-cat-tab--active' : ''}`}
            onClick={() => { setCatTab(tab.id); if (tab.id !== 'all') onEnterPOS('inventory'); }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ BOTTOM SHORTCUT BAR ════════════════════════════════ */}
      <div className="home-bottom">
        {[
          ['F1','입고'],['F2','출고'],['F3','창고간 입출고'],['F4','요청목록'],
          ['F5','재고조회'],['F6','저재고'],['F10','설정'],
          ['Ctrl+Shift+F','전체화면'],['ESC','종료/뒤로'],
        ].map(([k, l]) => (
          <span key={k} className="home-bottom__item">
            <kbd className="home-bottom__kbd">{k}</kbd>
            <span className="home-bottom__lbl">{l}</span>
          </span>
        ))}
        <span className="home-bottom__spacer" />
        <span style={{ color: '#444c56', fontSize: 12 }}>바코드 스캔 대기 중</span>
        <span className="home-bottom__ver">WMS v1.0 · DS</span>
      </div>

      {/* ═══ 스캐너 팝업 ════════════════════════════════════════ */}
      {scanPopup?.type === 'match' && (
        <ScanMatchPopup
          product={scanPopup.product}
          barcode={scanPopup.barcode}
          onInbound={() => { setScanPopup(null); onEnterPOS('inbound', scanPopup.product); }}
          onOutbound={() => { setScanPopup(null); onEnterPOS('outbound', scanPopup.product); }}
          onClose={() => setScanPopup(null)}
        />
      )}
      {scanPopup?.type === 'new' && (
        <ScanNewPopup
          barcode={scanPopup.barcode}
          onRegisterIn={() => { setScanPopup(null); onEnterPOS('inbound', { barcode: scanPopup.barcode }); }}
          onRegisterOut={() => { setScanPopup(null); onEnterPOS('outbound', { barcode: scanPopup.barcode }); }}
          onClose={() => setScanPopup(null)}
        />
      )}

    </div>
  );
};

export default WarehouseHome;
