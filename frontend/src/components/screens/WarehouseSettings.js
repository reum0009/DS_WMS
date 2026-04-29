import React, { useState, useEffect } from 'react';

const BG0='#0d1117',BG1='#161b22',BG2='#1c2128',BD='#30363d',BD2='#21262d';
const TX='#e6edf3',TX2='#8b949e',TX3='#444c56';
const RED='#f85149',GRN='#3fb950',BLU='#58a6ff',YLW='#e3b341',GRAY='#8b949e';

function formatClock(d){const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;}

const Toggle=({checked,onChange})=>(
  <div onClick={()=>onChange(!checked)} style={{
    width:42,height:22,borderRadius:11,background:checked?GRN:BG2,border:`1px solid ${checked?GRN:BD}`,
    cursor:'pointer',position:'relative',transition:'all 0.2s',flexShrink:0,
  }}>
    <div style={{width:16,height:16,borderRadius:8,background:'#fff',position:'absolute',top:2,left:checked?22:2,transition:'left 0.2s'}}/>
  </div>
);

const Row=({label,desc,children})=>(
  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'13px 16px',borderBottom:`1px solid ${BD2}`}}>
    <div>
      <div style={{fontSize:13,color:TX}}>{label}</div>
      {desc&&<div style={{fontSize:11,color:TX2,marginTop:2}}>{desc}</div>}
    </div>
    <div style={{flexShrink:0,marginLeft:20}}>{children}</div>
  </div>
);

const Section=({title,children})=>(
  <div style={{marginBottom:16}}>
    <div style={{fontSize:11,fontWeight:700,color:TX3,textTransform:'uppercase',letterSpacing:'0.5px',padding:'10px 16px 6px'}}>{title}</div>
    <div style={{background:BG1,border:`1px solid ${BD}`,borderRadius:8,overflow:'hidden'}}>{children}</div>
  </div>
);

const TABS=[
  {id:'server',  label:'🔌 서버접속'},
  {id:'autologin',label:'🔑 자동로그인'},
  {id:'scanner', label:'📷 바코드'},
  {id:'display', label:'🖥 화면'},
  {id:'system',  label:'⚙️ 시스템'},
  {id:'about',   label:'ℹ️ 정보'},
];

// localStorage 키
const LS_SERVER  = 'wms_server_url';
const LS_AUTO    = 'wms_autologin';
const LS_SAVED   = 'wms_saved_account'; // { username }

const DEFAULT_SERVER_URL =
  process.env.REACT_APP_SERVER_URL ||
  process.env.REACT_APP_APP_ORIGIN ||
  window.location.origin;

const QUICK_SERVER_PRESETS = [
  ['현재 접속 주소', DEFAULT_SERVER_URL],
  ...(process.env.REACT_APP_BACKUP_SERVER_URL
    ? [['백업 서버', process.env.REACT_APP_BACKUP_SERVER_URL]]
    : []),
];

