import React, { useState, useEffect, useRef, useCallback } from 'react';
import { productsAPI, warehousesAPI, productsQuickAdd, outboundAPI, warehouseTransferAPI } from '../../api/api';

// ── 공통 스타일 상수 ──────────────────────────────────────────────
const BG0='#0d1117',BG1='#161b22',BG2='#1c2128',BG3='#21262d';
const BD='#30363d',BD2='#21262d';
const TX='#e6edf3',TX2='#8b949e',TX3='#444c56';
const RED='#f85149',GRN='#3fb950',BLU='#58a6ff',YLW='#e3b341',ORG='#f0883e';

// ── 출고번호 규칙: 2 + YYMMDD + ms3자리 ─────────────
function makeRef(){
  const d=new Date(),p=n=>String(n).padStart(2,'0');
  const ms=String(Date.now()).slice(-3);
  return `2${String(d.getFullYear()).slice(-2)}${p(d.getMonth()+1)}${p(d.getDate())}${ms}`;
}

function formatClock(d){const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;}

function stockSt(p) {
  const s = p?.currentStock ?? 0, safe = p?.safetyStock ?? 0;
  if (s === 0)   return { label: '소진', color: RED };
  if (s <= safe) return { label: '부족', color: YLW };
  return           { label: '정상', color: GRN };
}

function ProductNameSpec({ product, nameStyle = {}, specStyle = {} }) {
  return (
    <div>
      <div style={nameStyle}>{product?.productName || product?.Product?.productName || product?.product?.productName || '—'}</div>
      {(product?.specification || product?.Product?.specification || product?.product?.specification) && (
        <div style={{ color: TX2, fontSize: 11, marginTop: 2, ...specStyle }}>
          {product?.specification || product?.Product?.specification || product?.product?.specification}
        </div>
      )}
    </div>
  );
}

// ── 바코드 스캐너 감지 훅 ─────────────────────────────────────────────
const SCANNER_SPEED_MS = 50;
const SCANNER_MIN_LEN  = 3;
const IDLE_RESET_MS    = 280;
const COMMAND_BARCODES = {
  W99999: { screen: 'inbound', label: '입고바코드', type: 'inbound' },
  W99998: { screen: 'outbound', label: '출고바코드', type: 'outbound' },
};

function useBarcodeScanner(onScan, enabled=true) {
  const buf=useRef([]), timer=useRef(null);
  useEffect(()=>{
    if(!enabled) return;
    const reset=()=>{buf.current=[];};
    const onKey=(e)=>{
      const el=document.activeElement,tag=el?.tagName;
      if(tag==='SELECT'||tag==='TEXTAREA') return;
      if(tag==='INPUT'&&el?.dataset?.barcodeManual!=='true') return;
      if(e.ctrlKey||e.altKey||e.metaKey) return;
      if(e.key.length>1&&e.key!=='Enter') return;
      e.stopImmediatePropagation();
      if(e.key==='Enter'){
        const b=buf.current; buf.current=[]; clearTimeout(timer.current);
        if(b.length<SCANNER_MIN_LEN) return;
        if(b.every((x,i)=>i===0||(x.ts-b[i-1].ts)<= SCANNER_SPEED_MS)) onScan(b.map(x=>x.char).join(''));
        return;
      }
      buf.current.push({char:e.key,ts:Date.now()});
      clearTimeout(timer.current); timer.current=setTimeout(reset,IDLE_RESET_MS);
    };
    window.addEventListener('keydown',onKey,true);
    return()=>{window.removeEventListener('keydown',onKey,true);clearTimeout(timer.current);};
  },[enabled,onScan]);
}

// ── 오른쪽 패널 버튼 컴포넌트 ──────────────────────────────────
function RightBtn({ icon, label, sub, color, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        width: '100%', background: '#1c2128',
        border: `1px solid ${disabled ? '#21262d' : color + '55'}`,
        borderRadius: 6, padding: '9px 8px', cursor: disabled ? 'default' : 'pointer',
        textAlign: 'left', transition: 'border-color 0.15s',
        opacity: disabled ? 0.35 : 1,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14, color }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: disabled ? '#444c56' : TX }}>{label}</span>
      </div>
      <div style={{ fontSize: 10, color: TX2, marginTop: 2, paddingLeft: 20 }}>{sub}</div>
    </button>
  );
}

