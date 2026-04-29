import React, { useState, useEffect, useCallback } from 'react';
import { reportsAPI, stockHistoryAPI } from '../../api/api';

const BG0='#0d1117',BG1='#161b22',BG2='#1c2128',BD='#30363d',BD2='#21262d';
const TX='#e6edf3',TX2='#8b949e',TX3='#444c56';
const RED='#f85149',GRN='#3fb950',BLU='#58a6ff',ORG='#f0883e',PUR='#a371f7';

function formatClock(d){const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;}

const WarehouseReport = ({user, onGoHome}) => {
  const [clock, setClock] = useState(formatClock(new Date()));
  const [period, setPeriod] = useState('today');
  const [stats, setStats] = useState({ inboundCount:0, outboundCount:0, inboundQty:0, outboundQty:0, inboundAmt:0, outboundAmt:0 });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      // 리포트 통계 조회
      const resStats = await reportsAPI.getStats(); // 백엔드 라우트에 따라 기간 파라미터 필요할 수 있음
      const s = resStats.data || {};
      
      // 임시로 오늘 데이터 매핑 (실제 백엔드 응답 구조에 맞춤)
      setStats({
        inboundCount: s.todayInboundCount || 0,
        outboundCount: s.todayOutboundCount || 0,
        inboundQty: s.todayInboundQty || 0,
        outboundQty: s.todayOutboundQty || 0,
        inboundAmt: s.todayInboundAmt || 0,
        outboundAmt: s.todayOutboundAmt || 0
      });

      // 최근 이력 조회 (전체 이력 API 사용)
      const resHist = await stockHistoryAPI.getAll({ limit: 50 });
      setHistory(resHist.data || []);
      
    } catch (err) {
      console.error('Report data load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const id = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => clearInterval(id);
  }, [loadData]);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onGoHome(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onGoHome]);

  const statCard = (icon, label, value, sub, color) => (
    <div style={{ flex: 1, background: BG2, border: `2px solid ${color}44`, borderRadius: 15, padding: '24px' }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 36, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 16, color: TX2, marginTop: 5, fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 14, color: TX3, marginTop: 5, fontWeight: 700 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG0, color: TX, fontFamily: "'Noto Sans KR', sans-serif", overflow: 'hidden' }}>

      {/* TOP BAR */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', height: 84, background: BG1, borderBottom: `4px solid ${PUR}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <span style={{ fontSize: 24, fontWeight: 900, color: PUR }}>📊 리포트</span>
          <span style={{ fontSize: 14, color: PUR, background: '#1e0d40', border: `1px solid ${PUR}55`, borderRadius: 6, padding: '4px 12px', fontWeight: 700 }}>Report</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <span style={{ fontSize: 18, color: TX2, fontFamily: 'monospace', fontWeight: 600 }}>{clock}</span>
          <button onClick={onGoHome} style={{ background: BG2, border: `2px solid ${BD}`, color: TX, padding: '10px 24px', borderRadius: 10, cursor: 'pointer', fontSize: 16, fontWeight: 700 }}>🏠 홈</button>
        </div>
      </div>

      {/* 기간 탭 */}
      <div style={{ display: 'flex', gap: 12, padding: '20px 32px', background: BG1, borderBottom: `2px solid ${BD2}`, flexShrink: 0 }}>
        {[['today', '오늘'], ['week', '이번 주'], ['month', '이번 달']].map(([v, l]) => (
          <button key={v} onClick={() => setPeriod(v)}
            style={{ padding: '10px 28px', borderRadius: 10, border: `2px solid ${period === v ? PUR : BD}`,
              background: period === v ? '#1e0d40' : BG2, color: period === v ? PUR : TX2,
              cursor: 'pointer', fontSize: 16, fontWeight: period === v ? 800 : 500 }}>
            {l}
          </button>
        ))}
      </div>

      {/* BODY */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '30px 32px' }}>

        {/* 요약 카드 */}
        <div style={{ display: 'flex', gap: 20, marginBottom: 30 }}>
          {statCard('📥', '입고 건수', stats.inboundCount + '건', `${stats.inboundQty.toLocaleString()}개`, GRN)}
          {statCard('📤', '출고 건수', stats.outboundCount + '건', `${stats.outboundQty.toLocaleString()}개`, RED)}
          {statCard('💰', '입고 금액', `₩${(stats.inboundAmt / 10000).toLocaleString(undefined, {maximumFractionDigits:0})}만`, null, BLU)}
          {statCard('💸', '출고 금액', `₩${(stats.outboundAmt / 10000).toLocaleString(undefined, {maximumFractionDigits:0})}만`, null, ORG)}
        </div>

        {/* 최근 이력 리스트 확대 */}
        <div style={{ background: BG1, border: `2px solid ${BD}`, borderRadius: 20, padding: '24px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: TX, marginBottom: 20 }}>📋 입출고 통합 이력 (최근 50건)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 100px 180px 1fr 100px', background: BG2, borderRadius: 10, padding: '15px 20px', marginBottom: 10 }}>
            {['시간', '구분', '참조번호', '품목명', '수량'].map((h, i) => (
              <div key={h} style={{ fontSize: 14, fontWeight: 800, color: TX2, textAlign: i === 4 ? 'right' : 'left' }}>{h}</div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '50px', color: PUR, fontSize: 18, fontWeight: 700 }}>데이터 로드 중...</div>
            ) : history.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '50px', color: TX3, fontSize: 16 }}>이력이 없습니다.</div>
            ) : history.map((h, i) => {
              const dt = new Date(h.createdAt);
              const timeStr = `${dt.getMonth()+1}/${dt.getDate()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
              const isIn = h.type === 'inbound';
              return (
                <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '120px 100px 180px 1fr 100px', padding: '20px', borderBottom: `1px solid ${BD2}`, background: i % 2 === 0 ? BG0 : BG1, alignItems: 'center' }}>
                  <div style={{ fontSize: 14, color: TX2, fontWeight: 600 }}>{timeStr}</div>
                  <div>
                    <span style={{ fontSize: 12, color: isIn ? GRN : RED, background: isIn ? '#0d2616' : '#2d0d0b', border: `1px solid ${isIn ? GRN : RED}55`, borderRadius: 6, padding: '4px 10px', fontWeight: 800 }}>
                      {isIn ? '입고' : '출고'}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, color: TX2, fontFamily: 'monospace', fontWeight: 600 }}>{h.reference || '—'}</div>
                  <div style={{ fontSize: 16, color: TX, fontWeight: 700 }}>{h.Product?.productName || '삭제된 품목'}</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: isIn ? GRN : RED, textAlign: 'right' }}>
                    {isIn ? '+' : '-'}{h.quantity.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* BOTTOM */}
      <div style={{ height: 54, background: '#010409', borderTop: `2px solid ${BD2}`, display: 'flex', alignItems: 'center', gap: 24, padding: '0 32px', flexShrink: 0 }}>
        {[['ESC', '홈으로']].map(([k, l]) => (
          <span key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <kbd style={{ background: BG2, border: `2px solid ${BD}`, borderRadius: 6, padding: '3px 10px', fontSize: 14, color: TX2, fontFamily: 'monospace', fontWeight: 800 }}>{k}</kbd>
            <span style={{ fontSize: 16, color: TX3, fontWeight: 700 }}>{l}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

export default WarehouseReport;