const WarehouseSettings = ({user, onGoHome}) => {
  const [clock, setClock] = useState(formatClock(new Date()));
  const [tab,   setTab]   = useState('server');
  const [toast, setToast] = useState(null);

  // ── 서버접속 상태 ─────────────────────────────────────────────────
  const [svrStatus, setSvrStatus] = useState({}); // { api, ping, msg, code }
  const [checking,  setChecking]  = useState(false);

  // ── 설정값 ────────────────────────────────────────────────────────
  const [cfg, setCfg] = useState(() => {
    const savedUrl = localStorage.getItem(LS_SERVER) || DEFAULT_SERVER_URL;
    const savedAuto = localStorage.getItem(LS_AUTO) === 'true';
    const savedAcc  = (() => { try { return JSON.parse(localStorage.getItem(LS_SAVED)||'{}'); } catch { return {}; } })();
    return {
      // 서버접속
      apiUrl:      savedUrl,
      connTimeout: 5,        // 초
      retryCount:  3,
      retryDelay:  2,        // 초
      // 자동로그인
      autoLogin:   savedAuto,
      saveAccount: !!savedAcc.username,
      savedUser:   savedAcc.username || '',
      // 스캐너
      scannerSpeed:50, scannerMinLen:3, scannerIdle:280,
      autoAddOnScan:true, beepOnScan:true,
      // 화면
      fontSize:'medium', showStockBar:true, showCategory:true,
      fullscreen:true, confirmOnOutbound:true, confirmOnInbound:false,
      // 시스템
      autoBackup:false, sessionTimeout:480,
      lowStockAlert:true, emptyStockAlert:true,
    };
  });

  useEffect(()=>{const id=setInterval(()=>setClock(formatClock(new Date())),1000);return()=>clearInterval(id);},[]);
  useEffect(()=>{
    const h=(e)=>{if(e.key==='Escape')onGoHome();};
    window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h);
  },[onGoHome]);

  const set=(key,val)=>setCfg(p=>({...p,[key]:val}));
  const showToast=(msg,type='success')=>{setToast({msg,type});setTimeout(()=>setToast(null),2200);};

  // 저장
  const save=()=>{
    localStorage.setItem(LS_SERVER, cfg.apiUrl);
    localStorage.setItem(LS_AUTO,   String(cfg.autoLogin));
    if (!cfg.saveAccount) {
      localStorage.removeItem(LS_SAVED);
    }
    showToast('설정 저장 완료');
  };

  // 서버 연결 테스트
  const checkServer = async () => {
    setChecking(true);
    setSvrStatus({});
    const t0 = Date.now();
    const url = cfg.apiUrl.replace(/\/+$/,'');
    try {
      const res = await fetch(`${url}/api/auth/me`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')||''}` },
        signal: AbortSignal.timeout(cfg.connTimeout * 1000),
      });
      const ping = Date.now() - t0;
      const ok   = res.status < 500;
      setSvrStatus({ api: ok?'ok':'error', ping, code: res.status,
        msg: ok ? '서버 응답 정상' : `서버 오류 (HTTP ${res.status})` });
    } catch(e) {
      const ping = Date.now() - t0;
      const isTimeout = e.name === 'TimeoutError' || e.name === 'AbortError';
      setSvrStatus({ api:'error', ping,
        msg: isTimeout ? `응답 시간 초과 (${cfg.connTimeout}초)` : '연결 실패 — 서버 주소를 확인하세요' });
    } finally {
      setChecking(false);
    }
  };

  // 저장된 로그인 정보 삭제
  const clearSavedAccount=()=>{
    localStorage.removeItem(LS_SAVED);
    localStorage.removeItem(LS_AUTO);
    set('savedUser','');
    set('saveAccount',false);
    set('autoLogin',false);
    showToast('저장된 로그인 정보 삭제됨');
  };

  const inp=(key,type='text',opts={})=>(
    <input type={type} value={cfg[key]} onChange={e=>set(key,type==='number'?Number(e.target.value):e.target.value)}
      style={{background:BG2,border:`1px solid ${BD}`,borderRadius:6,color:TX,padding:'6px 10px',fontSize:12,
        width:opts.width||140,textAlign:type==='number'?'right':'left',...opts.style}}/>
  );

  const sel=(key,options)=>(
    <select value={cfg[key]} onChange={e=>set(key,e.target.value)}
      style={{background:BG2,border:`1px solid ${BD}`,borderRadius:6,color:TX,padding:'6px 10px',fontSize:12,cursor:'pointer',width:140}}>
      {options.map(([v,l])=><option key={v} value={v}>{l}</option>)}
    </select>
  );

  // 연결 상태 색
  const apiColor = !svrStatus.api ? TX3 : svrStatus.api==='ok' ? GRN : RED;
  const pingColor = !svrStatus.ping ? TX3 : svrStatus.ping<100 ? GRN : svrStatus.ping<400 ? YLW : RED;

  return(
    <div style={{display:'flex',flexDirection:'column',height:'100vh',background:BG0,color:TX,fontFamily:"'Noto Sans KR',sans-serif",overflow:'hidden'}}>

      {/* TOP BAR */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 20px',height:54,background:BG1,borderBottom:`2px solid ${GRAY}55`,flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:18,fontWeight:700}}>⚙️ 설정</span>
          <span style={{fontSize:11,color:GRAY,background:BG2,border:`1px solid ${BD}`,borderRadius:4,padding:'2px 8px'}}>F10</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <span style={{fontSize:12,color:TX2,fontFamily:'monospace'}}>{clock}</span>
          <button onClick={save} style={{background:'#1158b7',border:`1px solid ${BLU}`,color:'#fff',padding:'6px 16px',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:700}}>💾 저장</button>
          <button onClick={onGoHome} style={{background:BG2,border:`1px solid ${BD}`,color:TX2,padding:'6px 14px',borderRadius:6,cursor:'pointer',fontSize:12}}>🏠 홈</button>
        </div>
      </div>

      {/* BODY */}
      <div style={{flex:1,display:'flex',overflow:'hidden'}}>

        {/* 탭 사이드 */}
        <div style={{width:160,background:BG1,borderRight:`1px solid ${BD2}`,flexShrink:0,paddingTop:8}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{width:'100%',padding:'11px 16px',textAlign:'left',background:tab===t.id?BG2:'transparent',
                border:'none',borderLeft:tab===t.id?`3px solid ${BLU}`:'3px solid transparent',
                color:tab===t.id?TX:TX2,cursor:'pointer',fontSize:13,fontWeight:tab===t.id?700:400}}>
              {t.label}
            </button>
          ))}
        </div>

        {/* 탭 내용 */}
        <div style={{flex:1,overflowY:'auto',padding:'16px 24px'}}>

          {/* ─── 서버접속 ──────────────────────────────────────── */}
          {tab==='server'&&(
            <>
              {/* 연결 상태 카드 */}
              <div style={{display:'flex',gap:10,marginBottom:16}}>
                <div style={{flex:1,background:BG2,border:`1px solid ${apiColor}44`,borderRadius:8,padding:'14px',textAlign:'center'}}>
                  <div style={{fontSize:22,marginBottom:4}}>🌐</div>
                  <div style={{fontSize:18,fontWeight:700,color:apiColor}}>
                    {!svrStatus.api ? '—' : svrStatus.api==='ok' ? '정상' : '오류'}
                  </div>
                  <div style={{fontSize:11,color:TX2,marginTop:2}}>API 서버</div>
                </div>
                <div style={{flex:1,background:BG2,border:`1px solid ${pingColor}44`,borderRadius:8,padding:'14px',textAlign:'center'}}>
                  <div style={{fontSize:22,marginBottom:4}}>⚡</div>
                  <div style={{fontSize:18,fontWeight:700,color:pingColor}}>
                    {svrStatus.ping != null ? `${svrStatus.ping}ms` : '—'}
                  </div>
                  <div style={{fontSize:11,color:TX2,marginTop:2}}>응답시간</div>
                </div>
                <div style={{flex:1,background:BG2,border:`1px solid ${BD}`,borderRadius:8,padding:'14px',textAlign:'center'}}>
                  <div style={{fontSize:22,marginBottom:4}}>📡</div>
                  <div style={{fontSize:13,fontWeight:700,color:TX2,wordBreak:'break-all',fontFamily:'monospace'}}>
                    {cfg.apiUrl.replace('http://','').replace('https://','').split('/')[0]}
                  </div>
                  <div style={{fontSize:11,color:TX2,marginTop:2}}>접속 주소</div>
                </div>
              </div>

              {/* 연결 테스트 버튼 */}
              <div style={{marginBottom:16}}>
                <button onClick={checkServer} disabled={checking}
                  style={{width:'100%',padding:'12px',fontSize:14,fontWeight:700,
                    background:checking?BG2:'linear-gradient(135deg,#0d2a56,#1e4fa0)',
                    border:`1px solid ${checking?BD:BLU}`,color:checking?TX3:'#fff',
                    borderRadius:8,cursor:checking?'default':'pointer',transition:'all 0.2s'}}>
                  {checking?'⟳ 연결 확인 중...':'🔌 서버 연결 테스트'}
                </button>
                {svrStatus.msg&&(
                  <div style={{marginTop:8,padding:'8px 12px',
                    background:svrStatus.api==='ok'?'#0d2616':'#2d0d0b',
                    border:`1px solid ${svrStatus.api==='ok'?GRN:RED}44`,borderRadius:6,
                    fontSize:12,color:svrStatus.api==='ok'?GRN:RED,textAlign:'center'}}>
                    {svrStatus.api==='ok'?'✅':'❌'} {svrStatus.msg}
                    {svrStatus.code&&<span style={{color:TX3,marginLeft:8}}>HTTP {svrStatus.code}</span>}
                  </div>
                )}
              </div>

              {/* 서버 주소 설정 */}
              <Section title="서버 주소">
                <Row label="API 서버 URL" desc="백엔드 주소 (포트 포함)">
                  <input value={cfg.apiUrl}
                    onChange={e=>set('apiUrl',e.target.value)}
                    placeholder={DEFAULT_SERVER_URL}
                    style={{background:BG2,border:`1px solid ${BD}`,borderRadius:6,color:TX,
                      padding:'6px 10px',fontSize:12,width:230}}/>
                </Row>
                <Row label="빠른 설정">
                  <div style={{display:'flex',gap:6}}>
                    {QUICK_SERVER_PRESETS.map(([l,v])=>(
                      <button key={l} onClick={()=>set('apiUrl',v)}
                        style={{fontSize:11,padding:'5px 10px',background:cfg.apiUrl===v?'#1158b7':BG2,
                          border:`1px solid ${cfg.apiUrl===v?BLU:BD}`,color:cfg.apiUrl===v?'#fff':TX2,
                          borderRadius:4,cursor:'pointer'}}>
                        {l}
                      </button>
                    ))}
                  </div>
                </Row>
              </Section>

              {/* 연결 옵션 */}
              <Section title="연결 옵션">
                <Row label="연결 타임아웃 (초)" desc="이 시간 초과 시 연결 실패 처리">
                  {inp('connTimeout','number',{width:70})}
                </Row>
                <Row label="재연결 시도 횟수" desc="연결 실패 시 자동 재시도">
                  {inp('retryCount','number',{width:70})}
                </Row>
                <Row label="재연결 대기 (초)" desc="재시도 간격">
                  {inp('retryDelay','number',{width:70})}
                </Row>
              </Section>
            </>
          )}

          {/* ─── 자동로그인 ────────────────────────────────────── */}
          {tab==='autologin'&&(
            <>
              {/* 현재 로그인 정보 카드 */}
              <div style={{background:BG1,border:`1px solid ${BD}`,borderRadius:8,padding:'16px 20px',marginBottom:16}}>
                <div style={{fontSize:11,color:TX3,marginBottom:8}}>현재 로그인 계정</div>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <div style={{width:40,height:40,borderRadius:20,background:'#1158b7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>
                    👤
                  </div>
                  <div>
                    <div style={{fontSize:15,fontWeight:700,color:TX}}>{user?.name||'—'}</div>
                    <div style={{fontSize:12,color:TX2,marginTop:2}}>
                      역할: {user?.role||'warehouse'} · {user?.warehouse||'창고'}
                    </div>
                  </div>
                  <div style={{marginLeft:'auto'}}>
                    <span style={{fontSize:10,color:GRN,background:'#0d2616',border:`1px solid ${GRN}44`,borderRadius:4,padding:'3px 8px'}}>
                      ● 로그인 중
                    </span>
                  </div>
                </div>
              </div>

              <Section title="자동 로그인 설정">
                <Row label="자동 로그인 사용"
                  desc="앱 시작 시 저장된 계정으로 자동 로그인">
                  <Toggle checked={cfg.autoLogin} onChange={v=>set('autoLogin',v)}/>
                </Row>
                <Row label="계정 정보 저장"
                  desc="현재 로그인 계정을 이 기기에 저장">
                  <Toggle checked={cfg.saveAccount} onChange={v=>{
                    set('saveAccount',v);
                    if (v) {
                      const acc = { username: user?.username||user?.name||'' };
                      localStorage.setItem(LS_SAVED, JSON.stringify(acc));
                      set('savedUser', acc.username);
                    } else {
                      localStorage.removeItem(LS_SAVED);
                      set('savedUser','');
                    }
                  }}/>
                </Row>
              </Section>

              {/* 저장된 계정 정보 */}
              <Section title="저장된 계정">
                {cfg.savedUser ? (
                  <>
                    <Row label="저장된 사용자">
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <span style={{fontSize:12,color:BLU,fontFamily:'monospace'}}>{cfg.savedUser}</span>
                        <span style={{fontSize:10,color:GRN,background:'#0d2616',border:`1px solid ${GRN}44`,borderRadius:3,padding:'2px 6px'}}>저장됨</span>
                      </div>
                    </Row>
                    <Row label="저장 정보 삭제" desc="자동 로그인도 함께 해제됩니다">
                      <button onClick={clearSavedAccount}
                        style={{fontSize:11,padding:'6px 12px',background:'#2d0d0b',border:`1px solid ${RED}`,
                          color:RED,borderRadius:5,cursor:'pointer',fontWeight:700}}>
                        🗑 삭제
                      </button>
                    </Row>
                  </>
                ) : (
                  <div style={{padding:'20px',textAlign:'center',color:TX3,fontSize:13}}>
                    저장된 계정 없음<br/>
                    <span style={{fontSize:11}}>위에서 '계정 정보 저장'을 켜면 현재 계정이 저장됩니다</span>
                  </div>
                )}
              </Section>

              {/* 보안 안내 */}
              <div style={{background:'#2d2000',border:`1px solid ${YLW}33`,borderRadius:8,padding:'12px 16px'}}>
                <div style={{fontSize:12,color:YLW,fontWeight:700,marginBottom:6}}>⚠️ 보안 안내</div>
                <div style={{fontSize:11,color:TX2,lineHeight:1.6}}>
                  • 계정 정보는 이 기기의 브라우저 저장소에 보관됩니다.<br/>
                  • 공용 PC에서는 자동 로그인 사용을 권장하지 않습니다.<br/>
                  • 비밀번호는 저장하지 않으며, 서버 세션 토큰만 유지됩니다.
                </div>
              </div>
            </>
          )}

          {/* ─── 바코드 ────────────────────────────────────────── */}
          {tab==='scanner'&&(
            <>
              <Section title="스캐너 인식 설정">
                <Row label="스캐너 속도 임계값 (ms)" desc="이 속도 이하면 스캐너로 판정">{inp('scannerSpeed','number',{width:80})}</Row>
                <Row label="최소 문자 수" desc="바코드 인식 최소 길이">{inp('scannerMinLen','number',{width:80})}</Row>
                <Row label="유휴 초기화 시간 (ms)" desc="입력 없으면 버퍼 초기화">{inp('scannerIdle','number',{width:80})}</Row>
              </Section>
              <Section title="스캔 동작">
                <Row label="스캔 시 자동 추가" desc="스캔 즉시 세션에 추가"><Toggle checked={cfg.autoAddOnScan} onChange={v=>set('autoAddOnScan',v)}/></Row>
                <Row label="스캔 알림음" desc="인식 성공 시 비프음"><Toggle checked={cfg.beepOnScan} onChange={v=>set('beepOnScan',v)}/></Row>
              </Section>
            </>
          )}

          {/* ─── 화면 ──────────────────────────────────────────── */}
          {tab==='display'&&(
            <>
              <Section title="화면 표시">
                <Row label="글꼴 크기">{sel('fontSize',[['small','작게'],['medium','보통'],['large','크게']])}</Row>
                <Row label="재고 막대 표시" desc="품목 목록에 재고 비율 막대 표시"><Toggle checked={cfg.showStockBar} onChange={v=>set('showStockBar',v)}/></Row>
                <Row label="카테고리 표시" desc="품목 목록에 카테고리 표시"><Toggle checked={cfg.showCategory} onChange={v=>set('showCategory',v)}/></Row>
                <Row label="전체화면 자동 진입" desc="시작 시 전체화면으로 전환"><Toggle checked={cfg.fullscreen} onChange={v=>set('fullscreen',v)}/></Row>
              </Section>
              <Section title="확인 팝업">
                <Row label="출고 확정 전 확인" desc="출고 처리 전 확인 팝업 표시"><Toggle checked={cfg.confirmOnOutbound} onChange={v=>set('confirmOnOutbound',v)}/></Row>
                <Row label="입고 확정 전 확인" desc="입고 처리 전 확인 팝업 표시"><Toggle checked={cfg.confirmOnInbound} onChange={v=>set('confirmOnInbound',v)}/></Row>
              </Section>
            </>
          )}

          {/* ─── 시스템 ────────────────────────────────────────── */}
          {tab==='system'&&(
            <>
              <Section title="세션">
                <Row label="세션 타임아웃 (분)" desc="비활동 후 자동 로그아웃">{inp('sessionTimeout','number',{width:80})}</Row>
              </Section>
              <Section title="알림">
                <Row label="저재고 경보" desc="안전재고 이하 품목 알림"><Toggle checked={cfg.lowStockAlert} onChange={v=>set('lowStockAlert',v)}/></Row>
                <Row label="소진 품목 경보" desc="재고 0 품목 긴급 알림"><Toggle checked={cfg.emptyStockAlert} onChange={v=>set('emptyStockAlert',v)}/></Row>
              </Section>
              <Section title="로컬 저장소">
                <Row label="앱 데이터 초기화" desc="서버 설정, 자동로그인 등 모두 삭제">
                  <button onClick={()=>{
                    [LS_SERVER,LS_AUTO,LS_SAVED,'token','user'].forEach(k=>localStorage.removeItem(k));
                    showToast('로컬 데이터 초기화 완료 — 재시작하세요','warn');
                  }} style={{fontSize:11,padding:'6px 12px',background:'#2d0d0b',border:`1px solid ${RED}`,color:RED,borderRadius:5,cursor:'pointer',fontWeight:700}}>
                    🗑 초기화
                  </button>
                </Row>
              </Section>
            </>
          )}

          {/* ─── 정보 ──────────────────────────────────────────── */}
          {tab==='about'&&(
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{background:BG1,border:`1px solid ${BD}`,borderRadius:8,padding:'24px',textAlign:'center'}}>
                <div style={{fontSize:48,marginBottom:8}}>📦</div>
                <div style={{fontSize:20,fontWeight:700,color:TX,marginBottom:4}}>DS WMS Agent</div>
                <div style={{fontSize:13,color:TX2,marginBottom:2}}>Warehouse Management System</div>
                <div style={{fontSize:11,color:TX3}}>v1.0.0</div>
              </div>
              <Section title="에이전트 정보">
                {[
                  ['버전','v1.0.0'],
                  ['빌드 날짜','2026-04-16'],
                  ['프론트엔드','React 18'],
                  ['접속 서버', cfg.apiUrl],
                  ['저장된 계정', cfg.savedUser || '없음'],
                ].map(([k,v])=>(
                  <Row key={k} label={k}><span style={{fontSize:12,color:TX2,fontFamily:'monospace'}}>{v}</span></Row>
                ))}
              </Section>
              <Section title="현재 세션">
                {[
                  ['사용자', user?.name||'—'],
                  ['역할',   user?.role||'warehouse'],
                  ['창고',   user?.warehouse||'—'],
                  ['로그인', new Date().toLocaleString('ko-KR')],
                ].map(([k,v])=>(
                  <Row key={k} label={k}><span style={{fontSize:12,color:TX2}}>{v}</span></Row>
                ))}
              </Section>
            </div>
          )}

        </div>
      </div>

      {/* BOTTOM */}
      <div style={{height:34,background:'#010409',borderTop:`1px solid ${BD2}`,display:'flex',alignItems:'center',gap:16,padding:'0 16px',flexShrink:0}}>
        {[['F10','설정'],['ESC','홈으로']].map(([k,l])=>(
          <span key={k} style={{display:'flex',gap:4,alignItems:'center'}}>
            <kbd style={{background:BG2,border:`1px solid ${BD}`,borderRadius:3,padding:'1px 5px',fontSize:10,color:TX2,fontFamily:'monospace'}}>{k}</kbd>
            <span style={{fontSize:11,color:TX3}}>{l}</span>
          </span>
        ))}
      </div>

      {toast&&<div style={{position:'fixed',top:20,left:'50%',transform:'translateX(-50%)',zIndex:9999,
        background:toast.type==='warn'?'#2d2000':toast.type==='error'?'#3a1a1a':'#1a3a2a',
        border:`1px solid ${toast.type==='warn'?YLW:toast.type==='error'?RED:GRN}`,
        color:toast.type==='warn'?YLW:toast.type==='error'?RED:GRN,
        padding:'10px 22px',borderRadius:8,fontSize:13,fontWeight:600}}>{toast.msg}</div>}
    </div>
  );
};

export default WarehouseSettings;