// ── 가상 숫자 키패드 컴포넌트 ────────────────────────────────────
function NumKeypad({ value, onChange, onClose, label }) {
  const [buf, setBuf] = useState(value || '');

  useEffect(() => {
    setBuf(value || '');
  }, [value]);
  
  const press = (k) => {
    if (k === 'C') setBuf('');
    else if (k === '←') setBuf(prev => prev.slice(0, -1));
    else if (k === 'OK') { onChange(buf); onClose(); }
    else setBuf(prev => (prev === '1' ? k : prev + k));
  };

  useEffect(() => {
    const fn = (e) => {
      if (e.key === 'Escape')    { e.stopImmediatePropagation(); e.preventDefault(); onClose(); }
      if (e.key === 'Enter')     { e.stopImmediatePropagation(); e.preventDefault(); onChange(buf); onClose(); }
      if (e.key === 'Backspace') { e.stopImmediatePropagation(); e.preventDefault(); setBuf(prev => prev.slice(0, -1)); }
      if (e.key >= '0' && e.key <= '9') { e.stopImmediatePropagation(); e.preventDefault(); setBuf(prev => (prev === '1' ? e.key : prev + e.key)); }
    };
    window.addEventListener('keydown', fn, true);
    return () => window.removeEventListener('keydown', fn, true);
  }, [buf, onClose, onChange]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1700 }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background: BG1, border: `2px solid ${BD}`, borderRadius: 20, padding: 30, width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        <div style={{ fontSize: 18, color: TX2, marginBottom: 12, textAlign: 'center' }}>{label || '숫자 입력'}</div>
        <div style={{ background: BG0, border: `3px solid ${RED}`, borderRadius: 12, padding: '24px 20px', fontSize: 48, fontWeight: 900, color: RED, fontFamily: 'monospace', textAlign: 'right', marginBottom: 20 }}>{buf || '0'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          {['7','8','9','4','5','6','1','2','3','C','0','←'].map(k => (
            <button key={k} onClick={() => press(k)} style={{ padding: '24px 0', fontSize: 24, fontWeight: 800, borderRadius: 12, cursor: 'pointer', border: `2px solid ${BD}`, background: BG2, color: TX }}>{k}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <button onClick={onClose} style={{ padding: 18, background: 'none', border: `2px solid ${BD}`, color: TX2, borderRadius: 12, cursor: 'pointer', fontSize: 18, fontWeight: 700 }}>취소</button>
          <button onClick={() => press('OK')} style={{ padding: 18, background: RED, border: 'none', color: '#fff', borderRadius: 12, cursor: 'pointer', fontSize: 18, fontWeight: 700 }}>확인</button>
        </div>
      </div>
    </div>
  );
}

// ── 한글 가상 키보드 컴포넌트 ────────────────────────────────────
const CHO  = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JONG_COMB  = {'ㄱ+ㅅ':'ㄳ','ㄴ+ㅈ':'ㄵ','ㄴ+ㅎ':'ㄶ','ㄹ+ㄱ':'ㄺ','ㄹ+ㅁ':'ㄻ','ㄹ+ㅂ':'ㄼ','ㄹ+ㅅ':'ㄽ','ㄹ+ㅌ':'ㄾ','ㄹ+ㅍ':'ㄿ','ㄹ+ㅎ':'ㅀ','ㅂ+ㅅ':'ㅄ'};
const JONG_SPLIT = {'ㄳ':['ㄱ','ㅅ'],'ㄵ':['ㄴ','ㅈ'],'ㄶ':['ㄴ','ㅎ'],'ㄺ':['ㄹ','ㄱ'],'ㄻ':['ㄹ','ㅁ'],'ㄼ':['ㄹ','ㅂ'],'ㄽ':['ㄹ','ㅅ'],'ㄾ':['ㄹ','ㅌ'],'ㄿ':['ㄹ','ㅍ'],'ㅀ':['ㄹ','ㅎ'],'ㅄ':['ㅂ','ㅅ']};
const JUNG_COMB  = {'ㅗ+ㅏ':'ㅘ','ㅗ+ㅐ':'ㅙ','ㅗ+ㅣ':'ㅚ','ㅜ+ㅓ':'ㅝ','ㅜ+ㅔ':'ㅞ','ㅜ+ㅣ':'ㅟ','ㅡ+ㅣ':'ㅢ'};
const JONG_SET   = new Set(JONG.filter(Boolean));

function composeKor(cho, jung, jong) {
  const ci = CHO.indexOf(cho), vi = JUNG.indexOf(jung), ji = JONG.indexOf(jong || '');
  if (ci < 0 || vi < 0 || ji < 0) return cho + (jung || '') + (jong || '');
  return String.fromCharCode(0xAC00 + (ci * 21 + vi) * 28 + ji);
}

function KoreanKeypad({ value, onChange, onClose, label }) {
  const [buf,   setBuf]   = useState(value || '');
  const [cs,    setCs]    = useState(null);
  const sRef = useRef({}); sRef.current = { buf, cs };

  const display = buf + (cs ? (cs.jung ? composeKor(cs.cho, cs.jung, cs.jong||'') : cs.cho) : '');
  const isC = c => CHO.includes(c); const isV = c => JUNG.includes(c);

  function doPressKor(key) {
    const { cs } = sRef.current;
    if (isC(key)) {
      if (!cs) { setCs({ cho: key }); }
      else if (!cs.jung) { setBuf(b => b + cs.cho); setCs({ cho: key }); }
      else if (!cs.jong) { if (JONG_SET.has(key)) setCs(s => ({...s, jong: key})); else { setBuf(b => b + composeKor(cs.cho, cs.jung, '')); setCs({ cho: key }); } }
      else { const comb = JONG_COMB[cs.jong+'+'+key]; if (comb) setCs(s => ({...s, jong: comb})); else { setBuf(b => b + composeKor(cs.cho, cs.jung, cs.jong)); setCs({ cho: key }); } }
    } else if (isV(key)) {
      if (!cs) { setBuf(b => b + composeKor('ㅇ', key, '')); }
      else if (!cs.jung) { setCs(s => ({...s, jung: key})); }
      else if (!cs.jong) { const comb = JUNG_COMB[cs.jung+'+'+key]; if (comb) setCs(s => ({...s, jung: comb})); else { setBuf(b => b + composeKor(cs.cho, cs.jung, '')); setCs({ cho: 'ㅇ', jung: key }); } }
      else { const split = JONG_SPLIT[cs.jong]; if (split) { setBuf(b => b + composeKor(cs.cho, cs.jung, split[0])); setCs({ cho: split[1], jung: key }); } else { setBuf(b => b + composeKor(cs.cho, cs.jung, '')); setCs({ cho: cs.jong, jung: key }); } }
    }
  }
  function doPressBS() {
    const { cs } = sRef.current;
    if (cs) {
      if (cs.jong) { const split = JONG_SPLIT[cs.jong]; if (split) setCs(s => ({...s, jong: split[0]})); else setCs(s => ({...s, jong: null})); }
      else if (cs.jung) { const un = Object.entries(JUNG_COMB).find(([,v]) => v === cs.jung); if (un) setCs(s => ({...s, jung: un[0].split('+')[0]})); else setCs(s => ({...s, jung: null})); }
      else setCs(null);
    } else setBuf(b => b.slice(0, -1));
  }
  function doPressOK() { const { buf, cs } = sRef.current; let t = buf; if (cs) t += cs.jung ? composeKor(cs.cho, cs.jung, cs.jong||'') : cs.cho; onChange(t); onClose(); }

  useEffect(() => {
    const fn = e => {
      const KOR_MAP = {
        'q':'ㅂ','w':'ㅈ','e':'ㄷ','r':'ㄱ','t':'ㅅ','y':'ㅛ','u':'ㅕ','i':'ㅑ','o':'ㅐ','p':'ㅔ',
        'a':'ㅁ','s':'ㄴ','d':'ㅇ','f':'ㄹ','g':'ㅎ','h':'ㅗ','j':'ㅓ','k':'ㅏ','l':'ㅣ',
        'z':'ㅋ','x':'ㅌ','c':'ㅊ','v':'ㅍ','b':'ㅠ','n':'ㅜ','m':'ㅡ',
        'Q':'ㅃ','W':'ㅉ','E':'ㄸ','R':'ㄲ','T':'ㅆ',
      };
      const stop = () => { e.stopImmediatePropagation(); e.preventDefault(); };
      if (e.key === 'Escape') { stop(); onClose(); return; }
      if (e.key === 'Enter')  { stop(); doPressOK(); return; }
      if (e.key === 'Backspace') { stop(); doPressBS(); return; }
      if (e.key === ' ') { stop(); setBuf(b => b + ' '); return; }
      if (KOR_MAP[e.key]) { stop(); doPressKor(KOR_MAP[e.key]); return; }
      if (e.key.length === 1) {
        stop();
        const { cs } = sRef.current;
        if (cs) {
          setBuf(b => b + (cs.jung ? composeKor(cs.cho, cs.jung, cs.jong || '') : cs.cho));
          setCs(null);
        }
        setBuf(b => b + e.key);
      }
    };
    window.addEventListener('keydown', fn, true);
    return () => window.removeEventListener('keydown', fn, true);
  }, []); // eslint-disable-line

  const rows = [['ㅂ','ㅈ','ㄷ','ㄱ','ㅅ','ㅛ','ㅕ','ㅑ','ㅐ','ㅔ'],['ㅁ','ㄴ','ㅇ','ㄹ','ㅎ','ㅗ','ㅓ','ㅏ','ㅣ'],['ㅋ','ㅌ','ㅊ','ㅍ','ㅠ','ㅜ','ㅡ']];
  const btnBase = { padding:'12px 0', fontSize:14, fontWeight:700, borderRadius:6, cursor:'pointer', border:`1px solid ${BD}`, background:BG2, color:TX };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.72)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1600 }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:BG1, border:`1px solid ${BD}`, borderRadius:12, padding:20, width:440, boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
        <div style={{ fontSize:12, color:TX2, marginBottom:10 }}>{label}</div>
        <div style={{ background:BG0, border:`1px solid ${BLU}`, borderRadius:8, padding:14, fontSize:20, fontWeight:700, color:TX, marginBottom:15, minHeight:50 }}>{display}</div>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display:'flex', gap:4, marginBottom:4 }}>
            {row.map(k => <button key={k} onClick={() => doPressKor(k)} style={{ ...btnBase, flex:1 }}>{k}</button>)}
          </div>
        ))}
        <div style={{ display:'flex', gap:4, marginTop:10 }}>
          <button onClick={() => setBuf(b=>b+' ')} style={{ ...btnBase, flex:3 }}>Space</button>
          <button onClick={doPressBS} style={{ ...btnBase, flex:1, background:'#3a2e00', borderColor:YLW, color:YLW }}>←</button>
          <button onClick={doPressOK} style={{ ...btnBase, flex:2, background:GRN, borderColor:GRN, color:'#fff' }}>확인</button>
          <button onClick={onClose} style={{ ...btnBase, flex:1.5 }}>닫기</button>
        </div>
      </div>
    </div>
  );
}

// ── 달력 팝업 컴포넌트 ──────────────────────────────────────────
function CalendarPicker({ value, onChange, onClose, label }) {
  const today = new Date();
  const init = value ? new Date(value) : today;
  const [y, setY] = useState(init.getFullYear());
  const [m, setM] = useState(init.getMonth());
  const daysInM = new Date(y, m + 1, 0).getDate();
  const firstDow = new Date(y, m, 1).getDay();
  const cells = []; for (let i = 0; i < firstDow; i++) cells.push(null); for (let d = 1; d <= daysInM; d++) cells.push(d);
  const p2 = n => String(n).padStart(2, '0');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1700 }}>
      <div style={{ background: BG1, border: `1px solid ${BD}`, borderRadius: 12, padding: 20, width: 280, boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
        <div style={{ fontSize: 12, color: TX2, marginBottom: 10 }}>{label}</div>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
          <button onClick={()=>m===0?(setM(11),setY(y-1)):setM(m-1)} style={{background:BG2, color:TX, border:'none', padding:'5px 10px', borderRadius:4, cursor:'pointer'}}>◀</button>
          <span style={{fontWeight:700, color:TX}}>{y}년 {m+1}월</span>
          <button onClick={()=>m===11?(setM(0),setY(y+1)):setM(m+1)} style={{background:BG2, color:TX, border:'none', padding:'5px 10px', borderRadius:4, cursor:'pointer'}}>▶</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {['일','월','화','수','목','금','토'].map(d=><div key={d} style={{textAlign:'center', fontSize:11, color:TX2}}>{d}</div>)}
          {cells.map((d, i) => d ? <button key={i} onClick={()=>{onChange(`${y}-${p2(m+1)}-${p2(d)}`); onClose();}} style={{ padding:8, background:BG2, color:TX, border:'none', borderRadius:4, cursor:'pointer' }}>{d}</button> : <div key={i}/>)}
        </div>
        <button onClick={onClose} style={{ width:'100%', marginTop:15, padding:10, background:BG3, color:TX, border:'none', borderRadius:6, cursor:'pointer' }}>닫기</button>
      </div>
    </div>
  );
}

