import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { reportsAPI } from '../../api/api';

const BG0 = '#0d1117';
const BG1 = '#161b22';
const BG2 = '#1c2128';
const BD = '#30363d';
const BD2 = '#21262d';
const TX = '#e6edf3';
const TX2 = '#8b949e';
const TX3 = '#6e7681';
const RED = '#f85149';
const GRN = '#3fb950';
const BLU = '#58a6ff';
const ORG = '#f0883e';
const PUR = '#a371f7';

function formatClock(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatDateTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function number(value) {
  return (Number(value) || 0).toLocaleString();
}

function money(value) {
  return `${number(value)}원`;
}

function ProductNameSpec({ row, strong = false }) {
  return (
    <div>
      <div style={{ fontWeight: strong ? 900 : 700 }}>{row.productName || '-'}</div>
      {row.specification && <div style={{ color: TX2, fontSize: 12, marginTop: 2, fontWeight: 700 }}>{row.specification}</div>}
    </div>
  );
}

const baseButton = {
  height: 38,
  padding: '0 18px',
  borderRadius: 8,
  border: `1px solid ${BD}`,
  background: BG2,
  color: TX2,
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 800,
};

const tableHeadStyle = {
  position: 'sticky',
  top: 0,
  background: BG2,
  color: TX2,
  fontSize: 12,
  fontWeight: 900,
  textAlign: 'right',
  padding: '12px 14px',
  borderBottom: `1px solid ${BD}`,
  whiteSpace: 'nowrap',
};

const tableCellStyle = {
  padding: '13px 14px',
  borderBottom: `1px solid ${BD2}`,
  textAlign: 'right',
  color: TX,
  fontSize: 14,
  whiteSpace: 'nowrap',
};

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: BG1, border: `1px solid ${BD}`, borderLeft: `4px solid ${color}`, borderRadius: 8, padding: 18, minWidth: 0 }}>
      <div style={{ fontSize: 13, color: TX2, fontWeight: 800, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, color, fontWeight: 900, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: TX3, fontWeight: 700, marginTop: 8 }}>{sub}</div>
    </div>
  );
}

