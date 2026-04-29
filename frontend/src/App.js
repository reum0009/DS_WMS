import React, { useState, useEffect } from 'react';
import './App.css';
import LoginForm from './components/LoginForm';
import UpdateChecker from './components/UpdateChecker';
import InviteAcceptPage from './components/screens/InviteAcceptPage';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import WarehouseDashboard from './components/screens/WarehouseDashboard';
import WarehouseHome    from './components/screens/WarehouseHome';
import WarehouseInbound         from './components/screens/WarehouseInbound';
import WarehouseTransfer        from './components/screens/WarehouseTransfer';
import WarehouseOutbound        from './components/screens/WarehouseOutbound';
import WarehouseRequestList     from './components/screens/WarehouseRequestList';
import WarehouseInventory       from './components/screens/WarehouseInventory';
import WarehouseLowStock        from './components/screens/WarehouseLowStock';
import WarehouseReport          from './components/screens/WarehouseReport';
import WarehouseSettings        from './components/screens/WarehouseSettings';
import AdminDashboard from './components/screens/AdminDashboard';
import ApplicantScreen from './components/screens/ApplicantScreen';
import ApproverScreen from './components/screens/ApproverScreen';
import ReleaserScreen from './components/screens/ReleaserScreen';

// ── 창고 역할 전용 앱 (홈 ↔ POS 전환) ───────────────────────────
// ── 창고 역할 전용 앱 — 화면별 독립 컴포넌트 라우터 ─────────────
function WarehouseApp({ user, onLogout }) {
  const [screen, setScreen] = useState('home');
  const [posFunc, setPosFunc] = useState('inbound');
  const [pendingItem, setPendingItem] = useState(null);

  const goHome = () => {
    setScreen('home');
    setPendingItem(null);
  };

  const handleEnterPOS = (funcId, data = null) => {
    setPendingItem(data);
    switch (funcId) {
      case 'inbound':          setScreen('inbound');          return;
      case 'transfer':         setScreen('transfer-inbound'); return;
      case 'transfer-inbound': setScreen('transfer-inbound'); return;
      case 'transfer-outbound': setScreen('transfer-outbound'); return;
      case 'outbound':         setScreen('outbound');         return;
      case 'req-outbound':     setScreen('req-outbound');     return;
      case 'inventory':        setScreen('inventory');        return;
      case 'low-stock':        setScreen('low-stock');        return;
      case 'report':           setScreen('report');           return;
      case 'settings':         setScreen('settings');         return;
      default:
        setPosFunc(funcId || 'inbound');
        setScreen('pos');
    }
  };

  const commonProps = { user, onLogout, onGoHome: goHome, initialProduct: pendingItem };

  if (screen === 'inbound')          return <WarehouseInbound         {...commonProps} />;
  if (screen === 'transfer-inbound') return <WarehouseTransfer        user={user} onLogout={onLogout} onGoHome={goHome} initialTab="inbound" />;
  if (screen === 'transfer-outbound') return <WarehouseTransfer       user={user} onLogout={onLogout} onGoHome={goHome} initialTab="outbound" />;
  if (screen === 'outbound')         return <WarehouseOutbound        {...commonProps} />;
  if (screen === 'req-outbound')     return <WarehouseRequestList     {...commonProps} />;
  if (screen === 'inventory')        return <WarehouseInventory       {...commonProps} />;
  if (screen === 'low-stock')        return <WarehouseLowStock        {...commonProps} />;
  if (screen === 'report')           return <WarehouseReport          {...commonProps} />;
  if (screen === 'settings')         return <WarehouseSettings        {...commonProps} />;
  if (screen === 'pos')              return <WarehouseDashboard user={user} onLogout={onLogout} defaultFunc={posFunc} onGoHome={goHome} initialProduct={pendingItem} />;

  return <WarehouseHome user={user} onLogout={onLogout} onEnterPOS={handleEnterPOS} />;
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [activeScreen, setActiveScreen] = useState('dashboard');

  useEffect(() => {
    // 로컬스토리지에서 인증 정보 확인
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    
    if (token && savedUser) {
      setIsAuthenticated(true);
      setUser(JSON.parse(savedUser));
    }
  }, []);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    setIsAuthenticated(true);
    setActiveScreen('dashboard');
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setIsAuthenticated(false);
    setUser(null);
    setActiveScreen('dashboard');
  };

  // 역할별 메뉴 정의
  const getMenuByRole = (role) => {
    switch(role) {
      case 'admin':
      case 'dept_admin':
        return [
          { id: 'dashboard', label: '📊 대시보드', icon: '📊' },
        ];
      case 'applicant':
        return [
          { id: 'dashboard', label: '� 상품 신청', icon: '🛒' },
        ];
      case 'approver':
        return [
          { id: 'dashboard', label: '✅ 신청 승인', icon: '✅' },
        ];
      case 'releaser':
        return [
          { id: 'dashboard', label: '📦 출고 관리', icon: '📦' },
        ];
      case 'warehouse':
      default:
        return [
          { id: 'dashboard', label: '📊 대시보드', icon: '📊' },
          { id: 'inbound', label: '📥 입고 관리', icon: '📥' },
          { id: 'outbound', label: '📤 출고 관리', icon: '📤' },
          { id: 'stock', label: '📋 재고 조회', icon: '📋' },
          { id: 'report', label: '📈 레포트', icon: '📈' },
        ];
    }
  };

  const renderScreen = () => {
    const role = user?.role || 'warehouse';

    if (role === 'admin' || role === 'dept_admin') {
      switch (activeScreen) {
        case 'dashboard':
          return <AdminDashboard />;
        default:
          return <AdminDashboard />;
      }
    } else if (role === 'applicant') {
      switch (activeScreen) {
        case 'dashboard':
          return <ApplicantScreen />;
        default:
          return <ApplicantScreen />;
      }
    } else if (role === 'approver') {
      switch (activeScreen) {
        case 'dashboard':
          return <ApproverScreen />;
        default:
          return <ApproverScreen />;
      }
    } else if (role === 'releaser') {
      switch (activeScreen) {
        case 'dashboard':
          return <ReleaserScreen />;
        default:
          return <ReleaserScreen />;
      }
    } else {
      // warehouse role - 통합 대시보드 사용
      return <WarehouseDashboard />;
    }
  };

  // 로그인하지 않았으면 로그인 폼 표시
  if (!isAuthenticated) {
    return <LoginForm onLoginSuccess={handleLoginSuccess} />;
  }

  // 창고 역할은 홈 → POS 전환 (사이드바 없음)
  if (user?.role === 'warehouse') {
    return <WarehouseApp user={user} onLogout={handleLogout} />;
  }

  // 관리자: AdminDashboard 자체 레이아웃 사용
  if (user?.role === 'admin' || user?.role === 'dept_admin') {
    return <AdminDashboard user={user} onLogout={handleLogout} />;
  }

  // 그 외 역할: 기존 레이아웃
  const userInfo = {
    name: user?.name || '사용자',
    warehouse: user?.warehouse || '본사창고',
    role: user?.role || 'warehouse'
  };

  const sidebarMenu = getMenuByRole(user?.role);

  return (
    <div className="app-container">
      <Header user={userInfo} onLogout={handleLogout} />
      <div className="main-content">
        <Sidebar
          activeScreen={activeScreen}
          onScreenChange={setActiveScreen}
          menuItems={sidebarMenu}
        />
        <div className="content-area">
          {renderScreen()}
        </div>
      </div>
    </div>
  );
}

// 초대 토큰이 있으면 수락 페이지, 없으면 일반 앱
function Root() {
  const inviteToken = new URLSearchParams(window.location.search).get('invite');
  if (inviteToken) {
    return (
      <InviteAcceptPage
        token={inviteToken}
        onDone={() => { window.history.replaceState({}, '', '/'); window.location.reload(); }}
      />
    );
  }
  return (
    <UpdateChecker>
      <App />
    </UpdateChecker>
  );
}

export default Root;