// ── 출고 수정 모달 컴포넌트 ──────────────────────────────────────
function EditModal({ warehouses, editSearch, setEditSearch, onClose, onRefreshMaster, initialReference, uiScale = 1 }) {
  const [filterWH, setFilterWH] = useState('');
  const [filterProduct, setFilterProduct] = useState('');
  const [sessions, setSessions] = useState([]);
  const [filteredSessions, setFilteredSessions] = useState([]);
  const [selectedRef, setSelectedRef] = useState(null);
  const [detailItems, setDetailItems] = useState([]);
  const [editQtyMap, setEditQtyMap] = useState({});
  const [toast, setToast] = useState(null);
  const [keypadTarget, setKeypadTarget] = useState(null);
  const [calPicker, setCalPicker] = useState(null);
  const [editKorPad, setEditKorPad] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };

  const fetchSessions = useCallback(async () => {
    try {
      const res = await outboundAPI.getSessions({
        startDate: editSearch.startDate,
        endDate:   editSearch.endDate,
        reference: editSearch.reference || undefined
      });
      setSessions(res.data || []);
      setFilteredSessions(res.data || []);
    } catch { showToast('검색 실패', 'error'); }
  }, [editSearch]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  useEffect(() => {
    if (!initialReference) return;
    setSelectedRef(initialReference);
    (async () => {
      try {
        const res = await outboundAPI.getSession(initialReference);
        setDetailItems(res.data || []);
        const qmap = {};
        (res.data || []).forEach(it => { qmap[it.id] = Number(it.quantity); });
        setEditQtyMap(qmap);
      } catch {
        showToast('상세 로드 실패', 'error');
      }
    })();
  }, [initialReference]);

  const selectRef = async (ref) => {
    setSelectedRef(ref);
    try {
      const res = await outboundAPI.getSession(ref);
      setDetailItems(res.data || []);
      const qmap = {}; res.data.forEach(it => { qmap[it.id] = Number(it.quantity); }); setEditQtyMap(qmap);
    } catch { showToast('로드 실패', 'error'); }
  };

  const saveItem = async (item) => {
    const n = parseInt(editQtyMap[item.id], 10);
    if (!n || n <= 0) { showToast('수량은 1 이상이어야 합니다', 'error'); return; }
    try {
      await outboundAPI.updateItem(item.reference, item.id, { quantity: n });
      showToast('수정 완료');
      onRefreshMaster();
      await selectRef(item.reference);
    } catch (e) { showToast(e.response?.data?.error || '수정 실패', 'error'); }
  };

  const deleteDetailItem = async (item) => {
    try {
      await outboundAPI.deleteItem(item.reference, item.id);
      showToast('삭제 완료'); onRefreshMaster(); selectRef(item.reference); setConfirmAction(null);
    } catch { showToast('실패', 'error'); }
  };

  const detailTotalQty = detailItems.reduce((s, it) => s + it.quantity, 0);
  const detailTotalAmt = detailItems.reduce((s, it) => s + (it.Product?.unitPrice || 0) * it.quantity, 0);
  const popupScale = 1.3 / (uiScale || 1);
  // fixed + 부모 transform 환경에서 vh는 실제 뷰포트 기준이므로 % 사용
  // 자신의 scale(popupScale) 적용 후 90% 이내로 보정
  const modalH = Math.min(90, Math.round(90 / popupScale));
  const modalW = Math.min(90, Math.round(90 / popupScale));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300 }}
      onClick={e => { if (editKorPad || keypadTarget || calPicker || confirmAction) return; if (e.target === e.currentTarget) onClose(); }}>

      {toast && <div style={{ position:'fixed', top:20, left:'50%', transform:'translateX(-50%)', zIndex:9999, background:BG1, border:`1px solid ${BLU}`, color:TX, padding:'10px 22px', borderRadius:8, fontSize:13, fontWeight:600 }}>{toast.msg}</div>}

      {confirmAction && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9998 }}>
          <div style={{ background:BG1, border:`1px solid ${RED}`, borderRadius:10, padding:24, width:400, boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize:15, fontWeight:700, color:RED, marginBottom:12 }}>⚠️ 출고 취소 확인</div>
            <div style={{ fontSize:13, color:TX, marginBottom:20 }}>{confirmAction.message}</div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => setConfirmAction(null)} style={{ background:'none', border:`1px solid ${BD}`, color:TX2, padding:'8px 16px', borderRadius:6, cursor:'pointer' }}>취소</button>
              <button onClick={() => deleteDetailItem(confirmAction.payload)} style={{ background:RED, color:'#fff', border:'none', padding:'8px 20px', borderRadius:6, cursor:'pointer', fontWeight:700 }}>확정</button>
            </div>
          </div>
        </div>
      )}

      {keypadTarget && <NumKeypad label={keypadTarget.label} value={String(editQtyMap[keypadTarget.id])} onChange={v=>setEditQtyMap(p=>({...p, [keypadTarget.id]:Number(v)||0}))} onClose={()=>setKeypadTarget(null)} />}
      {calPicker && <CalendarPicker label={calPicker.label} value={editSearch[calPicker.field]} onChange={v=>setEditSearch(p=>({...p, [calPicker.field]:v}))} onClose={()=>setCalPicker(null)} />}
      {editKorPad && <KoreanKeypad label={editKorPad.label} value={filterProduct} onChange={v=>setFilterProduct(v)} onClose={()=>setEditKorPad(null)} />}

      <div onClick={e => e.stopPropagation()} style={{ background: BG1, border: `1px solid ${BD}`, borderRadius: 12, width: `${modalW}%`, maxWidth: 1100, height: `${modalH}%`, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', transform: `scale(${popupScale})`, transformOrigin: 'center center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: 'linear-gradient(135deg, #1c2128 0%, #21262d 100%)', borderBottom: `2px solid ${RED}55`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: TX }}>🔍 출고 수정</span>
            <span style={{ fontSize: 11, color: RED, background: '#2d0d0b', border: `1px solid ${RED}55`, borderRadius: 4, padding: '2px 8px' }}>과거 출고 조회 · 수정</span>
          </div>
          <button onClick={onClose} style={{ background: '#30363d', border: '1px solid #484f58', color: TX, width: 28, height: 28, borderRadius: 6, cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ width: 360, borderRight: `1px solid ${BD2}`, display: 'flex', flexDirection: 'column', background: BG0 }}>
            <div style={{ padding: 16, borderBottom: `1px solid ${BD2}` }}>
               <div style={{ marginBottom: 12 }}>
                 <label style={{ display: 'block', fontSize: 11, color: TX2, marginBottom: 4, fontWeight: 600 }}>📦 창고별</label>
                 <select value={filterWH} onChange={e=>setFilterWH(e.target.value)} style={{ width:'100%', background:BG1, color:TX, border:`1px solid ${BD}`, padding:8, borderRadius:6, fontSize:12, cursor:'pointer' }}>
                   <option value="">전체 창고</option>
                   {warehouses.map(w=><option key={w.id} value={w.id}>{w.warehouseName}</option>)}
                 </select>
               </div>
               <div style={{ marginBottom: 12 }}>
                 <label style={{ display: 'block', fontSize: 11, color: TX2, marginBottom: 4, fontWeight: 600 }}>📅 출고기간</label>
                 <div style={{ display:'flex', gap:5 }}>
                   <button onClick={()=>setCalPicker({field:'startDate', label:'시작일'})} style={{flex:1, background:BG1, color:TX, border:`1px solid ${BD}`, padding:8, borderRadius:6, fontSize:12, textAlign:'left', fontFamily:'monospace'}}>📅 {editSearch.startDate.replace(/-/g,'.')}</button>
                   <button onClick={()=>setCalPicker({field:'endDate', label:'종료일'})} style={{flex:1, background:BG1, color:TX, border:`1px solid ${BD}`, padding:8, borderRadius:6, fontSize:12, textAlign:'left', fontFamily:'monospace'}}>📅 {editSearch.endDate.replace(/-/g,'.')}</button>
                 </div>
               </div>
               <div style={{ marginBottom: 16 }}>
                 <label style={{ display: 'block', fontSize: 11, color: TX2, marginBottom: 4, fontWeight: 600 }}>🏷️ 품목/출고번호</label>
                 <button onClick={()=>setEditKorPad({label:'품목명 검색'})} style={{ width:'100%', textAlign:'left', background:BG1, color:filterProduct?TX:TX3, border:`1px solid ${BD}`, padding:8, borderRadius:6, fontSize:12 }}>{filterProduct || '검색어 입력'}</button>
               </div>
               <button onClick={fetchSessions} style={{ width:'100%', background: 'linear-gradient(135deg, #1158b7 0%, #1a6edb 100%)', border: '1px solid #388bfd', color:'#fff', padding:10, borderRadius:6, fontWeight:700, cursor:'pointer' }}>🔍 조회</button>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr 60px 50px', background: BG2, borderBottom: `1px solid ${BD}`, padding: '0 10px' }}>
                {['NO', '출고번호', '종류', '수량'].map((h, i) => (
                  <div key={h} style={{ padding: '8px 4px', fontSize: 11, fontWeight: 700, color: TX2, textAlign: i >= 2 ? 'right' : 'left' }}>{h}</div>
                ))}
              </div>
              {filteredSessions.map((s, i) => (
                <div key={s.reference} onClick={() => selectRef(s.reference)}
                  style={{
                    display: 'grid', gridTemplateColumns: '30px 1fr 60px 50px',
                    padding: '0 10px', cursor: 'pointer',
                    background: selectedRef === s.reference ? '#2d0d0b' : i % 2 === 0 ? BG0 : '#111720',
                    borderBottom: `1px solid ${BD2}`,
                    borderLeft: selectedRef === s.reference ? `3px solid ${RED}` : '3px solid transparent',
                  }}>
                  <div style={{ padding: '12px 4px', fontSize: 12, color: TX2 }}>{filteredSessions.length - i}</div>
                  <div style={{ padding: '10px 4px' }}>
                    <div style={{ fontSize: 12, color: selectedRef === s.reference ? RED : TX, fontFamily: 'monospace', fontWeight: 600 }}>{s.reference}</div>
                    <div style={{ fontSize: 10, color: TX2, marginTop: 2 }}>{s.createdAt.slice(0, 16).replace('T', ' ')} · {s.userName}</div>
                  </div>
                  <div style={{ padding: '12px 4px', fontSize: 11, color: TX2, textAlign: 'right' }}>{s.itemCount}종</div>
                  <div style={{ padding: '12px 4px', fontSize: 12, color: RED, fontWeight: 700, textAlign: 'right' }}>{s.totalQty}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 오른쪽 상세부 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: BG0 }}>
            {!selectedRef ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: TX3, gap: 10 }}>
                <div style={{ fontSize: 40 }}>📋</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>왼쪽 목록에서 항목을 선택하세요</div>
              </div>
            ) : (
              <>
                <div style={{ padding: '14px 20px', background: BG1, borderBottom: `1px solid ${BD2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: RED, fontFamily: 'monospace' }}>{selectedRef}</div>
                    <div style={{ fontSize: 11, color: TX2, marginTop: 4 }}>담당: {sessions.find(s=>s.reference===selectedRef)?.userName}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 15 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: TX2 }}>총 수량</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: RED }}>{detailTotalQty}<span style={{ fontSize: 11, fontWeight: 400, marginLeft: 2 }}>개</span></div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: TX2 }}>품목</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: TX }}>{detailItems.length}<span style={{ fontSize: 11, fontWeight: 400, marginLeft: 2 }}>종</span></div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 80px 100px 120px', background: BG2, borderBottom: `2px solid ${BD}`, padding: '0 10px' }}>
                  {['NO', '품목명', '수량', '금액(₩)', ''].map((h, i) => (
                    <div key={h} style={{ padding: '10px 4px', fontSize: 11, fontWeight: 700, color: TX2, textAlign: i >= 2 && i <= 3 ? 'right' : i === 4 ? 'center' : 'left' }}>{h}</div>
                  ))}
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {detailItems.map((it, i) => {
                    const curQty = Number(editQtyMap[it.id]) || 0;
                    const changed = curQty !== Number(it.quantity);
                    return (
                      <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 80px 100px 120px', padding: '4px 10px', borderBottom: `1px solid ${BD2}`, alignItems: 'center', background: i % 2 === 0 ? BG0 : '#111720' }}>
                        <div style={{ fontSize: 12, color: TX2 }}>{i + 1}</div>
                        <div>
                          <ProductNameSpec product={it.Product} nameStyle={{ fontSize: 13, fontWeight: 600 }} />
                          <div style={{ fontSize: 10, color: TX2, fontFamily: 'monospace' }}>{it.Product?.productCode}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <button onClick={() => setKeypadTarget({ id: it.id, label: it.Product?.productName })}
                            style={{ background: BG0, border: `1px solid ${changed ? BLU : BD}`, color: changed ? BLU : TX, borderRadius: 4, padding: '5px 10px', fontFamily: 'monospace', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>{curQty}</button>
                        </div>
                        <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>₩{((it.Product?.unitPrice || 0) * curQty).toLocaleString()}</div>
                        <div style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
                          <button onClick={() => saveItem(it)} disabled={!changed} style={{ padding: '5px 12px', background: changed ? GRN : BG3, color: '#fff', border: 'none', borderRadius: 4, cursor: changed ? 'pointer' : 'default', fontSize: 11, fontWeight: 700 }}>저장</button>
                          <button onClick={() => setConfirmAction({ message: `"${it.Product?.productName}" 출고를 취소하시겠습니까?\n취소된 수량만큼 재고가 복구됩니다.`, payload: it })} style={{ padding: '5px 12px', background: RED, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>취소</button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ padding: '12px 20px', background: BG1, borderTop: `1px solid ${BD}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                   <span style={{ fontSize: 12, color: TX2 }}>세션 합계</span>
                   <span style={{ fontSize: 16, fontWeight: 700 }}>₩{detailTotalAmt.toLocaleString()}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 창고간 이동 관리 모달 (신규/수정/취소 통합) ───────────────────
function TransferManagementModal({ user, items, setItems, warehouses, onClose, onRefreshMaster, showToast }) {
  const [activeTab, setActiveTab] = useState('new'); // 'new' | 'history'
  const [selectedWH, setSelectedWH] = useState('');
  const [pendingTransfers, setPendingTransfers] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const [selectedTrans, setSelectedTrans] = useState(null);
  const [editQtyMap, setEditQtyMap] = useState({});
  const [keypadTarget, setKeypadTarget] = useState(null);

  // 같은 부서 창고만 필터링 (자신 제외)
  const deptWHs = warehouses.filter(w => w.deptId === user.deptId && w.id !== user.warehouseId);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await warehouseTransferAPI.getAll({ 
        status: 'pending', 
        fromWarehouseId: user.warehouseId 
      });
      setPendingTransfers(res.data || []);
    } catch { showToast('내역 로드 실패', 'error'); }
    finally { setLoading(false); }
  }, [user.warehouseId, showToast]);

  useEffect(() => {
    if (activeTab === 'history') fetchHistory();
  }, [activeTab, fetchHistory]);

  const handleCreateTransfer = async () => {
    if (!selectedWH) { showToast('대상 창고를 선택하세요', 'error'); return; }
    if (!items.length) { showToast('이동할 품목이 없습니다', 'error'); return; }
    
    setLoading(true);
    try {
      await warehouseTransferAPI.create({
        fromWarehouseId: user.warehouseId,
        toWarehouseId: Number(selectedWH),
        items: items.map(it => ({ productId: it.productId, quantity: it.quantity }))
      });
      showToast('창고간 이동 출고 완료');
      setItems([]);
      onRefreshMaster();
      onClose();
    } catch (e) { showToast(e.response?.data?.error || '이동 등록 실패', 'error'); }
    finally { setLoading(false); }
  };

  const handleUpdateTransfer = async () => {
    if (!selectedTrans) return;
    setLoading(true);
    try {
      const updateItems = selectedTrans.items.map(it => ({
        id: it.id,
        quantity: Number(editQtyMap[it.id] || it.quantity)
      }));
      await warehouseTransferAPI.update(selectedTrans.id, { items: updateItems });
      showToast('이동 수량 수정 완료');
      onRefreshMaster();
      fetchHistory();
      setSelectedTrans(null);
    } catch (e) { showToast(e.response?.data?.error || '수정 실패', 'error'); }
    finally { setLoading(false); }
  };

  const handleCancelTransfer = async (id) => {
    if (!window.confirm('이동을 취소하시겠습니까?\n출고 창고의 재고가 복구됩니다.')) return;
    setLoading(true);
    try {
      await warehouseTransferAPI.cancel(id);
      showToast('이동 취소 완료');
      onRefreshMaster();
      fetchHistory();
      if (selectedTrans?.id === id) setSelectedTrans(null);
    } catch { showToast('취소 실패', 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300 }}>
      {keypadTarget && (
        <NumKeypad 
          label={keypadTarget.label} 
          value={String(editQtyMap[keypadTarget.id])} 
          onChange={v => setEditQtyMap(p => ({ ...p, [keypadTarget.id]: v }))} 
          onClose={() => setKeypadTarget(null)} 
        />
      )}
      
      <div style={{ background: BG1, border: `2px solid ${BD}`, borderRadius: 12, width: '90vw', maxWidth: 900, height: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', background: BG2, borderBottom: `2px solid ${ORG}55`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: TX }}>🔀 창고간 이동 관리</span>
          <div style={{ display: 'flex', background: BG0, borderRadius: 6, padding: 3 }}>
            <button onClick={() => setActiveTab('new')} style={{ padding: '5px 15px', borderRadius: 4, border: 'none', background: activeTab === 'new' ? ORG : 'none', color: activeTab === 'new' ? '#fff' : TX2, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>신규 이동</button>
            <button onClick={() => setActiveTab('history')} style={{ padding: '5px 15px', borderRadius: 4, border: 'none', background: activeTab === 'history' ? ORG : 'none', color: activeTab === 'history' ? '#fff' : TX2, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>이동 내역/수정</button>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: TX, fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'new' ? (
            <div style={{ padding: 30, display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}>
              <div style={{ width: '100%', maxWidth: 400 }}>
                <label style={{ display: 'block', color: TX2, fontSize: 12, marginBottom: 8 }}>도착 창고 선택 (동일 부서만 가능)</label>
                <select value={selectedWH} onChange={e => setSelectedWH(e.target.value)}
                  style={{ width: '100%', background: BG0, border: `2px solid ${ORG}`, color: TX, padding: 12, borderRadius: 8, fontSize: 14 }}>
                  <option value="">-- 창고 선택 --</option>
                  {deptWHs.map(w => <option key={w.id} value={w.id}>{w.warehouseName}</option>)}
                </select>
              </div>
              
              <div style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20, width: '100%', maxWidth: 500 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>이동 예정 품목 ({items.length}종)</div>
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {items.map(it => (
                    <div key={it.productId} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${BD2}`, fontSize: 13 }}>
                      <ProductNameSpec product={it.product} />
                      <span style={{ color: ORG, fontWeight: 700 }}>{it.quantity} {it.product.unit}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={handleCreateTransfer} disabled={loading || !selectedWH || !items.length}
                style={{ width: '100%', maxWidth: 400, padding: 15, background: ORG, border: 'none', color: '#fff', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', marginTop: 20 }}>
                {loading ? '처리 중...' : '🚚 창고간 이동 출고 시작'}
              </button>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <div style={{ width: 350, borderRight: `1px solid ${BD2}`, overflowY: 'auto' }}>
                {pendingTransfers.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: TX3 }}>이동 중인 내역이 없습니다</div>
                ) : (
                  pendingTransfers.map(t => (
                    <div key={t.id} onClick={() => { setSelectedTrans(t); const qm={}; t.items.forEach(it=>qm[it.id]=it.quantity); setEditQtyMap(qm); }}
                      style={{ padding: 15, borderBottom: `1px solid ${BD2}`, cursor: 'pointer', background: selectedTrans?.id === t.id ? '#2d2000' : 'transparent' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: ORG, fontFamily: 'monospace' }}>{t.transferOutNumber}</span>
                        <span style={{ fontSize: 11, color: TX2 }}>{t.outAt.slice(0,10)}</span>
                      </div>
                      <div style={{ fontSize: 12 }}>{t.fromWarehouse?.warehouseName} → <span style={{ color: ORG }}>{t.toWarehouse?.warehouseName}</span></div>
                      <div style={{ fontSize: 11, color: TX2, marginTop: 4 }}>{t.items?.length}종 / {t.items?.reduce((s,i)=>s+i.quantity,0)}개</div>
                    </div>
                  ))
                )}
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: BG0 }}>
                {selectedTrans ? (
                  <>
                    <div style={{ padding: 15, borderBottom: `1px solid ${BD2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>이동 상세: {selectedTrans.transferOutNumber}</span>
                      <button onClick={() => handleCancelTransfer(selectedTrans.id)} style={{ background: 'none', border: `1px solid ${RED}`, color: RED, padding: '5px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>🚫 이동 전체 취소</button>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                      {selectedTrans.items.map(it => {
                        const cur = editQtyMap[it.id];
                        const chg = Number(cur) !== it.quantity;
                        return (
                          <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px', padding: '10px 15px', borderBottom: `1px solid ${BD2}`, alignItems: 'center' }}>
                            <ProductNameSpec product={it.Product} nameStyle={{ fontSize: 13 }} />
                            <button onClick={() => setKeypadTarget({ id: it.id, label: it.Product?.productName })}
                              style={{ background: BG1, border: `1px solid ${chg ? BLU : BD}`, color: chg ? BLU : TX, padding: 5, borderRadius: 4, fontFamily: 'monospace' }}>{cur}</button>
                            <div style={{ fontSize: 11, color: TX2, textAlign: 'right' }}>{it.Product?.unit}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ padding: 15, background: BG1, borderTop: `1px solid ${BD2}` }}>
                      <button onClick={handleUpdateTransfer} style={{ width: '100%', padding: 12, background: BLU, border: 'none', color: '#fff', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>수정 사항 저장</button>
                    </div>
                  </>
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TX3 }}>목록에서 내역을 선택하세요</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 출고화면 전용 스캔 팝업 ───────────────────────────────────────
function ScanOutboundPopup({ product, quantity, onQuantityChange, onQtyPadToggle, onOutbound, onClose }) {
  const qty = quantity || 1;
  const [showPad, setShowPad] = React.useState(false);
  const [padBuf, setPadBuf] = React.useState(String(qty));

  React.useEffect(() => {
    if (!showPad) setPadBuf(String(quantity || 1));
  }, [quantity, showPad]);

  const openPad  = () => { setPadBuf(String(qty)); setShowPad(true);  onQtyPadToggle?.(true);  };
  const closePad = () => { setShowPad(false); onQtyPadToggle?.(false); };

  const pressPad = (k) => {
    if (k === 'C') setPadBuf('');
    else if (k === '←') setPadBuf(p => p.slice(0, -1));
    else setPadBuf(p => (!p || p === '0') ? k : p + k);
  };

  React.useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        if (showPad) { setShowPad(false); onQtyPadToggle?.(false); }
        else onClose();
        return;
      }
      if (!showPad) return;
      if (e.key >= '0' && e.key <= '9') {
        e.stopImmediatePropagation();
        const k = e.key;
        setPadBuf(p => (!p || p === '0') ? k : p + k);
      } else if (e.key === 'Backspace') {
        e.stopImmediatePropagation();
        setPadBuf(p => p.slice(0, -1));
      } else if (e.key === 'Enter') {
        e.stopImmediatePropagation();
        const n = parseInt(padBuf, 10);
        if (n > 0) onQuantityChange(n);
        setShowPad(false);
        onQtyPadToggle?.(false);
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [showPad, padBuf, onClose, onQuantityChange, onQtyPadToggle]);

  const stockColor = product.currentStock === 0 ? RED
    : product.currentStock <= (product.safetyStock || 0) ? YLW : GRN;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.80)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
      <div style={{ background: BG1, border: `1px solid ${BD}`, borderRadius: 12, padding: '28px 32px', width: 440, textAlign: 'center' }}>
        <ProductNameSpec product={product} nameStyle={{ fontSize: 20, fontWeight: 700, color: TX, marginBottom: 4 }} />
        {product.productCode && (
          <div style={{ fontSize: 12, color: TX2, marginBottom: 4, fontFamily: 'monospace' }}>{product.productCode}</div>
        )}
        <div style={{ fontSize: 28, fontWeight: 700, color: stockColor, marginBottom: 2 }}>
          {product.currentStock} <span style={{ fontSize: 14, fontWeight: 400 }}>{product.unit}</span>
        </div>
        <div style={{ fontSize: 12, color: TX2, marginBottom: 16 }}>현재 재고</div>

        {showPad ? (
          <>
            <div style={{ background: BG0, border: `2px solid ${RED}`, borderRadius: 10, padding: '12px 16px', marginBottom: 10, fontSize: 40, fontWeight: 900, color: RED, fontFamily: 'monospace', textAlign: 'right' }}>
              {padBuf || '0'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
              {['7','8','9','4','5','6','1','2','3','C','0','←'].map(k => (
                <button key={k} onClick={() => pressPad(k)} style={{ padding: '14px 0', fontSize: 18, fontWeight: 700, borderRadius: 8, cursor: 'pointer', border: `1px solid ${BD}`, background: BG2, color: TX }}>{k}</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button onClick={closePad} style={{ padding: '12px', fontSize: 14, background: 'none', border: `1px solid ${BD}`, color: TX2, borderRadius: 8, cursor: 'pointer' }}>취소</button>
              <button onClick={() => { const n = parseInt(padBuf, 10); if (n > 0) onQuantityChange(n); closePad(); }}
                style={{ padding: '12px', fontSize: 14, fontWeight: 700, background: '#2d0d0b', border: `2px solid ${RED}`, color: RED, borderRadius: 8, cursor: 'pointer' }}>확인</button>
            </div>
          </>
        ) : (
          <>
            <div onClick={openPad} title="클릭하여 수량 직접 입력"
              style={{ background: '#2d0d0b', border: `2px solid ${RED}`, borderRadius: 10, padding: '10px 20px', marginBottom: 6, display: 'inline-block', minWidth: 140, cursor: 'pointer' }}>
              <div style={{ fontSize: 12, color: RED, marginBottom: 2 }}>출고 수량 (클릭 시 수정)</div>
              <div style={{ fontSize: 36, fontWeight: 900, color: RED, fontFamily: 'monospace' }}>{qty}</div>
              <div style={{ fontSize: 11, color: TX3 }}>{product.unit}</div>
            </div>
            <div style={{ fontSize: 11, color: TX3, marginBottom: 18 }}>바코드를 계속 스캔하면 수량이 증가합니다</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <button onClick={onOutbound} style={{ flex: 1, background: '#2d0d0b', border: `2px solid ${RED}`, color: RED, padding: '14px 0', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 700 }}>
                📤 출고 추가
              </button>
            </div>
            <div style={{ fontSize: 11, color: TX3, marginBottom: 8 }}>출고바코드 스캔 → 자동 추가</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: TX2, fontSize: 13, cursor: 'pointer' }}>취소 (ESC)</button>
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
const WarehouseOutbound = ({user, onGoHome, onNavigate, initialProduct}) => {
  const [clock,  setClock]  = useState(formatClock(new Date()));
  const [uiScale, setUiScale] = useState(1);
  const [ref,    setRef]    = useState(makeRef());
  const [items,  setItems]  = useState([]);
  const [selIdx, setSelIdx] = useState(null);
  const [scanned,setScanned]= useState(null);
  const [qtyPad, setQtyPad] = useState(null);
  const [toast,  setToast]  = useState(null);
  const [products,setProducts]=useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [recentOutbounds, setRecentOutbounds] = useState([]);
  const [selectedWH, setSelectedWH] = useState('');
  const [dataReady, setDataReady] = useState(false);
  const [todayCount, setTodayCount] = useState(0);

  const [showBarInput, setShowBarInput] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [korKeypad, setKorKeypad] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editInitialRef, setEditInitialRef] = useState('');
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [editSearch, setEditSearch] = useState(() => { const d30=new Date(); d30.setDate(d30.getDate()-30); return { startDate: d30.toISOString().slice(0,10), endDate: new Date().toISOString().slice(0,10), reference: '' }; });

  const [showAddPopup, setShowAddPopup] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [pendingBarcode, setPendingBarcode] = useState('');
  const [newProdName, setNewProdName] = useState('');
  const manualRef = useRef(null);

  // ── 출고화면 내 바코드 스캔 팝업 ─────────────────────────────
  const [scanPopup, setScanPopup] = useState(null); // { type:'match', product, quantity }
  const scanPopupRef = useRef(null);
  useEffect(() => { scanPopupRef.current = scanPopup; }, [scanPopup]);
  const [scanPopupQtyPadOpen, setScanPopupQtyPadOpen] = useState(false);
  const blockKorFocus = useRef(false);

  const openKorKeypad = (label, value, onConfirm) => {
    if (blockKorFocus.current) return;
    setKorKeypad({ label, value, onConfirm });
  };
  const closeKorKeypad = (confirm, val) => {
    blockKorFocus.current = true;
    if (confirm && korKeypad) korKeypad.onConfirm(val);
    setKorKeypad(null);
    setTimeout(() => { blockKorFocus.current = false; }, 300);
  };

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };

  const loadAll = useCallback(async () => {
    try {
      const resW = await warehousesAPI.getAll();
      setWarehouses(resW.data || []);
      const wList = resW.data || [];
      const defaultWh = String(user?.warehouseId || wList[0]?.id || '');
      if (defaultWh) setSelectedWH(prev => prev || defaultWh);

      const scopeWh = Number(selectedWH || defaultWh) || null;
      const resP = await productsAPI.getAll(scopeWh ? { warehouseId: scopeWh } : undefined);
      setProducts((resP.data || []).map(p => ({ ...p, unitPrice: parseInt(p.unitPrice, 10) || 0 })));
      const sRes = await outboundAPI.getSessions({});
      const recent = (sRes.data || [])
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, 15);
      setRecentOutbounds(recent);
      setDataReady(true);
      if(initialProduct?.id){
        const latest = (resP.data || []).find(p => p.id === initialProduct.id) || initialProduct;
        if(initialProduct._qty) {
          // 바코드로 수량 확정된 경우 → 키패드 생략, 바로 세션에 추가
          const qty = initialProduct._qty;
          if(latest.currentStock <= 0) {
            showToast(`"${latest.productName}" 재고 없음`, 'error');
          } else {
            const safeQty = qty > latest.currentStock ? latest.currentStock : qty;
            if(safeQty < qty) showToast(`재고 ${latest.currentStock}개만 처리 가능`, 'warn');
            setItems([{ productId: latest.id, product: latest, quantity: safeQty }]);
          }
        } else {
          if(latest.currentStock > 0) { setScanned(latest); setQtyPad({product:latest, value:'1', label:latest.productName}); }
          else showToast(`"${latest.productName}" 재고 없음`, 'error');
        }
      }
    } catch (e) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || '알 수 없는 오류';
      showToast(`로드 실패: ${msg}`, 'error');
    }
  }, [initialProduct, selectedWH, user?.warehouseId]);

  useEffect(() => { loadAll(); const id = setInterval(() => setClock(formatClock(new Date())), 1000); return () => clearInterval(id); }, [loadAll]);
  useEffect(() => {
    const calcScale = () => {
      const w = window.innerWidth || 0;
      if (w >= 1600) return 1.5;
      return 1;
    };
    const applyScale = () => setUiScale(calcScale());
    applyScale();
    window.addEventListener('resize', applyScale);
    return () => window.removeEventListener('resize', applyScale);
  }, []);
  useEffect(() => {
    if (!selectedWH) return;
    productsAPI.getAll({ warehouseId: Number(selectedWH) })
      .then(r => setProducts((r.data || []).map(p => ({ ...p, unitPrice: parseInt(p.unitPrice, 10) || 0 }))))
      .catch(() => {});
  }, [selectedWH]);
  useEffect(() => { outboundAPI.getToday().then(r => setTodayCount(r.data?.sessions || 0)).catch(() => {}); }, []);

  // ── 팝업에서 세션으로 추가 ────────────────────────────────────
  const addToSessionFromPopup = useCallback((product, quantity) => {
    const qty = quantity;
    if (qty > product.currentStock) { showToast('재고 부족', 'error'); return; }
    setItems(prev => {
      const ex = prev.findIndex(i => i.productId === product.id);
      if (ex >= 0) {
        const nq = prev[ex].quantity + qty;
        if (nq > product.currentStock) { showToast('재고 초과', 'error'); return prev; }
        return prev.map((it, idx) => idx === ex ? { ...it, quantity: nq } : it);
      }
      return [...prev, { productId: product.id, product, quantity: qty }];
    });
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, currentStock: p.currentStock - qty } : p));
    showToast('추가 완료');
    setScanPopup(null);
  }, []); // eslint-disable-line

  const processBarcode = useCallback((code) => {
    const q = String(code || '').toLowerCase().trim(); if(!q) return;
    const rawCode = String(code || '').trim().toUpperCase();
    const command = COMMAND_BARCODES[rawCode];
    const current = scanPopupRef.current;

    if (command) {
      if (command.type === 'outbound' && current?.type === 'match') {
        // 출고 바코드 + 팝업 열림 → 키패드 없이 바로 세션 추가
        addToSessionFromPopup(current.product, current.quantity || 1);
        return;
      }
      showToast(`${command.label} 인식`);
      if (command.screen !== 'outbound') onNavigate?.(command.screen);
      return;
    }

    const found = products.find(p => String(p.barcode||'').toLowerCase().trim() === q || String(p.productCode||'').toLowerCase().trim() === q || (p.codes||[]).some(c => String(c.codeValue||'').toLowerCase().trim() === q));

    if (current?.type === 'match') {
      if (found && found.id === current.product?.id) {
        // 같은 품목 → 수량 증가 (재고 초과 체크)
        const nextQty = (current.quantity || 1) + 1;
        if (nextQty > found.currentStock) { showToast('재고 초과', 'error'); return; }
        setScanPopup(prev => ({ ...prev, quantity: nextQty }));
        return;
      }
      if (found) {
        if (found.currentStock <= 0) { showToast(`"${found.productName}" 재고 없음`, 'error'); return; }
        setScanPopup({ type: 'match', product: found, quantity: 1 });
        return;
      }
      // 미등록 → 팝업 닫고 등록 팝업
      setScanPopup(null);
      setPendingBarcode(code); setScanned(null); setShowAddPopup(true);
      return;
    }

    if(!found) { setPendingBarcode(code); setScanned(null); setShowAddPopup(true); return; }
    if(found.currentStock <= 0) { showToast(`"${found.productName}" 재고 없음`, 'error'); return; }
    setScanPopup({ type: 'match', product: found, quantity: 1 });
  }, [products, onNavigate, addToSessionFromPopup]);

  const handleManualScan = (overrideVal) => {
    const val = (overrideVal !== undefined ? overrideVal : manualBarcode).trim();
    if (!val) return;
    processBarcode(val);
    setManualBarcode('');
    setShowBarInput(false);
  };

  const handlePrintCommandBarcode = async (type) => {
    try {
      const command = Object.values(COMMAND_BARCODES).find(x => x.type === type);
      await productsAPI.printCommandLabel({ type });
      showToast(`${command?.label || '명령 바코드'} 출력 요청 완료`);
    } catch (e) {
      showToast(e.response?.data?.error || '명령 바코드 출력 실패', 'error');
    }
  };

  // scanPopup 자체는 스캐너를 막지 않음 (수량증가/명령처리 필요)
  // 단, 팝업 내 수량 키패드가 열리면 스캐너 비활성
  useBarcodeScanner(processBarcode, dataReady && !showAddPopup && !korKeypad && !showEditModal && !showBarInput && !showTransferModal && !scanPopupQtyPadOpen);

  const addToSession = (product, qtyStr) => {
    const qty = parseInt(qtyStr) || 1;
    if(qty > product.currentStock) { showToast('재고 부족', 'error'); return; }
    setItems(prev => {
      const ex = prev.findIndex(i => i.productId === product.id);
      if(ex >= 0) {
        const nq = prev[ex].quantity + qty;
        if(nq > product.currentStock) { showToast('재고 초과', 'error'); return prev; }
        return prev.map((it, idx) => idx === ex ? { ...it, quantity: nq } : it);
      }
      return [...prev, { productId: product.id, product, quantity: qty }];
    });
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, currentStock: p.currentStock - qty } : p));
    showToast(`추가 완료`); setScanned(null); setQtyPad(null);
  };

  const handleConfirm = async () => {
    if(!items.length || addLoading) return;
    setAddLoading(true);
    try {
      await outboundAPI.process({ reference: ref, warehouseId: Number(selectedWH), items: items.map(it => ({ productId: it.productId, quantity: it.quantity })) });
      showToast('출고 완료'); setItems([]); setSelIdx(null); setRef(makeRef()); setTodayCount(c => c + 1); await loadAll();
    } catch (e) { showToast(e.response?.data?.error || '오류', 'error'); }
    finally { setAddLoading(false); }
  };

  const handleQuickAdd = async () => {
    if (!newProdName.trim()) return;
    setAddLoading(true);
    try {
      const res = await productsQuickAdd({ productName: newProdName, barcode: pendingBarcode || null, unit: '개' });
      showToast(`등록 완료`); await loadAll(); processBarcode(pendingBarcode || res.data.productCode);
      setShowAddPopup(false); setNewProdName(''); setPendingBarcode('');
    } catch { showToast('실패', 'error'); }
    finally { setAddLoading(false); }
  };

  useEffect(() => {
    const h = (e) => {
      if(e.ctrlKey || e.altKey || e.metaKey) return;
      if(e.key === 'Escape') {
        if(showEditModal || showTransferModal) return; 
        if(korKeypad) { setKorKeypad(null); return; }
        if(showBarInput) { setShowBarInput(false); return; }
        if(showAddPopup) { setShowAddPopup(false); return; }
        if(qtyPad) { setQtyPad(null); return; }
        onGoHome();
      }
      if(e.key === 'F7' && items.length) { e.preventDefault(); handleConfirm(); }
      if(e.key === 'F8' && selIdx !== null) {
        e.preventDefault();
        const item = items[selIdx];
        setProducts(prev => prev.map(p => p.id === item.productId ? { ...p, currentStock: p.currentStock + item.quantity } : p));
        setItems(p => p.filter((_, i) => i !== selIdx));
        setSelIdx(null);
      }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [qtyPad, items, selIdx, onGoHome, showAddPopup, korKeypad, showEditModal, showBarInput, showTransferModal]); // eslint-disable-line

  return (
    <div style={{ height:'100vh', width:'100%', overflow:'hidden', background:BG0 }}>
      <div style={{
        display:'flex',
        flexDirection:'column',
        width: `${(100 / uiScale).toFixed(3)}%`,
        height: `${(100 / uiScale).toFixed(3)}%`,
        transform: `scale(${uiScale})`,
        transformOrigin:'top left',
        background:BG0,
        color:TX,
        fontFamily:"'Malgun Gothic', sans-serif",
        overflow:'hidden',
      }}>
      {toast && <div style={{ position:'fixed', top:20, left:'50%', transform:'translateX(-50%)', zIndex:9999, background:BG1, border:`1px solid ${BLU}`, color:TX, padding:'10px 22px', borderRadius:8, fontSize:13, fontWeight:600 }}>{toast.msg}</div>}
      {scanPopup?.type === 'match' && (
        <ScanOutboundPopup
          product={scanPopup.product}
          quantity={scanPopup.quantity || 1}
          onQuantityChange={(n) => setScanPopup(prev => ({ ...prev, quantity: n }))}
          onQtyPadToggle={(open) => setScanPopupQtyPadOpen(open)}
          onOutbound={() => addToSessionFromPopup(scanPopup.product, scanPopup.quantity || 1)}
          onClose={() => setScanPopup(null)}
        />
      )}
      {qtyPad && <NumKeypad label={qtyPad.label} value={qtyPad.value} onChange={v => addToSession(qtyPad.product, v)} onClose={() => setQtyPad(null)} />}
      {korKeypad && (
        <KoreanKeypad
          label={korKeypad.label}
          value={korKeypad.value}
          onChange={v => closeKorKeypad(true, v)}
          onClose={() => closeKorKeypad(false)}
        />
      )}
      {showEditModal && (
        <EditModal
          warehouses={warehouses}
          editSearch={editSearch}
          setEditSearch={setEditSearch}
          onClose={() => setShowEditModal(false)}
          onRefreshMaster={loadAll}
          initialReference={editInitialRef}
          uiScale={uiScale}
        />
      )}
      {showTransferModal && <TransferManagementModal user={user} items={items} setItems={setItems} warehouses={warehouses} onClose={()=>setShowTransferModal(false)} onRefreshMaster={loadAll} showToast={showToast} />}

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 20px', height:54, background:BG1, borderBottom:`2px solid ${RED}55`, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}><span style={{fontSize:18, fontWeight:700}}>📤 출고 처리</span><span style={{fontSize:11, color:RED, background:'#2d0d0b', border:`1px solid ${RED}55`, borderRadius:4, padding:'2px 8px'}}>F2</span></div>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}><span style={{fontSize:12, color:TX2, fontFamily:'monospace'}}>{clock}</span><button onClick={onGoHome} style={{background:BG2, border:`1px solid ${BD}`, color:TX2, padding:'6px 14px', borderRadius:6, cursor:'pointer', fontSize:12}}>🏠 홈</button></div>
      </div>

      <div style={{ flex:1, display:'flex', overflow:'hidden', alignItems:'stretch' }}>
        <div style={{ width:320, background:BG0, borderRight:`1px solid ${BD2}`, display:'flex', flexDirection:'column', padding:'14px 12px', overflowY:'auto', flexShrink:0 }}>
          <div style={{ fontSize:13, fontWeight:600, color:BLU, marginBottom:8 }}>최근 출고 내역</div>
          {recentOutbounds.length === 0 ? (
            <p style={{ color:TX2, fontSize:12, textAlign:'center', marginTop:12 }}>출고 내역이 없습니다</p>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {recentOutbounds.map(s => (
                <div key={s.reference}
                  onClick={() => {
                    setEditSearch(prev => ({ ...prev, reference: s.reference }));
                    setEditInitialRef(s.reference);
                    setShowEditModal(true);
                  }}
                  style={{ background:BG2, border:`1px solid ${BD2}`, borderRadius:6, padding:'7px 8px', cursor:'pointer' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                    <span style={{ color:BLU, fontFamily:'monospace', fontSize:11 }}>{s.reference}</span>
                    <span style={{ color:TX2, fontSize:10 }}>{(s.createdAt || '').toString().replace('T', ' ').slice(0, 16)}</span>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
                    <span style={{ color:TX }}>{s.userName || '—'}</span>
                    <span style={{ color:GRN }}>{s.itemCount || 0}종 / {(s.totalQty || 0).toLocaleString()}개</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:BG0 }}>
          <div style={{ padding:'8px 14px', borderBottom:`1px solid ${BD2}`, display:'flex', justifyContent:'space-between', fontSize:12 }}>
             <span style={{color:BLU, fontWeight:500}}>
               ※ 바코드를 스캔하면 리스트가 보여집니다.
               {scanned ? <span style={{ marginLeft: 8, color: stockSt(scanned).color }}>최근 스캔: {scanned.productName}{scanned.specification ? ` / ${scanned.specification}` : ''}</span> : null}
             </span>
             <span style={{fontFamily:'monospace'}}>출고번호: <span style={{color:RED, fontWeight:700}}>{ref}</span></span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'44px 1fr 80px 90px 100px', background:BG2, borderBottom:`2px solid ${BD}`, padding:'0 8px' }}>
            {['NO','품목명','수량','단가','금액'].map((h,i)=><div key={h} style={{padding:'10px 6px', fontSize:12, fontWeight:700, color:TX2, textAlign:i>=2?'right':'left'}}>{h}</div>)}
          </div>
          <div style={{ flex:1, overflowY:'auto' }}>
            {items.map((it, i) => (
              <div key={i} onClick={()=>setSelIdx(i)} style={{ display:'grid', gridTemplateColumns:'44px 1fr 80px 90px 100px', padding:'0 8px', borderBottom:`1px solid ${BD}`, background:selIdx===i?'#1a0a0a':BG0, cursor:'pointer' }}>
                <div style={{padding:10, fontSize:12, color:TX2}}>{i+1}</div>
                <div style={{padding:8}}><ProductNameSpec product={it.product} nameStyle={{fontSize:14, fontWeight:selIdx===i?700:400}} /><div style={{fontSize:11, color:TX2}}>{it.product.productCode}</div></div>
                <div style={{padding:10, textAlign:'right', color:RED, fontWeight:700}}>{it.quantity}</div>
                <div style={{padding:10, textAlign:'right', fontSize:12, color:TX2}}>{it.product.unitPrice.toLocaleString()}</div>
                <div style={{padding:10, textAlign:'right', fontWeight:600}}>{(it.quantity * it.product.unitPrice).toLocaleString()}</div>
              </div>
            ))}
          </div>
          <div style={{ padding:15, background:BG1, borderTop:`1px solid ${BD}` }}>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:10}}><span style={{color:TX2}}>총 출고 합계</span><span><strong style={{color:RED, marginRight:10}}>{items.reduce((s,i)=>s+i.quantity,0)}개</strong><strong>₩{items.reduce((s,i)=>s+i.quantity*i.product.unitPrice,0).toLocaleString()}</strong></span></div>
            <button onClick={handleConfirm} disabled={!items.length} style={{ width:'100%', padding:15, background:items.length?'linear-gradient(135deg,#da3633,#f85149)':BG3, border:'none', color:'#fff', borderRadius:8, fontSize:16, fontWeight:700, cursor:items.length?'pointer':'default' }}>📤 출고 확정 (F7)</button>
          </div>
        </div>

        <div style={{ width:230, background:BG1, borderLeft:`1px solid ${BD2}`, display:'flex', flexDirection:'column', padding:10, gap:6 }}>
          <div style={{ fontSize:11, color:TX2, paddingLeft:4 }}>출고 옵션</div>
          <select value={selectedWH} onChange={e=>setSelectedWH(e.target.value)} style={{ background:BG0, color:TX, border:`1px solid ${BD}`, padding:8, borderRadius:6, fontSize:12 }}>
            {warehouses.map(w=><option key={w.id} value={w.id}>{w.warehouseName}</option>)}
          </select>
          <RightBtn icon="▦" label="바코드 입력" sub="수동 입력" color={BLU}
            onClick={() => {
              setShowBarInput(true);
              setTimeout(() => openKorKeypad('바코드 / 품목코드 입력', '', v => { setManualBarcode(v); handleManualScan(v); }), 50);
            }} />
          <RightBtn icon="▥" label="출고바코드 출력" sub="W99998" color={RED} onClick={() => handlePrintCommandBarcode('outbound')} />
          <div style={{ borderTop:`1px solid ${BD2}`, margin:'4px 0' }} />
          <RightBtn icon="🔍" label="출고 수정" sub="이력 조회" color="#a371f7"
            onClick={() => { setEditInitialRef(''); setShowEditModal(true); }} />
          <RightBtn icon="🔀" label="창고간출고" sub="창고 이동 관리" color={ORG} onClick={()=>setShowTransferModal(true)} />
          <div style={{ borderTop:`1px solid ${BD2}`, margin:'4px 0' }} />
          <RightBtn icon="✕" label="선택 삭제" sub="F8" color={RED} disabled={selIdx===null} onClick={()=>{
             if(selIdx===null) return;
             const item = items[selIdx];
             setProducts(prev => prev.map(p => p.id === item.productId ? { ...p, currentStock: p.currentStock + item.quantity } : p));
             setItems(p => p.filter((_, i) => i !== selIdx));
             setSelIdx(null);
          }} />
          <RightBtn icon="🔄" label="초기화" sub="F9" color={YLW} onClick={()=>{if(window.confirm('초기화?')){setItems([]);setRef(makeRef());}}} />
          <div style={{ flex:1 }} />
          <div style={{ background:BG0, padding:10, borderRadius:8, textAlign:'center' }}><div style={{fontSize:10, color:TX2}}>오늘 출고</div><div style={{fontSize:18, fontWeight:800, color:RED}}>{todayCount}건</div></div>
        </div>
      </div>
      
      {showBarInput && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '22px 26px', width: 380 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e6edf3', marginBottom: 4 }}>바코드 수동 입력</div>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 14 }}>스캐너 불량 시 바코드 번호를 직접 입력하세요</div>
            <input
              ref={manualRef}
              data-barcode-manual="true"
              inputMode="text" lang="ko"
              value={manualBarcode}
              onChange={e => setManualBarcode(e.target.value)}
              readOnly
              onClick={e => { e.stopPropagation(); !korKeypad && openKorKeypad('바코드 / 품목코드 입력', manualBarcode, v => setManualBarcode(v)); }}
              onKeyDown={e => { if (!korKeypad && e.key === 'Enter') handleManualScan(); if (!korKeypad && e.key === 'Escape') setShowBarInput(false); }}
              placeholder="바코드 번호 입력 후 Enter"
              style={{ width: '100%', background: '#0d1117', border: `1px solid ${korKeypad ? '#58a6ff' : '#388bfd'}`, borderRadius: 6, color: '#e6edf3', padding: '10px 12px', fontSize: 15, fontFamily: 'monospace', boxSizing: 'border-box', marginBottom: 14, cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowBarInput(false)} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>취소</button>
              <button onClick={handleManualScan} style={{ background: '#1158b7', border: '1px solid #388bfd', color: '#fff', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>조회</button>
            </div>
          </div>
        </div>
      )}

      {showAddPopup && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.78)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1100 }}>
          <div style={{ background:'#161b22', border:`1px solid ${BD}`, borderRadius:10, padding:'20px 24px', width:400 }}>
            <div style={{ fontSize:14, fontWeight:700, color:TX, marginBottom:12 }}>새 품목 빠른 등록</div>
            {pendingBarcode && <div style={{ fontFamily:'monospace', fontSize:12, color:BLU, marginBottom:10 }}>바코드: {pendingBarcode}</div>}
            <input value={newProdName} onChange={e=>setNewProdName(e.target.value)} placeholder="품목명 입력" autoFocus style={{ width:'100%', background:BG0, border:`1px solid ${BD}`, borderRadius:5, color:TX, padding:'10px', fontSize:13, boxSizing:'border-box', marginBottom:10 }} />
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={()=>setShowAddPopup(false)} style={{ background: 'none', border: `1px solid ${BD}`, color: TX2, padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>취소</button>
              <button onClick={handleQuickAdd} disabled={addLoading} style={{ background: GRN, border: `1px solid ${GRN}`, color: '#fff', padding: '7px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>{addLoading ? '등록 중…' : '임시 등록'}</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default WarehouseOutbound;
