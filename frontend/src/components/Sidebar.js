import React from 'react';

function Sidebar({ activeScreen, onScreenChange, menuItems }) {
  const defaultMenuItems = [
    { id: 'dashboard', label: '📊 대시보드', icon: '📊' },
    { id: 'inbound', label: '📥 입고 관리', icon: '📥' },
    { id: 'outbound', label: '📤 출고 관리', icon: '📤' },
    { id: 'stock', label: '📋 재고 조회', icon: '📋' },
    { id: 'report', label: '📈 레포트', icon: '📈' },
  ];

  const menu = menuItems || defaultMenuItems;

  return (
    <aside className="sidebar">
      <nav className="menu">
        {menu.map(item => (
          <button
            key={item.id}
            className={`menu-item ${activeScreen === item.id ? 'active' : ''}`}
            onClick={() => onScreenChange(item.id)}
          >
            <span className="menu-icon">{item.icon}</span>
            <span className="menu-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

export default Sidebar;
