import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  usersAPI, warehousesAPI, productsAPI,
  categoriesAPI, suppliersAPI, stockHistoryAPI, invitationsAPI,
  gwMappingAPI,
  dbConfigAPI, noticesAPI, purchaseCartAPI,
} from '../../api/api';

// ── 단위 목록 ─────────────────────────────────────────────────────
const UNITS = ['개', '박스', '묶음', '롤', '장', '세트', '병', '봉', '통', '팩', '다스', '리터', 'kg', 'm'];

// ── 역할 라벨 ─────────────────────────────────────────────────────
const ROLE_LABELS = {
  admin: '시스템관리자',
  dept_admin: '부서관리자',
  warehouse: '창고작업자',
  applicant: '신청자',
};
const ROLE_OPTIONS = ['admin', 'dept_admin', 'applicant', 'warehouse'];

// ── 상태 뱃지 ─────────────────────────────────────────────────────
function Badge({ color, children }) {
  const colors = {
    green:  { bg: '#1a3a2a', text: '#3fb950', border: '#238636' },
    red:    { bg: '#3a1a1a', text: '#f85149', border: '#8b1a1a' },
    yellow: { bg: '#3a2e00', text: '#e3b341', border: '#9e6a03' },
    gray:   { bg: '#2d333b', text: '#8b949e', border: '#444c56' },
    blue:   { bg: '#0d2044', text: '#58a6ff', border: '#1158b7' },
    purple: { bg: '#2d1a4a', text: '#d2a8ff', border: '#6e40c9' },
  };
  const s = colors[color] || colors.gray;
  return (
    <span style={{
      background: s.bg, color: s.text, border: `1px solid ${s.border}`,
      borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 600
    }}>{children}</span>
  );
}

