import React, { useState, useEffect } from 'react';
import axios from 'axios';

const STORAGE_KEY = 'app_version';

export default function UpdateChecker({ children }) {
  const [checking, setChecking] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const apiBase = process.env.REACT_APP_API_BASE_URL || '/api';
        const res = await axios.get(`${apiBase}/update/check`, { timeout: 4000 });
        const serverVersion = res.data?.version;
        if (!serverVersion || cancelled) return;

        const cachedVersion = localStorage.getItem(STORAGE_KEY);

        if (cachedVersion && cachedVersion !== serverVersion) {
          setUpdating(true);
          localStorage.setItem(STORAGE_KEY, serverVersion);
          // 캐시 무효화 후 하드 새로고침
          setTimeout(() => {
            window.location.href = window.location.href.split('?')[0] + '?v=' + serverVersion;
          }, 1200);
          return;
        }

        localStorage.setItem(STORAGE_KEY, serverVersion);
      } catch {
        // 버전 체크 실패 시 그냥 진행
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  if (updating) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'system-ui, sans-serif', gap: 16
      }}>
        <div style={{ fontSize: 32 }}>⟳</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>새 버전을 적용하는 중...</div>
        <div style={{ fontSize: 13, color: '#8b949e' }}>잠시 후 자동으로 새로고침됩니다</div>
        <div style={{ width: 200, height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden', marginTop: 8 }}>
          <div style={{ height: '100%', background: '#58a6ff', borderRadius: 2, animation: 'progress 1.2s ease-in-out forwards' }} />
        </div>
        <style>{`@keyframes progress { from { width: 0% } to { width: 100% } }`}</style>
      </div>
    );
  }

  if (checking) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0d1117', color: '#8b949e', fontFamily: 'system-ui, sans-serif', fontSize: 14
      }}>
        연결 중...
      </div>
    );
  }

  return children;
}