export default function WarehouseReport({ user, onGoHome }) {
  const [clock, setClock] = useState(formatClock(new Date()));
  const [period, setPeriod] = useState('today');
  const [view, setView] = useState('product');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await reportsAPI.getWarehouseSummary({
        period,
        warehouseId: user?.warehouseId || undefined,
      });
      setData(res.data || null);
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data || err.message || '리포트 조회 실패';
      setError(String(msg));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period, user?.warehouseId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') onGoHome?.();
      if (e.key === 'F5') {
        e.preventDefault();
        loadData();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [loadData, onGoHome]);

  const stats = data?.stats || {};
  const rows = useMemo(() => {
    if (view === 'category') return data?.byCategory || [];
    if (view === 'recent') return data?.recent || [];
    return data?.byProduct || [];
  }, [data, view]);

  const activeBtn = (active, color = PUR) => ({
    ...baseButton,
    borderColor: active ? color : BD,
    background: active ? `${color}22` : BG2,
    color: active ? color : TX2,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG0, color: TX, overflow: 'hidden' }}>
      <div style={{ height: 72, background: BG1, borderBottom: `3px solid ${PUR}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: TX }}>리포트</div>
          <div style={{ fontSize: 13, color: PUR, border: `1px solid ${PUR}66`, borderRadius: 6, padding: '4px 10px', fontWeight: 900 }}>
            {user?.warehouse || user?.warehouseName || '내 창고'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontFamily: 'monospace', color: TX2, fontWeight: 700 }}>{clock}</span>
          <button onClick={loadData} style={baseButton} disabled={loading}>{loading ? '조회 중' : '새로고침'}</button>
          <button onClick={onGoHome} style={{ ...baseButton, color: TX, borderColor: BD }}>홈</button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '16px 28px', background: BG1, borderBottom: `1px solid ${BD2}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            ['today', '오늘'],
            ['week', '이번 주'],
            ['month', '이번 달'],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setPeriod(id)} style={activeBtn(period === id)}>{label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            ['product', '품목별'],
            ['category', '카테고리별'],
            ['recent', '최근 이력'],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setView(id)} style={activeBtn(view === id, BLU)}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 28 }}>
        {error && (
          <div style={{ background: '#2d0d0b', border: `1px solid ${RED}`, color: RED, borderRadius: 8, padding: 14, fontWeight: 800, marginBottom: 18 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(160px, 1fr))', gap: 14, marginBottom: 18 }}>
          <StatCard label="입고" value={`${number(stats.inboundQty)}개`} sub={`${number(stats.inboundCount)}건 / ${money(stats.inboundAmt)}`} color={GRN} />
          <StatCard label="출고" value={`${number(stats.outboundQty)}개`} sub={`${number(stats.outboundCount)}건 / ${money(stats.outboundAmt)}`} color={RED} />
          <StatCard label="순증감" value={`${stats.netQty >= 0 ? '+' : ''}${number(stats.netQty)}개`} sub="입고 수량 - 출고 수량" color={stats.netQty >= 0 ? BLU : ORG} />
          <StatCard label="조회 범위" value={period === 'today' ? '오늘' : period === 'week' ? '이번 주' : '이번 달'} sub={data?.range ? `${formatDateTime(data.range.start)} ~ ${formatDateTime(data.range.end)}` : '-'} color={PUR} />
        </div>

        <div style={{ background: BG1, border: `1px solid ${BD}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', borderBottom: `1px solid ${BD2}` }}>
            <div style={{ fontSize: 16, fontWeight: 900 }}>
              {view === 'recent' ? '최근 입출고 이력' : view === 'category' ? '카테고리별 집계' : '품목별 집계'}
            </div>
            <div style={{ fontSize: 12, color: TX2, fontWeight: 800 }}>{number(rows.length)}건</div>
          </div>

          <div style={{ maxHeight: 'calc(100vh - 350px)', overflow: 'auto' }}>
            {loading ? (
              <div style={{ padding: 56, textAlign: 'center', color: PUR, fontWeight: 900 }}>데이터 조회 중</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: 56, textAlign: 'center', color: TX3, fontWeight: 800 }}>표시할 리포트 데이터가 없습니다.</div>
            ) : view === 'recent' ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...tableHeadStyle, textAlign: 'left' }}>시간</th>
                    <th style={{ ...tableHeadStyle, textAlign: 'left' }}>구분</th>
                    <th style={{ ...tableHeadStyle, textAlign: 'left' }}>품목</th>
                    <th style={{ ...tableHeadStyle, textAlign: 'left' }}>참조번호</th>
                    <th style={tableHeadStyle}>수량</th>
                    <th style={{ ...tableHeadStyle, textAlign: 'left' }}>처리자</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isIn = row.type === 'inbound';
                    return (
                      <tr key={row.id}>
                        <td style={{ ...tableCellStyle, textAlign: 'left', color: TX2 }}>{formatDateTime(row.createdAt)}</td>
                        <td style={{ ...tableCellStyle, textAlign: 'left', color: isIn ? GRN : RED, fontWeight: 900 }}>{isIn ? '입고' : '출고'}</td>
                        <td style={{ ...tableCellStyle, textAlign: 'left' }}><ProductNameSpec row={row} /></td>
                        <td style={{ ...tableCellStyle, textAlign: 'left', color: TX2 }}>{row.reference || '-'}</td>
                        <td style={{ ...tableCellStyle, color: isIn ? GRN : RED, fontWeight: 900 }}>{isIn ? '+' : '-'}{number(row.quantity)} {row.unit}</td>
                        <td style={{ ...tableCellStyle, textAlign: 'left', color: TX2 }}>{row.userName || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...tableHeadStyle, textAlign: 'left' }}>{view === 'category' ? '카테고리' : '품목'}</th>
                    {view === 'product' && <th style={{ ...tableHeadStyle, textAlign: 'left' }}>품목코드</th>}
                    <th style={tableHeadStyle}>입고수량</th>
                    <th style={tableHeadStyle}>출고수량</th>
                    <th style={tableHeadStyle}>순증감</th>
                    <th style={tableHeadStyle}>입고금액</th>
                    <th style={tableHeadStyle}>출고금액</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={view === 'category' ? row.name : row.productId}>
                      <td style={{ ...tableCellStyle, textAlign: 'left', fontWeight: 900 }}>{view === 'category' ? row.name : <ProductNameSpec row={row} strong />}</td>
                      {view === 'product' && <td style={{ ...tableCellStyle, textAlign: 'left', color: TX2 }}>{row.productCode || '-'}</td>}
                      <td style={{ ...tableCellStyle, color: GRN, fontWeight: 900 }}>{number(row.inboundQty)} {row.unit || ''}</td>
                      <td style={{ ...tableCellStyle, color: RED, fontWeight: 900 }}>{number(row.outboundQty)} {row.unit || ''}</td>
                      <td style={{ ...tableCellStyle, color: row.netQty >= 0 ? BLU : ORG, fontWeight: 900 }}>{row.netQty >= 0 ? '+' : ''}{number(row.netQty)}</td>
                      <td style={tableCellStyle}>{money(row.inboundAmt)}</td>
                      <td style={tableCellStyle}>{money(row.outboundAmt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div style={{ height: 46, background: '#010409', borderTop: `1px solid ${BD2}`, display: 'flex', alignItems: 'center', gap: 22, padding: '0 28px', flexShrink: 0 }}>
        {[
          ['F5', '새로고침'],
          ['ESC', '홈'],
        ].map(([key, label]) => (
          <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <kbd style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 5, padding: '2px 8px', color: TX2, fontFamily: 'monospace', fontWeight: 900 }}>{key}</kbd>
            <span style={{ color: TX3, fontWeight: 800 }}>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
