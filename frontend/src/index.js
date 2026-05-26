import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const renderFatalError = (error) => {
  const rootEl = document.getElementById('root');
  if (!rootEl) return;
  const message = String(error?.stack || error?.reason?.stack || error?.message || error?.reason || error || 'Unknown error');
  rootEl.innerHTML = `
    <div style="min-height:100vh;background:#0d1117;color:#e6edf3;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px;">
      <div style="max-width:880px;margin:10vh auto;background:#161b22;border:1px solid #f85149;border-radius:8px;padding:24px;">
        <div style="color:#f85149;font-size:20px;font-weight:800;margin-bottom:10px;">WMS 화면 오류</div>
        <div style="color:#c9d1d9;line-height:1.6;margin-bottom:16px;">빈 화면 대신 오류를 표시했습니다. 아래 내용을 확인해 주세요.</div>
        <pre style="white-space:pre-wrap;word-break:break-word;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;color:#ff7b72;max-height:320px;overflow:auto;"></pre>
        <button style="margin-top:16px;background:#238636;border:1px solid #2ea043;color:#fff;border-radius:6px;padding:10px 16px;font-weight:800;cursor:pointer;" onclick="window.location.reload()">새로고침</button>
      </div>
    </div>
  `;
  const pre = rootEl.querySelector('pre');
  if (pre) pre.textContent = message;
};

window.addEventListener('error', (event) => {
  console.error('[WMS global error]', event.error || event.message);
  renderFatalError(event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[WMS unhandled rejection]', event.reason);
  renderFatalError(event.reason);
});

const root = ReactDOM.createRoot(document.getElementById('root'));
try {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (error) {
  console.error('[WMS root render error]', error);
  renderFatalError(error);
}
