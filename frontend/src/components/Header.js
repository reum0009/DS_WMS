import React from 'react';

function Header({ user, onLogout }) {
  return (
    <header className="header">
      <div className="header-left">
        <h1>📦 창고 관리 POS</h1>
      </div>
      <div className="header-right">
        <div className="user-info">
          <span className="warehouse-name">{user.warehouse}</span>
          <span className="user-name">{user.name}</span>
        </div>
        <button className="logout-btn" onClick={onLogout}>로그아웃</button>
      </div>
    </header>
  );
}

export default Header;