// ── 확인 다이얼로그 (window.confirm 대체) ────────────────────────
function ConfirmModal({ message, subMessage, confirmLabel = '확인', confirmColor = '#238636', onConfirm, onCancel }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
    }} onClick={onCancel}>
      <div style={{
        background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
        width: 360, padding: '28px 28px 24px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, color: '#e6edf3', fontWeight: 600, marginBottom: subMessage ? 8 : 20, lineHeight: 1.5 }}>
          {message}
        </div>
        {subMessage && (
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 20, lineHeight: 1.6 }}>{subMessage}</div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            background: 'none', border: '1px solid #30363d', color: '#8b949e',
            padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
          }}>취소</button>
          <button onClick={onConfirm} style={{
            background: confirmColor, border: 'none', color: '#fff',
            padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700,
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ── 모달 래퍼 ─────────────────────────────────────────────────────
function Modal({ title, onClose, children, width = 520 }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }} onClick={onClose}>
      <div style={{
        background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
        width, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto',
        padding: '24px 28px'
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: '#e6edf3' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── 입력 공통 스타일 ─────────────────────────────────────────────
const inputStyle = {
  width: '100%', background: '#0d1117', border: '1px solid #30363d',
  borderRadius: 6, color: '#e6edf3', padding: '8px 12px', fontSize: 14,
  boxSizing: 'border-box', outline: 'none',
};
const labelStyle = { display: 'block', fontSize: 13, color: '#8b949e', marginBottom: 4 };
const fieldWrap = { marginBottom: 14 };

function Field({ label, children }) {
  return (
    <div style={fieldWrap}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function SaveBtn({ onClick, loading, label = '저장' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
      <button onClick={onClick} disabled={loading} style={{
        background: '#238636', border: '1px solid #2ea043', color: '#fff',
        padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 14
      }}>{loading ? '처리 중…' : label}</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  메인 AdminDashboard
// ─────────────────────────────────────────────────────────────────
export default function AdminDashboard({ user, onLogout }) {
  // 열린 탭 목록 [{ id, label, icon }], 활성 탭 id
  const [tabs,        setTabs]        = useState([{ id: 'overview', label: '대시보드', icon: '◈' }]);
  const [activeTab,   setActiveTab]   = useState('overview');
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [msg,         setMsg]         = useState(null);

  const showMsg = useCallback((text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 2800);
  }, []);

  // 메뉴 클릭 → 탭 열기
  const openTab = useCallback((id) => {
    const meta = MENUS.find(m => m.id === id);
    if (!meta) return;
    setTabs(prev => prev.find(t => t.id === id) ? prev : [...prev, { id, label: meta.label, icon: meta.icon }]);
    setActiveTab(id);
  }, []);

  // 탭 닫기
  const closeTab = useCallback((id, e) => {
    e.stopPropagation();
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) return [{ id: 'overview', label: '대시보드', icon: '◈' }];
      return next;
    });
    setActiveTab(prev => {
      if (prev !== id) return prev;
      const idx = tabs.findIndex(t => t.id === id);
      const next = tabs.filter(t => t.id !== id);
      if (next.length === 0) return 'overview';
      return next[Math.max(0, idx - 1)].id;
    });
  }, [tabs]);

  const renderPanel = () => {
    switch (activeTab) {
      case 'overview':   return <OverviewPanel   showMsg={showMsg} onNavigate={openTab} />;
      case 'notices':    return <NoticesPanel    showMsg={showMsg} />;
      case 'items':      return <ItemsPanel       showMsg={showMsg} />;
      case 'categories': return <CategoriesPanel  showMsg={showMsg} currentUser={user} />;
      case 'purchaseCart': return <PurchaseCartPanel showMsg={showMsg} currentUser={user} />;
      case 'warehouses': return <WarehousesPanel  showMsg={showMsg} currentUser={user} />;
      case 'policy':     return <PolicyPanel      showMsg={showMsg} />;
      case 'suppliers':  return <SuppliersPanel   showMsg={showMsg} />;
      case 'users':      return <UsersPanel       showMsg={showMsg} currentUser={user} />;
      case 'reports':    return <ReportsPanel     showMsg={showMsg} />;
      case 'gwmapping':  return <GwMappingPanel   showMsg={showMsg} />;
      case 'dbconfig':   return <DbConfigPanel    showMsg={showMsg} />;
      case 'autoorder':  return <AutoOrderPanel />;
      case 'update':     return <UpdatePanel      showMsg={showMsg} />;
      default:           return <OverviewPanel    showMsg={showMsg} onNavigate={openTab} />;
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}>

      {/* ── 사이드바 ── */}
      <AdminSidebar
        active={activeTab}
        onSelect={openTab}
        user={user}
        onLogout={onLogout}
        collapsed={sideCollapsed}
        onToggle={() => setSideCollapsed(v => !v)}
      />

      {/* ── 우측: 탭바 + 콘텐츠 ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* 탭 바 */}
        <div style={{
          display: 'flex', alignItems: 'flex-end', background: '#0d1117',
          borderBottom: '1px solid #21262d', flexShrink: 0,
          overflowX: 'auto', overflowY: 'hidden',
          scrollbarWidth: 'thin', scrollbarColor: '#30363d transparent',
          minHeight: 38,
        }}>
          {tabs.map(t => {
            const isActive = t.id === activeTab;
            const isOverview = t.id === 'overview';
            return (
              <div
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '0 14px', height: 38, flexShrink: 0,
                  background: isActive ? '#161b22' : 'transparent',
                  borderRight: '1px solid #21262d',
                  borderTop: isActive ? '2px solid #58a6ff' : '2px solid transparent',
                  cursor: 'pointer', userSelect: 'none',
                  color: isActive ? '#e6edf3' : '#8b949e',
                  fontSize: 12, fontWeight: isActive ? 600 : 400,
                  transition: 'background 0.1s',
                  position: 'relative', top: 1,
                }}
              >
                <span style={{ fontSize: 13 }}>{t.icon}</span>
                <span>{t.label}</span>
                {!isOverview && (
                  <span
                    onClick={(e) => closeTab(t.id, e)}
                    style={{
                      marginLeft: 4, width: 16, height: 16, borderRadius: 3,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, color: '#444c56', lineHeight: 1,
                      transition: 'background 0.1s, color 0.1s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#30363d'; e.currentTarget.style.color = '#f85149'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#444c56'; }}
                  >
                    ×
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* 콘텐츠 */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px', position: 'relative' }}>
          {msg && (
            <div style={{
              position: 'fixed', top: 16, right: 24, zIndex: 2000,
              background: msg.type === 'error' ? '#3a1a1a' : '#1a3a2a',
              border: `1px solid ${msg.type === 'error' ? '#f85149' : '#3fb950'}`,
              color: msg.type === 'error' ? '#f85149' : '#3fb950',
              padding: '10px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600,
            }}>{msg.text}</div>
          )}
          {renderPanel()}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  사이드바
// ─────────────────────────────────────────────────────────────────
const MENUS = [
  { id: 'overview',   icon: '◈', label: '대시보드' },
  { id: 'notices',    icon: '!', label: '공지사항 관리' },
  { id: 'items',      icon: '▦', label: '품목 관리' },
  { id: 'categories', icon: '≡', label: '카테고리 관리' },
  { id: 'purchaseCart', icon: '▣', label: '장바구니' },
  { id: 'warehouses', icon: '⌂', label: '창고 관리' },
  { id: 'policy',     icon: '⚙', label: '재고 정책' },
  { id: 'suppliers',  icon: '◑', label: '공급업체 관리' },
  { id: 'users',      icon: '◉', label: '사용자·권한' },
  { id: 'reports',    icon: '▤', label: '보고서' },
  { id: 'gwmapping',  icon: '⇄', label: 'GW소모품매핑' },
  { id: 'dbconfig',   icon: 'DB', label: 'DB 설정' },
  { id: 'autoorder',  icon: '◌', label: '자동발주 (예정)' },
  { id: 'update',     icon: '↑', label: '시스템 업데이트' },
];

function AdminSidebar({ active, onSelect, user, onLogout, collapsed, onToggle }) {
  return (
    <div style={{
      width: collapsed ? 44 : 220,
      background: '#161b22', borderRight: '1px solid #21262d',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      transition: 'width 0.2s ease', overflow: 'hidden',
    }}>
      {/* 헤더 + 접기 버튼 */}
      <div style={{
        padding: '0 8px', height: 48, borderBottom: '1px solid #21262d',
        display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between',
        flexShrink: 0,
      }}>
        {!collapsed && (
          <div style={{ paddingLeft: 10 }}>
            <div style={{ fontSize: 13, color: '#58a6ff', fontWeight: 700, letterSpacing: 1, whiteSpace: 'nowrap' }}>WAREHOUSE</div>
            <div style={{ fontSize: 10, color: '#8b949e', marginTop: 1 }}>관리자 시스템</div>
          </div>
        )}
        <button onClick={onToggle} title={collapsed ? '펼치기' : '접기'} style={{
          width: 28, height: 28, borderRadius: 5, border: '1px solid #30363d',
          background: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 13,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          transition: 'background 0.15s',
        }}
          onMouseEnter={e => e.currentTarget.style.background = '#30363d'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* 메뉴 */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '6px 0' }}>
        {MENUS.map(m => {
          const isActive = active === m.id;
          const isDimmed = m.id === 'autoorder';
          return (
            <button key={m.id} onClick={() => onSelect(m.id)} title={collapsed ? m.label : undefined} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: isActive ? '#1f2937' : 'none',
              border: 'none',
              color: isActive ? '#58a6ff' : isDimmed ? '#444c56' : '#c9d1d9',
              padding: collapsed ? '10px 0' : '10px 16px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              textAlign: 'left', cursor: 'pointer', fontSize: 13,
              width: '100%',
              borderLeft: isActive ? '3px solid #58a6ff' : '3px solid transparent',
              fontWeight: isActive ? 600 : 400,
              whiteSpace: 'nowrap',
            }}>
              <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>{m.icon}</span>
              {!collapsed && m.label}
            </button>
          );
        })}
      </div>

      {/* 하단: 사용자 정보 + 로그아웃 */}
      <div style={{ borderTop: '1px solid #21262d', padding: collapsed ? '10px 0' : '12px 16px', flexShrink: 0 }}>
        {!collapsed && (
          <>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 2 }}>
              👤 {user?.name || '관리자'}
            </div>
            <div style={{ fontSize: 11, color: '#444c56', marginBottom: 10 }}>
              {user?.warehouse || '본사창고'}
            </div>
          </>
        )}
        {onLogout && (
          <button onClick={onLogout} title={collapsed ? '로그아웃' : undefined} style={{
            width: '100%', padding: '7px 0', background: 'none',
            border: '1px solid #30363d', borderRadius: 5,
            color: '#8b949e', cursor: 'pointer', fontSize: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <span>🚪</span>
            {!collapsed && <span>로그아웃</span>}
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  공통: 섹션 헤더
// ─────────────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle, action }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24, borderBottom: '1px solid #21262d', paddingBottom: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 20, color: '#e6edf3' }}>{title}</h2>
        {subtitle && <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8b949e' }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function AddBtn({ onClick, label = '+ 등록' }) {
  return (
    <button onClick={onClick} style={{
      background: '#238636', border: '1px solid #2ea043', color: '#fff',
      padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600
    }}>{label}</button>
  );
}

function ProductNameSpec({ item, name, spec, nameStyle = {}, specStyle = {} }) {
  const productName = name ?? item?.productName ?? item?.Product?.productName ?? item?.mappedProduct?.productName ?? '';
  const specification = spec ?? item?.specification ?? item?.Product?.specification ?? item?.mappedProduct?.specification ?? '';
  return (
    <div>
      <div style={nameStyle}>{productName}</div>
      {specification && <div style={{ color: '#8b949e', fontSize: 11, marginTop: 1, ...specStyle }}>{specification}</div>}
    </div>
  );
}

const warehouseDisplayName = (warehouseStock, warehouses = []) => {
  const warehouseId = warehouseStock?.warehouseId ?? warehouseStock?.id;
  return warehouseStock?.warehouse?.warehouseName
    || warehouses.find(w => String(w.id) === String(warehouseId))?.warehouseName
    || `창고 #${warehouseId}`;
};

const warehouseSortRank = (name) => {
  const text = String(name || '').replace(/\s+/g, '');
  if (text.includes('평택')) return 0;
  return 1;
};

const sortWarehouseStocksForDisplay = (stocks = [], warehouses = []) => [...(stocks || [])].sort((a, b) => {
  const nameA = warehouseDisplayName(a, warehouses);
  const nameB = warehouseDisplayName(b, warehouses);
  const rank = warehouseSortRank(nameA) - warehouseSortRank(nameB);
  if (rank !== 0) return rank;
  return nameA.localeCompare(nameB, 'ko');
});

const sortWarehousesForDisplay = (warehouses = []) => [...(warehouses || [])].sort((a, b) => {
  const rank = warehouseSortRank(a.warehouseName) - warehouseSortRank(b.warehouseName);
  if (rank !== 0) return rank;
  return String(a.warehouseName || '').localeCompare(String(b.warehouseName || ''), 'ko');
});

// ─────────────────────────────────────────────────────────────────
//  개요 패널 (대시보드)
// ─────────────────────────────────────────────────────────────────
function OverviewPanel({ showMsg, onNavigate }) {
  const [stats, setStats] = useState({ products: 0, lowStock: 0, noSafety: 0, warehouses: 0, users: 0, suppliers: 0 });
  const [lowItems, setLowItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const loadOverview = async () => {
      try {
        const p = await productsAPI.getAll();
        const products = p.data || [];
        const low = products.filter(x => x.currentStock <= (x.safetyStock || 0));
        const noSafety = products.filter(x => !x.safetyStock);

        const w = await warehousesAPI.getAll();
        const u = await usersAPI.getAll();
        const s = await suppliersAPI.getAll();

        if (!alive) return;
        setStats({
          products: products.length,
          lowStock: low.length,
          noSafety: noSafety.length,
          warehouses: (w.data || []).length,
          users: (u.data || []).length,
          suppliers: (s.data || []).length,
        });
        setLowItems(low.slice(0, 10));
      } catch {
        if (!alive) return;
        showMsg('데이터 로드 실패', 'error');
      } finally {
        if (alive) setLoading(false);
      }
    };
    loadOverview();
    return () => { alive = false; };
  }, [showMsg]);

  const widgets = [
    { label: '총 품목', value: stats.products, color: '#58a6ff', icon: '▦', menuId: 'items' },
    { label: '저재고 품목', value: stats.lowStock, color: '#f85149', icon: '!', menuId: 'reports' },
    { label: '안전재고 미설정', value: stats.noSafety, color: '#e3b341', icon: '△', menuId: 'policy' },
    { label: '창고 수', value: stats.warehouses, color: '#3fb950', icon: '⌂', menuId: 'warehouses' },
    { label: '사용자 수', value: stats.users, color: '#d2a8ff', icon: '◉', menuId: 'users' },
    { label: '공급업체 수', value: stats.suppliers, color: '#f0883e', icon: '◑', menuId: 'suppliers' },
  ];

  return (
    <div>
      <SectionHeader title="대시보드" subtitle="창고 관리 시스템 현황 요약" />
      {loading ? <p style={{ color: '#8b949e' }}>로딩 중…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
            {widgets.map(w => (
              <div key={w.label} onClick={() => w.menuId && onNavigate && onNavigate(w.menuId)} title={w.menuId ? '클릭하여 관련 메뉴로 이동' : undefined} style={{
                background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: '20px 24px',
                borderTop: `3px solid ${w.color}`,
                cursor: w.menuId ? 'pointer' : 'default',
              }}>
                <div style={{ fontSize: 24, color: w.color, marginBottom: 8 }}>{w.icon}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: w.color }}>{w.value}</div>
                <div style={{ fontSize: 13, color: '#8b949e', marginTop: 4 }}>{w.label}</div>
              </div>
            ))}
          </div>

          {lowItems.length > 0 && (
            <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 20 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 14, color: '#f85149' }}>저재고 알림 (상위 10건)</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #21262d' }}>
                    {['품목명', '현재고', '안전재고', '상태'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: '#8b949e', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lowItems.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #161b22' }}>
                      <td style={{ padding: '8px 8px', color: '#e6edf3' }}><ProductNameSpec item={p} nameStyle={{ color: '#e6edf3' }} /></td>
                      <td style={{ padding: '8px 8px', color: p.currentStock === 0 ? '#f85149' : '#e3b341', fontWeight: 600 }}>{p.currentStock}</td>
                      <td style={{ padding: '8px 8px', color: '#8b949e' }}>{p.safetyStock || '미설정'}</td>
                      <td style={{ padding: '8px 8px' }}>
                        {p.currentStock === 0
                          ? <Badge color="red">소진</Badge>
                          : <Badge color="yellow">저재고</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  품목 관리 패널
// ─────────────────────────────────────────────────────────────────
// ── 코드 타입 라벨 ───────────────────────────────────────────────
const CODE_TYPE_COLOR = { barcode: '#58a6ff', vendor: '#d2a8ff', internal: '#3fb950' };

// ── 카테고리 트리 헬퍼 ─────────────────────────────────────────────
function buildCatPathMap(nodes, prefix, map) {
  nodes.forEach(n => {
    const path = prefix ? `${prefix} › ${n.name}` : n.name;
    map[n.id] = path;
    if (n.children && n.children.length > 0) buildCatPathMap(n.children, path, map);
  });
}

function findCatPath(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return [n.id];
    if (n.children && n.children.length > 0) {
      const found = findCatPath(n.children, id);
      if (found) return [n.id, ...found];
    }
  }
  return null;
}

// compact=true → 가로 한 줄 드롭다운 5개 배치 (필터 용도)
// compact=false (기본) → 세로 배치 (폼 용도)
function CascadeCatSelect({ tree, catSel, onChange, compact = false, allowDirectSelect = false }) {
  const LEVEL_KEYS = ['l1', 'l2', 'l3', 'l4', 'l5'];
  const ALL_BY_LEVEL = { l1: [], l2: [], l3: [], l4: [], l5: [] };

  const collectByLevel = (nodes, pathIds = [], pathNames = []) => {
    (nodes || []).forEach(n => {
      const nextIds = [...pathIds, n.id];
      const nextNames = [...pathNames, n.name];
      const depth = nextIds.length;
      const key = LEVEL_KEYS[depth - 1];
      if (key) {
        ALL_BY_LEVEL[key].push({ ...n, pathIds: nextIds, label: nextNames.join(' › ') });
      }
      if (n.children && n.children.length > 0) collectByLevel(n.children, nextIds, nextNames);
    });
  };
  collectByLevel(tree);

  const getLevelNodes = (levelKey) => {
    const levelIdx = LEVEL_KEYS.indexOf(levelKey);
    // 가장 가까운 상위 선택된 레벨 찾기
    let ancestorIdx = -1;
    for (let i = levelIdx - 1; i >= 0; i--) {
      if (catSel[LEVEL_KEYS[i]]) {
        ancestorIdx = i;
        break;
      }
    }

    if (ancestorIdx === -1) {
      // 상위 선택이 없으면 해당 레벨의 모든 노드 표시
      return ALL_BY_LEVEL[levelKey];
    } else {
      // 선택된 상위 레벨의 모든 하위 노드 표시
      const ancestorId = parseInt(catSel[LEVEL_KEYS[ancestorIdx]]);
      return ALL_BY_LEVEL[levelKey].filter(n => n.pathIds.includes(ancestorId));
    }
  };

  const sel = (level, val) => {
    if (!val) {
      const next = { ...catSel, [level]: '' };
      const idx = LEVEL_KEYS.indexOf(level);
      for (let i = idx + 1; i < LEVEL_KEYS.length; i++) next[LEVEL_KEYS[i]] = '';
      onChange(next);
      return;
    }

    const node = ALL_BY_LEVEL[level].find(n => String(n.id) === String(val));
    if (node) {
      const next = { ...catSel };
      node.pathIds.forEach((id, idx) => {
        if (LEVEL_KEYS[idx]) next[LEVEL_KEYS[idx]] = String(id);
      });
      // 현재 레벨 하위는 초기화
      const idx = LEVEL_KEYS.indexOf(level);
      for (let i = idx + 1; i < LEVEL_KEYS.length; i++) next[LEVEL_KEYS[i]] = '';
      onChange(next);
    }
  };

  const selStyle = { ...inputStyle, fontSize: 12, padding: '5px 8px' };
  const levels = [
    { key: 'l1', label: '부서',   nodes: getLevelNodes('l1'), disabled: false },
    { key: 'l2', label: '분류',   nodes: getLevelNodes('l2'), disabled: false },
    { key: 'l3', label: '대분류', nodes: getLevelNodes('l3'), disabled: false },
    { key: 'l4', label: '중분류', nodes: getLevelNodes('l4'), disabled: false },
    { key: 'l5', label: '소분류', nodes: getLevelNodes('l5'), disabled: false },
  ];

  if (compact) {
    // 가로 배치: 선택 가능한 레벨만 표시 (선택된 레벨+1까지)
    const visibleUpTo = catSel.l4 ? 5 : catSel.l3 ? 4 : catSel.l2 ? 3 : catSel.l1 ? 2 : 1;
    const visibleLevels = levels.slice(0, visibleUpTo);
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {visibleLevels.map(({ key, label, nodes, disabled }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#444c56', whiteSpace: 'nowrap' }}>{label}</span>
            <select
              value={catSel[key] || ''}
              disabled={disabled}
              onChange={e => sel(key, e.target.value)}
              style={{ ...selStyle, minWidth: 90, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
            >
              <option value="">전체</option>
              {nodes.map(n => {
                const levelIdx = LEVEL_KEYS.indexOf(key);
                const hasDirectParent = levelIdx > 0 && catSel[LEVEL_KEYS[levelIdx - 1]];
                return <option key={n.id} value={n.id}>{hasDirectParent ? n.name : (n.label || n.name)}</option>;
              })}
            </select>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {levels.map(({ key, label, nodes, disabled }) => (
        <div key={key} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#8b949e', textAlign: 'right', whiteSpace: 'nowrap' }}>
            {key === 'l1' ? '부서(L1)' : key === 'l2' ? '자산유형(L2)' : key === 'l3' ? '대분류(L3)' : key === 'l4' ? '중분류(L4)' : '소분류(L5)'}
          </span>
          <select
            value={catSel[key] || ''}
            disabled={disabled}
            onChange={e => sel(key, e.target.value)}
            style={{ ...selStyle, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
          >
            <option value="">-- 선택 --</option>
            {nodes.map(n => {
              const levelIdx = LEVEL_KEYS.indexOf(key);
              const hasDirectParent = levelIdx > 0 && catSel[LEVEL_KEYS[levelIdx - 1]];
              return <option key={n.id} value={n.id}>{(hasDirectParent && !allowDirectSelect) ? n.name : (n.label || n.name)}</option>;
            })}
          </select>
        </div>
      ))}
    </div>
  );
}

function NoticesPanel({ showMsg }) {
  const today = new Date().toISOString().slice(0, 10);
  const [warehouses, setWarehouses] = useState([]);
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ warehouseIds: [], warehouseId: '', startDate: today, endDate: today, content: '', isActive: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [wRes, nRes] = await Promise.all([warehousesAPI.getAll(), noticesAPI.getAll()]);
      setWarehouses(wRes.data || []);
      setNotices(nRes.data || []);
      setForm(f => ({
        ...f,
        warehouseIds: f.warehouseIds?.length ? f.warehouseIds : [],
        warehouseId: f.warehouseId || String((wRes.data || [])[0]?.id || ''),
      }));
    } catch {
      showMsg('공지사항 로드 실패', 'error');
    } finally {
      setLoading(false);
    }
  }, [showMsg]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setEditing(null);
    setForm({ warehouseIds: [], warehouseId: String(warehouses[0]?.id || ''), startDate: today, endDate: today, content: '', isActive: true });
  };

  const editNotice = (n) => {
    setEditing(n);
    setForm({
      warehouseIds: [String(n.warehouseId || '')].filter(Boolean),
      warehouseId: String(n.warehouseId || ''),
      startDate: String(n.startDate || today).slice(0, 10),
      endDate: String(n.endDate || today).slice(0, 10),
      content: n.content || '',
      isActive: n.isActive !== false,
    });
  };

  const save = async () => {
    const selectedWarehouseIds = editing ? [form.warehouseId].filter(Boolean) : (form.warehouseIds || []);
    if (selectedWarehouseIds.length === 0) return showMsg('창고를 선택하세요', 'error');
    if (!form.startDate || !form.endDate) return showMsg('공지 기간을 설정하세요', 'error');
    if (form.startDate > form.endDate) return showMsg('시작일은 종료일보다 늦을 수 없습니다', 'error');
    if (!form.content.trim()) return showMsg('공지사항 내용을 입력하세요', 'error');

    setLoading(true);
    try {
      const payload = {
        ...(editing
          ? { warehouseId: Number(form.warehouseId) }
          : { warehouseIds: selectedWarehouseIds.map(Number) }),
        startDate: form.startDate,
        endDate: form.endDate,
        content: form.content.trim(),
        isActive: form.isActive,
      };
      if (editing) {
        await noticesAPI.update(editing.id, payload);
        showMsg('공지사항 수정 완료');
      } else {
        await noticesAPI.create(payload);
        showMsg(`공지사항 ${selectedWarehouseIds.length}개 창고 저장 완료`);
      }
      resetForm();
      await load();
    } catch (e) {
      showMsg(e.response?.data?.error || '공지사항 저장 실패', 'error');
    } finally {
      setLoading(false);
    }
  };

  const remove = async (n) => {
    if (!window.confirm('공지사항을 삭제하시겠습니까?')) return;
    setLoading(true);
    try {
      await noticesAPI.delete(n.id);
      showMsg('공지사항 삭제 완료');
      if (editing?.id === n.id) resetForm();
      await load();
    } catch (e) {
      showMsg(e.response?.data?.error || '공지사항 삭제 실패', 'error');
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (n) => {
    setLoading(true);
    try {
      await noticesAPI.update(n.id, { isActive: !n.isActive });
      await load();
    } catch (e) {
      showMsg(e.response?.data?.error || '상태 변경 실패', 'error');
    } finally {
      setLoading(false);
    }
  };

  const whName = (id) => warehouses.find(w => String(w.id) === String(id))?.warehouseName || `창고 #${id}`;
  const toggleWarehouse = (id, checked) => {
    const sid = String(id);
    setForm(f => {
      const prev = f.warehouseIds || [];
      return {
        ...f,
        warehouseIds: checked ? [...new Set([...prev, sid])] : prev.filter(x => x !== sid),
      };
    });
  };
  const allSelected = warehouses.length > 0 && form.warehouseIds.length === warehouses.length;

  return (
    <div>
      <SectionHeader title="공지사항 관리" subtitle="창고별 공지사항과 표시 기간을 관리합니다" />
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 18, alignItems: 'start' }}>
        <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 18 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#e6edf3' }}>{editing ? '공지사항 수정' : '공지사항 등록'}</h3>
          {editing ? (
            <Field label="창고 선택 *">
              <select value={form.warehouseId} onChange={e => setForm(f => ({ ...f, warehouseId: e.target.value }))} style={inputStyle}>
                <option value="">-- 창고 선택 --</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouseName}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="창고 선택 *">
              <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, padding: 10, maxHeight: 160, overflowY: 'auto' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e6edf3', fontSize: 13, fontWeight: 700, marginBottom: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={e => setForm(f => ({ ...f, warehouseIds: e.target.checked ? warehouses.map(w => String(w.id)) : [] }))}
                  />
                  전체 창고 선택
                </label>
                <div style={{ borderTop: '1px solid #21262d', paddingTop: 8, display: 'grid', gap: 7 }}>
                  {warehouses.map(w => (
                    <label key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c9d1d9', fontSize: 13, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={(form.warehouseIds || []).includes(String(w.id))}
                        onChange={e => toggleWarehouse(w.id, e.target.checked)}
                      />
                      {w.warehouseName}
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ color: '#8b949e', fontSize: 11, marginTop: 6 }}>{form.warehouseIds.length}개 창고 선택됨</div>
            </Field>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="시작일 *">
              <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} style={inputStyle} />
            </Field>
            <Field label="종료일 *">
              <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} style={inputStyle} />
            </Field>
          </div>
          <Field label="공지사항 내용 *">
            <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} rows={7}
              placeholder="창고 담당자 화면에 표시할 공지사항을 입력하세요"
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c9d1d9', fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
            활성화
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
            {editing && <button onClick={resetForm} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', borderRadius: 6, padding: '8px 14px', cursor: 'pointer' }}>취소</button>}
            <button onClick={save} disabled={loading} style={{ background: '#238636', border: '1px solid #2ea043', color: '#fff', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontWeight: 700 }}>
              {loading ? '처리 중...' : editing ? '수정 저장' : '저장'}
            </button>
          </div>
        </div>

        <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #21262d', color: '#8b949e', fontSize: 13, fontWeight: 700 }}>공지사항 목록 ({notices.length})</div>
          {notices.length === 0 ? (
            <div style={{ padding: 42, color: '#444c56', textAlign: 'center', fontWeight: 700 }}>등록된 공지사항이 없습니다.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#1c2128', color: '#8b949e' }}>
                  {['창고', '기간', '내용', '상태', '관리'].map(h => <th key={h} style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid #30363d' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {notices.map(n => (
                  <tr key={n.id} style={{ borderBottom: '1px solid #21262d' }}>
                    <td style={{ padding: '10px 12px', color: '#e6edf3', whiteSpace: 'nowrap' }}>{n.warehouse?.warehouseName || whName(n.warehouseId)}</td>
                    <td style={{ padding: '10px 12px', color: '#8b949e', whiteSpace: 'nowrap' }}>{n.startDate} ~ {n.endDate}</td>
                    <td style={{ padding: '10px 12px', color: '#c9d1d9', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{n.content}</td>
                    <td style={{ padding: '10px 12px' }}><Badge color={n.isActive ? 'green' : 'gray'}>{n.isActive ? '활성' : '비활성'}</Badge></td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <button onClick={() => editNotice(n)} style={{ background: '#0d2044', border: '1px solid #1158b7', color: '#58a6ff', borderRadius: 4, padding: '5px 9px', marginRight: 6, cursor: 'pointer' }}>수정</button>
                      <button onClick={() => toggleActive(n)} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', borderRadius: 4, padding: '5px 9px', marginRight: 6, cursor: 'pointer' }}>{n.isActive ? '숨김' : '표시'}</button>
                      <button onClick={() => remove(n)} style={{ background: '#3a1a1a', border: '1px solid #8b1a1a', color: '#f85149', borderRadius: 4, padding: '5px 9px', cursor: 'pointer' }}>삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function ItemsPanel({ showMsg }) {
  const [view,         setView]         = useState('active');
  const [products,     setProducts]     = useState([]);
  const [inactive,     setInactive]     = useState([]);
  const [drafts,       setDrafts]       = useState([]); // GW에서 넘어온 임시 품목
  const [catTree,      setCatTree]      = useState([]);
  const [catPathMap,   setCatPathMap]   = useState({});
  const [search,       setSearch]       = useState('');
  const [showForm,     setShowForm]     = useState(false);
  const [editing,      setEditing]      = useState(null);  // null = 신규/복사, object = 수정
  const [isClone,      setIsClone]      = useState(false); // 복사 등록 모드
  const [loading,      setLoading]      = useState(false);
  const [barcodeGenerating, setBarcodeGenerating] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const [dupModal,     setDupModal]     = useState(null);
  const [dupError,     setDupError]     = useState('');   // 완전 중복 인라인 에러
  const [deptWarehouses, setDeptWarehouses] = useState([]);
  const [catWareStocks, setCatWareStocks] = useState([]); // 선택된 카테고리의 창고별 안전재고
  // 카테고리 빠른 추가 모달
  const [catAddModal,  setCatAddModal]  = useState(null); // { addLevel, parentId, parentName }
  const [catAddName,   setCatAddName]   = useState('');
  const [catAddSaving, setCatAddSaving] = useState(false);

  const EMPTY_CAT_SEL = { l1: '', l2: '', l3: '', l4: '', l5: '' };
  const [catSel,    setCatSel]    = useState(EMPTY_CAT_SEL);
  // 목록 필터용 카테고리 선택
  const [filterCat, setFilterCat] = useState(EMPTY_CAT_SEL);

  const EMPTY_FORM = {
    productName: '', specification: '', categoryId: '', unit: '개',
    unitPrice: '', warehouseStocks: [], notes: '', codes: [],
  };
  const [form, setForm] = useState(EMPTY_FORM);

  const loadCatTree = async () => {
    const t = await categoriesAPI.getTree();
    const tree = t.data || [];
    setCatTree(tree);
    const pathMap = {};
    buildCatPathMap(tree, '', pathMap);
    setCatPathMap(pathMap);
    return tree;
  };

  const load = useCallback(() => {
    Promise.all([productsAPI.getAll(), productsAPI.getInactive(), categoriesAPI.getTree()])
      .then(([p, pi, t]) => {
        const allProducts = p.data || [];
        // 활성 목록: isActive && !isDraft
        setProducts(allProducts.filter(x => !x.isDraft));
        // 품목 매핑 대기: isActive && isDraft
        setDrafts(allProducts.filter(x => x.isDraft));
        
        setInactive(pi.data || []);
        const tree = t.data || [];
        setCatTree(tree);
        const pathMap = {};
        buildCatPathMap(tree, '', pathMap);
        setCatPathMap(pathMap);
      })
      .catch(() => showMsg('로드 실패', 'error'));
  }, [showMsg]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = catSel.l5 || catSel.l4 || catSel.l3 || catSel.l2 || catSel.l1 || '';
    setForm(f => ({ ...f, categoryId: id }));
    setDupError('');
  }, [catSel]);

  // 카테고리 변경 시 창고별 안전재고 로드
  useEffect(() => {
    if (!form.categoryId) { setCatWareStocks([]); return; }
    let alive = true;
    categoriesAPI.getWarehouseStocks(form.categoryId)
      .then(r => { if (alive) setCatWareStocks(r.data || []); })
      .catch(() => { if (alive) setCatWareStocks([]); });
    return () => { alive = false; };
  }, [form.categoryId]);

  const selectedDeptId = (() => {
    if (!form.categoryId) return null;
    const path = findCatPath(catTree, parseInt(form.categoryId, 10));
    return path && path.length ? path[0] : null;
  })();

  // 선택된 카테고리의 안전재고 (카테고리 기반 안전재고 표시용)
  const selectedCatSafety = useMemo(() => {
    if (!form.categoryId || !catTree.length) return null;
    const findNode = (nodes, id) => {
      for (const n of nodes) {
        if (parseInt(n.id) === parseInt(id)) return n;
        if (n.children && n.children.length) {
          const found = findNode(n.children, id);
          if (found) return found;
        }
      }
      return null;
    };
    const node = findNode(catTree, form.categoryId);
    return node != null ? (parseInt(node.safetyStock, 10) || 0) : null;
  }, [form.categoryId, catTree]);

  const selectedDeptAccessIds = (() => {
    if (!selectedDeptId) return [];
    const root = (catTree || []).find(n => n.id === parseInt(selectedDeptId, 10));
    if (!root) return [parseInt(selectedDeptId, 10)];
    let arr = [];
    if (Array.isArray(root.accessDeptIds)) arr = root.accessDeptIds;
    else if (typeof root.accessDeptIds === 'string' && root.accessDeptIds.trim()) {
      try {
        const parsed = JSON.parse(root.accessDeptIds);
        if (Array.isArray(parsed)) arr = parsed;
      } catch (_) { arr = []; }
    }
    const ids = Array.from(new Set(arr.map(v => parseInt(v, 10)).filter(v => Number.isInteger(v) && v > 0)));
    if (!ids.length) return [parseInt(selectedDeptId, 10)];
    return ids;
  })();

  useEffect(() => {
    let alive = true;
    if (!selectedDeptId) {
      setDeptWarehouses([]);
      // 신규 등록이거나 초기화 중일 때만 warehouseStocks 비움
      if (!editing && !isClone) setForm(f => ({ ...f, warehouseStocks: [] }));
      return;
    }
    warehousesAPI.getAll()
      .then(r => {
        if (!alive) return;
        const allowedDeptIds = new Set(selectedDeptAccessIds);
        const rows = (r.data || []).filter(w => {
          const deptMatched = allowedDeptIds.has(parseInt(w.deptId || 0, 10));
          const activeOnly = ![false, 0, '0', 'false'].includes(w.isActive);
          return deptMatched && activeOnly;
        });
        setDeptWarehouses(rows);
        
        // 수정/복사 모드일 때는 fillForm에서 넣은 초기값이 있으므로 필터링만 진행
        const allowed = new Set(rows.map(w => String(w.id)));
        setForm(f => ({
          ...f,
          warehouseStocks: (f.warehouseStocks || []).filter(ws => allowed.has(String(ws.warehouseId))),
        }));
      })
      .catch(() => { if (alive) showMsg('창고 목록 로드 실패', 'error'); });
    return () => { alive = false; };
  }, [selectedDeptId, selectedDeptAccessIds, showMsg, editing, isClone]);

  const restoreCatSel = (categoryId, tree) => {
    const t = tree || catTree;
    if (categoryId && t.length > 0) {
      const path = findCatPath(t, parseInt(categoryId));
      if (path) {
        const sel = { l1: '', l2: '', l3: '', l4: '', l5: '' };
        ['l1','l2','l3','l4','l5'].forEach((k, i) => { if (path[i]) sel[k] = String(path[i]); });
        setCatSel(sel);
        return;
      }
    }
    setCatSel(EMPTY_CAT_SEL);
  };

  const fillForm = (p) => {
    const normalizedWarehouseStocks = (p.warehouseStocks && p.warehouseStocks.length > 0)
      ? p.warehouseStocks.map(ws => ({
          warehouseId: parseInt(ws.warehouseId, 10),
        })).filter(ws => Number.isInteger(ws.warehouseId) && ws.warehouseId > 0)
      : (p.warehouseId ? [{ warehouseId: parseInt(p.warehouseId, 10) }] : []);

    setForm({
      productName:   p.productName || '',
      specification: p.specification || '',
      categoryId:    p.categoryId || '',
      unit:          p.unit || '개',
      unitPrice:     p.unitPrice === undefined || p.unitPrice === null || p.unitPrice === '' ? '' : String(parseInt(p.unitPrice, 10) || 0),
      warehouseStocks: normalizedWarehouseStocks,
      notes:         p.notes || '',
      codes: (p.codes || []).map(c => ({ codeType: c.codeType, codeValue: c.codeValue, supplierId: c.supplierId || '', notes: c.notes || '' })),
    });
    setDupError('');
    restoreCatSel(p.categoryId);
  };

  const openAdd   = () => { setEditing(null); setIsClone(false); setForm(EMPTY_FORM); setCatSel(EMPTY_CAT_SEL); setDupError(''); setShowForm(true); };
  const openEdit  = async (p) => {
    setEditing(p);
    setIsClone(false);
    setDupError('');
    try {
      const r = await productsAPI.getById(p.id);
      fillForm(r.data || p);
    } catch (_) {
      fillForm(p);
      showMsg('상세 조회 실패: 목록 데이터로 불러왔습니다', 'error');
    }
    setShowForm(true);
  };
  const openClone = (p) => { setEditing(null); setIsClone(true);  fillForm(p); setShowForm(true); };

  // ── 카테고리 빠른 추가 ──
  const openCatAdd = () => {
    const lv = catSel.l5 ? 5 : catSel.l4 ? 4 : catSel.l3 ? 3 : catSel.l2 ? 2 : catSel.l1 ? 1 : 0;
    if (lv >= 5) { showMsg('L5가 최하위 레벨입니다', 'error'); return; }
    const addLevel = lv + 1;
    const parentId = lv > 0 ? parseInt(catSel['l' + lv]) : null;
    const parentName = parentId ? (catPathMap[parentId] || `ID ${parentId}`) : '(최상위)';
    setCatAddModal({ addLevel, parentId, parentName });
    setCatAddName('');
  };

  const handleQuickAddCat = async () => {
    if (!catAddName.trim()) return showMsg('이름을 입력하세요', 'error');
    setCatAddSaving(true);
    try {
      let newCat;
      if (catAddModal.addLevel === 1) {
        newCat = (await categoriesAPI.createDept({ name: catAddName.trim() })).data;
      } else {
        newCat = (await categoriesAPI.create({ name: catAddName.trim(), level: catAddModal.addLevel, parentId: catAddModal.parentId })).data;
      }
      showMsg(`"${catAddName.trim()}" 카테고리 추가 완료`);
      setCatAddModal(null);
      const newTree = await loadCatTree();
      const path = findCatPath(newTree, newCat.id);
      if (path) {
        const sel = { l1: '', l2: '', l3: '', l4: '', l5: '' };
        ['l1','l2','l3','l4','l5'].forEach((k, i) => { if (path[i]) sel[k] = String(path[i]); });
        setCatSel(sel);
      }
    } catch (e) {
      showMsg(e.response?.data?.error || '카테고리 추가 실패', 'error');
    } finally { setCatAddSaving(false); }
  };

  // ── 코드 배열 조작 ──
  const addCode    = () => setForm(f => ({ ...f, codes: [...f.codes, { codeType: 'barcode', codeValue: '', supplierId: '', notes: '' }] }));
  const removeCode = (i) => setForm(f => ({ ...f, codes: f.codes.filter((_, idx) => idx !== i) }));
  const updateCode = (i, field, val) => setForm(f => { const codes = [...f.codes]; codes[i] = { ...codes[i], [field]: val }; return { ...f, codes }; });
  const handleGenerateBarcode = async () => {
    if (barcodeGenerating) return;
    setBarcodeGenerating(true);
    try {
      const { data } = await productsAPI.generateBarcode();
      const baseBarcode = String(data?.barcode || '').trim().toUpperCase();
      if (!/^W\d{5}$/.test(baseBarcode)) throw new Error('Invalid barcode');

      let appliedBarcode = baseBarcode;
      setForm(f => {
        const codes = [...f.codes];
        const reserved = new Set(codes.map(c => String(c.codeValue || '').trim().toUpperCase()).filter(Boolean));
        let seq = parseInt(baseBarcode.slice(1), 10);
        while (reserved.has(`W${String(seq).padStart(5, '0')}`)) seq += 1;
        appliedBarcode = `W${String(seq).padStart(5, '0')}`;

        const emptyBarcodeIndex = codes.findIndex(c => c.codeType === 'barcode' && !String(c.codeValue || '').trim());
        const nextCode = { codeType: 'barcode', codeValue: appliedBarcode, supplierId: '', notes: '' };
        if (emptyBarcodeIndex >= 0) codes[emptyBarcodeIndex] = { ...codes[emptyBarcodeIndex], ...nextCode };
        else codes.push(nextCode);
        return { ...f, codes };
      });
      showMsg(`바코드 ${appliedBarcode} 생성 완료`);
    } catch (e) {
      showMsg(e.response?.data?.error || '바코드 생성 실패', 'error');
    } finally {
      setBarcodeGenerating(false);
    }
  };

  const toggleWarehouse = (warehouseId, checked) => {
    setForm(f => {
      const prev = [...(f.warehouseStocks || [])];
      const exists = prev.find(x => parseInt(x.warehouseId, 10) === warehouseId);
      if (checked && !exists) prev.push({ warehouseId });
      if (!checked) return { ...f, warehouseStocks: prev.filter(x => parseInt(x.warehouseId, 10) !== warehouseId) };
      return { ...f, warehouseStocks: prev };
    });
  };

  // ── 저장 ──
  const doSave = async (force = false) => {
    if (!form.productName || !form.unit) return showMsg('품목명과 단위는 필수입니다', 'error');
    if (form.unitPrice === undefined || form.unitPrice === null || form.unitPrice === '') return showMsg('기준 단가는 필수입니다', 'error');
    if (!Number.isInteger(Number(form.unitPrice)) || Number(form.unitPrice) < 0) return showMsg('기준 단가는 0 이상의 정수만 입력하세요', 'error');
    if (!form.warehouseStocks || form.warehouseStocks.length === 0) return showMsg('최소 1개 창고를 지정하세요', 'error');

    setDupError('');
    setLoading(true);
    try {
      const normalizedWarehouseStocks = (form.warehouseStocks || []).map(x => ({
        warehouseId: parseInt(x.warehouseId, 10),
        safetyStock: 0,
      }));
      const payload = {
        ...form,
        unitPrice: parseInt(form.unitPrice, 10),
        warehouseStocks: normalizedWarehouseStocks,
      };
      if (editing && !isClone) {
        await productsAPI.update(editing.id, payload);
        showMsg('품목이 수정되었습니다');
        setShowForm(false); load();
      } else {
        if (!force) {
          const { data: { exact, similar } } = await productsAPI.checkDuplicate({
            productName: form.productName, specification: form.specification,
            categoryId: form.categoryId, unit: form.unit,
          });
          if (exact.length > 0) {
            setDupError('동일한 품목명·상품명·카테고리·단위가 이미 존재합니다. 중복 등록 불가합니다.');
            setLoading(false); return;
          }
          if (similar.length > 0) {
            setDupModal({ similar });
            setLoading(false); return;
          }
        }
        await productsAPI.create({ ...payload, force });
        showMsg(isClone ? '복사 등록 완료 (새 ITM코드 자동생성)' : '품목이 등록되었습니다 (코드 자동생성)');
        setShowForm(false); load();
      }
    } catch (e) {
      showMsg(e.response?.data?.error || '저장 실패', 'error');
    } finally { setLoading(false); }
  };

  const handleDelete = (id, name) => {
    setConfirmModal({
      message: `"${name}" 품목을 비활성화하시겠습니까?`,
      confirmLabel: '비활성화', confirmColor: '#b62324',
      onConfirm: async () => { setConfirmModal(null); await productsAPI.delete(id).catch(() => showMsg('삭제 실패', 'error')); showMsg('비활성화 완료'); load(); },
    });
  };
  const handleRestore = (id, name) => {
    setConfirmModal({
      message: `"${name}" 품목을 복구하시겠습니까?`,
      confirmLabel: '복구', confirmColor: '#238636',
      onConfirm: async () => { setConfirmModal(null); await productsAPI.restore(id).catch(() => showMsg('복구 실패', 'error')); showMsg('복구 완료'); load(); },
    });
  };
  const handleDeletePermanent = (id, name) => {
    setConfirmModal({
      message: `"${name}" 품목을 영구 삭제하시겠습니까?`,
      subMessage: '연결된 바코드/코드 데이터도 함께 삭제되며 복구할 수 없습니다.',
      confirmLabel: '영구 삭제', confirmColor: '#b62324',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await productsAPI.deletePermanent(id);
          showMsg('영구 삭제 완료');
          load();
        } catch (e) {
          showMsg(e.response?.data?.error || '삭제 실패', 'error');
        }
      },
    });
  };

  // filterCat에서 가장 세부 선택된 카테고리 ID 반환
  const handlePrintBarcode = (product, code) => {
    if (!product?.id || code?.codeType !== 'barcode' || !code?.codeValue) return;
    setConfirmModal({
      message: `"${code.codeValue}" 바코드 라벨을 출력하시겠습니까?`,
      subMessage: `품목명 : ${product.productName}`,
      confirmLabel: '출력',
      confirmColor: '#238636',
      onConfirm: async () => {
        try {
          setConfirmModal(null);
          await productsAPI.printLabel({ productId: product.id, productName: product.productName, barcode: code.codeValue });
          showMsg('라벨 출력 요청 완료');
        } catch (e) {
          showMsg(e.response?.data?.error || '라벨 출력 실패', 'error');
        }
      },
    });
  };

  const filterCatId = filterCat.l5 || filterCat.l4 || filterCat.l3 || filterCat.l2 || filterCat.l1 || null;

  // 노드 id를 기준으로 자신 + 모든 하위 id 수집
  const getDescendantIds = useCallback((nodeId) => {
    const ids = new Set();
    const walk = (nodes) => {
      nodes.forEach(n => {
        if (n.id === parseInt(nodeId)) {
          // 자신과 하위 전부 수집
          const collectAll = (node) => {
            ids.add(node.id);
            (node.children || []).forEach(collectAll);
          };
          collectAll(n);
        } else {
          walk(n.children || []);
        }
      });
    };
    walk(catTree);
    return ids;
  }, [catTree]);

  const filterIds = filterCatId ? getDescendantIds(filterCatId) : null;
  const sortProductsByCategory = (list) => [...list].sort((a, b) => {
    const catA = catPathMap[a.categoryId] || 'zzz 미분류';
    const catB = catPathMap[b.categoryId] || 'zzz 미분류';
    const catCmp = catA.localeCompare(catB, 'ko');
    if (catCmp !== 0) return catCmp;
    const nameCmp = (a.productName || '').localeCompare(b.productName || '', 'ko');
    if (nameCmp !== 0) return nameCmp;
    return (a.productCode || '').localeCompare(b.productCode || '', 'ko');
  });

  const filterList = (list) => {
    const q = search.toLowerCase();
    return sortProductsByCategory(list.filter(p => {
      if (filterIds && !(p.categoryId && filterIds.has(p.categoryId))) return false;
      if (!q) return true;
      return (
        (p.productName || '').toLowerCase().includes(q) ||
        (p.productCode || '').toLowerCase().includes(q) ||
        (p.specification || '').toLowerCase().includes(q) ||
        (p.codes || []).some(c => c.codeValue.toLowerCase().includes(q))
      );
    }));
  };

  const filtered  = filterList(products);
  const filteredI = filterList(inactive);
  const filteredDrafts = filterList(drafts);

  const formTitle = editing && !isClone
    ? `수정 — ${editing.productCode}`
    : isClone
      ? `복사 등록 (${editing?.productCode || ''} 기반)`
      : '신규 품목 등록';

  // ── 렌더 ──
  return (
    <div>
      <SectionHeader title="품목 관리" subtitle="품목 마스터 등록·수정·관리 (ITM 자동코드 / 다중코드 지원)" />

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

        {/* ── 왼쪽: 목록 ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 탭 */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid #21262d' }}>
            {[
              ['active', '활성 목록', products.length],
              ['mapping', '품목 매핑', drafts.length],
              ['inactive', '비활성 목록', inactive.length]
            ].map(([v, label, cnt]) => (
              <button key={v} onClick={() => { setView(v); setSearch(''); }} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '8px 18px',
                fontSize: 13, fontWeight: view === v ? 700 : 400,
                color: view === v ? '#e6edf3' : '#8b949e',
                borderBottom: view === v ? '2px solid #58a6ff' : '2px solid transparent', marginBottom: -1,
              }}>
                {label}
                <span style={{ 
                  marginLeft: 6, fontSize: 11, padding: '1px 6px', borderRadius: 10, 
                  background: v === 'inactive' ? '#3a1a1a' : v === 'mapping' ? '#0d2044' : '#1a3a2a', 
                  color: v === 'inactive' ? '#f85149' : v === 'mapping' ? '#58a6ff' : '#3fb950' 
                }}>{cnt}</span>
              </button>
            ))}
            {/* 폼 닫혀있을 때 등록 버튼 */}
            {!showForm && (
              <button onClick={openAdd} style={{ marginLeft: 'auto', background: '#238636', border: 'none', color: '#fff', padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ 품목 등록</button>
            )}
          </div>

          {/* 카테고리 필터 */}
          <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#58a6ff', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>카테고리 필터</span>
              {filterCatId && (
                <>
                  <span style={{ fontSize: 11, color: '#8b949e' }}>—</span>
                  <span style={{ fontSize: 11, color: '#c9d1d9', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {catPathMap[filterCatId] || `ID ${filterCatId}`}
                  </span>
                  <button onClick={() => setFilterCat({ l1: '', l2: '', l3: '', l4: '', l5: '' })} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '1px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>✕ 초기화</button>
                </>
              )}
            </div>
            <CascadeCatSelect tree={catTree} catSel={filterCat} onChange={setFilterCat} compact />
          </div>

          {/* 검색 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="품목명, ITM코드, 상품명, 바코드 검색" style={{ ...inputStyle, maxWidth: 280 }} />
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8b949e', alignSelf: 'center' }}>
              {view === 'active' ? `${filtered.length} / ${products.length}건` : view === 'mapping' ? `${filteredDrafts.length} / ${drafts.length}건` : `${filteredI.length} / ${inactive.length}건`}
            </span>
          </div>

          {/* 테이블 */}
          <div style={{ background: '#161b22', border: `1px solid ${view === 'inactive' ? '#3a1a1a' : view === 'mapping' ? '#0d2044' : '#21262d'}`, borderRadius: 8, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: showForm ? 600 : 900 }}>
              <thead style={{ background: '#1c2128' }}>
                <tr>
                  {['ITM코드', '품목명 / 상품명', showForm ? null : '코드', '카테고리', '전체/창고별 재고', '안전재고', ''].filter(Boolean).map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: '#8b949e', fontWeight: 500, borderBottom: '1px solid #21262d', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(view === 'active' ? filtered : view === 'mapping' ? filteredDrafts : filteredI).map((p, i) => (
                  <tr key={p.id} style={{ background: i % 2 === 0 ? '#0d1117' : '#161b22', borderBottom: '1px solid #21262d' }}>
                    <td style={{ padding: '10px 12px', color: '#58a6ff', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {p.productCode}
                      {p.isDraft && <span style={{ marginLeft: 6, fontSize: 10, color: '#e3b341', border: '1px solid #9e6a03', borderRadius: 3, padding: '1px 4px' }}>임시</span>}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <ProductNameSpec item={p} nameStyle={{ color: '#e6edf3', fontWeight: 500 }} />
                    </td>
                    {!showForm && (
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {(p.codes || []).slice(0, 2).map((c, ci) => (
                            <span
                              key={ci}
                              onClick={e => { e.stopPropagation(); handlePrintBarcode(p, c); }}
                              title={c.codeType === 'barcode' ? '라벨 출력' : undefined}
                              style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: CODE_TYPE_COLOR[c.codeType] + '18', color: CODE_TYPE_COLOR[c.codeType], border: `1px solid ${CODE_TYPE_COLOR[c.codeType]}44`, fontFamily: 'monospace', cursor: c.codeType === 'barcode' ? 'pointer' : 'default' }}
                            >{c.codeValue}</span>
                          ))}
                          {(p.codes || []).length > 2 && <span style={{ fontSize: 11, color: '#8b949e' }}>+{p.codes.length - 2}</span>}
                          {(p.codes || []).length === 0 && <span style={{ color: '#444c56', fontSize: 11 }}>—</span>}
                        </div>
                      </td>
                    )}
                    <td style={{ padding: '10px 12px', color: '#8b949e', fontSize: 11 }}>
                      {catPathMap[p.categoryId]
                        ? catPathMap[p.categoryId].split(' › ').slice(-2).join(' › ')
                        : <span style={{ color: '#444c56' }}>미분류</span>}
                    </td>
                    <td style={{ padding: '10px 12px', minWidth: 170 }}>
                      <div style={{ fontWeight: 700, color: p.currentStock === 0 ? '#f85149' : p.currentStock <= (p.safetyStock || 0) ? '#e3b341' : '#3fb950', marginBottom: 5 }}>
                        전체 {p.currentStock} <span style={{ color: '#8b949e', fontSize: 11, fontWeight: 500 }}>{p.unit}</span>
                      </div>
                      {(p.warehouseStocks || []).length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {sortWarehouseStocksForDisplay(p.warehouseStocks || [], deptWarehouses).map(ws => (
                            <span key={ws.warehouseId} style={{ border: '1px solid #30363d', borderRadius: 4, padding: '1px 6px', color: '#c9d1d9', background: '#0d1117', whiteSpace: 'nowrap', fontSize: 11 }}>
                              {ws.warehouse?.warehouseName || `창고 #${ws.warehouseId}`} {parseInt(ws.currentStock, 10) || 0}
                            </span>
                          ))}
                        </div>
                      ) : <span style={{ color: '#444c56', fontSize: 11 }}>창고별 재고 없음</span>}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#8b949e' }}>
                      {p.safetyStock ? <>{p.safetyStock} <span style={{ fontSize: 11 }}>{p.unit}</span></> : <span style={{ color: '#444c56' }}>-</span>}
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {view === 'inactive' ? (
                        <>
                          <button onClick={() => handleRestore(p.id, p.productName)} style={{ background: 'none', border: '1px solid #238636', color: '#3fb950', padding: '2px 7px', borderRadius: 4, cursor: 'pointer', fontSize: 11, marginRight: 4 }}>복구</button>
                          <button onClick={() => handleDeletePermanent(p.id, p.productName)} style={{ background: 'none', border: '1px solid #3a1a1a', color: '#f85149', padding: '2px 7px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>영구삭제</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => openClone(p)} title="이 품목 기반으로 신규 등록" style={{ background: 'none', border: '1px solid #1158b7', color: '#58a6ff', padding: '2px 7px', borderRadius: 4, cursor: 'pointer', fontSize: 11, marginRight: 4 }}>복사</button>
                          <button onClick={() => openEdit(p)} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '2px 7px', borderRadius: 4, cursor: 'pointer', fontSize: 11, marginRight: 4 }}>수정</button>
                          <button onClick={() => handleDelete(p.id, p.productName)} style={{ background: 'none', border: '1px solid #3a1a1a', color: '#f85149', padding: '2px 7px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>비활성화</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(view === 'active' ? filtered : view === 'mapping' ? filteredDrafts : filteredI).length === 0 && (
              <p style={{ textAlign: 'center', color: '#8b949e', padding: 40 }}>
                {view === 'inactive' ? '비활성화된 품목이 없습니다' : view === 'mapping' ? '매핑 대기 중인 품목이 없습니다 (GW 매핑에서 등록하세요)' : '품목이 없습니다'}
              </p>
            )}
          </div>
        </div>

        {/* ── 오른쪽: 등록/수정 폼 패널 ── */}
        {showForm && (
          <div style={{ width: 440, flexShrink: 0, background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: '16px 18px', position: 'sticky', top: 16, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}>

            {/* 패널 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>{formTitle}</div>
                {isClone && <div style={{ fontSize: 11, color: '#58a6ff', marginTop: 2 }}>기존 정보 불러옴 — 수정 후 신규 등록</div>}
              </div>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {/* 중복 에러 배너 */}
            {dupError && (
              <div style={{ background: '#3a1a1a', border: '1px solid #f85149', borderRadius: 6, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: '#f85149', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 14 }}>✕</span>
                <span>{dupError}</span>
              </div>
            )}

            {/* 기본 정보 */}
            <div style={{ fontSize: 10, color: '#58a6ff', fontWeight: 700, letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>기본 정보</div>
            <Field label="품목명 *">
              <input value={form.productName} onChange={e => { setForm(f => ({ ...f, productName: e.target.value })); setDupError(''); }}
                style={inputStyle} placeholder="예: A4 복사용지" />
            </Field>
            <Field label="상품명">
              <input value={form.specification} onChange={e => { setForm(f => ({ ...f, specification: e.target.value })); setDupError(''); }}
                style={inputStyle} placeholder="예: 80g, A4, 500매" />
            </Field>

            {/* 카테고리 + 빠른 추가 */}
            <Field label="카테고리">
              <CascadeCatSelect tree={catTree} catSel={catSel} onChange={setCatSel} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                {form.categoryId ? (
                  <div style={{ flex: 1, fontSize: 11, color: '#58a6ff', padding: '4px 8px', background: '#0d2044', borderRadius: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {catPathMap[form.categoryId] || `ID ${form.categoryId}`}
                  </div>
                ) : (
                  <div style={{ flex: 1, fontSize: 11, color: '#444c56', padding: '4px 8px' }}>미선택</div>
                )}
                <button onClick={openCatAdd} title="새 카테고리 추가" style={{ background: 'none', border: '1px solid #238636', color: '#3fb950', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>+ 카테고리 추가</button>
              </div>
            </Field>
            <Field label="창고 지정 *">
              <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, padding: '10px 12px' }}>
                {!selectedDeptId ? (
                  <div style={{ fontSize: 12, color: '#8b949e' }}>먼저 카테고리를 선택하세요.</div>
                ) : deptWarehouses.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#f85149' }}>해당 부서에 등록된 창고가 없습니다.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {deptWarehouses.map(w => {
                      const row = (form.warehouseStocks || []).find(x => String(x.warehouseId) === String(w.id));
                      const checked = !!row;
                      return (
                        <label key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#c9d1d9' }}>
                          <input type="checkbox" checked={checked} onChange={e => toggleWarehouse(w.id, e.target.checked)} style={{ accentColor: '#58a6ff' }} />
                          <span>{w.warehouseName}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="단위 *">
                <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} style={inputStyle}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
              <Field label="기준 단가 (원) *">
                <input type="number" min="0" step="1" value={form.unitPrice} onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value === '' ? '' : e.target.value }))} style={inputStyle} />
              </Field>
            </div>
            <Field label="카테고리 안전재고 (자동 적용)">
              {!form.categoryId ? (
                <div style={{ fontSize: 12, color: '#8b949e', padding: '6px 0' }}>카테고리 선택 후 자동 설정됩니다.</div>
              ) : (form.warehouseStocks || []).length === 0 ? (
                <div style={{ fontSize: 12, color: '#8b949e', padding: '6px 0' }}>
                  창고를 선택하면 카테고리 안전재고가 자동 적용됩니다.
                  {selectedCatSafety !== null && <span style={{ color: '#58a6ff', marginLeft: 4 }}>(기본: {selectedCatSafety})</span>}
                </div>
              ) : (
                <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '8px 12px' }}>
                  {(form.warehouseStocks || []).map(ws => {
                    const wh = deptWarehouses.find(w => String(w.id) === String(ws.warehouseId));
                    const cwEntry = catWareStocks.find(s => parseInt(s.warehouseId, 10) === parseInt(ws.warehouseId, 10));
                    const safety = cwEntry !== undefined ? parseInt(cwEntry.safetyStock, 10) : (selectedCatSafety ?? 0);
                    return (
                      <div key={ws.warehouseId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: '#c9d1d9' }}>{wh?.warehouseName || `창고 #${ws.warehouseId}`}</span>
                        <span style={{ color: '#58a6ff', fontWeight: 600 }}>{safety}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
                카테고리에서 설정한 창고별 안전재고가 자동 적용됩니다. 변경은 카테고리 관리에서 하세요.
              </div>
            </Field>
            <Field label="비고">
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} placeholder="메모 (선택)" />
            </Field>

            {/* 코드 매핑 */}
            <div style={{ marginTop: 14, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, color: '#58a6ff', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>코드 매핑</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={addCode} style={{ background: 'none', border: '1px solid #238636', color: '#3fb950', padding: '2px 9px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>+ 추가</button>
                <button onClick={handleGenerateBarcode} disabled={barcodeGenerating} style={{ background: 'none', border: '1px solid #1158b7', color: barcodeGenerating ? '#8b949e' : '#58a6ff', padding: '2px 9px', borderRadius: 4, cursor: barcodeGenerating ? 'wait' : 'pointer', fontSize: 11 }}>바코드 생성</button>
              </div>
            </div>
            {form.codes.length === 0 && <div style={{ fontSize: 11, color: '#444c56', marginBottom: 8 }}>바코드·거래처코드 없음</div>}
            {form.codes.map((c, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 26px', gap: 5, marginBottom: 6, alignItems: 'center' }}>
                <select value={c.codeType} onChange={e => updateCode(i, 'codeType', e.target.value)} style={{ ...inputStyle, padding: '6px 8px', fontSize: 11 }}>
                  <option value="barcode">바코드</option>
                  <option value="vendor">거래처코드</option>
                  <option value="internal">내부코드</option>
                </select>
                <input value={c.codeValue} onChange={e => updateCode(i, 'codeValue', e.target.value)} style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 11 }}
                  placeholder={c.codeType === 'barcode' ? '8901234...' : c.codeType === 'vendor' ? '거래처 품번' : '내부번호'} />
                <button onClick={() => removeCode(i)} style={{ background: 'none', border: '1px solid #3a1a1a', color: '#f85149', borderRadius: 4, cursor: 'pointer', fontSize: 13, height: 30 }}>×</button>
              </div>
            ))}

            {!editing && (
              <div style={{ marginTop: 8, padding: '7px 10px', background: '#0d1117', border: '1px solid #21262d', borderRadius: 5, fontSize: 11, color: '#8b949e' }}>
                품목코드(ITM-XXXXXX)는 저장 시 자동 생성됩니다
              </div>
            )}

            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              <SaveBtn onClick={() => doSave(false)} loading={loading} label={editing && !isClone ? '수정 저장' : '등록'} />
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>취소</button>
            </div>
          </div>
        )}
      </div>

      {/* ─── 카테고리 빠른 추가 모달 ─── */}
      {catAddModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}
          onClick={() => setCatAddModal(null)}>
          <div style={{ background: '#161b22', border: '1px solid #238636', borderRadius: 10, width: 360, padding: '22px 24px' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#3fb950', marginBottom: 4 }}>카테고리 추가</div>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 14 }}>
              L{catAddModal.addLevel} 추가 — 상위: <span style={{ color: '#c9d1d9' }}>{catAddModal.parentName}</span>
            </div>
            <Field label={`카테고리명 (L${catAddModal.addLevel}) *`}>
              <input value={catAddName} onChange={e => setCatAddName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleQuickAddCat()}
                style={inputStyle} placeholder="카테고리 이름 입력" autoFocus />
            </Field>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <SaveBtn onClick={handleQuickAddCat} loading={catAddSaving} label="추가" />
              <button onClick={() => setCatAddModal(null)} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 유사 품목 경고 모달 ─── */}
      {dupModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
          onClick={() => setDupModal(null)}>
          <div style={{ background: '#161b22', border: '1px solid #e3b341', borderRadius: 10, width: 480, padding: '24px 28px' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 18 }}>⚠</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#e3b341' }}>유사 품목이 존재합니다</span>
            </div>
            <p style={{ fontSize: 13, color: '#8b949e', marginBottom: 12 }}>아래 품목과 이름 또는 상품명이 유사합니다. 중복 등록을 확인하세요.</p>
            <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, overflow: 'hidden', marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ background: '#1c2128' }}>
                  <tr>{['ITM코드', '품목명', '상품명', '단위'].map(h => <th key={h} style={{ padding: '8px 10px', color: '#8b949e', fontWeight: 500, textAlign: 'left' }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {(dupModal.similar || []).map(p => (
                    <tr key={p.id} style={{ borderTop: '1px solid #21262d' }}>
                      <td style={{ padding: '7px 10px', color: '#58a6ff', fontFamily: 'monospace' }}>{p.productCode}</td>
                      <td style={{ padding: '7px 10px', color: '#e6edf3' }}><ProductNameSpec item={p} nameStyle={{ color: '#e6edf3' }} /></td>
                      <td style={{ padding: '7px 10px', color: '#8b949e' }}>{p.specification || '—'}</td>
                      <td style={{ padding: '7px 10px', color: '#8b949e' }}>{p.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDupModal(null)} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>취소 (다시 확인)</button>
              <button onClick={() => { setDupModal(null); doSave(true); }} style={{ background: '#3a2e00', border: '1px solid #e3b341', color: '#e3b341', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>그래도 등록</button>
            </div>
          </div>
        </div>
      )}

      {confirmModal && <ConfirmModal {...confirmModal} onCancel={() => setConfirmModal(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  카테고리 관리 패널 — 5단계 계층 트리
//  L1=부서  L2=자산유형(고정)  L3=대분류  L4=중분류  L5=소분류
// ─────────────────────────────────────────────────────────────────
const LEVEL_LABEL = ['', '부서(L1)', '분류(L2)', '대분류(L3)', '중분류(L4)', '소분류(L5)'];

const formatWon = (value) => `${Number(value || 0).toLocaleString()}원`;
const sourceLabel = (source) => {
  const type = source?.type || 'manual';
  if (type === 'compuzone') return '컴퓨존';
  if (type === 'external') return '외부';
  return '수동';
};
const sourceBadgeColor = (source) => {
  const type = source?.type || 'manual';
  if (type === 'compuzone') return 'blue';
  if (type === 'external') return 'purple';
  return 'gray';
};
const productImageUrl = (product) => product?.source?.thumbnailUrl || product?.source?.imageUrl || '';
const productLabel = (product) => [product?.productName, product?.specification].filter(Boolean).join(' / ');

function ProductThumb({ product, onOpen }) {
  const src = productImageUrl(product);
  return (
    <button
      type="button"
      onClick={() => src && onOpen && onOpen(product)}
      title={src ? '이미지 크게 보기' : '이미지 없음'}
      style={{
        width: 54, height: 54, borderRadius: 6, border: '1px solid #30363d',
        background: '#0d1117', color: '#8b949e', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: src ? 'zoom-in' : 'default', padding: 0, flexShrink: 0,
      }}
    >
      {src ? (
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
      ) : (
        <span style={{ fontSize: 10, lineHeight: 1.3 }}>NO<br />IMG</span>
      )}
    </button>
  );
}

function ImagePreviewModal({ product, onClose }) {
  const src = productImageUrl(product);
  if (!product || !src) return null;
  return (
    <Modal title={productLabel(product) || '상품 이미지'} onClose={onClose} width={760}>
      <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 8, padding: 16, textAlign: 'center' }}>
        <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
      </div>
      {product.source?.productUrl && (
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <a href={product.source.productUrl} target="_blank" rel="noreferrer" style={{ color: '#58a6ff', fontSize: 13 }}>상품 페이지 열기</a>
        </div>
      )}
    </Modal>
  );
}

// 재귀 트리 노드
function TreeNode({ node, depth = 0, onAdd, onEdit, onDelete, onMove, onCart,
                    dragState, onDragStart, onDragEnter, onDragLeave, onDrop, onDragEnd,
                    closedIds, onToggle, canDropChild }) {
  const color = node.color || '#8b949e';
  const hasChildren = node.children && node.children.length > 0;
  const open = !closedIds?.has(node.id); // closedIds에 없으면 기본 펼침

  const isDragging   = dragState?.dragId === node.id;
  const isDropTarget = dragState?.overId === node.id;
  const dropPosition = isDropTarget ? dragState?.dropPosition : null; // 'child' | 'after'

  // 규칙: 레벨 무관 이동 가능, 단 이동 후 L5 초과/순환 구조는 금지
  const canDrop = canDropChild ? canDropChild(node, dragState) : false;

  // 같은 레벨이면 부모가 달라도 뒤에 배치 가능
  const canReorder = dragState?.dragId
    && dragState.dragId !== node.id
    && dragState.dragLevel === node.level;

  const isInteractive = canDrop || canReorder;

  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 10px', borderRadius: 6, marginBottom: 2,
    background: dropPosition === 'child' ? '#0d2044'
      : isDragging ? '#1c2128'
      : 'transparent',
    border: dropPosition === 'child' ? '1px dashed #58a6ff' : '1px solid transparent',
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
  };

  return (
    <div
      style={{ marginLeft: depth === 0 ? 0 : 16 }}
      onDragOver={isInteractive ? (e) => {
        e.preventDefault(); e.stopPropagation();
        onDragEnter(node, canDrop ? 'child' : 'after');
      } : undefined}
      onDragEnter={isInteractive ? (e) => {
        e.preventDefault(); e.stopPropagation();
        onDragEnter(node, canDrop ? 'child' : 'after');
      } : undefined}
      onDragLeave={isInteractive ? (e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        e.stopPropagation();
        onDragLeave(node.id); // 어떤 노드에서 벗어나는지 전달
      } : undefined}
      onDrop={isInteractive ? (e) => {
        e.preventDefault(); e.stopPropagation();
        onDrop(node, canDrop ? 'child' : 'after');
      } : undefined}
    >
      <div
        style={rowStyle}
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = 'move';
          onDragStart(node);
        }}
        onDragEnd={(e) => { e.stopPropagation(); onDragEnd && onDragEnd(); }}
        onMouseEnter={e => { if (!isDragging) e.currentTarget.style.background = '#1c2128'; }}
        onMouseLeave={e => { if (!isDropTarget || !canDrop) e.currentTarget.style.background = 'transparent'; }}
      >
        {/* 펼침 토글 */}
        <button onClick={() => onToggle && onToggle(node.id)} style={{
          background: 'none', border: 'none', color: '#8b949e', cursor: hasChildren ? 'pointer' : 'default',
          fontSize: 11, width: 16, flexShrink: 0, padding: 0,
        }}>{hasChildren ? (open ? '▾' : '▸') : '·'}</button>

        <span style={{ fontSize: 11, color: '#444c56', cursor: 'grab', userSelect: 'none', flexShrink: 0 }} title="드래그하여 이동">⠿</span>

        {/* 레벨 인디케이터 */}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
          background: color + '22', color, border: `1px solid ${color}44`, flexShrink: 0,
        }}>L{node.level}</span>

        {/* 이름 */}
        <span style={{ fontSize: 13, color: node.level === 1 ? '#e6edf3' : '#c9d1d9', fontWeight: node.level === 1 ? 600 : 400, flex: 1 }}>
          {node.name}
          {node.code && <span style={{ marginLeft: 6, fontSize: 10, color: '#8b949e' }}>{node.code}</span>}
        </span>

        {/* 자식 수 */}
        {hasChildren && <span style={{ fontSize: 11, color: '#444c56' }}>{node.children.length}</span>}

        {/* 드롭 힌트 */}
        {dropPosition === 'child' && (
          <span style={{ fontSize: 11, color: '#58a6ff', fontWeight: 700 }}>여기 하위로</span>
        )}
        {dropPosition === 'after' && (
          <span style={{ fontSize: 11, color: '#3fb950', fontWeight: 700 }}>아래로 이동</span>
        )}

        {/* 액션 버튼 */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
          {node.level < 5 && (
            <button onClick={() => onAdd(node)} title={`L${node.level + 1} 추가`} style={{
              background: 'none', border: '1px solid #238636', color: '#3fb950',
              padding: '2px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 11,
            }}>+ 하위</button>
          )}
          {node.level > 1 && (
            <button onClick={() => onMove(node)} title="이동 (선택)" style={{
              background: 'none', border: '1px solid #1158b7', color: '#58a6ff',
              padding: '2px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 11,
            }}>이동</button>
          )}
          <button onClick={() => onCart && onCart(node)} title="이 카테고리 품목을 장바구니에 담기" style={{
            background: 'none', border: '1px solid #9e6a03', color: '#e3b341',
            padding: '2px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 11,
          }}>담기</button>
          <button onClick={() => onEdit(node)} style={{
            background: 'none', border: '1px solid #30363d', color: '#8b949e',
            padding: '2px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 11,
          }}>수정</button>
          <button onClick={() => onDelete(node)} style={{
            background: 'none', border: '1px solid #3a1a1a', color: '#f85149',
            padding: '2px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 11,
          }}>×</button>
        </div>
      </div>

      {/* 순서 변경 드롭 인디케이터 (파란 가로선) */}
      {dropPosition === 'after' && (
        <div style={{ height: 2, background: '#3fb950', borderRadius: 1, margin: '0 8px 2px 8px' }} />
      )}

      {/* 자식 노드 */}
      {open && hasChildren && (
        <div style={{ borderLeft: `1px solid ${color}33`, marginLeft: 18, paddingLeft: 4 }}>
          {node.children.map(child => (
            <TreeNode key={child.id} node={child} depth={depth + 1}
              onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onMove={onMove} onCart={onCart}
              dragState={dragState} onDragStart={onDragStart}
              onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDrop={onDrop} onDragEnd={onDragEnd}
              closedIds={closedIds} onToggle={onToggle} canDropChild={canDropChild} />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoriesPanel({ showMsg, currentUser }) {
  const [view,         setView]         = useState('active');
  const [tree,         setTree]         = useState([]);
  const [inactiveCats, setInactiveCats] = useState([]);
  const [allDepts,     setAllDepts]     = useState([]);
  const [allWarehouses, setAllWarehouses] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [confirmModal, setConfirmModal] = useState(null);
  const [modal,        setModal]        = useState(null);
  const [form,         setForm]         = useState({ name: '', code: '', color: '#58a6ff', accessDeptIds: [], warehouseStocks: [] });
  const [saving,       setSaving]       = useState(false);
  // 이동 모달: { node, candidates: [{id,name,path}], selectedId }
  const [moveModal,    setMoveModal]    = useState(null);
  const [purchaseModal, setPurchaseModal] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  // 드래그 상태: { dragId, dragLevel, dragParentId, overId }
  const [dragState,    setDragState]    = useState(null);
  // 접힌 노드 ID Set — 없으면 기본 펼침
  const [closedIds,    setClosedIds]    = useState(new Set());
  // 트리 컨테이너 스크롤 위치 유지용
  const treeContainerRef = useRef(null);
  const isSystemAdmin = currentUser?.role === 'admin';

  const flattenTree = useCallback((nodes, out = []) => {
    (nodes || []).forEach(n => {
      out.push(n);
      if (n.children?.length) flattenTree(n.children, out);
    });
    return out;
  }, []);

  const getDescendantIdSet = useCallback((rootId) => {
    const ids = new Set();
    const walk = (nodes) => {
      (nodes || []).forEach(n => {
        if (n.id === rootId) {
          const collect = (node) => {
            ids.add(node.id);
            (node.children || []).forEach(collect);
          };
          collect(n);
          return;
        }
        if (n.children?.length) walk(n.children);
      });
    };
    walk(tree);
    return ids;
  }, [tree]);

  const canMoveUnderParent = useCallback((movingNode, parentNode) => {
    if (!movingNode || !parentNode) return false;
    if (movingNode.id === parentNode.id) return false;
    if (parentNode.level >= 5) return false;
    const descendantIds = getDescendantIdSet(movingNode.id);
    if (descendantIds.has(parentNode.id)) return false;
    const all = flattenTree(tree, []);
    const subtree = all.filter(n => descendantIds.has(n.id));
    const delta = (parentNode.level + 1) - movingNode.level;
    const exceeds = subtree.some(n => (n.level + delta) > 5 || (n.level + delta) < 1);
    return !exceeds;
  }, [tree, flattenTree, getDescendantIdSet]);

  const parseIds = (raw, fallbackId) => {
    let arr = [];
    if (Array.isArray(raw)) arr = raw;
    else if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) arr = parsed;
      } catch (_) { arr = []; }
    }
    const ids = Array.from(new Set((arr || []).map(v => parseInt(v, 10)).filter(v => Number.isInteger(v) && v > 0)));
    if (!ids.length && fallbackId) return [parseInt(fallbackId, 10)];
    return ids;
  };

  const handleToggle = (nodeId) => {
    setClosedIds(prev => {
      const next = new Set(prev);
      next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId);
      return next;
    });
  };

  const loadAll = useCallback(async () => {
    // 스크롤 위치 저장
    const scrollTop = treeContainerRef.current?.scrollTop ?? 0;
    setLoading(true);
    try {
      const reqs = [categoriesAPI.getTree(), categoriesAPI.getInactive(), warehousesAPI.getAll()];
      if (isSystemAdmin) reqs.push(categoriesAPI.getAllDepts());
      const [tr, inc, whRes, deptsRes] = await Promise.all(reqs);
      setTree(tr.data || []);
      setInactiveCats(inc.data || []);
      setAllWarehouses((whRes?.data || []).filter(w => w.isActive !== false));
      if (isSystemAdmin) setAllDepts((deptsRes?.data) || []);
    } catch { showMsg('로드 실패', 'error'); }
    finally {
      setLoading(false);
      // 다음 렌더 후 스크롤 복원
      requestAnimationFrame(() => {
        if (treeContainerRef.current) treeContainerRef.current.scrollTop = scrollTop;
      });
    }
  }, [showMsg, isSystemAdmin]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const openAddDept = () => { setForm({ name: '', code: '', color: '#58a6ff', accessDeptIds: [], warehouseStocks: [] }); setModal({ mode: 'addDept' }); };
  const openAdd     = (parentNode) => { setForm({ name: '', code: '', color: '#58a6ff', accessDeptIds: [], warehouseStocks: [] }); setModal({ mode: 'add', node: parentNode }); };
  const openEdit    = async (node) => {
    setForm({
      name: node.name,
      code: node.code || '',
      color: node.color || '#58a6ff',
      accessDeptIds: node.level === 1 ? parseIds(node.accessDeptIds, node.id) : [],
      warehouseStocks: [],
    });
    setModal({ mode: 'edit', node });
    // 창고별 안전재고 로드
    try {
      const r = await categoriesAPI.getWarehouseStocks(node.id);
      const stocks = (r.data || []).map(s => ({ warehouseId: parseInt(s.warehouseId, 10), safetyStock: parseInt(s.safetyStock, 10) || 0 }));
      setForm(f => ({ ...f, warehouseStocks: stocks }));
    } catch (_) {}
  };
  const openDelete  = (node) => {
    setConfirmModal({
      message: `"${node.name}" 을(를) 비활성화하시겠습니까?`,
      subMessage: '하위 카테고리도 함께 비활성화됩니다.',
      confirmLabel: '비활성화', confirmColor: '#b62324',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await categoriesAPI.delete(node.id);
          showMsg('비활성화 완료'); loadAll();
        } catch (e) { showMsg(e.response?.data?.error || '삭제 실패', 'error'); }
      },
    });
  };

  const openMove = (node) => {
    // 이동 대상: 레벨 무관(단 L5 초과 금지), 자기 자신/하위 제외
    const all = flattenTree(tree, []);
    const candidates = all.filter(c =>
      c.id !== node.parentId &&
      c.id !== node.id &&
      canMoveUnderParent(node, c)
    );
    setMoveModal({ node, candidates, selectedId: candidates[0]?.id || '' });
  };

  const openPurchasePicker = async (node) => {
    setPurchaseModal({ node, loading: true, products: [], selected: {}, quantities: {} });
    try {
      const res = await purchaseCartAPI.getCatalog({ categoryId: node.id, includeDescendants: 1 });
      const products = res.data?.products || [];
      if (products.length === 0) {
        setPurchaseModal(null);
        showMsg('이 카테고리에 장바구니에 담을 품목이 없습니다', 'error');
        return;
      }
      const selected = {};
      const quantities = {};
      products.forEach((p, idx) => {
        selected[p.id] = products.length === 1 || idx === 0;
        quantities[p.id] = 1;
      });
      setPurchaseModal({ node, loading: false, products, selected, quantities });
    } catch (e) {
      setPurchaseModal(null);
      showMsg(e.response?.data?.error || '구매 품목 로드 실패', 'error');
    }
  };

  const setPurchaseSelected = (productId, checked) => {
    setPurchaseModal(m => m ? ({ ...m, selected: { ...m.selected, [productId]: checked } }) : m);
  };

  const setPurchaseQuantity = (productId, value) => {
    const quantity = Math.max(1, parseInt(value, 10) || 1);
    setPurchaseModal(m => m ? ({ ...m, quantities: { ...m.quantities, [productId]: quantity } }) : m);
  };

  const refreshPurchaseImage = async (product) => {
    try {
      await purchaseCartAPI.refreshImage(product.id, { sourceId: product.source?.id || undefined });
      const res = await purchaseCartAPI.getCatalog({ categoryId: purchaseModal.node.id, includeDescendants: 1 });
      const products = res.data?.products || [];
      setPurchaseModal(m => m ? ({ ...m, products }) : m);
      showMsg('이미지 갱신 완료');
    } catch (e) {
      showMsg(e.response?.data?.error || '이미지 갱신 실패', 'error');
    }
  };

  const addSelectedToCart = async () => {
    if (!purchaseModal) return;
    const selectedProducts = (purchaseModal.products || []).filter(p => purchaseModal.selected?.[p.id]);
    if (selectedProducts.length === 0) return showMsg('담을 품목을 선택하세요', 'error');
    try {
      for (const product of selectedProducts) {
        await purchaseCartAPI.addItem({
          productId: product.id,
          sourceId: product.source?.id || undefined,
          quantity: purchaseModal.quantities?.[product.id] || 1,
        });
      }
      showMsg(`${selectedProducts.length}개 품목을 장바구니에 담았습니다`);
      setPurchaseModal(null);
    } catch (e) {
      showMsg(e.response?.data?.error || '장바구니 담기 실패', 'error');
    }
  };

  const handleMoveConfirm = async () => {
    if (!moveModal?.selectedId) return showMsg('이동할 위치를 선택하세요', 'error');
    try {
      await categoriesAPI.move(moveModal.node.id, moveModal.selectedId);
      showMsg(`"${moveModal.node.name}" 이동 완료`);
      setMoveModal(null);
      loadAll();
    } catch (e) { showMsg(e.response?.data?.error || '이동 실패', 'error'); }
  };

  // ── 드래그 앤 드롭 핸들러 ──────────────────────────────────────────
  const handleDragStart = (node) => {
    const desc = Array.from(getDescendantIdSet(node.id));
    const all = flattenTree(tree, []);
    const maxLevel = all.filter(n => desc.includes(n.id)).reduce((m, n) => Math.max(m, n.level), node.level);
    setDragState({
      dragId: node.id,
      dragLevel: node.level,
      dragParentId: node.parentId,
      dragDescendantIds: desc,
      dragMaxLevel: maxLevel,
      overId: null,
      dropPosition: null
    });
  };
  const handleDragEnter = (node, position = 'child') => {
    setDragState(s => s ? { ...s, overId: node.id, dropPosition: position } : s);
  };
  const handleDragLeave = (nodeId) => {
    // dragenter(새 대상)가 먼저 실행되어 overId가 이미 바뀌었으면 무시
    setDragState(s => {
      if (!s || s.overId !== nodeId) return s;
      return { ...s, overId: null, dropPosition: null };
    });
  };
  const handleDragEnd = () => setDragState(null);
  const handleDrop = async (targetNode, position = 'child') => {
    if (!dragState) return;
    const draggedId = dragState.dragId;
    setDragState(null);
    try {
      if (position === 'after') {
        // 같은 부모든 다른 부모든 move-after 엔드포인트로 통합 처리
        await categoriesAPI.moveAfter(draggedId, targetNode.id);
        showMsg('이동 완료');
      } else {
        if (!canDropChild(targetNode, dragState)) {
          showMsg('이동하면 레벨이 L5를 초과합니다. 다른 위치를 선택하세요.', 'error');
          return;
        }
        await categoriesAPI.move(draggedId, targetNode.id);
        showMsg('이동 완료');
      }
      loadAll();
    } catch (e) { showMsg(e.response?.data?.error || '이동 실패', 'error'); }
  };

  const canDropChild = useCallback((targetNode, drag) => {
    if (!drag?.dragId || !targetNode) return false;
    if (drag.dragLevel === 1) return false;
    if (drag.dragId === targetNode.id) return false;
    if (targetNode.level >= 5) return false;
    if (Array.isArray(drag.dragDescendantIds) && drag.dragDescendantIds.includes(targetNode.id)) return false;
    const delta = (targetNode.level + 1) - drag.dragLevel;
    return (drag.dragMaxLevel + delta) <= 5;
  }, []);

  const handleCatRestore = (cat) => {
    setConfirmModal({
      message: `"${cat.name}" 카테고리를 복구하시겠습니까?`,
      confirmLabel: '복구', confirmColor: '#238636',
      onConfirm: async () => {
        setConfirmModal(null);
        try { await categoriesAPI.restore(cat.id); showMsg('복구 완료'); loadAll(); }
        catch (e) { showMsg(e.response?.data?.error || '복구 실패', 'error'); }
      },
    });
  };

  const handleCatDeletePermanent = (cat) => {
    setConfirmModal({
      message: `"${cat.name}" 카테고리를 영구 삭제하시겠습니까?`,
      subMessage: '복구할 수 없습니다. 하위 카테고리가 있으면 먼저 처리하세요.',
      confirmLabel: '영구 삭제', confirmColor: '#b62324',
      onConfirm: async () => {
        setConfirmModal(null);
        try { await categoriesAPI.deletePermanent(cat.id); showMsg('영구 삭제 완료'); loadAll(); }
        catch (e) { showMsg(e.response?.data?.error || '삭제 실패', 'error'); }
      },
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) return showMsg('이름을 입력하세요', 'error');
    setSaving(true);
    try {
      let savedId = null;
      if (modal.mode === 'addDept') {
        const res = await categoriesAPI.createDept({
          name: form.name.trim(),
          code: form.code || undefined,
          color: form.color,
          accessDeptIds: Array.from(new Set((form.accessDeptIds || []).map(v => parseInt(v, 10)).filter(v => Number.isInteger(v) && v > 0))),
        });
        savedId = res.data?.id;
        showMsg(`부서 "${form.name}" 등록 완료`);
      } else if (modal.mode === 'add') {
        const newLevel = modal.node.level + 1;
        const res = await categoriesAPI.create({ name: form.name.trim(), level: newLevel, parentId: modal.node.id });
        savedId = res.data?.id;
        showMsg('등록 완료');
      } else {
        const payload = { name: form.name.trim(), code: form.code || undefined, color: form.color };
        if (modal.node.level === 1) {
          payload.accessDeptIds = Array.from(new Set((form.accessDeptIds || []).map(v => parseInt(v, 10)).filter(v => Number.isInteger(v) && v > 0)));
        }
        await categoriesAPI.update(modal.node.id, payload);
        savedId = modal.node.id;
        showMsg('수정 완료');
      }
      // 창고별 안전재고 저장
      if (savedId && (form.warehouseStocks || []).length > 0) {
        const validStocks = (form.warehouseStocks || [])
          .filter(s => Number.isInteger(parseInt(s.warehouseId, 10)) && parseInt(s.warehouseId, 10) > 0)
          .map(s => ({ warehouseId: parseInt(s.warehouseId, 10), safetyStock: Math.max(0, parseInt(s.safetyStock, 10) || 0) }));
        await categoriesAPI.setWarehouseStocks(savedId, validStocks);
      }
      setModal(null); loadAll();
    } catch (e) { showMsg(e.response?.data?.error || '저장 실패', 'error'); }
    finally { setSaving(false); }
  };

  // 모달 제목/안내
  const modalTitle = modal?.mode === 'addDept' ? '신규 부서(L1) 등록'
    : modal?.mode === 'add' ? `${LEVEL_LABEL[(modal?.node?.level || 0) + 1]} 추가 — 상위: ${modal?.node?.name}`
    : `"${modal?.node?.name}" 수정`;

  const showCode  = modal?.mode === 'addDept' || modal?.mode === 'edit';
  const showColor = modal?.mode === 'addDept' || modal?.mode === 'edit';
  const showAccess = isSystemAdmin && (modal?.mode === 'addDept' || (modal?.mode === 'edit' && modal?.node?.level === 1));

  // 모달에서 보여줄 창고 목록 — L1 루트의 accessDeptIds 기준으로 필터
  const modalWarehouses = (() => {
    if (!modal || modal.mode === 'addDept') return [];
    const flatAll = flattenTree(tree, []);
    const nodeId = modal.mode === 'edit' ? modal.node?.id : modal.node?.id; // parent for 'add'
    const findL1 = (id) => {
      let n = flatAll.find(x => x.id === id);
      while (n) {
        if (n.level === 1) return n;
        const parentId = n.parentId;
        n = parentId ? flatAll.find(x => x.id === parentId) : null;
      }
      return null;
    };
    const l1 = modal.node?.level === 1 ? modal.node : findL1(nodeId);
    if (!l1) return [];
    const accessIds = parseIds(l1.accessDeptIds, l1.id);
    return allWarehouses.filter(w => accessIds.includes(parseInt(w.deptId || 0, 10)));
  })();

  return (
    <div>
      <SectionHeader title="카테고리 관리"
        subtitle="5단계 계층: 부서(L1) › 분류(L2) › 대분류(L3) › 중분류(L4) › 소분류(L5)"
        action={view === 'active' ? <AddBtn onClick={openAddDept} label="+ 부서 추가" /> : null} />

      {/* ── 활성 / 비활성 탭 ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid #21262d' }}>
        {[['active','활성 목록', tree.length], ['inactive','비활성 목록', inactiveCats.length]].map(([v, label, cnt]) => (
          <button key={v} onClick={() => setView(v)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '8px 18px',
            fontSize: 13, fontWeight: view === v ? 700 : 400,
            color: view === v ? '#e6edf3' : '#8b949e',
            borderBottom: view === v ? '2px solid #58a6ff' : '2px solid transparent',
            marginBottom: -1,
          }}>
            {label}
            <span style={{
              marginLeft: 6, fontSize: 11, padding: '1px 6px', borderRadius: 10,
              background: v === 'inactive' ? '#3a1a1a' : '#1a3a2a',
              color: v === 'inactive' ? '#f85149' : '#3fb950',
            }}>{cnt}</span>
          </button>
        ))}
      </div>

      {/* 트리 뷰 (활성) */}
      {view === 'active' && (
        <div ref={treeContainerRef} style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: '12px 16px', minHeight: 200, overflowY: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#8b949e', padding: 40 }}>불러오는 중...</div>
          ) : tree.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#8b949e', padding: 40 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🗂</div>
              <div>등록된 부서가 없습니다</div>
              <div style={{ fontSize: 12, color: '#444c56', marginTop: 4 }}>상단의 "+ 부서 추가" 버튼으로 시작하세요</div>
            </div>
          ) : (
            tree.map(dept => (
              <div key={dept.id} style={{ marginBottom: 12, borderBottom: '1px solid #21262d', paddingBottom: 12 }}>
                <TreeNode node={dept} depth={0} onAdd={openAdd} onEdit={openEdit} onDelete={openDelete} onMove={openMove}
                  onCart={openPurchasePicker}
                  dragState={dragState} onDragStart={handleDragStart}
                  onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDrop={handleDrop} onDragEnd={handleDragEnd}
                  closedIds={closedIds} onToggle={handleToggle} canDropChild={canDropChild} />
              </div>
            ))
          )}
        </div>
      )}

      {/* 비활성 목록 */}
      {view === 'inactive' && (
        <div style={{ background: '#161b22', border: '1px solid #3a1a1a', borderRadius: 8, overflow: 'hidden' }}>
          {inactiveCats.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#8b949e', padding: 40 }}>비활성화된 카테고리가 없습니다</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: '#1c2128' }}>
                <tr>
                  {['레벨', '이름', '코드', '비활성화 일시', ''].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: '#8b949e', fontWeight: 500, borderBottom: '1px solid #21262d' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inactiveCats.map((cat, i) => (
                  <tr key={cat.id} style={{ background: i % 2 === 0 ? '#0d1117' : '#161b22', borderBottom: '1px solid #21262d' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 3, background: '#1c2128', color: '#8b949e', border: '1px solid #30363d' }}>
                        {LEVEL_LABEL[cat.level] || `L${cat.level}`}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#e6edf3' }}>{cat.name}</td>
                    <td style={{ padding: '10px 12px', color: '#8b949e', fontFamily: 'monospace', fontSize: 12 }}>{cat.code || '—'}</td>
                    <td style={{ padding: '10px 12px', color: '#444c56', fontSize: 12 }}>
                      {new Date(cat.updatedAt).toLocaleString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <button onClick={() => handleCatRestore(cat)}
                        style={{ background: 'none', border: '1px solid #238636', color: '#3fb950', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, marginRight: 6 }}>복구</button>
                      <button onClick={() => handleCatDeletePermanent(cat)}
                        style={{ background: 'none', border: '1px solid #3a1a1a', color: '#f85149', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>영구삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 등록/수정 모달 */}
      {modal && (
        <Modal title={modalTitle} onClose={() => setModal(null)} width={560}>
          <Field label="이름 *">
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              style={inputStyle} placeholder={modal.mode === 'addDept' ? 'IT Team, Production, General Affairs …' : '분류명 입력'} />
          </Field>
          {showCode && (
            <Field label="코드 (선택)">
              <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                style={inputStyle} placeholder="IT, PROD, GA …" />
            </Field>
          )}
          {showColor && (
            <Field label="색상">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  style={{ width: 40, height: 32, border: '1px solid #30363d', borderRadius: 4, cursor: 'pointer', background: 'none', padding: 2 }} />
                <input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  style={{ ...inputStyle, fontFamily: 'monospace', maxWidth: 120 }} placeholder="#58a6ff" />
                <span style={{ width: 24, height: 24, borderRadius: 12, background: form.color, border: '1px solid #30363d', flexShrink: 0 }} />
              </div>
            </Field>
          )}
          {showAccess && (
            <Field label="권한 부서 (L1 하위 전체에 상속)">
              <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, padding: '10px 12px', maxHeight: 180, overflowY: 'auto' }}>
                {allDepts.length === 0 ? (
                  <div style={{ color: '#8b949e', fontSize: 12 }}>부서 목록 로드 중...</div>
                ) : (
                  allDepts.map(d => {
                    const checked = (form.accessDeptIds || []).includes(d.id);
                    const isSelf = modal?.node?.level === 1 && modal?.node?.id === d.id;
                    return (
                      <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, color: '#c9d1d9', fontSize: 13, opacity: isSelf ? 0.75 : 1 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isSelf}
                          onChange={(e) => {
                            setForm(f => {
                              const prev = new Set((f.accessDeptIds || []).map(v => parseInt(v, 10)).filter(v => Number.isInteger(v) && v > 0));
                              if (e.target.checked) prev.add(d.id);
                              else prev.delete(d.id);
                              return { ...f, accessDeptIds: Array.from(prev) };
                            });
                          }}
                          style={{ accentColor: '#58a6ff' }}
                        />
                        <span>{d.name}{isSelf ? ' (자기 부서 기본 포함)' : ''}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </Field>
          )}
          {/* 창고별 안전재고 */}
          {(modal.mode === 'edit' || modal.mode === 'add') && (
            <Field label="창고별 안전재고">
              {modalWarehouses.length === 0 ? (
                <div style={{ fontSize: 12, color: '#8b949e', padding: '8px 0' }}>
                  {modal.mode === 'add' ? '상위 부서에 연결된 창고가 없습니다.' : '이 카테고리에 연결된 창고가 없습니다.'}
                </div>
              ) : (
                <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, padding: '10px 12px' }}>
                  {modalWarehouses.map(w => {
                    const entry = (form.warehouseStocks || []).find(s => parseInt(s.warehouseId, 10) === w.id);
                    return (
                      <div key={w.id} style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 13, color: '#c9d1d9' }}>{w.warehouseName}</span>
                        <input
                          type="number" min="0"
                          value={entry !== undefined ? entry.safetyStock : 0}
                          onChange={e => {
                            const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                            setForm(f => {
                              const stocks = [...(f.warehouseStocks || [])];
                              const idx = stocks.findIndex(s => parseInt(s.warehouseId, 10) === w.id);
                              if (idx >= 0) stocks[idx] = { ...stocks[idx], safetyStock: val };
                              else stocks.push({ warehouseId: w.id, safetyStock: val });
                              return { ...f, warehouseStocks: stocks };
                            });
                          }}
                          style={{ ...inputStyle, padding: '6px 8px', fontSize: 12 }}
                        />
                      </div>
                    );
                  })}
                  <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
                    이 카테고리에 속한 모든 품목에 창고별 안전재고가 동일하게 적용됩니다.
                  </div>
                </div>
              )}
            </Field>
          )}
          <SaveBtn onClick={handleSave} loading={saving} label={modal.mode === 'edit' ? '수정 저장' : '등록'} />
        </Modal>
      )}

      {purchaseModal && (
        <Modal title={`장바구니 담기 — ${purchaseModal.node?.name || ''}`} onClose={() => setPurchaseModal(null)} width={900}>
          {purchaseModal.loading ? (
            <div style={{ color: '#8b949e', padding: 32, textAlign: 'center' }}>품목을 불러오는 중...</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 }}>
                <div style={{ color: '#8b949e', fontSize: 12 }}>
                  {purchaseModal.products.length === 1
                    ? '수량을 정해서 장바구니에 담습니다.'
                    : '여러 품목 중 구매할 항목과 수량을 선택하세요.'}
                </div>
                <Badge color="blue">{purchaseModal.products.length}개 품목</Badge>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '58vh', overflowY: 'auto', paddingRight: 4 }}>
                {purchaseModal.products.map(product => {
                  const selected = !!purchaseModal.selected?.[product.id];
                  const source = product.source || {};
                  return (
                    <div key={product.id} style={{
                      display: 'grid',
                      gridTemplateColumns: '28px 58px minmax(220px, 1fr) 110px 86px 92px',
                      gap: 10,
                      alignItems: 'center',
                      background: selected ? '#0d2044' : '#0d1117',
                      border: `1px solid ${selected ? '#58a6ff' : '#30363d'}`,
                      borderRadius: 8,
                      padding: 10,
                    }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={e => setPurchaseSelected(product.id, e.target.checked)}
                        style={{ accentColor: '#58a6ff' }}
                      />
                      <ProductThumb product={product} onOpen={setImagePreview} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                          <span style={{ color: '#e6edf3', fontSize: 13, fontWeight: 700 }}>{product.productName}</span>
                          <Badge color={sourceBadgeColor(source)}>{sourceLabel(source)}</Badge>
                          {source.sourceCount > 1 && <Badge color="yellow">구매처 {source.sourceCount}</Badge>}
                        </div>
                        <div style={{ color: '#8b949e', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {product.specification || product.productCode}
                        </div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 5, fontSize: 11 }}>
                          {source.productUrl ? (
                            <a href={source.productUrl} target="_blank" rel="noreferrer" style={{ color: '#58a6ff' }}>상품 페이지</a>
                          ) : (
                            <span style={{ color: '#f0883e' }}>구매 URL 없음</span>
                          )}
                          <button onClick={() => refreshPurchaseImage(product)} style={{
                            background: 'none', border: 'none', padding: 0, color: '#8b949e', cursor: 'pointer', fontSize: 11,
                          }}>이미지 갱신</button>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', color: '#e6edf3', fontSize: 13, fontWeight: 700 }}>
                        {formatWon(product.unitPrice)}
                      </div>
                      <input
                        type="number"
                        min="1"
                        value={purchaseModal.quantities?.[product.id] || 1}
                        onChange={e => setPurchaseQuantity(product.id, e.target.value)}
                        style={{ ...inputStyle, padding: '6px 8px', fontSize: 13, textAlign: 'right' }}
                      />
                      <div style={{ textAlign: 'right', color: '#8b949e', fontSize: 12 }}>
                        재고 {Number(product.currentStock || 0).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button onClick={() => setPurchaseModal(null)} style={{
                  background: 'none', border: '1px solid #30363d', color: '#8b949e',
                  padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                }}>취소</button>
                <button onClick={addSelectedToCart} style={{
                  background: '#238636', border: '1px solid #2ea043', color: '#fff',
                  padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                }}>장바구니 담기</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* ── 이동 모달 ── */}
      {moveModal && (
        <Modal title={`"${moveModal.node.name}" 이동 — ${LEVEL_LABEL[moveModal.node.level]}`}
          onClose={() => setMoveModal(null)} width={460}>
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 16, lineHeight: 1.6 }}>
            레벨과 관계없이 다른 카테고리 하위로 이동할 수 있습니다.
            하위 카테고리도 함께 이동되며, 이동 후 레벨이 L5를 초과하면 저장할 수 없습니다.
          </div>

          {moveModal.candidates.length === 0 ? (
            <div style={{ padding: '16px 0', color: '#f85149', fontSize: 13 }}>
              이동 가능한 대상이 없습니다. (이동 시 L5 초과 또는 순환 구조가 발생합니다)
            </div>
          ) : (
            <Field label="이동할 부모 카테고리 선택 *">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {moveModal.candidates.map(c => (
                  <label key={c.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                    background: moveModal.selectedId === c.id ? '#0d2044' : '#0d1117',
                    border: `1px solid ${moveModal.selectedId === c.id ? '#58a6ff' : '#30363d'}`,
                  }}>
                    <input type="radio" name="moveTarget" value={c.id}
                      checked={moveModal.selectedId === c.id}
                      onChange={() => setMoveModal(m => ({ ...m, selectedId: c.id }))}
                      style={{ accentColor: '#58a6ff' }} />
                    <span style={{
                      fontSize: 10, padding: '1px 5px', borderRadius: 3,
                      background: '#1c2128', color: '#8b949e', border: '1px solid #30363d',
                    }}>L{c.level}</span>
                    <span style={{ fontSize: 13, color: '#e6edf3' }}>{c.name}</span>
                    {c.code && <span style={{ fontSize: 11, color: '#444c56', fontFamily: 'monospace' }}>{c.code}</span>}
                  </label>
                ))}
              </div>
            </Field>
          )}

          {moveModal.candidates.length > 0 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setMoveModal(null)} style={{
                background: 'none', border: '1px solid #30363d', color: '#8b949e',
                padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
              }}>취소</button>
              <button onClick={handleMoveConfirm} style={{
                background: '#1158b7', border: '1px solid #58a6ff', color: '#fff',
                padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700,
              }}>이동</button>
            </div>
          )}
        </Modal>
      )}

      <ImagePreviewModal product={imagePreview} onClose={() => setImagePreview(null)} />
      {confirmModal && <ConfirmModal {...confirmModal} onCancel={() => setConfirmModal(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  창고 관리 패널
// ─────────────────────────────────────────────────────────────────
function WarehousesPanel({ showMsg, currentUser }) {
  const [warehouses, setWarehouses] = useState([]);
  const [depts, setDepts] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ warehouseName: '', location: '', capacity: '', manager: '', deptId: '', isActive: true });
  const isSystemAdmin = currentUser?.role === 'admin';

  const load = useCallback(() => {
    warehousesAPI.getAll({ includeInactive: 1 }).then(r => setWarehouses(r.data || [])).catch(() => showMsg('로드 실패', 'error'));
  }, [showMsg]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    categoriesAPI.getDepts().then(r => setDepts(r.data || [])).catch(() => {});
  }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({
      warehouseName: '',
      location: '',
      capacity: '',
      manager: '',
      deptId: isSystemAdmin ? '' : (currentUser?.deptId || ''),
      isActive: true
    });
    setShowModal(true);
  };
  const openEdit = (w) => {
    setEditing(w);
    setForm({
      warehouseName: w.warehouseName,
      location: w.location,
      capacity: w.capacity,
      manager: w.manager || '',
      deptId: w.deptId || '',
      isActive: w.isActive
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.warehouseName || !form.location || !form.capacity) return showMsg('필수 항목을 입력하세요', 'error');
    setLoading(true);
    try {
      if (editing) { await warehousesAPI.update(editing.id, form); showMsg('창고 수정 완료'); }
      else { await warehousesAPI.create(form); showMsg('창고 등록 완료'); }
      setShowModal(false); load();
    } catch (e) { showMsg('저장 실패', 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <SectionHeader title="창고 관리" subtitle="창고 마스터 등록·수정·활성 설정"
        action={<AddBtn onClick={openAdd} label="+ 창고 등록" />} />

      <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#1c2128' }}>
            <tr>
              {['창고명', '위치', '수용 용량', '담당자', '활성', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: '#8b949e', fontWeight: 500, borderBottom: '1px solid #21262d' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {warehouses.map(w => (
              <tr key={w.id} style={{ borderBottom: '1px solid #21262d' }}>
                <td style={{ padding: '10px 12px', color: '#e6edf3', fontWeight: 500 }}>{w.warehouseName}</td>
                <td style={{ padding: '10px 12px', color: '#8b949e' }}>{w.location}</td>
                <td style={{ padding: '10px 12px', color: '#8b949e' }}>{w.capacity?.toLocaleString()}</td>
                <td style={{ padding: '10px 12px', color: '#8b949e' }}>{w.manager || '—'}</td>
                <td style={{ padding: '10px 12px' }}><Badge color={w.isActive ? 'green' : 'gray'}>{w.isActive ? '활성' : '비활성'}</Badge></td>
                <td style={{ padding: '10px 12px' }}>
                  <button onClick={() => openEdit(w)} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>수정</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {warehouses.length === 0 && <p style={{ textAlign: 'center', color: '#8b949e', padding: 40 }}>등록된 창고가 없습니다</p>}
      </div>

      {showModal && (
        <Modal title={editing ? '창고 수정' : '창고 등록'} onClose={() => setShowModal(false)}>
          <Field label="창고명 *"><input value={form.warehouseName} onChange={e => setForm(f => ({ ...f, warehouseName: e.target.value }))} style={inputStyle} /></Field>
          <Field label="위치/주소 *"><input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} style={inputStyle} /></Field>
          <Field label="수용 용량 *"><input type="number" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} style={inputStyle} /></Field>
          <Field label="담당자"><input value={form.manager} onChange={e => setForm(f => ({ ...f, manager: e.target.value }))} style={inputStyle} /></Field>
          <Field label="소속 부서">
            <select
              value={String(form.deptId || '')}
              onChange={e => setForm(f => ({ ...f, deptId: e.target.value }))}
              disabled={!isSystemAdmin}
              style={{ ...inputStyle, opacity: isSystemAdmin ? 1 : 0.7 }}
            >
              <option value="">미지정</option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="활성 여부">
            <select value={String(form.isActive)} onChange={e => setForm(f => ({ ...f, isActive: e.target.value === 'true' }))} style={inputStyle}>
              <option value="true">활성</option>
              <option value="false">비활성</option>
            </select>
          </Field>
          <SaveBtn onClick={handleSave} loading={loading} label={editing ? '수정 저장' : '등록'} />
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  재고 정책 패널 (FIFO + 안전재고)
// ─────────────────────────────────────────────────────────────────
function PolicyPanel({ showMsg }) {
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [catPathMap, setCatPathMap] = useState({});
  const [search, setSearch] = useState('');
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ warehouseId: '', delta: '', reason: '' });
  const [adjustLoading, setAdjustLoading] = useState(false);

  const loadProducts = useCallback(() => {
    Promise.all([productsAPI.getAll(), warehousesAPI.getAll(), categoriesAPI.getTree()])
      .then(([p, w, c]) => {
        setProducts(p.data || []);
        setWarehouses(w.data || []);
        const pathMap = {};
        buildCatPathMap(c.data || [], '', pathMap);
        setCatPathMap(pathMap);
      })
      .catch(() => showMsg('로드 실패', 'error'));
  }, [showMsg]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const filtered = products
    .filter(p => p.productName.includes(search))
    .sort((a, b) => {
      const catA = catPathMap[a.categoryId] || 'zzz 미분류';
      const catB = catPathMap[b.categoryId] || 'zzz 미분류';
      const catCmp = catA.localeCompare(catB, 'ko');
      if (catCmp !== 0) return catCmp;
      return (a.productName || '').localeCompare(b.productName || '', 'ko');
    });
  const getWarehouseStock = (product, warehouseId) => {
    const stocks = Array.isArray(product?.warehouseStocks) ? product.warehouseStocks : [];
    return stocks.find(ws => String(ws.warehouseId) === String(warehouseId));
  };
  const getWarehouseName = (warehouseId) => (
    warehouses.find(w => String(w.id) === String(warehouseId))?.warehouseName || `창고 #${warehouseId}`
  );
  const getStockStatus = (current, safety) => {
    const stock = Number(current || 0);
    const safe = Number(safety || 0);
    if (stock === 0) return { label: '소진', color: 'red' };
    if (safe > 0 && stock < safe * 0.3) return { label: '저재고', color: 'yellow' };
    return { label: '정상', color: 'green' };
  };
  const selectedWarehouseStock = getWarehouseStock(selectedProduct, adjustForm.warehouseId);
  const selectedWarehouseCurrent = parseInt(selectedWarehouseStock?.currentStock, 10) || 0;
  const openAdjust = (p) => {
    setSelectedProduct(p);
    const stocks = sortWarehouseStocksForDisplay(Array.isArray(p.warehouseStocks) ? p.warehouseStocks : [], warehouses);
    setAdjustForm({ warehouseId: stocks[0]?.warehouseId ? String(stocks[0].warehouseId) : '', delta: '', reason: '' });
    setShowAdjustModal(true);
  };
  const handleAdjustSave = async () => {
    if (!selectedProduct) return;
    if (!adjustForm.warehouseId) return showMsg('조정할 창고를 선택하세요', 'error');
    if (!adjustForm.delta || !adjustForm.reason) return showMsg('조정 수량과 사유를 입력하세요', 'error');
    const delta = parseInt(adjustForm.delta, 10);
    if (isNaN(delta) || delta === 0) return showMsg('유효한 수량을 입력하세요', 'error');
    const newWarehouseStock = selectedWarehouseCurrent + delta;
    if (newWarehouseStock < 0) return showMsg('창고 재고가 0 미만이 됩니다. 수량을 확인하세요', 'error');

    setAdjustLoading(true);
    try {
      const r = await productsAPI.adjustStock(selectedProduct.id, {
        warehouseId: adjustForm.warehouseId,
        delta,
        reason: adjustForm.reason,
      });
      const updatedProduct = r.data?.product;
      setProducts(prev => prev.map(p => p.id === selectedProduct.id
        ? { ...p, ...(updatedProduct || {}), currentStock: r.data?.totalCurrentStock ?? updatedProduct?.currentStock ?? p.currentStock }
        : p));
      showMsg(`${selectedProduct.productName} ${getWarehouseName(adjustForm.warehouseId)} 재고 조정 완료 (${delta > 0 ? '+' : ''}${delta})`);
      setShowAdjustModal(false);
    } catch (e) {
      showMsg(e.response?.data?.error || '저장 실패', 'error');
    } finally {
      setAdjustLoading(false);
    }
  };

  return (
    <div>
      <SectionHeader title="재고 정책 관리" subtitle="안전재고, FIFO 및 수동 재고 보정" />

      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 20, marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#58a6ff' }}>FIFO 정책 안내</h3>
        <p style={{ margin: 0, fontSize: 13, color: '#8b949e', lineHeight: 1.7 }}>
          FIFO(선입선출)는 입고일 기준으로 먼저 입고된 재고를 먼저 출고합니다.<br />
          현재 시스템은 전체 품목에 FIFO를 기본 적용합니다. 추후 카테고리별·품목별 예외 설정이 지원될 예정입니다.
        </p>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Badge color="green">전체 FIFO 활성</Badge>
          <Badge color="gray">카테고리별 예외 — 준비 중</Badge>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15, color: '#e6edf3' }}>카테고리 기반 안전재고 현황</h3>
      </div>
      <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 12 }}>
        안전재고는 카테고리 단위로 관리됩니다. 같은 카테고리의 모든 품목이 동일한 안전재고 기준을 적용받습니다.
        변경은 <strong style={{ color: '#58a6ff' }}>카테고리 관리</strong> 메뉴에서 해당 카테고리의 안전재고 값을 수정하세요.
      </div>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="품목명 검색"
        style={{ ...inputStyle, maxWidth: 280, marginBottom: 12 }} />

      <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#1c2128' }}>
            <tr>
              {['품목명', '전체 재고', '창고별 재고', '안전재고', '창고별 상태', '정책/보정'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: '#8b949e', fontWeight: 500, borderBottom: '1px solid #21262d' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const warehouseStocks = sortWarehouseStocksForDisplay(Array.isArray(p.warehouseStocks) ? p.warehouseStocks : [], warehouses);
              return (
                <tr key={p.id} style={{ borderBottom: '1px solid #21262d' }}>
                  <td style={{ padding: '10px 12px', color: '#e6edf3' }}><ProductNameSpec item={p} nameStyle={{ color: '#e6edf3' }} /></td>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: '#58a6ff' }}>{p.currentStock} <span style={{ color: '#8b949e', fontSize: 12, fontWeight: 500 }}>{p.unit}</span></td>
                  <td style={{ padding: '10px 12px', color: '#8b949e' }}>
                    {warehouseStocks.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {warehouseStocks.map(ws => (
                          <span key={ws.warehouseId} style={{ border: '1px solid #30363d', borderRadius: 4, padding: '2px 6px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>
                            {ws.warehouse?.warehouseName || getWarehouseName(ws.warehouseId)} {parseInt(ws.currentStock, 10) || 0} {p.unit}
                          </span>
                        ))}
                      </div>
                    ) : <span style={{ color: '#444c56' }}>창고 미지정</span>}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ color: p.safetyStock ? '#e6edf3' : '#444c56' }}>{p.safetyStock || '미설정'}</span>
                    <span style={{ fontSize: 10, color: '#58a6ff', marginLeft: 4 }}>(카테고리)</span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {warehouseStocks.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {warehouseStocks.map(ws => {
                          const status = getStockStatus(ws.currentStock, ws.safetyStock ?? p.safetyStock);
                          return <Badge key={ws.warehouseId} color={status.color}>{ws.warehouse?.warehouseName || getWarehouseName(ws.warehouseId)} {status.label}</Badge>;
                        })}
                      </div>
                    ) : <Badge color="gray">창고 미지정</Badge>}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <button onClick={() => openAdjust(p)}
                      style={{ background: 'none', border: '1px solid #e3b341', color: '#e3b341', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>재고 조정</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showAdjustModal && selectedProduct && (
        <Modal title={`재고 조정 — ${selectedProduct.productName}`} onClose={() => setShowAdjustModal(false)}>
          <div style={{ background: '#1c2128', borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 13, color: '#8b949e' }}>
            전체 재고: <strong style={{ color: '#e6edf3' }}>{selectedProduct.currentStock} {selectedProduct.unit}</strong>
            {adjustForm.warehouseId && (
              <span style={{ marginLeft: 12 }}>
                {getWarehouseName(adjustForm.warehouseId)} 재고:
                <strong style={{ color: '#58a6ff', marginLeft: 4 }}>{selectedWarehouseCurrent} {selectedProduct.unit}</strong>
              </span>
            )}
          </div>
          <Field label="조정 창고 *">
            <select value={adjustForm.warehouseId} onChange={e => setAdjustForm(f => ({ ...f, warehouseId: e.target.value }))} style={inputStyle}>
              <option value="">창고 선택</option>
              {sortWarehousesForDisplay(warehouses).map(w => (
                <option key={w.id} value={w.id}>
                  {w.warehouseName} ({parseInt(getWarehouseStock(selectedProduct, w.id)?.currentStock, 10) || 0} {selectedProduct.unit})
                </option>
              ))}
            </select>
          </Field>
          <Field label="조정 수량 (+ 입력: 증가, - 입력: 감소) *">
            <input type="number" value={adjustForm.delta} onChange={e => setAdjustForm(f => ({ ...f, delta: e.target.value }))} style={inputStyle} placeholder="예: +10 또는 -5" />
          </Field>
          <Field label="조정 사유 *">
            <input value={adjustForm.reason} onChange={e => setAdjustForm(f => ({ ...f, reason: e.target.value }))} style={inputStyle} placeholder="실사 차이, 파손, 기타" />
          </Field>
          {adjustForm.delta && !isNaN(parseInt(adjustForm.delta, 10)) && (
            <div style={{ background: '#1c2128', borderRadius: 6, padding: 12, marginBottom: 8, fontSize: 13 }}>
              조정 후 예상 창고 재고: <strong style={{ color: '#58a6ff' }}>{selectedWarehouseCurrent + parseInt(adjustForm.delta, 10)} {selectedProduct.unit}</strong>
            </div>
          )}
          <SaveBtn onClick={handleAdjustSave} loading={adjustLoading} label="조정 저장" />
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  공급업체 관리 패널
// ─────────────────────────────────────────────────────────────────
function SuppliersPanel({ showMsg }) {
  const [suppliers, setSuppliers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ supplierName: '', contactPerson: '', phone: '', email: '', address: '' });
  const [confirmModal, setConfirmModal] = useState(null);

  const load = useCallback(() => {
    suppliersAPI.getAll().then(r => setSuppliers(r.data || [])).catch(() => showMsg('로드 실패', 'error'));
  }, [showMsg]);
  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditing(null); setForm({ supplierName: '', contactPerson: '', phone: '', email: '', address: '' }); setShowModal(true); };
  const openEdit = (s) => { setEditing(s); setForm({ supplierName: s.supplierName, contactPerson: s.contactPerson || '', phone: s.phone || '', email: s.email || '', address: s.address || '' }); setShowModal(true); };

  const handleSave = async () => {
    if (!form.supplierName) return showMsg('공급업체명 필수', 'error');
    setLoading(true);
    try {
      if (editing) { await suppliersAPI.update(editing.id, form); showMsg('수정 완료'); }
      else { await suppliersAPI.create(form); showMsg('등록 완료'); }
      setShowModal(false); load();
    } catch (e) { showMsg('저장 실패', 'error'); }
    finally { setLoading(false); }
  };

  const handleDelete = (id, name) => {
    setConfirmModal({
      message: `"${name}" 공급업체를 비활성화하시겠습니까?`,
      confirmLabel: '비활성화',
      confirmColor: '#b62324',
      onConfirm: async () => {
        setConfirmModal(null);
        await suppliersAPI.delete(id).catch(() => showMsg('삭제 실패', 'error'));
        showMsg('비활성화 완료'); load();
      },
    });
  };

  return (
    <div>
      <SectionHeader title="공급업체 관리" subtitle="공급업체 등록·수정"
        action={<AddBtn onClick={openAdd} label="+ 공급업체 등록" />} />

      <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#1c2128' }}>
            <tr>
              {['코드', '공급업체명', '담당자', '전화', '이메일', '상태', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: '#8b949e', fontWeight: 500, borderBottom: '1px solid #21262d' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {suppliers.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid #21262d' }}>
                <td style={{ padding: '10px 12px', color: '#8b949e', fontFamily: 'monospace', fontSize: 12 }}>{s.supplierCode}</td>
                <td style={{ padding: '10px 12px', color: '#e6edf3', fontWeight: 500 }}>{s.supplierName}</td>
                <td style={{ padding: '10px 12px', color: '#8b949e' }}>{s.contactPerson || '—'}</td>
                <td style={{ padding: '10px 12px', color: '#8b949e' }}>{s.phone || '—'}</td>
                <td style={{ padding: '10px 12px', color: '#8b949e' }}>{s.email || '—'}</td>
                <td style={{ padding: '10px 12px' }}><Badge color={s.isActive ? 'green' : 'gray'}>{s.isActive ? '활성' : '비활성'}</Badge></td>
                <td style={{ padding: '10px 12px' }}>
                  <button onClick={() => openEdit(s)} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, marginRight: 6 }}>수정</button>
                  <button onClick={() => handleDelete(s.id, s.supplierName)} style={{ background: 'none', border: '1px solid #3a1a1a', color: '#f85149', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>비활성</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {suppliers.length === 0 && <p style={{ textAlign: 'center', color: '#8b949e', padding: 40 }}>등록된 공급업체가 없습니다</p>}
      </div>

      {showModal && (
        <Modal title={editing ? '공급업체 수정' : '공급업체 등록'} onClose={() => setShowModal(false)}>
          <Field label="공급업체명 *"><input value={form.supplierName} onChange={e => setForm(f => ({ ...f, supplierName: e.target.value }))} style={inputStyle} /></Field>
          <Field label="담당자"><input value={form.contactPerson} onChange={e => setForm(f => ({ ...f, contactPerson: e.target.value }))} style={inputStyle} /></Field>
          <Field label="전화번호"><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} style={inputStyle} /></Field>
          <Field label="이메일"><input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={inputStyle} /></Field>
          <Field label="주소"><textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} style={{ ...inputStyle, height: 72, resize: 'vertical' }} /></Field>
          <SaveBtn onClick={handleSave} loading={loading} label={editing ? '수정 저장' : '등록'} />
        </Modal>
      )}
      {confirmModal && (
        <ConfirmModal {...confirmModal} onCancel={() => setConfirmModal(null)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  사용자·권한 관리 패널
// ─────────────────────────────────────────────────────────────────
const ROLE_COLOR = { admin: 'red', dept_admin: 'yellow', warehouse: 'blue', applicant: 'gray' };
const INV_STATUS = {
  invited:  { label: '초대 발송됨',  color: '#58a6ff', bg: '#0d2044' },
  pending:  { label: '승인 대기',    color: '#e3b341', bg: '#3a2e00' },
  approved: { label: '승인 완료',    color: '#3fb950', bg: '#1a3a2a' },
  rejected: { label: '거절',         color: '#f85149', bg: '#3a1a1a' },
};

function UsersPanel({ showMsg, currentUser }) {
  const [panelTab,  setPanelTab]  = useState('users');  // 'users' | 'invitations'
  const [users,     setUsers]     = useState([]);
  const [depts,     setDepts]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [search,    setSearch]    = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showPw,    setShowPw]    = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'warehouse', deptId: '', warehouseId: '' });
  const [formWarehouses, setFormWarehouses] = useState([]);

  // 초대 관련 상태
  const [invitations,   setInvitations]   = useState([]);
  const [invLoading,    setInvLoading]    = useState(false);
  const [showInvModal,  setShowInvModal]  = useState(false);
  const [invForm,       setInvForm]       = useState({ email: '', role: 'warehouse', deptId: '', warehouseId: '' });
  const [invWarehouses, setInvWarehouses] = useState([]);
  const [invSending,    setInvSending]    = useState(false);
  const [devLink,       setDevLink]       = useState('');    // dev mode 초대 링크
  const [rejectModal,   setRejectModal]   = useState(null);  // { id, name }
  const [rejectReason,  setRejectReason]  = useState('');
  const [confirmModal,  setConfirmModal]  = useState(null);  // { message, subMessage, confirmLabel, confirmColor, onConfirm }
  const isSystemAdmin = currentUser?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await usersAPI.getAll();
      setUsers(r.data || []);
    } catch (e) {
      showMsg('사용자 목록 로드 실패', 'error');
    } finally {
      setLoading(false);
    }
  }, [showMsg]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    categoriesAPI.getDepts().then(r => setDepts(r.data || [])).catch(() => {});
  }, []);

  const loadWarehousesByDept = useCallback(async (deptId) => {
    if (!deptId) return [];
    const params = isSystemAdmin ? { deptId } : undefined;
    const r = await warehousesAPI.getAll(params);
    return r.data || [];
  }, [isSystemAdmin]);

  useEffect(() => {
    let alive = true;
    if (!showModal || form.role !== 'warehouse') { setFormWarehouses([]); return; }
    const deptId = isSystemAdmin ? form.deptId : (currentUser?.deptId || '');
    if (!deptId) { setFormWarehouses([]); return; }
    loadWarehousesByDept(deptId)
      .then(list => { if (alive) setFormWarehouses(list); })
      .catch(() => { if (alive) showMsg('창고 목록 로드 실패', 'error'); });
    return () => { alive = false; };
  }, [showModal, form.role, form.deptId, isSystemAdmin, currentUser?.deptId, loadWarehousesByDept, showMsg]);

  useEffect(() => {
    let alive = true;
    if (!showInvModal || invForm.role !== 'warehouse') { setInvWarehouses([]); return; }
    const deptId = isSystemAdmin ? invForm.deptId : (currentUser?.deptId || '');
    if (!deptId) { setInvWarehouses([]); return; }
    loadWarehousesByDept(deptId)
      .then(list => { if (alive) setInvWarehouses(list); })
      .catch(() => { if (alive) showMsg('창고 목록 로드 실패', 'error'); });
    return () => { alive = false; };
  }, [showInvModal, invForm.role, invForm.deptId, isSystemAdmin, currentUser?.deptId, loadWarehousesByDept, showMsg]);

  // 초대 목록 로드
  const loadInvitations = useCallback(async () => {
    setInvLoading(true);
    try {
      const r = await invitationsAPI.getAll();
      setInvitations(r.data || []);
    } catch { showMsg('초대 목록 로드 실패', 'error'); }
    finally { setInvLoading(false); }
  }, [showMsg]);

  useEffect(() => { if (panelTab === 'invitations') loadInvitations(); }, [panelTab, loadInvitations]);

  const handleSendInvite = async () => {
    if (!invForm.email.trim()) return showMsg('이메일을 입력하세요', 'error');
    if (invForm.role === 'warehouse') {
      if (isSystemAdmin && !invForm.deptId) return showMsg('소속 부서를 선택하세요', 'error');
      if (!invForm.warehouseId) return showMsg('소속 창고를 선택하세요', 'error');
    }
    setInvSending(true); setDevLink('');
    try {
      const payload = { email: invForm.email, role: invForm.role };
      if (isSystemAdmin) payload.deptId = invForm.deptId || null;
      if (invForm.role === 'warehouse') payload.warehouseId = invForm.warehouseId || null;
      const r = await invitationsAPI.send(payload);
      const failed = !!r.data.devLink && r.data.message?.includes('실패');
      showMsg(failed ? '초대 생성됨 (이메일 발송 실패 — 링크를 직접 전달하세요)' : '초대 이메일이 발송됐습니다');
      if (r.data.devLink) setDevLink(r.data.devLink);
      else setShowInvModal(false);
      loadInvitations();
    } catch (e) {
      const errMsg = e.response?.data?.error || '발송 실패';
      // 이미 초대가 있는 경우 → 초대 관리 탭으로 안내
      if (errMsg.includes('이미 발송된')) {
        showMsg('이미 발송된 초대가 있습니다. 초대 관리 탭에서 재발송할 수 있습니다.');
        setShowInvModal(false);
        setPanelTab('invitations');
        loadInvitations();
      } else {
        showMsg(errMsg, 'error');
      }
    }
    finally { setInvSending(false); }
  };

  const handleResend = async (inv) => {
    try {
      const r = await invitationsAPI.resend(inv.id);
      showMsg('재발송됐습니다');
      if (r.data.devLink) { setDevLink(r.data.devLink); setShowInvModal(true); }
      loadInvitations();
    } catch (e) { showMsg(e.response?.data?.error || '재발송 실패', 'error'); }
  };

  const handleApprove = (inv) => {
    setConfirmModal({
      message: `"${inv.name}" 님의 가입을 승인하시겠습니까?`,
      subMessage: `이메일: ${inv.email} / 역할: ${ROLE_LABELS[inv.role] || inv.role}`,
      confirmLabel: '✅ 승인',
      confirmColor: '#238636',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await invitationsAPI.approve(inv.id);
          showMsg(`${inv.name} 님 가입 승인 완료`);
          load(); loadInvitations();
        } catch (e) { showMsg(e.response?.data?.error || '승인 실패', 'error'); }
      },
    });
  };

  const handleReject = async () => {
    try {
      await invitationsAPI.reject(rejectModal.id, rejectReason);
      showMsg('거절 처리됐습니다');
      setRejectModal(null); setRejectReason('');
      loadInvitations();
    } catch (e) { showMsg('거절 실패', 'error'); }
  };

  const openAdd = () => {
    setEditing(null);
    setForm({
      name: '',
      email: '',
      password: '',
      role: 'warehouse',
      deptId: isSystemAdmin ? '' : (currentUser?.deptId || ''),
      warehouseId: '',
    });
    setShowPw(false);
    setShowModal(true);
  };
  const openEdit = (u) => {
    setEditing(u);
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      deptId: u.deptId || '',
      warehouseId: u.warehouseId || '',
    });
    setShowPw(false);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim())  return showMsg('이름을 입력하세요', 'error');
    if (!form.email.trim()) return showMsg('이메일을 입력하세요', 'error');
    if (!editing && !form.password) return showMsg('비밀번호를 입력하세요', 'error');
    if (form.role === 'warehouse') {
      if (isSystemAdmin && !form.deptId) return showMsg('소속 부서를 선택하세요', 'error');
      if (!form.warehouseId) return showMsg('소속 창고를 선택하세요', 'error');
    }
    setSaving(true);
    try {
      if (editing) {
        const payload = { name: form.name, role: form.role };
        if (isSystemAdmin) payload.deptId = form.deptId || null;
        payload.warehouseId = form.role === 'warehouse' ? (form.warehouseId || null) : null;
        if (form.password) payload.password = form.password;
        await usersAPI.update(editing.id, payload);
        showMsg('사용자 정보가 수정됐습니다');
      } else {
        const payload = { name: form.name, email: form.email, password: form.password, role: form.role };
        if (isSystemAdmin) payload.deptId = form.deptId || null;
        payload.warehouseId = form.role === 'warehouse' ? (form.warehouseId || null) : null;
        await usersAPI.create(payload);
        showMsg('사용자가 등록됐습니다');
      }
      setShowModal(false);
      load();
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || '저장 실패';
      showMsg(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (u) => {
    setConfirmModal({
      message: `"${u.name}" 계정을 삭제하시겠습니까?`,
      subMessage: '이 작업은 되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      confirmColor: '#b62324',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await usersAPI.delete(u.id);
          showMsg(`${u.name} 계정이 삭제됐습니다`);
          load();
        } catch (e) {
          showMsg(e.response?.data?.error || '삭제 실패', 'error');
        }
      },
    });
  };

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchRole   = !roleFilter || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  // 역할별 카운트
  const roleCounts = users.reduce((acc, u) => { acc[u.role] = (acc[u.role] || 0) + 1; return acc; }, {});

  const th = { textAlign: 'left', padding: '10px 14px', color: '#8b949e', fontWeight: 500, borderBottom: '1px solid #21262d', fontSize: 12 };
  const td = { padding: '11px 14px', borderBottom: '1px solid #161b22' };

  const pendingCount = invitations.filter(i => i.status === 'pending').length;

  return (
    <div>
      <SectionHeader title="사용자·권한 관리" subtitle="사용자 등록 및 초대 관리" />

      {/* 패널 탭 */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid #21262d' }}>
        {[
          { id: 'users',       label: '활성 사용자', count: users.length },
          { id: 'invitations', label: '초대 관리',   count: pendingCount, badge: pendingCount > 0 },
        ].map(t => (
          <button key={t.id} onClick={() => setPanelTab(t.id)} style={{
            padding: '8px 20px', background: 'none', border: 'none',
            borderBottom: panelTab === t.id ? '2px solid #58a6ff' : '2px solid transparent',
            color: panelTab === t.id ? '#58a6ff' : '#8b949e',
            cursor: 'pointer', fontSize: 13, fontWeight: panelTab === t.id ? 700 : 400,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {t.label}
            <span style={{
              background: t.badge ? '#e3b341' : '#21262d',
              color: t.badge ? '#0d1117' : '#8b949e',
              borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700,
            }}>{t.count}</span>
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingBottom: 4 }}>
          {panelTab === 'users'
            ? <AddBtn onClick={openAdd} label="+ 직접 등록" />
            : <button onClick={() => { setInvForm({ email: '', role: 'warehouse', deptId: isSystemAdmin ? '' : (currentUser?.deptId || ''), warehouseId: '' }); setDevLink(''); setShowInvModal(true); }}
                style={{ background: 'linear-gradient(135deg,#0d2a56,#1e4fa0)', border: '1px solid #58a6ff', color: '#fff', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                ✉️ 초대장 발송
              </button>
          }
        </div>
      </div>

      {/* ─── 초대 관리 탭 ─── */}
      {panelTab === 'invitations' && (
        <div>
          {invLoading ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#8b949e' }}>불러오는 중...</div>
          ) : (
            <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ background: '#1c2128' }}>
                  <tr>
                    {['이메일', '역할', '이름', '상태', '만료일', ''].map((h, i) => (
                      <th key={h} style={{ padding: '10px 14px', color: '#8b949e', fontWeight: 500, borderBottom: '1px solid #21262d', fontSize: 12, textAlign: i >= 5 ? 'right' : 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((inv, i) => {
                    const st = INV_STATUS[inv.status] || INV_STATUS.invited;
                    const expired = new Date(inv.expiresAt) < new Date();
                    return (
                      <tr key={inv.id} style={{ background: i % 2 === 0 ? '#0d1117' : '#161b22' }}>
                        <td style={{ padding: '11px 14px', color: '#e6edf3', fontFamily: 'monospace', fontSize: 12 }}>{inv.email}</td>
                        <td style={{ padding: '11px 14px' }}>
                          <Badge color={ROLE_COLOR[inv.role] || 'gray'}>{ROLE_LABELS[inv.role]}</Badge>
                        </td>
                        <td style={{ padding: '11px 14px', color: '#8b949e' }}>{inv.name || <span style={{ color: '#444c56' }}>미입력</span>}</td>
                        <td style={{ padding: '11px 14px' }}>
                          <span style={{ background: st.bg, color: st.color, border: `1px solid ${st.color}44`, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                            {st.label}{expired && inv.status === 'invited' ? ' (만료)' : ''}
                          </span>
                        </td>
                        <td style={{ padding: '11px 14px', color: '#8b949e', fontSize: 11 }}>
                          {new Date(inv.expiresAt).toLocaleDateString('ko-KR')}
                        </td>
                        <td style={{ padding: '11px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {inv.status === 'pending' && inv.name && (
                            <>
                              <button onClick={() => handleApprove(inv)}
                                style={{ background: '#0d2616', border: '1px solid #3fb950', color: '#3fb950', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, marginRight: 6, fontWeight: 700 }}>
                                ✅ 승인
                              </button>
                              <button onClick={() => { setRejectModal({ id: inv.id, name: inv.name }); setRejectReason(''); }}
                                style={{ background: 'none', border: '1px solid #f85149', color: '#f85149', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                                거절
                              </button>
                            </>
                          )}
                          {(inv.status === 'invited' || expired) && (
                            <button onClick={() => handleResend(inv)}
                              style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                              재발송
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {invitations.length === 0 && <p style={{ textAlign: 'center', color: '#8b949e', padding: 40 }}>초대 내역이 없습니다</p>}
            </div>
          )}
        </div>
      )}

      {/* ─── 활성 사용자 탭 ─── */}
      {panelTab === 'users' && (<>

      {/* 역할별 요약 카드 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {Object.entries(ROLE_LABELS).map(([k, v]) => (
          <div key={k} onClick={() => setRoleFilter(f => f === k ? '' : k)}
            style={{
              flex: '1 1 100px', background: roleFilter === k ? '#1f2937' : '#161b22',
              border: `1px solid ${roleFilter === k ? '#58a6ff' : '#21262d'}`,
              borderRadius: 8, padding: '10px 14px', cursor: 'pointer', transition: 'all 0.15s',
            }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: roleFilter === k ? '#58a6ff' : '#e6edf3' }}>
              {roleCounts[k] || 0}
            </div>
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* 검색 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="이름 또는 이메일 검색"
          style={{ ...inputStyle, maxWidth: 260 }}
        />
        {(search || roleFilter) && (
          <button onClick={() => { setSearch(''); setRoleFilter(''); }}
            style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
            ✕ 필터 초기화
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8b949e' }}>
          {filtered.length} / {users.length}명
        </span>
      </div>

      {/* 테이블 */}
      <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#8b949e' }}>불러오는 중...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#1c2128' }}>
              <tr>
                <th style={th}>이름</th>
                <th style={th}>이메일</th>
                <th style={th}>역할</th>
                <th style={th}>등록일</th>
                <th style={{ ...th, textAlign: 'right' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <tr key={u.id} style={{ background: i % 2 === 0 ? '#0d1117' : '#161b22' }}>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 14,
                        background: '#1f2937', border: '1px solid #30363d',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, color: '#58a6ff', fontWeight: 700, flexShrink: 0,
                      }}>
                        {u.name[0]}
                      </div>
                      <span style={{ color: '#e6edf3', fontWeight: 500 }}>{u.name}</span>
                    </div>
                  </td>
                  <td style={{ ...td, color: '#8b949e', fontFamily: 'monospace', fontSize: 12 }}>{u.email}</td>
                  <td style={td}>
                    <Badge color={ROLE_COLOR[u.role] || 'gray'}>
                      {ROLE_LABELS[u.role] || u.role}
                    </Badge>
                  </td>
                  <td style={{ ...td, color: '#8b949e', fontSize: 12 }}>
                    {new Date(u.createdAt).toLocaleDateString('ko-KR')}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => openEdit(u)}
                      style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, marginRight: 6 }}>
                      수정
                    </button>
                    <button onClick={() => handleDelete(u)}
                      style={{ background: 'none', border: '1px solid #3a1a1a', color: '#f85149', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && filtered.length === 0 && (
          <p style={{ textAlign: 'center', color: '#8b949e', padding: 40 }}>
            {search || roleFilter ? '검색 결과가 없습니다' : '등록된 사용자가 없습니다'}
          </p>
        )}
      </div>

      {/* 등록/수정 모달 */}
      {showModal && (
        <Modal title={editing ? `사용자 수정 — ${editing.name}` : '신규 사용자 등록'} onClose={() => setShowModal(false)}>

          {/* 수정 시 이메일 표시 (읽기전용) */}
          {editing && (
            <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '8px 12px', marginBottom: 16, fontSize: 12, color: '#8b949e' }}>
              📧 {editing.email}
            </div>
          )}

          <Field label="이름 *">
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} placeholder="홍길동" />
          </Field>

          {!editing && (
            <Field label="이메일 *">
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={inputStyle} placeholder="user@example.com" />
            </Field>
          )}

          <Field label={editing ? '새 비밀번호 (변경 시만 입력)' : '비밀번호 *'}>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                style={{ ...inputStyle, paddingRight: 40 }}
                placeholder={editing ? '변경하지 않으면 비워두세요' : '비밀번호 입력'}
              />
              <button onClick={() => setShowPw(v => !v)} style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 14,
              }}>
                {showPw ? '🙈' : '👁'}
              </button>
            </div>
          </Field>

          <Field label="역할">
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value, warehouseId: e.target.value === 'warehouse' ? f.warehouseId : '' }))}
              style={inputStyle}
            >
              {ROLE_OPTIONS.map(k => <option key={k} value={k}>{ROLE_LABELS[k]}</option>)}
            </select>
          </Field>

          <Field label="소속 부서">
            <select
              value={String(form.deptId || '')}
              onChange={e => setForm(f => ({ ...f, deptId: e.target.value, warehouseId: '' }))}
              disabled={!isSystemAdmin}
              style={{ ...inputStyle, opacity: isSystemAdmin ? 1 : 0.7 }}
            >
              <option value="">미지정</option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          {form.role === 'warehouse' && (
            <Field label="소속 창고 *">
              <select
                value={String(form.warehouseId || '')}
                onChange={e => setForm(f => ({ ...f, warehouseId: e.target.value }))}
                disabled={isSystemAdmin && !form.deptId}
                style={{ ...inputStyle, opacity: (isSystemAdmin && !form.deptId) ? 0.7 : 1 }}
              >
                <option value="">창고 선택</option>
                {formWarehouses.map(w => <option key={w.id} value={w.id}>{w.warehouseName}</option>)}
              </select>
            </Field>
          )}

          {/* 역할 설명 */}
          <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '10px 14px', marginBottom: 8, fontSize: 12, color: '#8b949e', lineHeight: 1.7 }}>
            {{
              admin:     '⚠️ 시스템 전체 관리 — 모든 기능 접근 가능',
              dept_admin:'🧭 부서 관리자 — 본인 부서 사용자/초대 관리',
              warehouse: '📦 창고 작업자 — 입출고, 재고조회, 창고POS 사용',
              applicant: '📝 신청자 — 물품 신청 및 본인 신청 조회',
            }[form.role]}
          </div>

          <SaveBtn onClick={handleSave} loading={saving} label={editing ? '수정 저장' : '등록'} />
        </Modal>
      )}
      </>)}

      {/* ─── 초대장 발송 모달 ─── */}
      {showInvModal && (
        <Modal title="초대장 발송" onClose={() => setShowInvModal(false)}>
          {devLink ? (
            <div>
              <div style={{ background: '#0d2616', border: '1px solid #3fb950', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: '#3fb950', fontWeight: 700, marginBottom: 8 }}>✅ 초대 생성 완료 (개발 모드)</div>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8 }}>SMTP 미설정 — 아래 링크를 직접 전달하세요</div>
                <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '10px 12px', fontSize: 12, fontFamily: 'monospace', color: '#58a6ff', wordBreak: 'break-all' }}>
                  {devLink}
                </div>
                <button onClick={() => { navigator.clipboard.writeText(devLink); showMsg('링크 복사됨'); }}
                  style={{ marginTop: 10, background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                  📋 링크 복사
                </button>
              </div>
              <button onClick={() => setShowInvModal(false)}
                style={{ width: '100%', padding: '10px', background: '#1c2128', border: '1px solid #30363d', color: '#e6edf3', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                닫기
              </button>
            </div>
          ) : (
            <div>
              <Field label="초대할 이메일 *">
                <input type="email" value={invForm.email} onChange={e => setInvForm(f => ({ ...f, email: e.target.value }))}
                  style={inputStyle} placeholder="user@example.com" />
              </Field>
              <Field label="배정 역할">
                <select
                  value={invForm.role}
                  onChange={e => setInvForm(f => ({ ...f, role: e.target.value, warehouseId: e.target.value === 'warehouse' ? f.warehouseId : '' }))}
                  style={inputStyle}
                >
                  {ROLE_OPTIONS.map(k => <option key={k} value={k}>{ROLE_LABELS[k]}</option>)}
                </select>
              </Field>
              <Field label="소속 부서">
                <select
                  value={String(invForm.deptId || '')}
                  onChange={e => setInvForm(f => ({ ...f, deptId: e.target.value, warehouseId: '' }))}
                  disabled={!isSystemAdmin}
                  style={{ ...inputStyle, opacity: isSystemAdmin ? 1 : 0.7 }}
                >
                  <option value="">미지정</option>
                  {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              {invForm.role === 'warehouse' && (
                <Field label="소속 창고 *">
                  <select
                    value={String(invForm.warehouseId || '')}
                    onChange={e => setInvForm(f => ({ ...f, warehouseId: e.target.value }))}
                    disabled={isSystemAdmin && !invForm.deptId}
                    style={{ ...inputStyle, opacity: (isSystemAdmin && !invForm.deptId) ? 0.7 : 1 }}
                  >
                    <option value="">창고 선택</option>
                    {invWarehouses.map(w => <option key={w.id} value={w.id}>{w.warehouseName}</option>)}
                  </select>
                </Field>
              )}
              <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#8b949e', lineHeight: 1.7 }}>
                {{'admin':'⚠️ 시스템 전체 관리','dept_admin':'🧭 부서 관리자','warehouse':'📦 창고 작업자','applicant':'📝 신청자'}[invForm.role]}
              </div>
              <SaveBtn onClick={handleSendInvite} loading={invSending} label="✉️ 초대 이메일 발송" />
            </div>
          )}
        </Modal>
      )}

      {/* ─── 거절 사유 모달 ─── */}
      {rejectModal && (
        <Modal title={`가입 거절 — ${rejectModal.name}`} onClose={() => setRejectModal(null)}>
          <Field label="거절 사유 (선택)">
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              style={{ ...inputStyle, height: 80, resize: 'vertical' }} placeholder="거절 사유를 입력하세요 (생략 가능)" />
          </Field>
          <SaveBtn onClick={handleReject} label="거절 확정" />
        </Modal>
      )}

      {/* ─── 확인 다이얼로그 ─── */}
      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          subMessage={confirmModal.subMessage}
          confirmLabel={confirmModal.confirmLabel}
          confirmColor={confirmModal.confirmColor}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  보고서 패널
// ─────────────────────────────────────────────────────────────────
function ReportsPanel({ showMsg }) {
  const [tab, setTab] = useState('weekly');
  const [products, setProducts] = useState([]);
  const [histories, setHistories] = useState([]);

  useEffect(() => {
    Promise.all([productsAPI.getAll(), warehousesAPI.getAll(), stockHistoryAPI.getAll({})])
      .then(([p, w, h]) => { setProducts(p.data || []); setHistories(h.data || []); })
      .catch(() => showMsg('로드 실패', 'error'));
  }, [showMsg]);

  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const filterPeriod = (start, end) => histories.filter(h => {
    const d = new Date(h.createdAt);
    return d >= start && d <= end;
  });

  const calcStats = (rows) => ({
    inQty:    rows.filter(h => h.type === 'inbound').reduce((s, h) => s + (h.quantity || 0), 0),
    outQty:   rows.filter(h => h.type === 'outbound').reduce((s, h) => s + (h.quantity || 0), 0),
    inCount:  rows.filter(h => h.type === 'inbound').length,
    outCount: rows.filter(h => h.type === 'outbound').length,
  });

  const weekly = calcStats(filterPeriod(weekStart, weekEnd));
  const monthly = calcStats(filterPeriod(monthStart, monthEnd));

  const TABS = [{ id: 'weekly', label: '주간 보고서' }, { id: 'monthly', label: '월말 보고서' }, { id: 'lowstock', label: '저재고 보고서' }];

  const lowStock = products.filter(p => p.currentStock <= (p.safetyStock || 0));

  const StatCard = ({ label, value, sub, color }) => (
    <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: '16px 20px', borderLeft: `3px solid ${color || '#58a6ff'}` }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || '#58a6ff' }}>{value?.toLocaleString()}</div>
      <div style={{ fontSize: 13, color: '#8b949e', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: '#444c56', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <SectionHeader title="보고서" subtitle="주간·월말 입출고 및 저재고 현황" />
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#161b22', borderRadius: 8, padding: 4, border: '1px solid #21262d', width: 'fit-content' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: tab === t.id ? '#21262d' : 'none', border: 'none',
            color: tab === t.id ? '#58a6ff' : '#8b949e', padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'weekly' && (
        <div>
          <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 16 }}>
            기간: {weekStart.toLocaleDateString('ko-KR')} ~ {weekEnd.toLocaleDateString('ko-KR')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <StatCard label="주간 입고 건수" value={weekly.inCount} color="#3fb950" />
            <StatCard label="주간 입고 수량" value={weekly.inQty} sub="단위 합계" color="#3fb950" />
            <StatCard label="주간 출고 건수" value={weekly.outCount} color="#f0883e" />
            <StatCard label="주간 출고 수량" value={weekly.outQty} sub="단위 합계" color="#f0883e" />
          </div>
        </div>
      )}

      {tab === 'monthly' && (
        <div>
          <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 16 }}>
            기간: {monthStart.toLocaleDateString('ko-KR')} ~ {monthEnd.toLocaleDateString('ko-KR')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <StatCard label="월 입고 건수" value={monthly.inCount} color="#3fb950" />
            <StatCard label="월 입고 수량" value={monthly.inQty} sub="단위 합계" color="#3fb950" />
            <StatCard label="월 출고 건수" value={monthly.outCount} color="#f0883e" />
            <StatCard label="월 출고 수량" value={monthly.outQty} sub="단위 합계" color="#f0883e" />
          </div>
          <div style={{ marginTop: 24, background: '#161b22', border: '1px solid #21262d', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: '#1c2128' }}>
                <tr>{['품목명', '단위', '기말 재고', '월 입고', '월 출고'].map(h =>
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: '#8b949e', fontWeight: 500, borderBottom: '1px solid #21262d' }}>{h}</th>
                )}</tr>
              </thead>
              <tbody>
                {products.slice(0, 20).map(p => {
                  const ph = filterPeriod(monthStart, monthEnd).filter(h => h.productId === p.id);
                  const inQty = ph.filter(h => h.type === 'inbound').reduce((s, h) => s + h.quantity, 0);
                  const outQty = ph.filter(h => h.type === 'outbound').reduce((s, h) => s + h.quantity, 0);
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #21262d' }}>
                      <td style={{ padding: '8px 12px', color: '#e6edf3' }}><ProductNameSpec item={p} nameStyle={{ color: '#e6edf3' }} /></td>
                      <td style={{ padding: '8px 12px', color: '#8b949e' }}>{p.unit}</td>
                      <td style={{ padding: '8px 12px', color: '#58a6ff', fontWeight: 600 }}>{p.currentStock}</td>
                      <td style={{ padding: '8px 12px', color: '#3fb950' }}>{inQty || '—'}</td>
                      <td style={{ padding: '8px 12px', color: '#f0883e' }}>{outQty || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'lowstock' && (
        <div>
          <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 16 }}>
            저재고 품목 {lowStock.length}건
          </p>
          <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: '#1c2128' }}>
                <tr>{['품목명', '단위', '현재고', '안전재고', '상태'].map(h =>
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: '#8b949e', fontWeight: 500, borderBottom: '1px solid #21262d' }}>{h}</th>
                )}</tr>
              </thead>
              <tbody>
                {lowStock.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #21262d' }}>
                    <td style={{ padding: '8px 12px', color: '#e6edf3', fontWeight: 500 }}><ProductNameSpec item={p} nameStyle={{ color: '#e6edf3', fontWeight: 500 }} /></td>
                    <td style={{ padding: '8px 12px', color: '#8b949e' }}>{p.unit}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: p.currentStock === 0 ? '#f85149' : '#e3b341' }}>{p.currentStock}</td>
                    <td style={{ padding: '8px 12px', color: '#8b949e' }}>{p.safetyStock || '미설정'}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {p.currentStock === 0 ? <Badge color="red">소진</Badge> : <Badge color="yellow">저재고</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lowStock.length === 0 && <p style={{ textAlign: 'center', color: '#3fb950', padding: 40 }}>저재고 품목 없음</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  자동발주 패널 (예정)
// ─────────────────────────────────────────────────────────────────
function DbConfigPanel({ showMsg }) {
  const [form, setForm] = useState({ host: '', port: 3306, database: '', user: '', password: '' });
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const setField = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setTestResult(null);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await dbConfigAPI.get();
      const cfg = res.data?.config || {};
      setCurrent(res.data || null);
      setForm({
        host: cfg.host || '127.0.0.1',
        port: cfg.port || 3306,
        database: cfg.database || 'warehouse_pos',
        user: cfg.user || 'root',
        password: '',
      });
    } catch (e) {
      showMsg(e.response?.data?.error || 'DB 설정을 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showMsg]);

  useEffect(() => { load(); }, [load]);

  const payload = () => ({
    host: form.host,
    port: Number(form.port),
    database: form.database,
    user: form.user,
    password: form.password,
  });

  const test = async () => {
    setTesting(true);
    try {
      const res = await dbConfigAPI.test(payload());
      setTestResult(res.data);
      showMsg(`연결 성공: ${res.data.version || 'MariaDB'}`);
    } catch (e) {
      const data = e.response?.data;
      setTestResult(data || { ok: false, error: e.message });
      showMsg(data?.error || 'DB 연결 테스트 실패', 'error');
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!window.confirm('DB 설정을 저장할까요? 저장 후 백엔드를 재시작해야 새 DB로 적용됩니다.')) return;
    setSaving(true);
    try {
      const res = await dbConfigAPI.save(payload());
      setTestResult(res.data?.test || null);
      showMsg(res.data?.message || 'DB 설정 저장 완료');
      await load();
    } catch (e) {
      showMsg(e.response?.data?.error || 'DB 설정 저장 실패', 'error');
    } finally {
      setSaving(false);
    }
  };

  const statBox = (label, value, color = '#e6edf3') => (
    <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 14, color, fontWeight: 700 }}>{value}</div>
    </div>
  );

  if (loading) return <div style={{ color: '#8b949e', padding: 24 }}>DB 설정을 불러오는 중...</div>;

  return (
    <div style={{ maxWidth: 860 }}>
      <SectionHeader
        title="DB 설정"
        subtitle="이 서버가 바라볼 MariaDB 접속 정보를 설정합니다."
        action={<button onClick={load} style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', padding: '7px 14px', borderRadius: 6, cursor: 'pointer' }}>새로고침</button>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        {statBox('현재 적용 중', `${current?.currentProcess?.host || '-'}:${current?.currentProcess?.port || '-'}`, '#58a6ff')}
        {statBox('저장된 DB', `${current?.config?.host || '-'}:${current?.config?.port || '-'}`, '#3fb950')}
        {statBox('DB 이름', current?.config?.database || '-', '#e6edf3')}
        {statBox('비밀번호', current?.config?.hasPassword ? '설정됨' : '미설정', current?.config?.hasPassword ? '#3fb950' : '#f85149')}
      </div>

      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 22, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <Field label="Host">
            <input style={inputStyle} value={form.host} onChange={e => setField('host', e.target.value)} placeholder="127.0.0.1 또는 DB 서버 IP" />
          </Field>
          <Field label="Port">
            <input style={inputStyle} type="number" value={form.port} onChange={e => setField('port', e.target.value)} placeholder="3306" />
          </Field>
        </div>
        <Field label="Database">
          <input style={inputStyle} value={form.database} onChange={e => setField('database', e.target.value)} placeholder="warehouse_pos" />
        </Field>
        <Field label="User">
          <input style={inputStyle} value={form.user} onChange={e => setField('user', e.target.value)} placeholder="root" />
        </Field>
        <Field label="Password">
          <input
            style={inputStyle}
            type="password"
            value={form.password}
            onChange={e => setField('password', e.target.value)}
            placeholder={current?.config?.hasPassword ? '변경하지 않으려면 비워두세요' : 'DB 비밀번호'}
            autoComplete="new-password"
          />
        </Field>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={test} disabled={testing || saving} style={{ background: '#1f6feb', border: '1px solid #388bfd', color: '#fff', padding: '8px 16px', borderRadius: 6, cursor: testing ? 'wait' : 'pointer', fontWeight: 600 }}>
            {testing ? '테스트 중...' : '연결 테스트'}
          </button>
          <button onClick={save} disabled={saving || testing} style={{ background: '#238636', border: '1px solid #2ea043', color: '#fff', padding: '8px 16px', borderRadius: 6, cursor: saving ? 'wait' : 'pointer', fontWeight: 600 }}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>

      {testResult && (
        <div style={{
          background: testResult.ok ? '#1a3a2a' : '#3a1a1a',
          border: `1px solid ${testResult.ok ? '#238636' : '#8b1a1a'}`,
          color: testResult.ok ? '#3fb950' : '#f85149',
          borderRadius: 8,
          padding: 16,
          fontSize: 13,
          lineHeight: 1.7,
        }}>
          {testResult.ok ? (
            <>
              <div style={{ fontWeight: 700 }}>연결 성공</div>
              <div>버전: {testResult.version || '-'}</div>
              <div>테이블 수: {testResult.tableCount}</div>
              <div>GW 매핑 테이블: {testResult.hasGwMappingTable ? '있음' : '없음'}</div>
            </>
          ) : (
            <div>{testResult.error || '연결에 실패했습니다.'}</div>
          )}
        </div>
      )}

      <div style={{ marginTop: 16, background: '#0d1117', border: '1px solid #21262d', borderRadius: 8, padding: 16, color: '#8b949e', fontSize: 12, lineHeight: 1.7 }}>
        저장한 설정은 <code style={{ color: '#c9d1d9' }}>backend/.env</code>에 반영됩니다. 이미 실행 중인 백엔드는 기존 DB 연결을 유지하므로 서비스 재실행 후 새 DB가 적용됩니다.
      </div>
    </div>
  );
}

function PurchaseCartPanel({ showMsg, currentUser }) {
  const [cart, setCart] = useState({ items: [], totalQuantity: 0, totalAmount: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({
    corp: '',
    title: '컴퓨존 구매 건',
    requester: currentUser?.name || '',
    memo: '',
    allowPartial: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await purchaseCartAPI.getCart();
      setCart(res.data || { items: [], totalQuantity: 0, totalAmount: 0 });
    } catch (e) {
      showMsg(e.response?.data?.error || '장바구니 로드 실패', 'error');
    } finally {
      setLoading(false);
    }
  }, [showMsg]);

  useEffect(() => { load(); }, [load]);

  const changeQty = async (item, quantity) => {
    const nextQty = Math.max(0, parseInt(quantity, 10) || 0);
    try {
      const res = await purchaseCartAPI.updateItem(item.cartItemId, { quantity: nextQty });
      setCart(res.data);
    } catch (e) {
      showMsg(e.response?.data?.error || '수량 변경 실패', 'error');
    }
  };

  const removeItem = async (item) => {
    try {
      const res = await purchaseCartAPI.removeItem(item.cartItemId);
      setCart(res.data);
    } catch (e) {
      showMsg(e.response?.data?.error || '삭제 실패', 'error');
    }
  };

  const clearCart = async () => {
    try {
      const res = await purchaseCartAPI.clear();
      setCart(res.data);
      setResult(null);
      showMsg('장바구니를 비웠습니다');
    } catch (e) {
      showMsg(e.response?.data?.error || '장바구니 비우기 실패', 'error');
    }
  };

  const refreshImage = async (item) => {
    try {
      await purchaseCartAPI.refreshImage(item.product.id, { sourceId: item.product.source?.id || undefined });
      await load();
      showMsg('이미지 갱신 완료');
    } catch (e) {
      showMsg(e.response?.data?.error || '이미지 갱신 실패', 'error');
    }
  };

  const checkout = async () => {
    setSaving(true);
    setResult(null);
    try {
      const res = await purchaseCartAPI.checkout(form);
      setResult(res.data);
      showMsg('Purchase_Auto 구매 작업을 생성했습니다');
    } catch (e) {
      const data = e.response?.data;
      setResult(data || null);
      showMsg(data?.error || '구매 작업 생성 실패', 'error');
    } finally {
      setSaving(false);
    }
  };

  const split = useMemo(() => {
    const compuzone = [];
    const manual = [];
    const blocked = [];
    (cart.items || []).forEach(item => {
      const source = item.product?.source || {};
      if (source.type === 'compuzone' && source.productUrl && source.isPurchasable) compuzone.push(item);
      else if (source.type === 'manual' || !source.type) manual.push(item);
      else blocked.push(item);
    });
    return { compuzone, manual, blocked };
  }, [cart.items]);

  return (
    <div>
      <SectionHeader
        title="장바구니"
        subtitle="카테고리에서 담은 품목을 컴퓨존 구매 작업으로 넘깁니다"
        action={cart.items?.length ? <button onClick={clearCart} style={{
          background: 'none', border: '1px solid #3a1a1a', color: '#f85149',
          padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
        }}>비우기</button> : null}
      />

      {loading ? (
        <div style={{ color: '#8b949e', padding: 40, textAlign: 'center' }}>불러오는 중...</div>
      ) : cart.items.length === 0 ? (
        <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 40, textAlign: 'center', color: '#8b949e' }}>
          카테고리 관리에서 품목을 장바구니에 담으세요.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18, alignItems: 'start' }}>
            <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ background: '#1c2128' }}>
                  <tr>
                    {['상품', '구매처', '단가', '수량', '금액', ''].map(h => (
                      <th key={h} style={{ textAlign: h === '상품' ? 'left' : 'right', padding: '10px 12px', color: '#8b949e', fontWeight: 500, borderBottom: '1px solid #21262d' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cart.items.map(item => {
                    const product = item.product || {};
                    const source = product.source || {};
                    return (
                      <tr key={item.cartItemId} style={{ borderBottom: '1px solid #21262d' }}>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <ProductThumb product={product} onOpen={setImagePreview} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ color: '#e6edf3', fontWeight: 700 }}>{product.productName}</div>
                              <div style={{ color: '#8b949e', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{product.specification || product.productCode}</div>
                              <div style={{ display: 'flex', gap: 10, marginTop: 5, fontSize: 11 }}>
                                {source.productUrl ? <a href={source.productUrl} target="_blank" rel="noreferrer" style={{ color: '#58a6ff' }}>상품 페이지</a> : <span style={{ color: '#f0883e' }}>URL 없음</span>}
                                <button onClick={() => refreshImage(item)} style={{ background: 'none', border: 'none', padding: 0, color: '#8b949e', cursor: 'pointer', fontSize: 11 }}>이미지 갱신</button>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}><Badge color={sourceBadgeColor(source)}>{sourceLabel(source)}</Badge></td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#e6edf3' }}>{formatWon(product.unitPrice)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <input type="number" min="0" value={item.quantity} onChange={e => changeQty(item, e.target.value)}
                            style={{ ...inputStyle, width: 70, padding: '6px 8px', textAlign: 'right', fontSize: 13 }} />
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#e6edf3', fontWeight: 700 }}>{formatWon(item.subtotal)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <button onClick={() => removeItem(item)} style={{
                            background: 'none', border: '1px solid #3a1a1a', color: '#f85149',
                            padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                          }}>삭제</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, padding: 10 }}>
                  <div style={{ color: '#8b949e', fontSize: 12 }}>총 수량</div>
                  <div style={{ color: '#e6edf3', fontSize: 20, fontWeight: 800 }}>{cart.totalQuantity.toLocaleString()}</div>
                </div>
                <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, padding: 10 }}>
                  <div style={{ color: '#8b949e', fontSize: 12 }}>예상 금액</div>
                  <div style={{ color: '#e6edf3', fontSize: 20, fontWeight: 800 }}>{formatWon(cart.totalAmount)}</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                <Badge color="blue">컴퓨존 {split.compuzone.length}</Badge>
                <Badge color="gray">수동 {split.manual.length}</Badge>
                <Badge color="purple">외부 {split.blocked.length}</Badge>
              </div>

              {(split.manual.length || split.blocked.length) > 0 && (
                <div style={{ background: '#3a2e00', border: '1px solid #9e6a03', color: '#e3b341', borderRadius: 6, padding: 10, fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
                  컴퓨존 자동구매가 안 되는 항목이 포함되어 있습니다. 기본은 막아두고, 아래 옵션을 켜면 컴퓨존 상품만 먼저 구매 작업으로 넘깁니다.
                </div>
              )}

              <Field label="법인/회사 *">
                <input value={form.corp} onChange={e => setForm(f => ({ ...f, corp: e.target.value }))} style={inputStyle} placeholder="예: 대승정밀" />
              </Field>
              <Field label="품의 제목 *">
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="요청자 *">
                <input value={form.requester} onChange={e => setForm(f => ({ ...f, requester: e.target.value }))} style={inputStyle} />
              </Field>
              <Field label="메모">
                <textarea value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} style={{ ...inputStyle, minHeight: 86, resize: 'vertical' }} placeholder="공장/부서/대상자/용도 등" />
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c9d1d9', fontSize: 13, marginBottom: 14 }}>
                <input type="checkbox" checked={form.allowPartial} onChange={e => setForm(f => ({ ...f, allowPartial: e.target.checked }))} style={{ accentColor: '#58a6ff' }} />
                컴퓨존 상품만 먼저 구매 작업 생성
              </label>
              <button onClick={checkout} disabled={saving || split.compuzone.length === 0} style={{
                width: '100%', background: saving || split.compuzone.length === 0 ? '#30363d' : '#238636',
                border: `1px solid ${saving || split.compuzone.length === 0 ? '#444c56' : '#2ea043'}`,
                color: '#fff', padding: '10px 14px', borderRadius: 6,
                cursor: saving || split.compuzone.length === 0 ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 800,
              }}>{saving ? '생성 중...' : 'Purchase_Auto 작업 생성'}</button>
            </div>
          </div>

          {result && (
            <div style={{ marginTop: 16, background: result.error ? '#3a1a1a' : '#1a3a2a', border: `1px solid ${result.error ? '#f85149' : '#3fb950'}`, borderRadius: 8, padding: 14, color: result.error ? '#f85149' : '#3fb950', fontSize: 13 }}>
              {result.error ? (
                <div>{result.error}</div>
              ) : (
                <div>
                  구매 작업 생성 완료
                  {result.purchaseJob?.job_id && <span style={{ marginLeft: 8, fontFamily: 'monospace' }}>{result.purchaseJob.job_id}</span>}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <ImagePreviewModal product={imagePreview} onClose={() => setImagePreview(null)} />
    </div>
  );
}

function AutoOrderPanel() {
  return (
    <div>
      <SectionHeader title="자동발주" subtitle="자동발주 설정 및 발주 이력 — 준비 중" />
      <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>◌</div>
        <h3 style={{ color: '#8b949e', margin: '0 0 8px' }}>자동발주 기능 준비 중</h3>
        <p style={{ color: '#444c56', fontSize: 13, margin: '0 0 24px' }}>
          저재고 기준으로 자동 발주 추천 및 발주 처리 기능이 추가될 예정입니다.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          {['자동발주 설정', '발주 추천 목록', '자동발주 이력'].map(f => (
            <div key={f} style={{ background: '#1c2128', border: '1px solid #21262d', borderRadius: 6, padding: '8px 20px', color: '#444c56', fontSize: 13 }}>{f} — 예정</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  GW 소모품 매핑 패널
// ─────────────────────────────────────────────────────────────────
function GwMappingPanel({ showMsg }) {
  const [view, setView] = useState("unregistered"); // "unregistered" | "completed" | "excluded"
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catTree, setCatTree] = useState([]);
  const [catPathMap, setCatPathMap] = useState({});
  const [mappingModal, setMappingModal] = useState(null); // { gwItem, productId, catSel }
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // 카테고리 빠른 추가 모달
  const [catAddModal, setCatAddModal] = useState(null);
  const [catAddName, setCatAddName] = useState("");
  const [catAddSaving, setCatAddSaving] = useState(false);

  const loadCatTree = async () => {
    const t = await categoriesAPI.getTree();
    const tree = t.data || [];
    setCatTree(tree);
    const pathMap = {};
    buildCatPathMap(tree, "", pathMap);
    setCatPathMap(pathMap);
    return tree;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res] = await Promise.all([
        gwMappingAPI.getItems(),
        loadCatTree()
      ]);
      setItems(res.data || []);
      return true;
    } catch (e) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || "알 수 없는 오류";
      showMsg(`데이터 로드 실패: ${msg}`, "error");
      return false;
    } finally {
      setLoading(false);
    }
  }, [showMsg]);

  useEffect(() => { load(); }, [load]);

  const refreshMappingStatus = async () => {
    const ok = await load();
    if (ok) showMsg("그룹웨어와 현재 시스템 상태를 다시 비교했습니다");
  };

  const openMapping = (item) => {
    const isEdit = !!item.mappedProduct;
    let initialCatSel = { l1: "", l2: "", l3: "", l4: "", l5: "" };

    // 1. 이미 매핑된 정보가 있는 경우 해당 카테고리 복원
    if (isEdit && item.mappedProduct.categoryId) {
      const path = findCatPath(catTree, item.mappedProduct.categoryId);
      if (path) {
        ["l1","l2","l3","l4","l5"].forEach((k, i) => { if (path[i]) initialCatSel[k] = String(path[i]); });
      }
    } 
    // 2. 매핑 정보가 없거나 카테고리가 없는 경우, GW 카테고리명으로 자동 검색
    else if (item.category) {
      // 트리 전체에서 이름이 일치하는 카테고리 ID 찾기 (재귀)
      const findIdByName = (nodes, name) => {
        for (const n of nodes) {
          if (n.name.trim() === name.trim()) return n.id;
          if (n.children?.length > 0) {
            const found = findIdByName(n.children, name);
            if (found) return found;
          }
        }
        return null;
      };

      const matchedId = findIdByName(catTree, item.category);
      if (matchedId) {
        const path = findCatPath(catTree, matchedId);
        if (path) {
          ["l1","l2","l3","l4","l5"].forEach((k, i) => { if (path[i]) initialCatSel[k] = String(path[i]); });
        }
      }
    }

    setMappingModal({
      gwItem: item,
      productId: item.mappedProduct?.id || null,
      productName: item.mappingNeedsReview ? item.itemName : (item.mappedProduct?.productName || item.itemName),
      specification: "",
      categoryId: item.mappedProduct?.categoryId || "",
      unit: item.mappedProduct?.unit || "개",
      catSel: initialCatSel
    });
  };

  const handleMapSave = async () => {
    if (!mappingModal.productName || !mappingModal.unit) return showMsg("품명과 단위는 필수입니다", "error");
    setSaving(true);
    try {
      const catId = mappingModal.catSel.l5 || mappingModal.catSel.l4 || mappingModal.catSel.l3 || mappingModal.catSel.l2 || mappingModal.catSel.l1 || null;
      await gwMappingAPI.mapItem({
        gwDocId: mappingModal.gwItem.gwDocId,
        productId: mappingModal.productId,
        productName: mappingModal.productName,
        specification: mappingModal.specification,
        categoryId: catId,
        unit: mappingModal.unit
      });
      showMsg(mappingModal.productId ? "매핑 수정 완료" : "품목 등록 및 연결 완료");
      setMappingModal(null);
      load();
    } catch (e) {
      showMsg(e.response?.data?.error || "저장 실패", "error");
    } finally {
      setSaving(false);
    }
  };

  const excludeMapping = async (item) => {
    if (!item.mappedProduct?.id) {
      showMsg("제외할 기존 매핑 품목이 없습니다", "error");
      return;
    }
    if (!window.confirm(`${item.itemName} 항목을 매핑 제외 목록으로 이동할까요?`)) return;
    try {
      await gwMappingAPI.excludeItem({ gwDocId: item.gwDocId, productId: item.mappedProduct.id });
      showMsg("매핑 제외로 이동했습니다");
      load();
    } catch (e) {
      showMsg(e.response?.data?.error || "제외 처리 실패", "error");
    }
  };

  // ── 카테고리 빠른 추가 ──
  const openCatAdd = () => {
    const cs = mappingModal.catSel;
    const lv = cs.l5 ? 5 : cs.l4 ? 4 : cs.l3 ? 3 : cs.l2 ? 2 : cs.l1 ? 1 : 0;
    if (lv >= 5) { showMsg("L5가 최하위 레벨입니다", "error"); return; }
    const addLevel = lv + 1;
    const parentId = lv > 0 ? parseInt(cs["l" + lv]) : null;
    const parentName = lv > 0 ? catPathMap[parentId] || "선택된 상위" : "최상위(부서)";

    // 카테고리 추가 시 GW 품목명을 기본값으로 채워줌
    setCatAddName(mappingModal.productName || "");
    setCatAddModal({ addLevel, parentId, parentName });
  };

  const handleQuickAddCat = async () => {
    if (!catAddName.trim()) return showMsg("이름을 입력하세요", "error");
    setCatAddSaving(true);
    try {
      let newCat;
      if (catAddModal.addLevel === 1) {
        newCat = (await categoriesAPI.createDept({ name: catAddName.trim() })).data;
      } else {
        newCat = (await categoriesAPI.create({ name: catAddName.trim(), level: catAddModal.addLevel, parentId: catAddModal.parentId })).data;
      }
      showMsg(`"${catAddName.trim()}" 카테고리 추가 완료`);
      setCatAddModal(null);
      const newTree = await loadCatTree();
      const path = findCatPath(newTree, newCat.id);
      if (path) {
        const sel = { l1: "", l2: "", l3: "", l4: "", l5: "" };
        ["l1","l2","l3","l4","l5"].forEach((k, i) => { if (path[i]) sel[k] = String(path[i]); });
        setMappingModal(m => ({ ...m, catSel: sel }));
      }
    } catch (e) {
      showMsg(e.response?.data?.error || "카테고리 추가 실패", "error");
    } finally { setCatAddSaving(false); }
  };

  const filtered = items.filter(it => {
    const mappedProducts = it.mappedProducts || (it.mappedProduct ? [it.mappedProduct] : []);
    const isComplete = mappedProducts.length > 0 && !it.mappingNeedsReview;
    if (view === "excluded" && !it.excluded) return false;
    if (view === "unregistered" && (isComplete || it.excluded)) return false;
    if (view === "completed" && (!isComplete || it.excluded)) return false;
    if (!search) return true;
    return it.itemName.toLowerCase().includes(search.toLowerCase()) || 
           it.gwDocId.includes(search) ||
           mappedProducts.some(p =>
             (p.productName || "").toLowerCase().includes(search.toLowerCase()) ||
             (p.specification || "").toLowerCase().includes(search.toLowerCase())
           );
  });

  return (
    <div>
      <SectionHeader title="GW 소모품 매핑" subtitle="그룹웨어 소모품(Applet 26) 품목과 시스템 품목 연결 관리" />

      <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid #21262d" }}>
        {[["unregistered", "매핑 필요"], ["completed", "매핑 완료"], ["excluded", "매핑 제외"]].map(([v, label]) => (
          <button key={v} onClick={() => setView(v)} style={{
            background: "none", border: "none", cursor: "pointer", padding: "8px 18px",
            fontSize: 13, fontWeight: view === v ? 700 : 400,
            color: view === v ? "#e6edf3" : "#8b949e",
            borderBottom: view === v ? "2px solid #58a6ff" : "2px solid transparent", marginBottom: -1,
          }}>
            {label}
            <span style={{ marginLeft: 6, fontSize: 11, padding: "1px 6px", borderRadius: 10, background: "#1a3a2a", color: "#3fb950" }}>
              {items.filter(it => {
                const mappedProducts = it.mappedProducts || (it.mappedProduct ? [it.mappedProduct] : []);
                const isComplete = mappedProducts.length > 0 && !it.mappingNeedsReview;
                if (v === "excluded") return !!it.excluded;
                return v === "unregistered" ? !isComplete && !it.excluded : isComplete && !it.excluded;
              }).length}
            </span>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, justifyContent: "space-between", alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="GW품목명, 문서ID, 매핑 품목 검색" style={{ ...inputStyle, maxWidth: 280 }} />
        <button onClick={refreshMappingStatus} disabled={loading} style={{
          background: "#1f6feb", border: "1px solid #388bfd", color: "#fff",
          padding: "8px 14px", borderRadius: 6, cursor: loading ? "wait" : "pointer",
          fontSize: 12, fontWeight: 700
        }}>
          {loading ? "비교 중..." : "새로고침"}
        </button>
      </div>

      <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ background: "#1c2128" }}>
            <tr>
              {["GW 문서ID", "GW 품목명", "GW 카테고리", "GW 기준/보유", view !== "unregistered" ? "매핑된 품목" : null, ""].filter(Boolean).map(h => (
                <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: "#8b949e", fontWeight: 500, borderBottom: "1px solid #21262d" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" style={{ textAlign: "center", padding: 40, color: "#8b949e" }}>로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan="6" style={{ textAlign: "center", padding: 40, color: "#8b949e" }}>데이터가 없습니다</td></tr>
            ) : filtered.map(it => (
              <tr key={it.gwDocId} style={{ borderBottom: "1px solid #21262d" }}>
                <td style={{ padding: "10px 12px", color: "#8b949e", fontFamily: "monospace" }}>{it.gwDocId}</td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ color: "#e6edf3", fontWeight: 500 }}>{it.itemName}</div>
                  {it.mappingNeedsReview && it.mappingIssues?.length > 0 && (
                    <div style={{ color: "#e3b341", fontSize: 11, marginTop: 4 }}>
                      {it.mappingIssues.join(", ")}
                    </div>
                  )}
                </td>
                <td style={{ padding: "10px 12px", color: "#8b949e" }}>{it.category}</td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ color: "#8b949e", fontSize: 12 }}>기준: {it.baseQty || 0}</div>
                  <div style={{ color: "#3fb950", fontSize: 12, fontWeight: 600 }}>보유: {it.currentStock || 0}</div>
                </td>
                {view !== "unregistered" && (
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ color: "#e6edf3", fontSize: 12, fontWeight: 700 }}>{it.itemName}</div>
                    <div style={{ color: "#8b949e", fontSize: 11, marginTop: 2 }}>
                      {(it.mappedProducts || (it.mappedProduct ? [it.mappedProduct] : []))
                        .map(product => product.specification || product.productName)
                        .filter(Boolean)
                        .join(", ")}
                    </div>
                  </td>
                )}
                <td style={{ padding: "10px 12px", textAlign: "right" }}>
                  <button onClick={() => openMapping(it)} style={{
                    background: "none", border: "1px solid #30363d", color: "#8b949e",
                    padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12
                  }}>
                    {view === "completed" ? "수정" : it.mappedProduct ? "수정/재매핑" : "등록/매핑"}
                  </button>
                  {view === "unregistered" && it.mappedProduct && (
                    <button onClick={() => excludeMapping(it)} style={{
                      marginLeft: 6, background: "none", border: "1px solid #6e7681", color: "#8b949e",
                      padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: 12
                    }}>
                      제외
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mappingModal && (
        <Modal title={mappingModal.productId ? "매핑 수정" : "품목 등록 및 매핑"} onClose={() => setMappingModal(null)}>
          <div style={{ marginBottom: 20, padding: 12, background: "#0d1117", border: "1px solid #21262d", borderRadius: 6 }}>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>GW 정보 (원본)</div>
            <div style={{ color: "#e6edf3", fontSize: 14, fontWeight: 600 }}>{mappingModal.gwItem.itemName}</div>
          </div>

          <Field label="품명 *">
            <input value={mappingModal.productName} onChange={e => setMappingModal(m => ({ ...m, productName: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="카테고리">
            <CascadeCatSelect
              tree={catTree}
              catSel={mappingModal.catSel}
              onChange={(sel) => setMappingModal(m => ({ ...m, catSel: sel }))}
              allowDirectSelect
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              {mappingModal.catSel.l1 ? (
                <div style={{ flex: 1, fontSize: 11, color: "#58a6ff", padding: "4px 8px", background: "#0d2044", borderRadius: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {catPathMap[mappingModal.catSel.l5 || mappingModal.catSel.l4 || mappingModal.catSel.l3 || mappingModal.catSel.l2 || mappingModal.catSel.l1] || "경로 로딩 중..."}
                </div>
              ) : (
                <div style={{ flex: 1, fontSize: 11, color: "#444c56", padding: "4px 8px" }}>미선택</div>
              )}
              <button onClick={openCatAdd} title="새 카테고리 추가" style={{ background: "none", border: "1px solid #238636", color: "#3fb950", padding: "3px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}>+ 카테고리 추가</button>
            </div>
          </Field>
          <Field label="단위 *">
            <select value={mappingModal.unit} onChange={e => setMappingModal(m => ({ ...m, unit: e.target.value }))} style={inputStyle}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>

          <SaveBtn onClick={handleMapSave} loading={saving} label={mappingModal.productId ? "변경 저장" : "등록 및 매핑"} />
        </Modal>
      )}

      {/* ─── 카테고리 빠른 추가 모달 ─── */}
      {catAddModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 }}
          onClick={() => setCatAddModal(null)}>
          <div style={{ background: "#161b22", border: "1px solid #238636", borderRadius: 10, width: 360, padding: "22px 24px" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#3fb950", marginBottom: 4 }}>카테고리 추가</div>
            <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 14 }}>
              L{catAddModal.addLevel} 추가 — 상위: <span style={{ color: "#c9d1d9" }}>{catAddModal.parentName}</span>
            </div>
            <Field label={`카테고리명 (L${catAddModal.addLevel}) *`}>
              <input value={catAddName} onChange={e => setCatAddName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleQuickAddCat()}
                style={inputStyle} placeholder="카테고리 이름 입력" autoFocus />
            </Field>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <SaveBtn onClick={handleQuickAddCat} loading={catAddSaving} label="추가" />
              <button onClick={() => setCatAddModal(null)} style={{ background: "none", border: "1px solid #30363d", color: "#8b949e", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 시스템 업데이트 패널 ─────────────────────────────────────────
const STATUS_LABEL = {
  in_progress:     { text: '진행 중',  color: '#e3b341' },
  success:         { text: '성공',     color: '#3fb950' },
  failed:          { text: '실패',     color: '#f85149' },
  rolled_back:     { text: '롤백됨',   color: '#8b949e' },
  rollback_failed: { text: '롤백실패', color: '#f85149' },
};

function UpdatePanel({ showMsg }) {
  const [tab, setTab]           = React.useState('apply'); // apply | github | history | log
  const [versionInfo, setVersionInfo] = React.useState(null);
  const [newVersion, setNewVersion] = React.useState('');
  const [gitBranch, setGitBranch] = React.useState('main');
  const [buildFrontend, setBuildFrontend] = React.useState(true);
  const [packages, setPackages] = React.useState([]);
  const [selectedPkg, setSelectedPkg] = React.useState('');
  const [dragOver, setDragOver] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [creatingPkg, setCreatingPkg] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [rolling, setRolling]   = React.useState(null);
  const [history, setHistory]   = React.useState([]);
  const [log, setLog]           = React.useState('');
  const [github, setGithub]     = React.useState(null);
  const [ghLoading, setGhLoading] = React.useState(false);
  const [ghDownloading, setGhDownloading] = React.useState(false);
  const token = localStorage.getItem('token');
  const headers = React.useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const API = `${process.env.REACT_APP_API_BASE_URL || '/api'}/update`;

  const loadVersion  = React.useCallback(() => fetch(`${API}/check`).then(r => r.json()).then(setVersionInfo).catch(() => {}), [API]);
  const loadPackages = React.useCallback(() => fetch(`${API}/packages`, { headers }).then(r => r.json()).then(d => {
    if (Array.isArray(d)) {
      setPackages(d);
      if (!d.some(pkg => pkg.name === selectedPkg)) setSelectedPkg(d[0]?.name || '');
    }
  }).catch(() => {}), [API, headers, selectedPkg]);
  const loadHistory  = React.useCallback(() => fetch(`${API}/history`, { headers }).then(r => r.json()).then(d => Array.isArray(d) && setHistory(d)).catch(() => {}), [API, headers]);
  const loadLog      = React.useCallback(() => fetch(`${API}/log`, { headers }).then(r => r.json()).then(d => setLog(d.log || '로그 없음')).catch(() => setLog('로그를 읽을 수 없습니다.')), [API, headers]);

  React.useEffect(() => { loadVersion(); loadPackages(); loadHistory(); }, [loadVersion, loadPackages, loadHistory]);
  React.useEffect(() => { if (tab === 'log') loadLog(); if (tab === 'history') loadHistory(); }, [tab, loadLog, loadHistory]);

  const refreshAll = async () => {
    await Promise.all([loadVersion(), loadPackages(), loadHistory()]);
    if (tab === 'log') await loadLog();
    showMsg('새로고침 완료');
  };

  const uploadFile = async (file) => {
    if (!file || !file.name.endsWith('.zip')) { showMsg('zip 파일만 업로드 가능합니다.'); return; }
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`${API}/upload`, { method: 'POST', headers, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업로드 실패');
      showMsg(`업로드 완료: ${data.filename}`);
      await loadPackages();
      setSelectedPkg(data.filename);
    } catch (e) { showMsg('오류: ' + e.message); }
    finally { setUploading(false); }
  };

  const applyUpdate = async (filenameOverride = null, skipConfirm = false) => {
    const targetPkg = filenameOverride || selectedPkg;
    if (!targetPkg) { showMsg('적용할 패키지를 선택하세요.'); return false; }
    if (!skipConfirm && !window.confirm(`${targetPkg} 을 적용합니다.\n서비스가 잠시 중단됩니다. 계속하시겠습니까?`)) return false;
    setApplying(true);
    try {
      const res = await fetch(`${API}/apply`, { 
        method: 'POST', 
        headers: { ...headers, 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ filename: targetPkg }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업데이트 실패');
      showMsg(data.message);
      setTimeout(() => window.location.reload(), 15000);
      return true;
    } catch (e) { showMsg('오류: ' + e.message); setApplying(false); return false; }
  };

  const doRollback = async (record) => {
    if (!window.confirm(`v${record.versionBefore || '?'} 으로 롤백합니다.\n서비스가 잠시 중단됩니다. 계속하시겠습니까?`)) return;
    setRolling(record.id);
    try {
      const res = await fetch(`${API}/rollback/${record.id}`, { method: 'POST', headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '롤백 실패');
      showMsg(data.message);
      setTimeout(() => window.location.reload(), 15000);
    } catch (e) { showMsg('롤백 오류: ' + e.message); setRolling(null); }
  };

  const checkGithub = async () => {
    setGhLoading(true); setGithub(null);
    try {
      const res = await fetch(`${API}/github/check`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setGithub(data);
    } catch (e) { showMsg('GitHub 오류: ' + e.message); }
    finally { setGhLoading(false); }
  };

  const downloadGithub = async (asset) => {
    setGhDownloading(true);
    try {
      const res = await fetch(`${API}/github/download`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ assetUrl: asset.url, filename: asset.name }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showMsg(`다운로드 완료: ${data.filename}`);
      await loadPackages();
      setSelectedPkg(data.filename);
      setTab('apply');
    } catch (e) { showMsg('다운로드 오류: ' + e.message); }
    finally { setGhDownloading(false); }
  };

  const createPackage = async () => {
    const version = newVersion.trim();
    if (!version) { showMsg('생성할 버전을 입력하세요.'); return; }
    setCreatingPkg(true);
    try {
      const res = await fetch(`${API}/create-package`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version,
          buildFrontend,
          sourceMode: 'git',
          gitBranch: gitBranch.trim() || 'main',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업데이트 패키지 생성 실패');
      showMsg(data.message || '업데이트 패키지 생성 및 목록 등록 완료');
      await loadPackages();
      const uploaded = data.uploadedFilename || data.filename;
      if (uploaded) setSelectedPkg(uploaded);
    } catch (e) {
      showMsg('생성 오류: ' + e.message);
    } finally {
      setCreatingPkg(false);
    }
  };

  const createPackageAndApply = async () => {
    const version = newVersion.trim();
    if (!version) { showMsg('생성할 버전을 입력하세요.'); return; }
    if (!window.confirm(`v${version} 업데이트 파일을 생성한 뒤 즉시 적용합니다.\n서비스가 잠시 중단됩니다. 계속하시겠습니까?`)) return;
    setCreatingPkg(true);
    try {
      const res = await fetch(`${API}/create-package`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version,
          buildFrontend,
          sourceMode: 'git',
          gitBranch: gitBranch.trim() || 'main',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업데이트 패키지 생성 실패');
      showMsg(data.message || '업데이트 패키지 생성 및 목록 등록 완료');
      await loadPackages();
      const uploaded = data.uploadedFilename || data.filename;
      if (uploaded) setSelectedPkg(uploaded);
      await applyUpdate(uploaded, true);
    } catch (e) {
      showMsg('생성 오류: ' + e.message);
    } finally {
      setCreatingPkg(false);
    }
  };

  const s = {
    card:  { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '20px 24px', marginBottom: 16 },
    btn:   (color, dis) => ({ padding: '8px 16px', borderRadius: 6, border: 'none', cursor: dis ? 'not-allowed' : 'pointer', background: dis ? '#21262d' : color, color: dis ? '#484f58' : '#fff', fontWeight: 600, fontSize: 12 }),
    tab:   (active) => ({ padding: '8px 18px', borderRadius: '6px 6px 0 0', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: active ? '#161b22' : 'transparent', color: active ? '#58a6ff' : '#8b949e', borderBottom: active ? '2px solid #58a6ff' : '2px solid transparent' }),
    th:    { padding: '8px 10px', textAlign: 'left', fontSize: 11, color: '#8b949e', fontWeight: 500, borderBottom: '1px solid #21262d' },
    td:    { padding: '8px 10px', fontSize: 12, color: '#e6edf3', borderBottom: '1px solid #21262d', verticalAlign: 'middle' },
    drop:  (over) => ({ border: `2px dashed ${over ? '#58a6ff' : '#30363d'}`, borderRadius: 8, padding: '32px 16px', textAlign: 'center', cursor: 'pointer', background: over ? '#1a2332' : '#0d1117', marginBottom: 16, transition: 'all .2s' }),
    logBox:{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: 14, fontSize: 12, color: '#8b949e', fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 400, overflowY: 'auto' },
  };

  const busy = applying || rolling !== null;

  return (
    <div style={{ padding: 28, maxWidth: 900 }}>
      <SectionHeader title="시스템 업데이트" subtitle="zip 업로드 또는 GitHub에서 업데이트 적용" />

      {/* 현재 버전 */}
      <div style={{ ...s.card, display: 'flex', gap: 40, alignItems: 'center' }}>
        <div><div style={{ fontSize: 11, color: '#8b949e' }}>현재 버전</div><div style={{ fontSize: 22, fontWeight: 700, color: '#58a6ff' }}>{versionInfo ? `v${versionInfo.version}` : '-'}</div></div>
        <div><div style={{ fontSize: 11, color: '#8b949e' }}>빌드 날짜</div><div style={{ fontSize: 14, color: '#e6edf3', fontWeight: 600 }}>{versionInfo?.buildDate || '-'}</div></div>
        <button onClick={refreshAll} style={{ ...s.btn('#21262d', false), marginLeft: 'auto' }}>새로고침</button>
      </div>

      {/* 탭 */}
      <div style={{ display: 'flex', borderBottom: '1px solid #21262d', marginBottom: 0 }}>
        {[['apply','Git 업데이트 적용'],['history','이력'],['log','로그']].map(([id, label]) => (
          <button key={id} style={s.tab(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {/* ── 업데이트 적용 탭 ── */}
      {tab === 'apply' && (
        <div style={s.card}>
          <div style={{ marginBottom: 16, padding: 12, border: '1px solid #21262d', borderRadius: 8, background: '#0d1117' }}>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
              Git 원격 저장소의 main 브랜치를 새로 가져와 업데이트 패키지를 생성합니다. 로컬에 아직 pull 하지 않은 변경도 main에 머지되어 있으면 포함됩니다.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input
                value={newVersion}
                onChange={(e) => setNewVersion(e.target.value)}
                placeholder="버전 (예: 1.0.3)"
                style={{ flex: 1, minWidth: 160, background: '#161b22', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', padding: '8px 10px', fontSize: 12 }}
              />
              <button onClick={createPackage} disabled={creatingPkg || applying} style={s.btn('#1f6feb', creatingPkg || applying)}>
                {creatingPkg ? '패키지 생성 중...' : '패키지만 생성'}
              </button>
              <button onClick={createPackageAndApply} disabled={creatingPkg || applying} style={s.btn('#238636', creatingPkg || applying)}>
                {creatingPkg || applying ? '처리 중...' : '생성 후 바로 적용'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
              <input
                value={gitBranch}
                onChange={(e) => setGitBranch(e.target.value)}
                placeholder="Git 브랜치 (기본: main)"
                style={{ flex: 1, background: '#161b22', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', padding: '8px 10px', fontSize: 12 }}
              />
              {gitBranch !== 'main' && (
                <button onClick={() => setGitBranch('main')} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '8px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}>main</button>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>
              서버 환경변수 UPDATE_GIT_REPO 또는 GITHUB_REPO가 있으면 그 저장소를 사용하고, 없으면 서버 checkout의 origin을 사용합니다.
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8b949e' }}>
              <input type="checkbox" checked={buildFrontend} onChange={(e) => setBuildFrontend(e.target.checked)} />
              프론트엔드 빌드 포함 (화면 변경 반영 권장)
            </label>
          </div>

          {/* 드래그 & 드롭 */}
          <div
            style={s.drop(dragOver)}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); uploadFile(e.dataTransfer.files[0]); }}
            onClick={() => document.getElementById('zipInput').click()}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>↑</div>
            <div style={{ fontSize: 13, color: '#8b949e' }}>{uploading ? '업로드 중...' : 'release-vX.X.X.zip 파일을 드래그하거나 클릭하여 업로드'}</div>
            <input id="zipInput" type="file" accept=".zip" style={{ display: 'none' }} onChange={e => uploadFile(e.target.files[0])} />
          </div>

          {/* 패키지 목록 */}
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>서버에 있는 패키지 (최근 3개만 보관)</div>
          {packages.length === 0 ? (
            <div style={{ fontSize: 13, color: '#484f58', marginBottom: 16 }}>업로드된 패키지 없음</div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              {packages.map(pkg => (
                <div key={pkg.name} onClick={() => setSelectedPkg(pkg.name)}
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 12px', borderRadius: 6, cursor: 'pointer', marginBottom: 4,
                    background: selectedPkg === pkg.name ? '#1a2e4a' : '#0d1117',
                    border: `1px solid ${selectedPkg === pkg.name ? '#58a6ff' : '#21262d'}` }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, color: selectedPkg === pkg.name ? '#58a6ff' : '#e6edf3' }}>{pkg.name}</span>
                  <span style={{ fontSize: 12, color: '#8b949e' }}>{pkg.size} · {new Date(pkg.date).toLocaleDateString('ko-KR')}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => applyUpdate()} disabled={busy || !selectedPkg} style={s.btn('#238636', busy || !selectedPkg)}>
              {applying ? '⟳ 적용 중...' : '선택한 패키지 적용'}
            </button>
            {busy && <span style={{ fontSize: 13, color: '#e3b341' }}>⟳ 처리 중... 완료 후 자동 새로고침됩니다</span>}
          </div>
        </div>
      )}

      {/* ── GitHub 탭 ── */}
      {tab === 'github' && (
        <div style={s.card}>
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 16, lineHeight: 1.6 }}>
            .env 에 <code style={{ background: '#0d1117', padding: '1px 6px', borderRadius: 4 }}>GITHUB_REPO=owner/repo</code> 를 설정하면 GitHub Releases에서 최신 버전을 확인할 수 있습니다.
          </div>
          <button onClick={checkGithub} disabled={ghLoading} style={s.btn('#1f6feb', ghLoading)}>
            {ghLoading ? '확인 중...' : 'GitHub 최신 버전 확인'}
          </button>

          {github && (
            <div style={{ marginTop: 16, background: '#0d1117', borderRadius: 8, padding: 16, border: '1px solid #21262d' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#8b949e' }}>최신 버전</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: github.latest !== github.current ? '#3fb950' : '#8b949e' }}>v{github.latest}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#8b949e' }}>현재 버전</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#e6edf3' }}>v{github.current}</div>
                </div>
                <div style={{ alignSelf: 'center', fontSize: 13, color: github.latest !== github.current ? '#3fb950' : '#8b949e', fontWeight: 600 }}>
                  {github.latest !== github.current ? '업데이트 있음' : '최신 버전'}
                </div>
              </div>
              {github.assets?.filter(a => a.name.endsWith('.zip')).map(asset => (
                <div key={asset.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid #21262d' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#e6edf3' }}>{asset.name}</span>
                  <button onClick={() => downloadGithub(asset)} disabled={ghDownloading} style={s.btn('#238636', ghDownloading)}>
                    {ghDownloading ? '다운로드 중...' : '다운로드 후 적용 준비'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 이력 탭 ── */}
      {tab === 'history' && (
        <div style={s.card}>
          <div style={{ fontSize: 13, color: '#e6edf3', fontWeight: 600, marginBottom: 14 }}>업데이트 이력 <span style={{ fontSize: 11, color: '#8b949e', fontWeight: 400 }}>(최근 20건)</span></div>
          {history.length === 0 ? <div style={{ fontSize: 13, color: '#8b949e' }}>이력 없음</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr>
                  <th style={s.th}>#</th><th style={s.th}>일시</th><th style={s.th}>이전</th><th style={s.th}>이후</th>
                  <th style={s.th}>파일</th><th style={s.th}>변경수</th><th style={s.th}>적용자</th><th style={s.th}>상태</th><th style={s.th}>롤백</th>
                </tr></thead>
                <tbody>
                  {history.map(row => {
                    const st = STATUS_LABEL[row.status] || { text: row.status, color: '#8b949e' };
                    const canRollback = row.status === 'success' && row.backupFile;
                    return (
                      <tr key={row.id}>
                        <td style={s.td}>{row.id}</td>
                        <td style={{ ...s.td, whiteSpace: 'nowrap', color: '#8b949e' }}>{new Date(row.createdAt).toLocaleString('ko-KR')}</td>
                        <td style={s.td}>{row.versionBefore || '-'}</td>
                        <td style={s.td}>{row.versionAfter || '-'}</td>
                        <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11, color: '#8b949e', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.releaseFile}>{row.releaseFile || '-'}</td>
                        <td style={{ ...s.td, textAlign: 'center' }}>{row.changedFiles ?? '-'}</td>
                        <td style={s.td}>{row.applier?.name || '-'}</td>
                        <td style={{ ...s.td, color: st.color, fontWeight: 600 }}>{st.text}</td>
                        <td style={s.td}>
                          {canRollback
                            ? <button onClick={() => doRollback(row)} disabled={busy} style={s.btn('#b62324', busy)}>{rolling === row.id ? '롤백 중...' : '롤백'}</button>
                            : <span style={{ color: '#484f58' }}>-</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── 로그 탭 ── */}
      {tab === 'log' && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3' }}>업데이트 로그</div>
            <button onClick={loadLog} style={s.btn('#21262d', false)}>새로고침</button>
          </div>
          <div style={s.logBox}>{log || '로그 없음'}</div>
        </div>
      )}
    </div>
  );
}
