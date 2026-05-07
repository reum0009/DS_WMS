import React, { useState, useEffect, useRef, useCallback } from 'react';
import { productsAPI, warehousesAPI, inboundAPI, categoriesAPI, productsQuickAdd, warehouseTransferAPI } from '../../api/api';
import './WarehouseInbound.css';

// ── 단위 목록 ────────────────────────────────────────────────────
const UNITS = ['개', '박스', '묶음', '롤', '장', '세트', '병', '봉', '통', '팩', '다스', '리터', 'kg', 'm'];

// ── 입고번호 규칙: 1 + YYMMDD + 순번3자리 (10자리) ─────────────
// 예: 1260415001 (2026.04.15 001번째 입고)
function makeRef() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const ms = String(Date.now()).slice(-3); // 고유성 보강
  return `1${yy}${mm}${dd}${ms}`;
}

// ── 테스트용 데이터 ────────────────────
const MOCK_SESSIONS = [];
const MOCK_TRANSFERS = {};

// ── 날짜 포맷 ─────────────────────────────────────────────────────
function formatClock(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ── 바코드 스캐너 감지 훅 ──────────────────────────────────────
const SCANNER_SPEED_MS = 50;
const SCANNER_MIN_LEN  = 3;
const IDLE_RESET_MS    = 280;
const COMMAND_BARCODES = {
  W99999: { screen: 'inbound', label: '입고바코드', type: 'inbound' },
  W99998: { screen: 'outbound', label: '출고바코드', type: 'outbound' },
};

function ProductNameSpec({ product, nameStyle = {}, specStyle = {} }) {
  return (
    <div>
      <div style={nameStyle}>{product?.productName || product?.Product?.productName || '—'}</div>
      {(product?.specification || product?.Product?.specification) && (
        <div style={{ color: '#8b949e', fontSize: 11, marginTop: 2, ...specStyle }}>
          {product?.specification || product?.Product?.specification}
        </div>
      )}
    </div>
  );
}

function useBarcodeScanner(onScan, enabled = true) {
  const buf = useRef([]);
  const timer = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    const reset = () => { buf.current = []; };
    const onKey = (e) => {
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (tag === 'INPUT' && el?.dataset?.barcodeManual !== 'true') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key.length > 1 && e.key !== 'Enter') return;
      e.stopImmediatePropagation();

      const now = Date.now();
      if (e.key === 'Enter') {
        const b = buf.current;
        buf.current = [];
        clearTimeout(timer.current);
        if (b.length < SCANNER_MIN_LEN) return;
        const isScanner = b.every((item, i) => i === 0 || (item.ts - b[i-1].ts) <= SCANNER_SPEED_MS);
        if (isScanner) onScan(b.map(x => x.char).join(''));
        return;
      }
      buf.current.push({ char: e.key, ts: now });
      clearTimeout(timer.current);
      timer.current = setTimeout(reset, IDLE_RESET_MS);
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); clearTimeout(timer.current); };
  }, [enabled, onScan]);
}

// ── 입고화면 전용 스캔 팝업 (홈화면 ScanMatchPopup과 동일 패턴, 입고만) ──
function ScanInboundPopup({ product, quantity, onQuantityChange, onQtyPadToggle, onInbound, onClose }) {
  const qty = quantity || 1;
  const [showPad, setShowPad] = useState(false);
  const [padBuf, setPadBuf] = useState(String(qty));

  useEffect(() => {
    if (!showPad) setPadBuf(String(quantity || 1));
  }, [quantity, showPad]);

  const openPad  = () => { setPadBuf(String(qty)); setShowPad(true);  onQtyPadToggle?.(true);  };
  const closePad = ()  => { setShowPad(false); onQtyPadToggle?.(false); };

  const pressPad = (k) => {
    if (k === 'C') setPadBuf('');
    else if (k === '←') setPadBuf(p => p.slice(0, -1));
    else setPadBuf(p => (!p || p === '0') ? k : p + k);
  };

  useEffect(() => {
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

  const stockColor = product.currentStock === 0 ? '#f85149'
    : product.currentStock <= (product.safetyStock || 0) ? '#e3b341' : '#3fb950';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.80)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: '28px 32px', width: 440, textAlign: 'center' }}>
        <ProductNameSpec product={product} nameStyle={{ fontSize: 20, fontWeight: 700, color: '#e6edf3', marginBottom: 4 }} />
        {product.productCode && (
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4, fontFamily: 'monospace' }}>{product.productCode}</div>
        )}
        <div style={{ fontSize: 28, fontWeight: 700, color: stockColor, marginBottom: 2 }}>
          {product.currentStock} <span style={{ fontSize: 14, fontWeight: 400 }}>{product.unit}</span>
        </div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 16 }}>현재 재고</div>

        {showPad ? (
          <>
            <div style={{ background: '#0d1117', border: '2px solid #3fb950', borderRadius: 10, padding: '12px 16px', marginBottom: 10, fontSize: 40, fontWeight: 900, color: '#3fb950', fontFamily: 'monospace', textAlign: 'right' }}>
              {padBuf || '0'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
              {['7','8','9','4','5','6','1','2','3','C','0','←'].map(k => (
                <button key={k} onClick={() => pressPad(k)} style={{ padding: '14px 0', fontSize: 18, fontWeight: 700, borderRadius: 8, cursor: 'pointer', border: '1px solid #30363d', background: '#1c2128', color: '#e6edf3' }}>{k}</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button onClick={closePad} style={{ padding: '12px', fontSize: 14, background: 'none', border: '1px solid #30363d', color: '#8b949e', borderRadius: 8, cursor: 'pointer' }}>취소</button>
              <button onClick={() => { const n = parseInt(padBuf, 10); if (n > 0) onQuantityChange(n); closePad(); }}
                style={{ padding: '12px', fontSize: 14, fontWeight: 700, background: '#0d2616', border: '2px solid #3fb950', color: '#3fb950', borderRadius: 8, cursor: 'pointer' }}>확인</button>
            </div>
          </>
        ) : (
          <>
            <div onClick={openPad} title="클릭하여 수량 직접 입력"
              style={{ background: '#0d2616', border: '2px solid #3fb950', borderRadius: 10, padding: '10px 20px', marginBottom: 6, display: 'inline-block', minWidth: 140, cursor: 'pointer' }}>
              <div style={{ fontSize: 12, color: '#3fb950', marginBottom: 2 }}>입고 수량 (클릭 시 수정)</div>
              <div style={{ fontSize: 36, fontWeight: 900, color: '#3fb950', fontFamily: 'monospace' }}>{qty}</div>
              <div style={{ fontSize: 11, color: '#444c56' }}>{product.unit}</div>
            </div>
            <div style={{ fontSize: 11, color: '#444c56', marginBottom: 18 }}>바코드를 계속 스캔하면 수량이 증가합니다</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <button onClick={onInbound} style={{ flex: 1, background: '#0d2616', border: '2px solid #3fb950', color: '#3fb950', padding: '14px 0', borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 700 }}>
                📥 입고 추가
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#444c56', marginBottom: 8 }}>입고바코드 스캔 → 자동 추가</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: 13, cursor: 'pointer' }}>취소 (ESC)</button>
          </>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
export default function WarehouseInbound({ user, onGoHome, onLogout, onNavigate, initialProduct }) {
  const initialProductConsumedRef = useRef(false);

  // ── 마스터 데이터 ──────────────────────────────────────────
  const [products,   setProducts]   = useState([]);
  const [categories, setCategories] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [dataReady,  setDataReady]  = useState(false);
  
  // ( ... rest of state declarations ... )
  // I will only change the component signature and loadAll for now


  // ── 세션 ────────────────────────────────────────────────────
  const [sessionItems, setSessionItems] = useState([]);
  const [selectedIdx,  setSelectedIdx]  = useState(null);
  const [sessionRef,   setSessionRef]   = useState(makeRef());
  const [recentInbounds, setRecentInbounds] = useState([]);

  const [selectedWH,   setSelectedWH]   = useState('');

  // ── 메인 그리드 숫자키패드 ──────────────────────────────────
  const [mainKeypad, setMainKeypad] = useState(null); // { label, value, itemIdx }

  // ── 한글 가상 키보드 ──────────────────────────────────────────
  const [korKeypad, setKorKeypad] = useState(null); // { label, value, onConfirm }
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

  // ── UI 상태 ─────────────────────────────────────────────────
  const [toast, setToast] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uiScale, setUiScale] = useState(1);
  const [clock,        setClock]        = useState(formatClock(new Date()));
  const [todayCount,   setTodayCount]   = useState(0);

  // ── 수동 바코드 입력 팝업 (오른쪽 메뉴) ──────────────────────
  const [showBarInput,  setShowBarInput]  = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');

  const [showEditModal,    setShowEditModal]    = useState(false);
  const [editInitialRef,   setEditInitialRef]   = useState('');
  // ── 창고간입고 모달 ────────────────────────────────────────────
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [editSearch,       setEditSearch]       = useState(() => { const d30 = new Date(); d30.setDate(d30.getDate() - 30); return { startDate: d30.toISOString().slice(0,10), endDate: new Date().toISOString().slice(0,10), reference: '' }; });

  // ── 새 품목 등록 팝업 ────────────────────────────────────────
  const [showAddPopup,   setShowAddPopup]   = useState(false);
  const [showCatPopup,   setShowCatPopup]   = useState(false);
  const [pendingBarcode, setPendingBarcode] = useState('');
  const [newProdName,    setNewProdName]    = useState('');
  const [newProdUnit,    setNewProdUnit]    = useState('개');
  const [newProdCatId,   setNewProdCatId]   = useState('');
  const [addLoading,     setAddLoading]     = useState(false);
  const [newCatName,     setNewCatName]     = useState('');
  const [newCatLevel,    setNewCatLevel]    = useState(1);

  // ── 기타 상태 ────────────────────────────────────────────────
  const [qtyPad, setQtyPad] = useState(null);

  // ── 입고화면 내 바코드 스캔 팝업 (ScanInboundPopup) ──────────
  const [scanPopup, setScanPopup] = useState(null); // { type:'match', product, quantity }
  const scanPopupRef = useRef(null);
  useEffect(() => { scanPopupRef.current = scanPopup; }, [scanPopup]);
  const [scanPopupQtyPadOpen, setScanPopupQtyPadOpen] = useState(false);

  const manualRef = useRef(null);

  // ── 시계 ────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  // ── 24인치(1920px+) 가독성 확대 ───────────────────────────────
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

  // ── 초기 로드 ────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    try {
      const [wRes, cRes] = await Promise.all([
        warehousesAPI.getAll(), categoriesAPI.getAll(),
      ]);
      setWarehouses(wRes.data || []);
      setCategories(cRes.data || []);
      const wList = wRes.data || [];
      const defaultWh = String(user?.warehouseId || wList[0]?.id || '');
      if (defaultWh) setSelectedWH(prev => prev || defaultWh);
      const scopeWh = Number(selectedWH || defaultWh) || null;
      const pRes = await productsAPI.getAll(scopeWh ? { warehouseId: scopeWh } : undefined);
      const pList = (pRes.data || []).map(p => ({ ...p, unitPrice: parseInt(p.unitPrice, 10) || 0 }));
      setProducts(pList);
      const sRes = await inboundAPI.getSessions({});
      const myWhId = Number(user?.warehouseId || 0);
      const recent = (sRes.data || [])
        .filter((s) => {
          if (!myWhId) return true;
          const sWhId = Number(s.warehouseId || s.warehouse?.id || 0);
          return sWhId === myWhId;
        })
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, 15);
      setRecentInbounds(recent);
      setDataReady(true);

      // initialProduct가 있고 id가 있으면 (매칭된 경우) 처리
      if (!initialProductConsumedRef.current && initialProduct && initialProduct.id) {
        const latest = pList.find(p => p.id === initialProduct.id) || initialProduct;

        if (initialProduct._qty) {
          initialProductConsumedRef.current = true;
          // 바코드로 수량까지 확정된 경우 → 키패드 생략, 바로 세션에 추가
          setSessionItems([{
            id:           Date.now(),
            productId:    latest.id,
            productCode:  latest.productCode || '',
            productName:  latest.productName,
            specification: latest.specification || '',
            barcode:      latest.barcode || '',
            categoryId:   latest.categoryId || null,
            unit:         latest.unit || '개',
            quantity:     initialProduct._qty,
            unitPrice:    latest.unitPrice || 0,
            currentStock: latest.currentStock || 0,
          }]);
        } else {
          initialProductConsumedRef.current = true;
          setQtyPad({ product: latest, value: 1 });
        }
      } else if (!initialProductConsumedRef.current && initialProduct && initialProduct.barcode) {
        initialProductConsumedRef.current = true;
        // 등록되지 않은 바코드로 들어온 경우 바로 등록 팝업
        setPendingBarcode(initialProduct.barcode);
        setShowAddPopup(true);
      }
    } catch (e) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || '알 수 없는 오류';
      showToast(`데이터 로드 실패: ${msg}`, 'error');
    } finally {
      setDataReady(true);
    }
  }, [initialProduct, selectedWH, user?.warehouseId]);

  useEffect(() => { loadAll(); }, []); // eslint-disable-line
  useEffect(() => {
    if (!selectedWH) return;
    productsAPI.getAll({ warehouseId: Number(selectedWH) })
      .then(r => setProducts((r.data || []).map(p => ({ ...p, unitPrice: parseInt(p.unitPrice, 10) || 0 }))))
      .catch(() => {});
  }, [selectedWH]);

  useEffect(() => {
    inboundAPI.getToday().then(r => setTodayCount(r.data?.sessions || 0)).catch(() => {});
  }, []);

  // ── 토스트 ───────────────────────────────────────────────────
  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const addToSession = (product, qty) => {
    setSessionItems(prev => {
      const idx = prev.findIndex(x => x.productId === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
        showToast(`${product.productName} 수량 +${qty}`);
        return next;
      }
      showToast(`${product.productName} 추가됨`);
      return [...prev, {
        id:           Date.now(),
        productId:    product.id,
        productCode:  product.productCode,
        productName:  product.productName,
        specification: product.specification || '',
        barcode:      product.barcode || '',
        categoryId:   product.categoryId,
        unit:         product.unit || '개',
        quantity:     qty,
        unitPrice:    product.unitPrice || 0,
        currentStock: product.currentStock || 0,
      }];
    });
    setQtyPad(null);
    setManualBarcode('');
    setShowBarInput(false);
  };

  // ── 세션에 품목 추가 (스캔팝업 → 세션 반영) ──────────────────
  const addToSessionFromPopup = useCallback((product, quantity) => {
    setSessionItems(prev => {
      const idx = prev.findIndex(x => x.productId === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity };
        return next;
      }
      return [...prev, {
        id:           Date.now(),
        productId:    product.id,
        productCode:  product.productCode || '',
        productName:  product.productName,
        specification: product.specification || '',
        barcode:      product.barcode || '',
        categoryId:   product.categoryId,
        unit:         product.unit || '개',
        quantity,
        unitPrice:    product.unitPrice || 0,
        currentStock: product.currentStock || 0,
      }];
    });
    showToast(`${product.productName} 추가됨`);
    setScanPopup(null);
  }, []); // eslint-disable-line

  // ── 바코드 처리 (스캐너 / 수동 공통) ─────────────────────────
  const processBarcode = useCallback((code) => {
    const q = String(code || '').toLowerCase().trim();
    if (!q) return;

    const rawCode = String(code || '').trim().toUpperCase();
    const command = COMMAND_BARCODES[rawCode];
    const current = scanPopupRef.current;

    if (command) {
      if (command.type === 'inbound' && current?.type === 'match') {
        // 입고 바코드 + 팝업 열림 → 키패드 없이 바로 세션 추가
        addToSessionFromPopup(current.product, current.quantity || 1);
        return;
      }
      showToast(`${command.label} 인식`);
      if (command.screen !== 'inbound') onNavigate?.(command.screen);
      return;
    }

    const found = products.find(p => {
      const b = String(p.barcode || '').toLowerCase().trim();
      const pc = String(p.productCode || '').toLowerCase().trim();
      const hasCodes = (p.codes || []).some(c => String(c.codeValue || '').toLowerCase().trim() === q);
      return b === q || pc === q || hasCodes;
    });

    if (current?.type === 'match') {
      // 팝업 열린 상태에서 스캔
      if (found && found.id === current.product?.id) {
        // 같은 품목 → 수량 증가
        setScanPopup(prev => ({ ...prev, quantity: (prev.quantity || 1) + 1 }));
        return;
      }
      if (found) {
        // 다른 품목 → 팝업 교체
        setScanPopup({ type: 'match', product: found, quantity: 1 });
        return;
      }
      // 미등록 바코드 → 팝업 닫고 등록 팝업 열기
      setScanPopup(null);
      showToast(`"${code}" — 미등록 바코드`, 'error');
      setPendingBarcode(code);
      setNewProdName('');
      setShowAddPopup(true);
      return;
    }

    if (found) {
      // 팝업 없음 → 새 팝업 열기 (기존 qtyPad 대신)
      setScanPopup({ type: 'match', product: found, quantity: 1 });
    } else {
      // 미등록 바코드
      showToast(`"${code}" — 미등록 바코드`, 'error');
      setPendingBarcode(code);
      setNewProdName('');
      setShowAddPopup(true);
    }
  }, [products, onNavigate, addToSessionFromPopup]);

  // ── 전역 스캐너 훅 연결 ──────────────────────────────────────
  // scanPopup 자체는 스캐너를 막지 않음 (팝업 내 수량증가/명령처리 필요)
  // 단, 팝업 내 수량 키패드가 열리면 스캐너 비활성
  const anyPopupOpen = confirming || showAddPopup || showCatPopup || !!mainKeypad || !!korKeypad;
  useBarcodeScanner(processBarcode, dataReady && !anyPopupOpen && !scanPopupQtyPadOpen);

  // ── 수동 바코드 입력 처리 ────────────────────────────────────
  const handleManualScan = (overrideVal) => {
    const val = (overrideVal !== undefined ? overrideVal : manualBarcode).trim();
    if (!val) return;
    processBarcode(val);
    setManualBarcode('');
    setShowBarInput(false);
  };

  // ── 행 선택 ──────────────────────────────────────────────────
  const handlePrintCommandBarcode = async (type) => {
    try {
      const command = Object.values(COMMAND_BARCODES).find(x => x.type === type);
      await productsAPI.printCommandLabel({ type });
      showToast(`${command?.label || '명령 바코드'} 출력 요청 완료`);
    } catch (e) {
      showToast(e.response?.data?.error || '명령 바코드 출력 실패', 'error');
    }
  };

  const selectRow = (i) => {
    if (selectedIdx === i) { setSelectedIdx(null); return; }
    setSelectedIdx(i);
  };

  const removeSelected = () => {
    if (selectedIdx === null) return;
    setSessionItems(prev => prev.filter((_, i) => i !== selectedIdx));
    setSelectedIdx(null);
  };

  // ── 입고 확정 ────────────────────────────────────────────────
  const handleCommit = async () => {
    if (!sessionItems.length) return;
    // 입고 확정 시 가상 키패드/입력 팝업은 모두 닫고 즉시 처리
    setMainKeypad(null);
    setKorKeypad(null);
    setShowBarInput(false);
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    setSubmitting(true);
    try {
      await inboundAPI.process({
        warehouseId: selectedWH ? Number(selectedWH) : null,
        items: sessionItems.map(i => ({ productId: i.productId, quantity: i.quantity })),
        sessionRef,
      });
      showToast(`입고 완료 — ${sessionItems.length}종 / ${totalQty}개`);
      initialProductConsumedRef.current = true;
      setSessionItems([]);
      setSelectedIdx(null);
      setSessionRef(makeRef());
      setScanPopup(null);
      setQtyPad(null);
      setManualBarcode('');
      setTodayCount(c => c + 1);
      setConfirming(false);
      await loadAll();
    } catch (e) {
      showToast(e.response?.data?.error || '처리 실패', 'error');
    } finally { setSubmitting(false); }
  };

  // ── 새 품목 빠른 등록 ────────────────────────────────────────
  const handleQuickAdd = async () => {
    if (!newProdName || !newProdUnit) { showToast('품목명·단위 필수', 'error'); return; }
    setAddLoading(true);
    try {
      const res = await productsQuickAdd({
        productName: newProdName,
        barcode: pendingBarcode || null,
        categoryId: newProdCatId ? Number(newProdCatId) : null,
        unit: newProdUnit,
      });
      showToast(`"${newProdName}" 임시 등록 완료`);
      await loadAll();
      processBarcode(pendingBarcode || res.data.productCode);
      setShowAddPopup(false);
      setNewProdName(''); setNewProdCatId(''); setNewProdUnit('개'); setPendingBarcode('');
    } catch { showToast('등록 실패', 'error'); }
    finally { setAddLoading(false); }
  };

  const handleQuickCat = async () => {
    if (!newCatName) return;
    try {
      const res = await categoriesAPI.create({ name: newCatName, level: Number(newCatLevel) });
      setCategories(prev => [...prev, res.data]);
      setNewProdCatId(String(res.data.id));
      showToast(`"${newCatName}" 추가`);
      setShowCatPopup(false); setNewCatName('');
    } catch { showToast('카테고리 등록 실패', 'error'); }
  };

  // ── 키보드 단축키 ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      switch (e.key) {
        case 'Escape':
          if (confirming)         { setConfirming(false);       return; }
          if (showEditModal || showTransferModal) return; // 각 모달이 내부에서 처리
          if (showBarInput)       { setShowBarInput(false);      return; }
          if (showAddPopup)       { setShowAddPopup(false);      return; }
          if (showCatPopup)       { setShowCatPopup(false);      return; }
          if (selectedIdx !== null) { setSelectedIdx(null); return; }
          onGoHome?.();
          return;
        case 'F7':
          e.preventDefault();
          if (sessionItems.length && !submitting) handleCommit();
          return;
        case 'F8':
          e.preventDefault();
          removeSelected();
          return;
        case 'F9':
          e.preventDefault();
          if (!sessionItems.length || window.confirm('세션 초기화?')) {
            setSessionItems([]); setSelectedIdx(null); setSessionRef(makeRef());
          }
          return;
        case 'Delete':
          if (selectedIdx !== null) { removeSelected(); }
          return;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, showBarInput, showAddPopup, selectedIdx, sessionItems, onGoHome]); // eslint-disable-line

  // ── 파생값 ──────────────────────────────────────────────────
  const catMap = {};
  categories.forEach(c => { catMap[c.id] = c.name; });
  const totalQty = sessionItems.reduce((s, i) => s + i.quantity, 0);
  const totalAmt = sessionItems.reduce((s, i) => s + (i.unitPrice || 0) * i.quantity, 0);
  const whName   = warehouses.find(w => String(w.id) === selectedWH)?.warehouseName || '창고';

  const iBase = { fontFamily: "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo',sans-serif" };

  // ════════════════════════════════════════════════════════════
  return (
    <div style={{ height: '100vh', width: '100%', overflow: 'hidden', background: '#0d1117' }}>
      <div style={{
        ...iBase,
        width: `${(100 / uiScale).toFixed(3)}%`,
        height: `${(100 / uiScale).toFixed(3)}%`,
        transform: `scale(${uiScale})`,
        transformOrigin: 'top left',
        display: 'flex',
        flexDirection: 'column',
        background: '#0d1117',
        color: '#e6edf3',
      }}>

      {/* ── 토스트 ── */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 20, zIndex: 9999,
          background: toast.type === 'error' ? '#3a1a1a' : toast.type === 'warning' ? '#3a2e00' : '#1a3a2a',
          border: `1px solid ${toast.type === 'error' ? '#f85149' : toast.type === 'warning' ? '#e3b341' : '#3fb950'}`,
          color: toast.type === 'error' ? '#f85149' : toast.type === 'warning' ? '#e3b341' : '#3fb950',
          padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
        }}>{toast.msg}</div>
      )}

      {/* ══ 상단 헤더 ════════════════════════════════════════════ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', height: 54, background: '#161b22', borderBottom: '2px solid #58a6ff55', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#e6edf3' }}>📥 입고 처리</span>
          <span style={{ fontSize: 11, color: '#58a6ff', background: '#0d2044', border: '1px solid #58a6ff55', borderRadius: 4, padding: '2px 8px' }}>F1</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 12, color: '#8b949e', fontFamily: 'monospace' }}>{clock}</span>
          <span style={{ fontSize: 12, color: '#8b949e' }}>👤 {user?.name || '창고담당'}</span>
          <button onClick={onGoHome} style={{ background: '#1c2128', border: '1px solid #30363d', color: '#8b949e', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>🏠 홈</button>
        </div>
      </div>

      {/* ══ 본문 3컬럼 ══════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', alignItems: 'stretch' }}>

        {/* ── 왼쪽: 입고 내역 (320px) ───────────────────── */}
        <div style={{ width: 320, background: '#0d1117', borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column', padding: '14px 12px', overflowY: 'auto', flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#58a6ff', marginBottom: 8 }}>최근 입고 내역</div>
          {recentInbounds.length === 0 ? (
            <p style={{ color: '#8b949e', fontSize: 12, textAlign: 'center', marginTop: 12 }}>입고 내역이 없습니다</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recentInbounds.map(s => (
                <div key={s.reference}
                  onClick={() => {
                    setEditSearch(prev => ({ ...prev, reference: s.reference }));
                    setEditInitialRef(s.reference);
                    setShowEditModal(true);
                  }}
                  style={{
                    background: '#1c2128',
                    border: '1px solid #21262d',
                    borderRadius: 6,
                    padding: '7px 8px',
                    cursor: 'pointer',
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ color: '#58a6ff', fontFamily: 'monospace', fontSize: 11 }}>{s.reference}</span>
                    <span style={{ color: '#8b949e', fontSize: 10 }}>{(s.createdAt || '').toString().replace('T', ' ').slice(0, 16)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: '#e6edf3' }}>{s.userName || '—'}</span>
                    <span style={{ color: '#3fb950' }}>{s.itemCount || 0}종 / {(s.totalQty || 0).toLocaleString()}개</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 가운데: 입고 항목 그리드 (flex) ────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0d1117' }}>

          {/* 스캔 안내 배너 */}
          {!dataReady ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e', fontSize: 14 }}>
              데이터 로딩 중…
            </div>
          ) : (
            <>
              {/* 스캔 안내 문구 */}
              <div style={{ padding: '6px 14px', background: '#0d1117', borderBottom: '1px solid #21262d', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#388bfd', fontWeight: 500 }}>※ 바코드를 스캔하면 리스트가 보여집니다.</span>
                <span style={{ fontSize: 12, color: '#8b949e', fontFamily: 'monospace' }}>입고번호: <span style={{ color: '#58a6ff', fontWeight: 700 }}>{sessionRef}</span></span>
              </div>

              {/* 그리드 헤더 */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '44px 1fr 80px 90px 100px',
                background: '#1c2128', borderBottom: '2px solid #30363d',
                padding: '0 8px', flexShrink: 0,
              }}>
                {['NO', '상품명', '수량', '단가', '금액'].map((h, i) => (
                  <div key={h} style={{
                    padding: '10px 6px', fontSize: 12, fontWeight: 700, color: '#8b949e',
                    textAlign: i >= 2 ? 'right' : 'left', borderRight: i < 4 ? '1px solid #30363d' : 'none',
                  }}>{h}</div>
                ))}
              </div>

              {/* 항목 리스트 */}
              <div style={{ flex: 1, overflow: 'auto' }}>
                {sessionItems.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#444c56', gap: 10 }}>
                    <div style={{ fontSize: 40 }}>📦</div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>바코드를 스캔하세요</div>
                    <div style={{ fontSize: 12, color: '#30363d' }}>스캐너 또는 우측 메뉴 "바코드 입력" 이용</div>
                  </div>
                ) : (
                  sessionItems.map((item, i) => {
                    const isSel = selectedIdx === i;
                    const amt   = (item.unitPrice || 0) * item.quantity;
                    return (
                      <div key={item.id}
                        onClick={() => selectRow(i)}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '44px 1fr 80px 90px 100px',
                          padding: '0 8px',
                          background: isSel ? '#1f2937' : i % 2 === 0 ? '#0d1117' : '#111720',
                          borderBottom: '1px solid #1c2128',
                          borderLeft: isSel ? '3px solid #58a6ff' : '3px solid transparent',
                          cursor: 'pointer',
                          transition: 'background 0.1s',
                        }}>
                        {/* NO */}
                        <div style={{ padding: '11px 6px', fontSize: 13, color: '#8b949e', borderRight: '1px solid #1c2128' }}>{i + 1}</div>
                        {/* 상품명 */}
                        <div style={{ padding: '8px 6px', borderRight: '1px solid #1c2128' }}>
                          <ProductNameSpec product={item} nameStyle={{ fontSize: 14, color: '#e6edf3', fontWeight: isSel ? 700 : 500 }} />
                          <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>
                            {catMap[item.categoryId] || '—'} · {item.unit}
                            {item.barcode && <span style={{ marginLeft: 6, fontFamily: 'monospace' }}>{item.barcode}</span>}
                          </div>
                        </div>
                        {/* 수량 */}
                        <div style={{ padding: '0 6px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', borderRight: '1px solid #1c2128' }}>
                          {isSel ? (
                            <button
                              onClick={e => { e.stopPropagation(); setMainKeypad({ label: `${item.productName} 수량`, value: String(item.quantity), itemIdx: i }); }}
                              style={{ width: 58, background: '#0d1117', border: '1px solid #388bfd', borderRadius: 4, color: '#58a6ff', padding: '4px 6px', fontSize: 15, fontWeight: 700, textAlign: 'right', cursor: 'pointer', fontFamily: 'monospace' }}>
                              {item.quantity}
                            </button>
                          ) : (
                            <span style={{ fontSize: 15, fontWeight: 700, color: '#58a6ff' }}>{item.quantity.toLocaleString()}</span>
                          )}
                        </div>
                        {/* 단가 */}
                        <div style={{ padding: '11px 6px', fontSize: 13, color: '#8b949e', textAlign: 'right', borderRight: '1px solid #1c2128' }}>
                          {(item.unitPrice || 0).toLocaleString()}
                        </div>
                        {/* 금액 */}
                        <div style={{ padding: '11px 6px', fontSize: 13, color: '#e6edf3', fontWeight: 600, textAlign: 'right' }}>
                          {amt.toLocaleString()}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* 합계 + 확정 버튼 (중앙 하단으로 이동) */}
              <div style={{ padding: '12px 16px', background: '#161b22', borderTop: '1px solid #30363d', flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, color: '#8b949e' }}>총 입고 합계</span>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 14, color: '#3fb950', fontWeight: 700, marginRight: 12 }}>{totalQty.toLocaleString()}개</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#e6edf3' }}>₩{totalAmt.toLocaleString()}</span>
                  </div>
                </div>
                <button onClick={() => sessionItems.length && !submitting && handleCommit()} disabled={!sessionItems.length || submitting}
                  style={{
                    width: '100%', padding: 14, fontSize: 16, fontWeight: 700,
                    background: sessionItems.length ? 'linear-gradient(135deg, #238636, #2ea043)' : '#1c2128',
                    border: `1px solid ${sessionItems.length ? '#3fb950' : '#30363d'}`, color: sessionItems.length ? '#fff' : '#444c56',
                    borderRadius: 8, cursor: sessionItems.length ? 'pointer' : 'default', transition: 'all 0.15s'
                  }}>
                  {submitting ? '⌛ 처리 중...' : '📥 입고 확정 (F7)'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── 오른쪽: 조작 메뉴 패널 (230px) ─────────────────── */}
        <div style={{ width: 230, background: '#161b22', borderLeft: '1px solid #21262d', display: 'flex', flexDirection: 'column', padding: '12px 10px', gap: 6, flexShrink: 0, overflowY: 'auto' }}>

          <div style={{ fontSize: 12, fontWeight: 700, color: '#8b949e', marginBottom: 4, paddingLeft: 4 }}>입고 옵션</div>

          <div style={{ marginBottom: 10, padding: '0 4px' }}>
            <label style={{ display: 'block', fontSize: 11, color: '#8b949e', marginBottom: 4 }}>입고 창고</label>
            <select value={selectedWH} onChange={e => setSelectedWH(e.target.value)}
              style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3', padding: '6px 8px', borderRadius: 6, fontSize: 12 }}>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouseName}</option>)}
            </select>
          </div>

          {/* 바코드 입력 버튼 */}
          <RightBtn
            icon="▦"
            label="바코드 입력"
            sub="스캐너 불량 시"
            color="#58a6ff"
            onClick={() => { setShowBarInput(true); setTimeout(() => openKorKeypad('바코드 / 품목코드 입력', '', v => { setManualBarcode(v); handleManualScan(v); }), 50); }}
          />

          {/* 구분선 */}
          <RightBtn
            icon="▥"
            label="입고바코드 출력"
            sub="W99999"
            color="#3fb950"
            onClick={() => handlePrintCommandBarcode('inbound')}
          />

          <div style={{ borderTop: '1px solid #21262d', margin: '4px 0' }} />

          {/* 입고 수정 */}
          <RightBtn
            icon="🔍"
            label="입고 수정"
            sub="과거 입고 조회"
            color="#a371f7"
            onClick={() => { setEditInitialRef(''); setShowEditModal(true); }}
          />

          {/* 창고간입고 */}
          <RightBtn
            icon="🔀"
            label="창고간입고"
            sub="창고 이동 처리"
            color="#f0883e"
            onClick={() => setShowTransferModal(true)}
          />

          {/* 구분선 */}
          <div style={{ borderTop: '1px solid #21262d', margin: '4px 0' }} />

          {/* 선택 삭제 */}
          <RightBtn
            icon="✕"
            label="선택 삭제"
            sub="Del / F8"
            color="#f85149"
            disabled={selectedIdx === null}
            onClick={removeSelected}
          />

          {/* 세션 초기화 */}
          <RightBtn
            icon="🔄"
            label="세션 초기화"
            sub="F9"
            color="#e3b341"
            onClick={() => {
              if (!sessionItems.length || window.confirm('세션을 초기화하시겠습니까?')) {
                setSessionItems([]); setSelectedIdx(null); setSessionRef(makeRef());
              }
            }}
          />

          <div style={{ flex: 1 }} />

          {/* 오늘 현황 */}
          <div style={{ background: '#0d1117', borderRadius: 8, padding: '12px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 2 }}>오늘 입고 확정</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#3fb950' }}>{todayCount}건</div>
          </div>
        </div>

      </div>

      {/* ══ 바코드 수동 입력 팝업 ════════════════════════════════ */}
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

      {/* ══ 입고 확정 모달 ═══════════════════════════════════════ */}
      {confirming && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '24px 28px', width: 400 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#e6edf3', marginBottom: 6 }}>📥 입고 확정</div>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 14, fontFamily: 'monospace' }}>{sessionRef} · {whName}</div>
            <div style={{ background: '#1c2128', borderRadius: 6, padding: '10px 12px', marginBottom: 14, display: 'flex', gap: 20, fontSize: 14 }}>
              <span style={{ color: '#58a6ff' }}>{sessionItems.length}종</span>
              <span style={{ color: '#3fb950' }}>{totalQty.toLocaleString()}개</span>
              <span style={{ color: '#8b949e' }}>₩{totalAmt.toLocaleString()}</span>
            </div>
            <div style={{ maxHeight: 150, overflow: 'auto', marginBottom: 16 }}>
              {sessionItems.map(i => (
                <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, borderBottom: '1px solid #21262d' }}>
                  <div style={{ color: '#e6edf3' }}><ProductNameSpec product={i} nameStyle={{ color: '#e6edf3' }} /></div>
                  <span style={{ color: '#3fb950', fontWeight: 600 }}>+{i.quantity} {i.unit}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirming(false)} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '8px 18px', borderRadius: 6, cursor: 'pointer' }}>취소</button>
              <button onClick={handleCommit} disabled={submitting}
                style={{ background: '#238636', border: '1px solid #2ea043', color: '#fff', padding: '8px 22px', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
                {submitting ? '처리 중…' : '입고 확정'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ 새 품목 등록 팝업 ════════════════════════════════════ */}
      {showAddPopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '20px 24px', width: 400 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>새 품목 빠른 등록</span>
              <button onClick={() => setShowAddPopup(false)} style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: 18, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ background: '#3a2e00', border: '1px solid #9e6a03', borderRadius: 5, padding: '6px 10px', marginBottom: 12, fontSize: 11, color: '#e3b341' }}>
              최소 정보만 입력합니다. 상세 정보는 관리자가 완성합니다.
            </div>
            {pendingBarcode && <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#58a6ff', marginBottom: 10 }}>바코드: {pendingBarcode}</div>}
            {[
              { label: '품목명 *', val: newProdName, set: setNewProdName, ph: '품목명 입력', auto: true },
            ].map(f => (
              <div key={f.label} style={{ marginBottom: 10 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#8b949e', marginBottom: 3 }}>{f.label}</label>
                <input value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph} autoFocus={f.auto} inputMode="text" lang="ko"
                  style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 5, color: '#e6edf3', padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
            ))}
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#8b949e', marginBottom: 3 }}>품목 분류</label>
              <div style={{ display: 'flex', gap: 5 }}>
                <select value={newProdCatId} onChange={e => setNewProdCatId(e.target.value)}
                  style={{ flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 5, color: newProdCatId ? '#e6edf3' : '#6e7681', padding: '6px 8px', fontSize: 12 }}>
                  <option value="">-- 선택사항 --</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button onClick={() => setShowCatPopup(true)} style={{ background: '#0d2044', border: '1px solid #1158b7', color: '#58a6ff', borderRadius: 5, padding: '0 8px', cursor: 'pointer', fontSize: 14 }}>+</button>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#8b949e', marginBottom: 3 }}>단위 *</label>
              <select value={newProdUnit} onChange={e => setNewProdUnit(e.target.value)}
                style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 5, color: '#e6edf3', padding: '6px 8px', fontSize: 12 }}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowAddPopup(false)} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>취소</button>
              <button onClick={handleQuickAdd} disabled={addLoading}
                style={{ background: '#238636', border: '1px solid #2ea043', color: '#fff', padding: '7px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                {addLoading ? '등록 중…' : '임시 등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ 카테고리 팝업 ════════════════════════════════════════ */}
      {showCatPopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '18px 22px', width: 300 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', marginBottom: 12 }}>새 카테고리</div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#8b949e', marginBottom: 3 }}>카테고리명</label>
              <input value={newCatName} onChange={e => setNewCatName(e.target.value)} autoFocus placeholder="카테고리명"
                inputMode="text" lang="ko"
                style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 5, color: '#e6edf3', padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#8b949e', marginBottom: 3 }}>레벨</label>
              <select value={newCatLevel} onChange={e => setNewCatLevel(e.target.value)}
                style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 5, color: '#e6edf3', padding: '6px 8px', fontSize: 12 }}>
                <option value={1}>대분류</option><option value={2}>중분류</option><option value={3}>소분류</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCatPopup(false)} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '6px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>취소</button>
              <button onClick={handleQuickCat} style={{ background: '#238636', border: '1px solid #2ea043', color: '#fff', padding: '6px 14px', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>추가</button>
            </div>
          </div>
        </div>
      )}
      {/* ══ 메인 그리드 숫자키패드 ══════════════════════════════ */}
      {mainKeypad && (
        <NumKeypad
          value={mainKeypad.value}
          onChange={(val) => {
            const qty = Math.max(1, parseInt(val) || 1);
            setSessionItems(prev => prev.map((it, i) => i === mainKeypad.itemIdx ? { ...it, quantity: qty } : it));
            setMainKeypad(null);
          }}
          onClose={() => setMainKeypad(null)}
          label={mainKeypad.label}
        />
      )}

      {/* ══ 한글 가상 키보드 ════════════════════════════════════ */}
      {korKeypad && (
        <KoreanKeypad
          value={korKeypad.value}
          onChange={v => closeKorKeypad(true, v)}
          onClose={() => closeKorKeypad(false)}
          label={korKeypad.label}
        />
      )}

      {/* ══ 입고 수정 모달 ══════════════════════════════════════ */}
      {showEditModal && (
        <EditModal
          warehouses={warehouses}
          editSearch={editSearch}
          setEditSearch={setEditSearch}
          initialReference={editInitialRef}
          uiScale={uiScale}
          onClose={() => setShowEditModal(false)}
        />
      )}
      {/* ══ 창고간입고 모달 ══════════════════════════════════════ */}
      {showTransferModal && (
        <TransferModal
          warehouses={warehouses}
          selectedWH={selectedWH}
          uiScale={uiScale}
          onClose={() => setShowTransferModal(false)}
        />
      )}

      {/* ══ 바코드 스캔 팝업 (입고 전용) ═══════════════════════════ */}
      {scanPopup?.type === 'match' && (
        <ScanInboundPopup
          product={scanPopup.product}
          quantity={scanPopup.quantity || 1}
          onQuantityChange={(n) => setScanPopup(prev => ({ ...prev, quantity: n }))}
          onQtyPadToggle={(open) => setScanPopupQtyPadOpen(open)}
          onInbound={() => addToSessionFromPopup(scanPopup.product, scanPopup.quantity || 1)}
          onClose={() => setScanPopup(null)}
        />
      )}

      {/* ══ 수량 입력 패드 (출고와 동일 방식) ══════════════════════ */}
      {qtyPad && (
        <QtyPad
          label={`${qtyPad.product.productName} 입고 수량`}
          value={qtyPad.value || 1}
          onConfirm={qty => addToSession(qtyPad.product, qty)}
          onClose={() => { setQtyPad(null); }}
        />
      )}

      {/* ══ 하단 단축키 바 ══════════════════════════════════════ */}
      <div style={{ height: 32, background: '#010409', borderTop: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: 20, padding: '0 20px', flexShrink: 0 }}>
        {[
          ['F7', '입고확정'],
          ['F8', '선택삭제'],
          ['F9', '전체초기화'],
          ['ESC', '홈/취소']
        ].map(([k, l]) => (
          <span key={k} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <kbd style={{ background: '#21262d', border: '1px solid #30363d', borderRadius: 4, padding: '1px 5px', fontSize: 10, color: '#8b949e', fontFamily: 'monospace' }}>{k}</kbd>
            <span style={{ fontSize: 11, color: '#8b949e' }}>{l}</span>
          </span>
        ))}
      </div>

    </div>
    </div>
  );
}

// ── 수량 입력 패드 (Outbound와 스타일 통일) ─────────────────────────
function QtyPad({ value, onConfirm, onClose, label }) {
  const [n, setN] = useState(value || 1);

  useEffect(() => {
    setN(value || 1);
  }, [value]);
  
  useEffect(() => {
    const fn = (e) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); onClose(); }
      if (e.key === 'Enter') { e.stopImmediatePropagation(); e.preventDefault(); handleDone(); }
      if (e.key === 'Backspace') { 
        e.stopImmediatePropagation(); e.preventDefault(); 
        setN(p => Math.max(1, Math.floor(p / 10))); 
      }
      if (e.key >= '1' && e.key <= '9') { 
        e.stopImmediatePropagation(); e.preventDefault(); 
        setN(p => Math.min(99999, p === 1 ? parseInt(e.key) : p * 10 + parseInt(e.key))); 
      }
      if (e.key === '0') { 
        e.stopImmediatePropagation(); e.preventDefault(); 
        setN(p => Math.min(99999, p === 1 ? 1 : p * 10)); 
      }
    };
    window.addEventListener('keydown', fn, true);
    return () => window.removeEventListener('keydown', fn, true);
  }, [n, onClose, onConfirm]); // eslint-disable-line

  const handleDone = () => {
    const v = parseInt(n);
    if (isNaN(v) || v < 1) return;
    onConfirm(v);
  };

  const btnStyle = (bg, border, color) => ({
    padding: '20px 0', fontSize: 24, fontWeight: 800, borderRadius: 12, cursor: 'pointer',
    border: `2px solid ${border}`, background: bg, color, userSelect: 'none'
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }}>
      <div style={{ background: '#161b22', border: '2px solid #30363d', borderRadius: 20, padding: 30, width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        <div style={{ fontSize: 18, color: '#8b949e', marginBottom: 12, textAlign: 'center' }}>{label || '수량 입력'}</div>
        <div style={{ background: '#0d1117', border: '3px solid #388bfd', borderRadius: 12, padding: '20px', fontSize: 48, fontWeight: 900, color: '#58a6ff', fontFamily: 'monospace', textAlign: 'right', marginBottom: 20 }}>
          {n}
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          {['7','8','9','4','5','6','1','2','3','C','0','←'].map(k => (
            <button key={k} onClick={() => {
              if (k === 'C') setN(1);
              else if (k === '←') setN(p => Math.max(1, Math.floor(p / 10)));
              else setN(p => Math.min(99999, p === 1 && k !== '0' ? parseInt(k) : p * 10 + parseInt(k)));
            }} style={btnStyle(k === 'C' ? '#3a1a1a' : k === '←' ? '#3a2e00' : '#1c2128', 
                               k === 'C' ? '#f85149' : k === '←' ? '#e3b341' : '#30363d', 
                               k === 'C' ? '#f85149' : k === '←' ? '#e3b341' : '#e6edf3')}>
              {k}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <button onClick={onClose} style={{ padding: 18, background: 'none', border: '2px solid #30363d', color: '#8b949e', borderRadius: 12, cursor: 'pointer', fontSize: 18, fontWeight: 700 }}>취소 (ESC)</button>
          <button onClick={handleDone} style={{ padding: 18, background: '#1158b7', border: '2px solid #388bfd', color: '#fff', borderRadius: 12, cursor: 'pointer', fontSize: 18, fontWeight: 700 }}>확인 (Enter)</button>
        </div>
      </div>
    </div>
  );
}

// ── 오른쪽 패널 버튼 컴포넌트 ──────────────────────────────────
function RightBtn({ icon, label, sub, color, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        width: '100%', background: disabled ? '#1c2128' : '#1c2128',
        border: `1px solid ${disabled ? '#21262d' : color + '55'}`,
        borderRadius: 6, padding: '9px 8px', cursor: disabled ? 'default' : 'pointer',
        textAlign: 'left', transition: 'border-color 0.15s',
        opacity: disabled ? 0.35 : 1,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14, color }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: disabled ? '#444c56' : '#e6edf3' }}>{label}</span>
      </div>
      <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2, paddingLeft: 20 }}>{sub}</div>
    </button>
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
  const [shift, setShift] = useState(false);
  const [eng,   setEng]   = useState(false);

  // Always-fresh state snapshot for use in stable event handlers
  const sRef = useRef({});
  sRef.current = { buf, cs, shift, eng };

  const display = buf + (cs ? (cs.jung ? composeKor(cs.cho, cs.jung, cs.jong||'') : cs.cho) : '');
  const isC = c => CHO.includes(c);
  const isV = c => JUNG.includes(c);

  function doPressKor(key) {
    const { cs } = sRef.current;
    if (isC(key)) {
      if (!cs)        { setCs({ cho: key }); }
      else if (!cs.jung) { setBuf(b => b + cs.cho); setCs({ cho: key }); }
      else if (!cs.jong) {
        if (JONG_SET.has(key)) setCs(s => ({...s, jong: key}));
        else { setBuf(b => b + composeKor(cs.cho, cs.jung, '')); setCs({ cho: key }); }
      } else {
        const comb = JONG_COMB[cs.jong+'+'+key];
        if (comb) setCs(s => ({...s, jong: comb}));
        else { setBuf(b => b + composeKor(cs.cho, cs.jung, cs.jong)); setCs({ cho: key }); }
      }
    } else if (isV(key)) {
      if (!cs)        { setBuf(b => b + composeKor('ㅇ', key, '')); }
      else if (!cs.jung) { setCs(s => ({...s, jung: key})); }
      else if (!cs.jong) {
        const comb = JUNG_COMB[cs.jung+'+'+key];
        if (comb) setCs(s => ({...s, jung: comb}));
        else { setBuf(b => b + composeKor(cs.cho, cs.jung, '')); setCs({ cho: 'ㅇ', jung: key }); }
      } else {
        const split = JONG_SPLIT[cs.jong];
        if (split) { setBuf(b => b + composeKor(cs.cho, cs.jung, split[0])); setCs({ cho: split[1], jung: key }); }
        else       { setBuf(b => b + composeKor(cs.cho, cs.jung, '')); setCs({ cho: cs.jong, jung: key }); }
      }
    }
    setShift(false);
  }

  function doPressEng(key) {
    const { cs, shift } = sRef.current;
    if (cs) { setBuf(b => b + (cs.jung ? composeKor(cs.cho, cs.jung, cs.jong||'') : cs.cho)); setCs(null); }
    setBuf(b => b + (shift ? key.toUpperCase() : key.toLowerCase()));
    setShift(false);
  }

  function doPressBS() {
    const { cs } = sRef.current;
    if (cs) {
      if (cs.jong) {
        const split = JONG_SPLIT[cs.jong];
        if (split) setCs(s => ({...s, jong: split[0]})); else setCs(s => ({...s, jong: null}));
      } else if (cs.jung) {
        const un = Object.entries(JUNG_COMB).find(([,v]) => v === cs.jung);
        if (un) setCs(s => ({...s, jung: un[0].split('+')[0]})); else setCs(s => ({...s, jung: null}));
      } else setCs(null);
    } else setBuf(b => b.slice(0, -1));
  }

  function doPressSpace() {
    const { cs } = sRef.current;
    if (cs) { setBuf(b => b + (cs.jung ? composeKor(cs.cho, cs.jung, cs.jong||'') : cs.cho)); setCs(null); }
    setBuf(b => b + ' ');
  }

  function doPressOK() {
    const { buf, cs } = sRef.current;
    let t = buf;
    if (cs) t += cs.jung ? composeKor(cs.cho, cs.jung, cs.jong||'') : cs.cho;
    onChange(t); onClose();
  }

  // Stable physical-keyboard handler via ref (always reads fresh state from sRef)
  const physRef = useRef(null);
  physRef.current = (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const { eng } = sRef.current;
    const KOR_MAP = {
      'q':'ㅂ','w':'ㅈ','e':'ㄷ','r':'ㄱ','t':'ㅅ','y':'ㅛ','u':'ㅕ','i':'ㅑ','o':'ㅐ','p':'ㅔ',
      'a':'ㅁ','s':'ㄴ','d':'ㅇ','f':'ㄹ','g':'ㅎ','h':'ㅗ','j':'ㅓ','k':'ㅏ','l':'ㅣ',
      'z':'ㅋ','x':'ㅌ','c':'ㅊ','v':'ㅍ','b':'ㅠ','n':'ㅜ','m':'ㅡ',
      'Q':'ㅃ','W':'ㅉ','E':'ㄸ','R':'ㄲ','T':'ㅆ',
    };
    const stop = () => { e.stopImmediatePropagation(); e.preventDefault(); };
    if (e.key === 'Escape')    { stop(); onClose();       return; }
    if (e.key === 'Enter')     { stop(); doPressOK();     return; }
    if (e.key === 'Backspace') { stop(); doPressBS();     return; }
    if (e.key === ' ')         { stop(); doPressSpace();  return; }
    if (!eng && KOR_MAP[e.key]) { stop(); doPressKor(KOR_MAP[e.key]); return; }
    if (eng && e.key.length === 1 && e.key !== ' ') { stop(); doPressEng(e.key); return; }
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

  useEffect(() => {
    const fn = e => physRef.current(e);
    window.addEventListener('keydown', fn, true); // capture → fires before other handlers
    return () => window.removeEventListener('keydown', fn, true);
  }, []);

  const NUM_ROW   = ['1','2','3','4','5','6','7','8','9','0'];
  const NUM_SHIFT = {'1':'!','2':'@','3':'#','4':'$','5':'%','6':'^','7':'&','8':'*','9':'(','0':')'};
  const KOR_ROWS = [
    ['ㅂ','ㅈ','ㄷ','ㄱ','ㅅ','ㅛ','ㅕ','ㅑ','ㅐ','ㅔ'],
    ['ㅁ','ㄴ','ㅇ','ㄹ','ㅎ','ㅗ','ㅓ','ㅏ','ㅣ'],
    ['ㅋ','ㅌ','ㅊ','ㅍ','ㅠ','ㅜ','ㅡ'],
  ];
  const ENG_ROWS = [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['z','x','c','v','b','n','m'],
  ];
  const SHIFT_MAP = {'ㅂ':'ㅃ','ㅈ':'ㅉ','ㄷ':'ㄸ','ㄱ':'ㄲ','ㅅ':'ㅆ','ㅐ':'ㅒ','ㅔ':'ㅖ'};
  const rows = eng ? ENG_ROWS : KOR_ROWS;
  const btnBase = { padding:'9px 0', fontSize:13, fontWeight:700, borderRadius:6, cursor:'pointer', border:'1px solid #30363d', background:'#1c2128', color:'#e6edf3', transition:'all 0.1s' };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.72)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9990 }}
      onClick={e => { e.stopPropagation(); if (e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:'#161b22', border:'1px solid #30363d', borderRadius:12, padding:'18px 16px', width:440, boxShadow:'0 12px 40px rgba(0,0,0,0.6)' }}>
        <div style={{ fontSize:11, color:'#8b949e', marginBottom:5 }}>{label || '한글 입력'}</div>
        <div style={{ background:'#0d1117', border:'1px solid #388bfd', borderRadius:8, padding:'10px 14px', fontSize:18, fontWeight:700, color:'#e6edf3', marginBottom:10, minHeight:46, wordBreak:'break-all' }}>
          {display || <span style={{color:'#444c56', fontSize:14, fontWeight:400}}>입력하세요</span>}
        </div>
        {/* 숫자 / 특수문자 행 */}
        <div style={{ display:'flex', gap:3, marginBottom:5 }}>
          {NUM_ROW.map(k => {
            const dk = shift ? NUM_SHIFT[k] : k;
            return (
              <button key={k}
                onClick={() => {
                  const { cs } = sRef.current;
                  if (cs) { setBuf(b => b + (cs.jung ? composeKor(cs.cho, cs.jung, cs.jong||'') : cs.cho)); setCs(null); }
                  setBuf(b => b + (shift ? NUM_SHIFT[k] : k));
                  setShift(false);
                }}
                style={{ ...btnBase, flex:1, minWidth:0, fontSize:12, background:'#21262d', borderColor:'#444c56', color: shift ? '#f0883e' : '#79c0ff' }}>
                <div style={{fontSize:9, color:'#6e7681', lineHeight:1}}>{NUM_SHIFT[k]}</div>
                <div>{dk}</div>
              </button>
            );
          })}
        </div>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display:'flex', gap:3, marginBottom:3, justifyContent:'center' }}>
            {row.map(k => {
              const dk = !eng && shift && SHIFT_MAP[k] ? SHIFT_MAP[k] : (eng && shift ? k.toUpperCase() : k);
              return (
                <button key={k} onClick={() => eng ? doPressEng(k) : doPressKor(!eng && shift && SHIFT_MAP[k] ? SHIFT_MAP[k] : k)}
                  style={{ ...btnBase, flex:1, minWidth:0 }}>{dk}</button>
              );
            })}
          </div>
        ))}
        <div style={{ display:'flex', gap:3, marginTop:4 }}>
          <button onClick={() => setShift(s=>!s)} style={{ ...btnBase, flex:1.4, fontSize:11, border:`1px solid ${shift?'#58a6ff':'#30363d'}`, background:shift?'#0d2044':'#1c2128', color:shift?'#58a6ff':'#e6edf3' }}>⇧ {eng?'대문자':'쌍자음'}</button>
          <button onClick={doPressSpace} style={{ ...btnBase, flex:3, fontSize:11, color:'#8b949e' }}>space</button>
          <button onClick={doPressBS} style={{ ...btnBase, flex:1.4, border:'1px solid #e3b341', background:'#3a2e00', color:'#e3b341' }}>←</button>
          <button onClick={() => {setBuf('');setCs(null);}} style={{ ...btnBase, flex:1, border:'1px solid #f85149', background:'#3a1a1a', color:'#f85149' }}>C</button>
          <button onClick={() => { const {cs}=sRef.current; if(cs){setBuf(b=>b+(cs.jung?composeKor(cs.cho,cs.jung,cs.jong||''):cs.cho));setCs(null);} setEng(e=>!e); }}
            style={{ ...btnBase, flex:1.4, fontSize:11, border:`1px solid ${eng?'#3fb950':'#8b949e'}`, background:eng?'#0d2616':'#1c2128', color:eng?'#3fb950':'#8b949e' }}>
            {eng?'영→한':'한→영'}
          </button>
        </div>
        <button onClick={doPressOK} style={{ width:'100%', marginTop:8, padding:'12px', fontSize:15, fontWeight:700, background:'linear-gradient(135deg,#238636,#2ea043)', border:'1px solid #3fb950', color:'#fff', borderRadius:8, cursor:'pointer' }}>✅ 확인</button>
      </div>
    </div>
  );
}

// ── 가상 숫자 키패드 컴포넌트 ────────────────────────────────────
function NumKeypad({ value, onChange, onClose, label }) {
  const [buf, setBuf] = useState(value || '');
  const repeatRef = useRef({ timer: null, startTime: null, active: false });

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => () => { repeatRef.current.active = false; clearTimeout(repeatRef.current.timer); }, []);

  const press = (k) => {
    if (k === 'C') setBuf('');
    else if (k === '←') setBuf(prev => prev.slice(0, -1));
    else if (k === 'OK') { onChange(buf); onClose(); }
    else setBuf(prev => prev + k);
  };

  // 물리 키보드
  useEffect(() => {
    const fn = (e) => {
      if (e.key === 'Escape')    { e.stopImmediatePropagation(); e.preventDefault(); onClose(); }
      if (e.key === 'Enter')     { e.stopImmediatePropagation(); e.preventDefault(); onChange(buf); onClose(); }
      if (e.key === 'Backspace') { e.stopImmediatePropagation(); e.preventDefault(); setBuf(prev => prev.slice(0, -1)); }
      if (e.key >= '0' && e.key <= '9') { e.stopImmediatePropagation(); e.preventDefault(); setBuf(prev => prev + e.key); }
    };
    window.addEventListener('keydown', fn, true);
    return () => window.removeEventListener('keydown', fn, true);
  }, [buf, onClose, onChange]); // eslint-disable-line

  // ── +/- 장단축 로직 ─────────────────────────────────────────
  const applyStep = useCallback((delta) => {
    setBuf(prev => String(Math.max(0, Math.min(99999, (parseInt(prev) || 0) + delta))));
  }, []);

  const startPress = (delta) => (e) => {
    e.preventDefault();
    applyStep(delta); // 즉시 1회 적용
    repeatRef.current.active = true;
    repeatRef.current.startTime = Date.now();
    const tick = () => {
      if (!repeatRef.current.active) return;
      const ms  = Date.now() - repeatRef.current.startTime;
      const inc   = ms >= 5000 ? 10 : 1;                        // 5초 이상 → 10씩
      const delay = ms >= 5000 ? 60 : ms >= 2000 ? 100 : 160;   // 빨라지는 주기
      applyStep(delta * inc);
      repeatRef.current.timer = setTimeout(tick, delay);
    };
    repeatRef.current.timer = setTimeout(tick, 500); // 0.5초 후 반복 시작
  };

  const stopPress = () => {
    repeatRef.current.active = false;
    clearTimeout(repeatRef.current.timer);
  };

  const stepBtn = (label, delta, color, bg) => ({
    onMouseDown: startPress(delta), onMouseUp: stopPress, onMouseLeave: stopPress,
    onTouchStart: startPress(delta), onTouchEnd: stopPress,
    style: {
      flex: 1, padding: '13px 0', fontSize: 22, fontWeight: 900, borderRadius: 8,
      cursor: 'pointer', border: `1px solid ${color}`, background: bg, color,
      userSelect: 'none', WebkitUserSelect: 'none', transition: 'opacity 0.1s',
    },
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9990 }}
      onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: '20px', width: 310, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6 }}>{label || '숫자 입력'}</div>
        <div style={{
          background: '#0d1117', border: '1px solid #388bfd', borderRadius: 8, padding: '12px 14px',
          fontSize: 24, fontWeight: 700, color: '#58a6ff', fontFamily: 'monospace', textAlign: 'right',
          marginBottom: 10, minHeight: 36, letterSpacing: 2,
        }}>{buf || '0'}</div>

        {/* ── +/- 버튼 (장단축 지원) ── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button {...stepBtn('－', -1, '#f85149', '#3a1a1a')}>－</button>
          <button {...stepBtn('＋', +1, '#3fb950', '#0d2616')}>＋</button>
        </div>
        <div style={{ fontSize: 10, color: '#444c56', textAlign: 'center', marginBottom: 8, lineHeight: 1.5 }}>
          짧게 누르면 1씩 · 2초 누르면 빠르게 1씩 · 5초 누르면 10씩
        </div>

        {/* ── 숫자 패드 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {['7','8','9','4','5','6','1','2','3','C','0','←'].map(k => (
            <button key={k} onClick={() => press(k)}
              style={{
                padding: '14px 0', fontSize: 18, fontWeight: 700, borderRadius: 8, cursor: 'pointer',
                border: k === 'C' ? '1px solid #f85149' : k === '←' ? '1px solid #e3b341' : '1px solid #30363d',
                background: k === 'C' ? '#3a1a1a' : k === '←' ? '#3a2e00' : '#1c2128',
                color: k === 'C' ? '#f85149' : k === '←' ? '#e3b341' : '#e6edf3',
                transition: 'all 0.1s',
              }}>{k}</button>
          ))}
        </div>
        <button onClick={() => press('OK')}
          style={{
            width: '100%', marginTop: 8, padding: '14px', fontSize: 16, fontWeight: 700,
            background: 'linear-gradient(135deg, #238636, #2ea043)', border: '1px solid #3fb950',
            color: '#fff', borderRadius: 8, cursor: 'pointer',
          }}>✅ 확인</button>
      </div>
    </div>
  );
}

// ── 달력 팝업 컴포넌트 ──────────────────────────────────────────
function CalendarPicker({ value, onChange, onClose, label }) {
  const today = new Date();
  const init  = value ? new Date(value + 'T00:00:00') : today;
  const [y, setY] = useState(init.getFullYear());
  const [m, setM] = useState(init.getMonth()); // 0-based
  const p2 = n => String(n).padStart(2, '0');

  const prevMonth = () => { if (m === 0) { setM(11); setY(y - 1); } else setM(m - 1); };
  const nextMonth = () => { if (m === 11) { setM(0);  setY(y + 1); } else setM(m + 1); };

  const firstDow  = new Date(y, m, 1).getDay();        // 0=Sun
  const daysInM   = new Date(y, m + 1, 0).getDate();
  const selD      = value ? parseInt(value.split('-')[2]) : -1;
  const selY      = value ? parseInt(value.split('-')[0]) : -1;
  const selM      = value ? parseInt(value.split('-')[1]) - 1 : -1;
  const todayKey  = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInM; d++) cells.push(d);

  const btnBase = { width: 32, height: 32, borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const DOW = ['일','월','화','수','목','금','토'];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
      onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#161b22', border: '1px solid #388bfd', borderRadius: 12, padding: '16px 18px', width: 290, boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
        {/* 헤더 */}
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 10 }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button onClick={prevMonth} style={{ ...btnBase, background: '#1c2128', color: '#e6edf3', width: 28, height: 28 }}>◀</button>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>{y}년 {m + 1}월</span>
          <button onClick={nextMonth} style={{ ...btnBase, background: '#1c2128', color: '#e6edf3', width: 28, height: 28 }}>▶</button>
        </div>
        {/* 요일 헤더 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
          {DOW.map((d, i) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: i === 0 ? '#f85149' : i === 6 ? '#58a6ff' : '#8b949e', padding: '4px 0' }}>{d}</div>
          ))}
        </div>
        {/* 날짜 그리드 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const isToday = `${y}-${m}-${d}` === todayKey;
            const isSel   = d === selD && m === selM && y === selY;
            const dow     = (firstDow + d - 1) % 7;
            return (
              <button key={i} onClick={() => { onChange(`${y}-${p2(m + 1)}-${p2(d)}`); onClose(); }}
                style={{
                  ...btnBase,
                  background: isSel ? '#388bfd' : isToday ? '#1c4080' : 'transparent',
                  color: isSel ? '#fff' : dow === 0 ? '#f85149' : dow === 6 ? '#58a6ff' : '#e6edf3',
                  border: isToday && !isSel ? '1px solid #388bfd55' : 'none',
                  fontWeight: isSel || isToday ? 700 : 400,
                }}>
                {d}
              </button>
            );
          })}
        </div>
        {/* 오늘 버튼 */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <button onClick={() => { onChange(`${today.getFullYear()}-${p2(today.getMonth()+1)}-${p2(today.getDate())}`); onClose(); }}
            style={{ flex: 1, padding: '8px', background: '#1c2128', border: '1px solid #30363d', borderRadius: 6, color: '#58a6ff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            오늘
          </button>
          <button onClick={onClose}
            style={{ flex: 1, padding: '8px', background: '#1c2128', border: '1px solid #30363d', borderRadius: 6, color: '#8b949e', fontSize: 12, cursor: 'pointer' }}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 창고간입고 모달 컴포넌트 ─────────────────────────────────────

function TransferModal({ warehouses, selectedWH, onClose, uiScale = 1 }) {
  const [outRefInput,  setOutRefInput]  = useState('');
  const [transfer,     setTransfer]     = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [fetchError,   setFetchError]   = useState('');
  const [editQtyMap,   setEditQtyMap]   = useState({});   // { productId: qty }
  const [toast,        setToast]        = useState(null);
  const [numKeypad,    setNumKeypad]    = useState(null); // { productId, label }
  const [numKeypadVal, setNumKeypadVal] = useState('');
  const [korPad,       setKorPad]       = useState(false);
  const [confirmed,    setConfirmed]    = useState(false);
  const inputRef = useRef(null);

  const myWarehouse = warehouses.find(w => String(w.id) === String(selectedWH));
  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 2800); };

  // TransferModal 내부 Escape 핸들러
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (numKeypad || korPad) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [numKeypad, korPad, onClose]); // eslint-disable-line

  const doFetch = async (val) => {
    const num = (val !== undefined ? val : outRefInput).trim();
    if (!num) return;
    setLoading(true);
    setFetchError('');
    setTransfer(null);
    setEditQtyMap({});
    setConfirmed(false);
    try {
      const res = await warehouseTransferAPI.getByOut(num);
      const data = res.data;
      if (!data) { setFetchError('출고 정보를 찾을 수 없습니다'); return; }
      if (data.status === 'confirmed') { setFetchError('이미 입고 확정된 건입니다'); return; }
      if (data.status === 'cancelled') { setFetchError('취소된 건입니다'); return; }
      setTransfer(data);
    } catch (e) {
      setFetchError(e.response?.status === 404 ? '출고번호를 찾을 수 없습니다' : '조회 중 오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!transfer || confirmed) return;
    const receivedItems = (transfer.items || []).map(item => ({
      productId: item.productId,
      receivedQuantity: editQtyMap[item.productId] ?? item.quantity,
    }));
    try {
      const res = await warehouseTransferAPI.confirm(transfer.id, { receivedItems });
      setConfirmed(true);
      setTransfer(prev => ({ ...prev, transferInNumber: res.data.transferInNumber, status: 'confirmed' }));
      showToast('✅ 입고 확정 완료 — 입고번호: ' + res.data.transferInNumber);
    } catch (e) {
      showToast('확정 실패: ' + (e.response?.data?.error || e.message), 'error');
    }
  };

  const items = transfer?.items || [];
  const totalQty = items.reduce((s, it) => s + (editQtyMap[it.productId] ?? it.quantity), 0);
  const totalAmt = items.reduce((s, it) => s + (it.Product?.unitPrice || 0) * (editQtyMap[it.productId] ?? it.quantity), 0);
  const popupScale = 1.3 / (uiScale || 1);
  const infoStyle = { background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '8px 12px', fontSize: 13, fontWeight: 700, color: '#e6edf3', fontFamily: 'monospace' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>

      {toast && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
          background: toast.type === 'error' ? '#3a1a1a' : '#1a3a2a',
          border: `1px solid ${toast.type === 'error' ? '#f85149' : '#3fb950'}`,
          color: toast.type === 'error' ? '#f85149' : '#3fb950',
          padding: '10px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>{toast.msg}</div>
      )}

      {numKeypad && (
        <NumKeypad
          value={numKeypadVal}
          onChange={(val) => {
            const qty = Math.max(1, parseInt(val) || 1);
            setEditQtyMap(p => ({ ...p, [numKeypad.productId]: qty }));
            setNumKeypad(null);
          }}
          onClose={() => setNumKeypad(null)}
          label={numKeypad.label}
        />
      )}

      {korPad && (
        <KoreanKeypad
          value={outRefInput}
          onChange={v => { setOutRefInput(v); setKorPad(false); doFetch(v); }}
          onClose={() => setKorPad(false)}
          label="출고번호 입력"
        />
      )}

      <div onClick={e => e.stopPropagation()} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, width: '90vw', maxWidth: 1000, height: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', transform: `scale(${popupScale})`, transformOrigin: 'center center' }}>

        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: 'linear-gradient(135deg, #1c2128, #21262d)', borderBottom: '2px solid #f0883e55', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#e6edf3' }}>🔀 창고간 입고</span>
            <span style={{ fontSize: 11, color: '#f0883e', background: '#3d2200', border: '1px solid #f0883e55', borderRadius: 4, padding: '2px 8px' }}>출고번호 스캔/입력</span>
          </div>
          <button onClick={onClose} style={{ background: '#30363d', border: '1px solid #484f58', color: '#e6edf3', width: 28, height: 28, borderRadius: 6, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* 본문 */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ── 좌측: 출고번호 입력 + 이동 정보 ── */}
          <div style={{ width: 320, borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column', flexShrink: 0, background: '#0d1117' }}>

            {/* 출고번호 입력 영역 */}
            <div style={{ padding: '18px 16px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <div style={{ width: 3, height: 14, background: '#f0883e', borderRadius: 2 }} />
                <span style={{ fontSize: 12, color: '#e6edf3', fontWeight: 700 }}>출고번호 입력</span>
                <span style={{ fontSize: 10, color: '#8b949e' }}>바코드 스캔 또는 직접 입력</span>
              </div>

              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input
                  ref={inputRef}
                  value={outRefInput}
                  onChange={e => setOutRefInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') doFetch(); }}
                  readOnly={!!korPad}
                  placeholder="TO-YYYYMMDD-0001"
                  autoFocus
                  style={{
                    flex: 1, background: '#1c2128',
                    border: `1px solid ${fetchError ? '#f85149' : transfer ? '#3fb950' : '#388bfd'}`,
                    borderRadius: 6, color: '#58a6ff', padding: '11px 12px',
                    fontSize: 15, fontFamily: 'monospace', fontWeight: 700,
                    boxSizing: 'border-box', outline: 'none',
                  }}
                />
                <button
                  onClick={() => setKorPad(true)}
                  title="키보드 입력"
                  style={{ background: '#1c2128', border: '1px solid #388bfd', borderRadius: 6, color: '#58a6ff', padding: '0 12px', cursor: 'pointer', fontSize: 18, flexShrink: 0 }}>
                  ⌨
                </button>
              </div>

              {/* 테스트 번호 힌트 */}
              {!transfer && !fetchError && (
                <div style={{ fontSize: 10, color: '#444c56', marginBottom: 6, lineHeight: 1.6 }}>
                  테스트:&nbsp;
                  {Object.keys(MOCK_TRANSFERS).map(k => (
                    <span key={k}
                      onClick={() => { setOutRefInput(k); doFetch(k); }}
                      style={{ color: '#388bfd', cursor: 'pointer', marginRight: 6, fontFamily: 'monospace' }}>
                      {k}
                    </span>
                  ))}
                </div>
              )}

              {fetchError && (
                <div style={{ fontSize: 11, color: '#f85149', background: '#2a0a0a', border: '1px solid #f8514955', borderRadius: 5, padding: '6px 10px', marginBottom: 8 }}>
                  ⚠ {fetchError}
                </div>
              )}

              <button
                onClick={() => doFetch()}
                disabled={loading || !outRefInput.trim()}
                style={{
                  width: '100%', padding: '10px', fontSize: 13, fontWeight: 700,
                  background: loading || !outRefInput.trim() ? '#1c2128' : 'linear-gradient(135deg, #1158b7, #1a6edb)',
                  border: '1px solid #388bfd', color: loading || !outRefInput.trim() ? '#444c56' : '#fff',
                  borderRadius: 6, cursor: loading || !outRefInput.trim() ? 'default' : 'pointer',
                }}>
                {loading ? '⏳ 조회 중...' : '🔍 조회'}
              </button>
            </div>

            {/* 이동 정보 (출고번호 조회 후 표시) */}
            {transfer ? (
              <div style={{ padding: '16px', flex: 1, overflowY: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                  <div style={{ width: 3, height: 14, background: '#3fb950', borderRadius: 2 }} />
                  <span style={{ fontSize: 12, color: '#e6edf3', fontWeight: 700 }}>이동 정보</span>
                  {confirmed && <span style={{ fontSize: 10, color: '#3fb950', background: '#0d2616', border: '1px solid #3fb95055', borderRadius: 3, padding: '1px 6px' }}>확정완료</span>}
                </div>

                {/* 출고 창고 (read-only) */}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: '#f85149', marginBottom: 4, fontWeight: 600 }}>📤 출고 창고 (보내는 곳)</div>
                  <div style={infoStyle}>{transfer.fromWarehouse?.warehouseName || '—'}</div>
                </div>

                {/* 입고 창고 (read-only, 로그인 창고) */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: '#3fb950', marginBottom: 4, fontWeight: 600 }}>📥 입고 창고 (받는 곳)</div>
                  <div style={{ ...infoStyle, border: '1px solid #3fb95055', color: '#3fb950' }}>
                    {myWarehouse?.warehouseName || transfer.toWarehouse?.warehouseName || '—'}
                  </div>
                </div>

                {/* 번호 정보 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 20px 1fr', gap: 6, alignItems: 'center' }}>
                  <div style={{ background: '#1c2128', borderRadius: 6, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10, color: '#f85149', marginBottom: 3, fontWeight: 600 }}>출고번호</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3', fontFamily: 'monospace', wordBreak: 'break-all' }}>{transfer.transferOutNumber}</div>
                  </div>
                  <div style={{ textAlign: 'center', color: '#8b949e', fontSize: 14 }}>→</div>
                  <div style={{ background: '#1c2128', borderRadius: 6, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10, color: '#3fb950', marginBottom: 3, fontWeight: 600 }}>입고번호</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: confirmed ? '#3fb950' : '#444c56', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {transfer.transferInNumber || '(확정 후 생성)'}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#444c56', gap: 8, padding: 20 }}>
                <div style={{ fontSize: 36 }}>📷</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>출고번호를 스캔하거나</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>직접 입력하세요</div>
                <div style={{ fontSize: 11, color: '#30363d', marginTop: 4 }}>Enter 또는 조회 버튼</div>
              </div>
            )}
          </div>

          {/* ── 우측: 입고 품목 ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {!transfer ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#444c56', gap: 10 }}>
                <div style={{ fontSize: 48 }}>📦</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>출고번호 조회 후</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>입고 품목이 표시됩니다</div>
              </div>
            ) : (
              <>
                {/* 그리드 헤더 */}
                <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 60px 80px 100px', background: '#1c2128', borderBottom: '2px solid #30363d', padding: '0 12px', flexShrink: 0 }}>
                  {['NO', '품목명', '단위', '수량', '금액(₩)'].map((h, i) => (
                    <div key={i} style={{ padding: '10px 4px', fontSize: 11, fontWeight: 700, color: '#8b949e', textAlign: i >= 3 ? 'right' : 'left' }}>{h}</div>
                  ))}
                </div>

                {/* 품목 리스트 */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {items.length === 0 ? (
                    <div style={{ padding: 30, textAlign: 'center', color: '#444c56', fontSize: 12 }}>품목 없음</div>
                  ) : (
                    items.map((item, i) => {
                      const curQty = editQtyMap[item.productId] ?? item.quantity;
                      const amt = (item.Product?.unitPrice || 0) * curQty;
                      return (
                        <div key={item.productId} style={{
                          display: 'grid', gridTemplateColumns: '32px 1fr 60px 80px 100px',
                          padding: '0 12px', background: i % 2 === 0 ? '#0d1117' : '#111720',
                          borderBottom: '1px solid #1c2128',
                        }}>
                          <div style={{ padding: '10px 4px', fontSize: 12, color: '#8b949e' }}>{i + 1}</div>
                          <div style={{ padding: '8px 4px' }}>
                            <ProductNameSpec product={item.Product} nameStyle={{ fontSize: 13, color: '#e6edf3', fontWeight: 500 }} />
                            <div style={{ fontSize: 10, color: '#58a6ff', fontFamily: 'monospace', marginTop: 1 }}>{item.Product?.productCode}</div>
                          </div>
                          <div style={{ padding: '10px 4px', fontSize: 12, color: '#8b949e' }}>{item.Product?.unit}</div>
                          <div style={{ padding: '6px 4px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => { if (confirmed) return; setNumKeypad({ productId: item.productId, label: `${item.Product?.productName} 수량` }); setNumKeypadVal(String(curQty)); }}
                              style={{
                                background: '#0d1117', border: `1px solid ${editQtyMap[item.productId] !== undefined ? '#388bfd' : '#30363d'}`,
                                borderRadius: 4, color: editQtyMap[item.productId] !== undefined ? '#58a6ff' : '#3fb950',
                                fontSize: 14, fontWeight: 700, padding: '5px 10px',
                                cursor: confirmed ? 'default' : 'pointer', fontFamily: 'monospace', minWidth: 50, textAlign: 'right',
                              }}>
                              {curQty}
                            </button>
                          </div>
                          <div style={{ padding: '10px 4px', fontSize: 13, color: '#e6edf3', fontWeight: 600, textAlign: 'right' }}>₩{amt.toLocaleString()}</div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 합계 + 확정 버튼 */}
                <div style={{ background: '#1c2128', borderTop: '2px solid #30363d', padding: '10px 16px', flexShrink: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 12, color: '#8b949e' }}>합계 <strong style={{ color: '#e6edf3' }}>{items.length}종</strong></span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#3fb950' }}>{totalQty.toLocaleString()}개</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>₩{totalAmt.toLocaleString()}</span>
                  </div>
                  {!confirmed ? (
                    <button onClick={handleConfirm}
                      style={{ width: '100%', padding: '12px', fontSize: 14, fontWeight: 700, background: 'linear-gradient(135deg, #f0883e, #d47020)', border: '1px solid #f0883e', color: '#fff', borderRadius: 8, cursor: 'pointer' }}>
                      🔀 입고 확정
                    </button>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '12px', background: '#0d2616', border: '1px solid #3fb950', borderRadius: 8, color: '#3fb950', fontSize: 13, fontWeight: 700 }}>
                      ✅ 입고 확정 완료 — {transfer.transferInNumber}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 입고 수정 모달 컴포넌트 ──────────────────────────────────────
function EditModal({ warehouses, editSearch, setEditSearch, onClose, initialReference, uiScale = 1 }) {
  const [filterWH, setFilterWH]                 = useState('');
  const [filterProduct, setFilterProduct]       = useState('');
  const [sessions, setSessions]                 = useState([]);
  const [filteredSessions, setFilteredSessions] = useState([]);
  const [selectedRef, setSelectedRef]           = useState(null);
  const [detailItems, setDetailItems]           = useState([]);
  const [editQtyMap, setEditQtyMap]             = useState({});     // { itemId: qty }
  const [editNameMap, setEditNameMap]           = useState({});     // { itemId: name }
  const [editingNameId, setEditingNameId]       = useState(null);   // 품목명 인라인 편집 중인 id
  const [toast, setToast]                       = useState(null);
  const [confirmAction, setConfirmAction]       = useState(null);   // { type, payload, message }
  const [keypadTarget, setKeypadTarget]         = useState(null);   // { itemId, label }
  const [keypadValue, setKeypadValue]           = useState('');
  const [editKorPad,  setEditKorPad]            = useState(null);
  const [calPicker,   setCalPicker]             = useState(null); // { field:'startDate'|'endDate' }
  const blockEditFocus = useRef(false);

  const loadSessions = async () => {
    try {
      const res = await inboundAPI.getSessions(editSearch);
      setSessions(res.data || []);
      doSearchFrom(res.data || []);
    } catch (e) {
      showToast('내역 로드 실패', 'error');
    }
  };

  // EditModal 내부 Escape 핸들러 (KoreanKeypad가 없을 때만 모달 닫기)
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (keypadTarget || editKorPad || confirmAction || calPicker) return; // 하위 UI가 먼저 처리
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keypadTarget, editKorPad, confirmAction, calPicker, onClose]); // eslint-disable-line

  const openEditKorPad = (label, value, onConfirm) => {
    if (blockEditFocus.current) return;
    setEditKorPad({ label, value, onConfirm });
  };
  const closeEditKorPad = (confirm, val) => {
    blockEditFocus.current = true;
    if (confirm && editKorPad) editKorPad.onConfirm(val);
    setEditKorPad(null);
    setTimeout(() => { blockEditFocus.current = false; }, 300);
  };

  // 초기 조회
  React.useEffect(() => { loadSessions(); }, []); // eslint-disable-line

  React.useEffect(() => {
    if (!initialReference) return;
    setEditSearch(prev => ({ ...prev, reference: initialReference }));
    const hasTarget = sessions.some(s => s.reference === initialReference);
    if (hasTarget) {
      selectRef(initialReference);
    }
  }, [initialReference]); // eslint-disable-line

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const doSearchFrom = (source) => {
    let result = [...source];
    // 창고 필터 (API에서 이미 했을 수도 있지만 프론트에서도 한 번 더 체크)
    if (filterWH) result = result.filter(s => String(s.warehouseId) === filterWH);
    
    // 품목명 필터 (상세 항목 items가 포함되어 있으므로 체크 가능)
    if (filterProduct.trim()) {
      const q = filterProduct.trim().toLowerCase();
      result = result.filter(s => (s.items || []).some(it => 
        it.Product?.productName?.toLowerCase().includes(q) || 
        it.Product?.productCode?.toLowerCase().includes(q)
      ));
    }
    setFilteredSessions(result);
  };

  const doSearch = () => {
    loadSessions();
    setSelectedRef(null);
    setDetailItems([]);
    setEditQtyMap({});
    setEditNameMap({});
    setEditingNameId(null);
  };

  const selectRef = (ref) => {
    setSelectedRef(ref);
    const sess = sessions.find(s => s.reference === ref);
    const items = sess && sess.items ? JSON.parse(JSON.stringify(sess.items)) : [];
    setDetailItems(items);
    const qmap = {};
    items.forEach(it => { qmap[it.id] = it.quantity; });
    setEditQtyMap(qmap);
    setEditNameMap({});
    setEditingNameId(null);
  };

  const selSession = sessions.find(s => s.reference === selectedRef);

  // ── 수량 변경 저장 ────────────────────────────────────────
  const saveQty = (item) => {
    const newQty = parseInt(editQtyMap[item.id]) || 1;
    if (newQty === item.quantity) return;
    const oldQty = item.quantity;
    setDetailItems(prev => prev.map(it => it.id === item.id ? { ...it, quantity: newQty } : it));
    // sessions 동기화
    setSessions(prev => prev.map(s => {
      if (s.reference !== selectedRef) return s;
      const newItems = s.items.map(it => it.id === item.id ? { ...it, quantity: newQty } : it);
      return { ...s, items: newItems, totalQty: newItems.reduce((sum, it) => sum + it.quantity, 0) };
    }));
    showToast(`"${item.Product?.productName}" 수량 ${oldQty} → ${newQty} 변경 완료`);
  };

  // ── 품목명 변경 저장 ────────────────────────────────────────
  const saveProductName = (item) => {
    const newName = (editNameMap[item.id] || '').trim();
    if (!newName || newName === item.Product?.productName) {
      setEditingNameId(null);
      return;
    }
    const oldName = item.Product?.productName;
    setDetailItems(prev => prev.map(it =>
      it.id === item.id ? { ...it, Product: { ...it.Product, productName: newName } } : it
    ));
    setSessions(prev => prev.map(s => {
      if (s.reference !== selectedRef) return s;
      return { ...s, items: s.items.map(it =>
        it.id === item.id ? { ...it, Product: { ...it.Product, productName: newName } } : it
      )};
    }));
    setEditingNameId(null);
    showToast(`품목명 "${oldName}" → "${newName}" 변경 완료`);
  };

  // ── 개별 품목 입고 취소 ────────────────────────────────────
  const cancelItem = (item) => {
    setDetailItems(prev => prev.filter(it => it.id !== item.id));
    setSessions(prev => prev.map(s => {
      if (s.reference !== selectedRef) return s;
      const newItems = s.items.filter(it => it.id !== item.id);
      return { ...s, items: newItems, itemCount: newItems.length, totalQty: newItems.reduce((sum, it) => sum + it.quantity, 0) };
    }));
    doSearchFrom(sessions.map(s => {
      if (s.reference !== selectedRef) return s;
      const newItems = s.items.filter(it => it.id !== item.id);
      return { ...s, items: newItems, itemCount: newItems.length, totalQty: newItems.reduce((sum, it) => sum + it.quantity, 0) };
    }));
    showToast(`"${item.Product?.productName}" 입고 취소 완료`, 'warning');
    setConfirmAction(null);
  };

  // ── 전체 입고 취소 ────────────────────────────────────────
  const cancelSession = () => {
    const ref = selectedRef;
    const newSessions = sessions.filter(s => s.reference !== ref);
    setSessions(newSessions);
    doSearchFrom(newSessions);
    setSelectedRef(null);
    setDetailItems([]);
    setEditQtyMap({});
    showToast(`${ref} 전체 입고 취소 완료`, 'warning');
    setConfirmAction(null);
  };

  // 파생값: 현재 상세의 동적 합계
  const detailTotalQty = detailItems.reduce((s, it) => s + it.quantity, 0);
  const detailTotalAmt = detailItems.reduce((s, it) => s + (it.unitPrice || 0) * it.quantity, 0);
  const popupScale = 1.3 / (uiScale || 1);

  // 스타일 상수
  const btnSm = (bg, border, color, disabled = false) => ({
    background: disabled ? '#1c2128' : bg,
    border: `1px solid ${disabled ? '#21262d' : border}`,
    color: disabled ? '#444c56' : color,
    borderRadius: 4, padding: '3px 8px', cursor: disabled ? 'default' : 'pointer',
    fontSize: 11, fontWeight: 600, transition: 'all 0.12s',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300 }}
      onClick={e => { if (editKorPad || keypadTarget || calPicker || confirmAction) return; if (e.target === e.currentTarget) onClose(); }}>

      {/* 토스트 */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
          background: toast.type === 'error' ? '#3a1a1a' : toast.type === 'warning' ? '#3a2e00' : '#1a3a2a',
          border: `1px solid ${toast.type === 'error' ? '#f85149' : toast.type === 'warning' ? '#e3b341' : '#3fb950'}`,
          color: toast.type === 'error' ? '#f85149' : toast.type === 'warning' ? '#e3b341' : '#3fb950',
          padding: '10px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>{toast.msg}</div>
      )}

      {/* 확인 다이얼로그 */}
      {confirmAction && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9998 }}
          onClick={e => e.stopPropagation()}>
          <div style={{ background: '#161b22', border: '1px solid #f85149', borderRadius: 10, padding: '24px 28px', width: 400, boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f85149', marginBottom: 8 }}>⚠️ {confirmAction.type === 'cancelSession' ? '전체 입고 취소' : '개별 품목 취소'}</div>
            <div style={{ fontSize: 13, color: '#e6edf3', marginBottom: 6 }}>{confirmAction.message}</div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 16, padding: '8px 10px', background: '#1c2128', borderRadius: 6 }}>
              {confirmAction.type === 'cancelSession'
                ? '해당 입고 세션의 모든 품목이 취소되며, 재고가 차감됩니다.'
                : '해당 품목의 입고가 취소되며, 재고가 차감됩니다.'}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmAction(null)}
                style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>취소</button>
              <button onClick={() => {
                  if (confirmAction.type === 'cancelSession') cancelSession();
                  else if (confirmAction.type === 'cancelItem') cancelItem(confirmAction.payload);
                }}
                style={{ background: '#da3633', border: '1px solid #f85149', color: '#fff', padding: '8px 22px', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {keypadTarget && (
        <NumKeypad
          value={keypadValue}
          onChange={(val) => {
            const qty = Math.max(1, parseInt(val) || 1);
            setEditQtyMap(p => ({ ...p, [keypadTarget.itemId]: qty }));
            setKeypadTarget(null);
          }}
          onClose={() => setKeypadTarget(null)}
          label={keypadTarget.label}
        />
      )}

      {editKorPad && (
        <KoreanKeypad
          value={editKorPad.value}
          onChange={v => closeEditKorPad(true, v)}
          onClose={() => closeEditKorPad(false)}
          label={editKorPad.label}
        />
      )}

      {calPicker && (
        <CalendarPicker
          value={editSearch[calPicker.field]}
          onChange={v => { setEditSearch(p => ({ ...p, [calPicker.field]: v })); setCalPicker(null); }}
          onClose={() => setCalPicker(null)}
          label={calPicker.field === 'startDate' ? '시작일' : '종료일'}
        />
      )}

      <div onClick={e => e.stopPropagation()} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, width: '90vw', maxWidth: 1100, height: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', transform: `scale(${popupScale})`, transformOrigin: 'center center' }}>

        {/* 모달 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: 'linear-gradient(135deg, #1c2128 0%, #21262d 100%)', borderBottom: '2px solid #a371f755', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#e6edf3' }}>🔍 입고 수정</span>
            <span style={{ fontSize: 11, color: '#a371f7', background: '#2d1b69', border: '1px solid #a371f755', borderRadius: 4, padding: '2px 8px' }}>과거 입고 조회 · 수정</span>
          </div>
          <button onClick={onClose} style={{ background: '#30363d', border: '1px solid #484f58', color: '#e6edf3', width: 28, height: 28, borderRadius: 6, cursor: 'pointer', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* 모달 본문 — 좌(검색+목록) / 우(상세) */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ── 왼쪽: 검색조건 + 세션 목록 ── */}
          <div style={{ width: 360, borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

            {/* 검색 조건 */}
            <div style={{ padding: '16px 16px 12px', background: '#0d1117', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <div style={{ width: 3, height: 14, background: '#a371f7', borderRadius: 2 }} />
                <span style={{ fontSize: 12, color: '#e6edf3', fontWeight: 700 }}>조회 조건</span>
              </div>

              {/* 창고별 */}
              <div style={{ marginBottom: 10 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#8b949e', marginBottom: 4, fontWeight: 600 }}>📦 창고별</label>
                <select value={filterWH} onChange={e => setFilterWH(e.target.value)}
                  style={{ width: '100%', background: '#1c2128', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', padding: '7px 10px', fontSize: 12, boxSizing: 'border-box', cursor: 'pointer' }}>
                  <option value="">전체 창고</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouseName}</option>)}
                  {warehouses.length === 0 && <>
                    <option value="1">본사 창고</option>
                    <option value="2">제2 창고</option>
                  </>}
                </select>
              </div>

              {/* 입고기간 */}
              <div style={{ marginBottom: 10 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#8b949e', marginBottom: 4, fontWeight: 600 }}>📅 입고기간</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button onClick={() => setCalPicker({ field: 'startDate' })}
                    style={{ flex: 1, background: '#1c2128', border: `1px solid ${calPicker?.field==='startDate' ? '#388bfd' : '#30363d'}`, borderRadius: 6, color: '#e6edf3', padding: '6px 8px', fontSize: 12, fontFamily: 'monospace', cursor: 'pointer', textAlign: 'left' }}>
                    📅 {editSearch.startDate.replace(/-/g, '.')}
                  </button>
                  <span style={{ color: '#8b949e', fontSize: 12, fontWeight: 700 }}>~</span>
                  <button onClick={() => setCalPicker({ field: 'endDate' })}
                    style={{ flex: 1, background: '#1c2128', border: `1px solid ${calPicker?.field==='endDate' ? '#388bfd' : '#30363d'}`, borderRadius: 6, color: '#e6edf3', padding: '6px 8px', fontSize: 12, fontFamily: 'monospace', cursor: 'pointer', textAlign: 'left' }}>
                    📅 {editSearch.endDate.replace(/-/g, '.')}
                  </button>
                </div>
              </div>

              {/* 품목 */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#8b949e', marginBottom: 4, fontWeight: 600 }}>🏷️ 품목</label>
                <input value={filterProduct}
                  readOnly
                  onClick={e => { e.stopPropagation(); !editKorPad && openEditKorPad('품목명 검색', filterProduct, v => setFilterProduct(v)); }}
                  placeholder="품목명으로 검색"
                  inputMode="none"
                  style={{ width: '100%', background: '#1c2128', border: `1px solid ${editKorPad ? '#388bfd' : '#30363d'}`, borderRadius: 6, color: '#e6edf3', padding: '7px 10px', fontSize: 12, boxSizing: 'border-box', cursor: 'pointer' }} />
              </div>

              <button onClick={doSearch}
                style={{ width: '100%', background: 'linear-gradient(135deg, #1158b7 0%, #1a6edb 100%)', border: '1px solid #388bfd', color: '#fff', padding: '9px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700, transition: 'opacity 0.15s' }}>
                🔍 조회
              </button>
            </div>

            {/* 세션 목록 */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr 60px 50px', background: '#1c2128', borderBottom: '1px solid #30363d', padding: '0 10px' }}>
                {['NO', '입고번호', '품목수', '수량'].map((h, i) => (
                  <div key={h} style={{ padding: '8px 4px', fontSize: 11, fontWeight: 700, color: '#8b949e', textAlign: i >= 2 ? 'right' : 'left' }}>{h}</div>
                ))}
              </div>

              {filteredSessions.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', color: '#444c56', fontSize: 12 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
                  검색 결과 없음
                </div>
              ) : (
                filteredSessions.map((s, i) => {
                  const isSel = selectedRef === s.reference;
                  return (
                    <div key={s.reference} onClick={() => selectRef(s.reference)}
                      style={{
                        display: 'grid', gridTemplateColumns: '30px 1fr 60px 50px',
                        padding: '0 10px', cursor: 'pointer',
                        background: isSel ? '#1f3a5f' : i % 2 === 0 ? '#0d1117' : '#111720',
                        borderBottom: '1px solid #1c2128',
                        borderLeft: isSel ? '3px solid #58a6ff' : '3px solid transparent',
                        transition: 'background 0.12s',
                      }}>
                      <div style={{ padding: '10px 4px', fontSize: 12, color: '#8b949e' }}>{i + 1}</div>
                      <div style={{ padding: '8px 4px' }}>
                        <div style={{ fontSize: 12, color: isSel ? '#58a6ff' : '#e6edf3', fontFamily: 'monospace', fontWeight: 600 }}>{s.reference}</div>
                        <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>
                          {(() => { const d=new Date(s.createdAt),p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; })()} · {s.userName} · {s.warehouseName}
                        </div>
                      </div>
                      <div style={{ padding: '10px 4px', fontSize: 12, color: '#8b949e', textAlign: 'right' }}>{s.itemCount}종</div>
                      <div style={{ padding: '10px 4px', fontSize: 12, color: '#3fb950', fontWeight: 700, textAlign: 'right' }}>{s.totalQty}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── 오른쪽: 세션 상세 / 수정 ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {!selectedRef ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#444c56', gap: 10 }}>
                <div style={{ fontSize: 40 }}>📋</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>왼쪽 목록에서 세션을 선택하세요</div>
                <div style={{ fontSize: 12, color: '#30363d' }}>입고번호를 클릭하면 세부 항목이 표시됩니다</div>
              </div>
            ) : (
              <>
                {/* 상세 헤더 */}
                <div style={{ padding: '12px 16px', background: '#0d1117', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, color: '#58a6ff', fontFamily: 'monospace', fontWeight: 700 }}>{selectedRef}</span>
                        <span style={{ fontSize: 10, color: '#a371f7', background: '#2d1b69', border: '1px solid #a371f733', borderRadius: 3, padding: '1px 6px' }}>
                          {selSession?.warehouseName}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: '#8b949e', marginTop: 3 }}>
                        {selSession && (() => { const d=new Date(selSession.createdAt),p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; })()} · 담당: {selSession?.userName}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div style={{ textAlign: 'right', marginRight: 8 }}>
                        <div style={{ fontSize: 11, color: '#8b949e' }}>총 수량</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#3fb950' }}>{detailTotalQty}<span style={{ fontSize: 11, fontWeight: 400, color: '#8b949e', marginLeft: 2 }}>개</span></div>
                      </div>
                      <div style={{ textAlign: 'right', marginRight: 12 }}>
                        <div style={{ fontSize: 11, color: '#8b949e' }}>품목</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#58a6ff' }}>{detailItems.length}<span style={{ fontSize: 11, fontWeight: 400, color: '#8b949e', marginLeft: 2 }}>종</span></div>
                      </div>
                      {/* 전체 입고 취소 버튼 */}
                      <button
                        onClick={() => setConfirmAction({
                          type: 'cancelSession',
                          message: `${selectedRef} 세션의 전체 입고를 취소하시겠습니까?\n(${detailItems.length}종 / ${detailTotalQty}개)`,
                        })}
                        style={{
                          background: '#3a1a1a', border: '1px solid #f85149', color: '#f85149',
                          padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                          fontWeight: 700, whiteSpace: 'nowrap', transition: 'all 0.15s',
                        }}>
                        🚫 전체 취소
                      </button>
                    </div>
                  </div>
                </div>

                {/* 상세 그리드 헤더 */}
                <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 70px 80px 90px 110px', background: '#1c2128', borderBottom: '2px solid #30363d', padding: '0 10px', flexShrink: 0 }}>
                  {['NO', '품목명', '단위', '수량', '금액(₩)', ''].map((h, i) => (
                    <div key={i} style={{ padding: '10px 4px', fontSize: 11, fontWeight: 700, color: '#8b949e', textAlign: i >= 3 && i < 5 ? 'right' : i === 5 ? 'center' : 'left' }}>{h}</div>
                  ))}
                </div>

                {/* 상세 품목 목록 */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {detailItems.length === 0 ? (
                    <div style={{ padding: 30, textAlign: 'center', color: '#444c56', fontSize: 12 }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
                      모든 품목이 취소되었습니다
                    </div>
                  ) : (
                    detailItems.map((item, i) => {
                      const curQty = editQtyMap[item.id] ?? item.quantity;
                      const qtyChanged = parseInt(curQty) !== item.quantity;
                      const isEditingName = editingNameId === item.id;
                      const amt = (item.unitPrice || 0) * (parseInt(curQty) || item.quantity);
                      return (
                        <div key={item.id}
                          style={{
                            display: 'grid', gridTemplateColumns: '32px 1fr 70px 80px 90px 110px',
                            padding: '0 10px',
                            background: i % 2 === 0 ? '#0d1117' : '#111720',
                            borderBottom: '1px solid #1c2128',
                            transition: 'background 0.1s',
                          }}>
                          {/* NO */}
                          <div style={{ padding: '10px 4px', fontSize: 12, color: '#8b949e' }}>{i + 1}</div>

                          {/* 품목명 (클릭시 인라인 편집) */}
                          <div style={{ padding: '7px 4px' }}>
                            {isEditingName ? (
                              <input
                                autoFocus
                                inputMode="text" lang="ko"
                                value={editNameMap[item.id] ?? item.Product?.productName ?? ''}
                                onChange={e => setEditNameMap(p => ({ ...p, [item.id]: e.target.value }))}
                                onBlur={() => saveProductName(item)}
                                onKeyDown={e => { if (e.key === 'Enter') saveProductName(item); if (e.key === 'Escape') setEditingNameId(null); }}
                                style={{ width: '100%', background: '#0d1117', border: '1px solid #388bfd', borderRadius: 4, color: '#58a6ff', padding: '4px 8px', fontSize: 13, fontWeight: 600, boxSizing: 'border-box' }}
                              />
                            ) : (
                              <div
                                onClick={() => { setEditingNameId(item.id); setEditNameMap(p => ({ ...p, [item.id]: item.Product?.productName })); }}
                                style={{ cursor: 'pointer', padding: '2px 0' }}
                                title="클릭하여 품목명 변경">
                                <div style={{ fontSize: 13, color: '#e6edf3', fontWeight: 500 }}>
                                  <ProductNameSpec product={item.Product} nameStyle={{ color: '#e6edf3' }} />
                                  <span style={{ fontSize: 9, color: '#388bfd', marginLeft: 4 }}>✏️</span>
                                </div>
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                              <span style={{ fontSize: 10, color: '#58a6ff', fontFamily: 'monospace' }}>{item.Product?.productCode}</span>
                              <span style={{ fontSize: 10, color: '#a371f7' }}>{item.Product?.categoryName}</span>
                            </div>
                          </div>

                          {/* 단위 */}
                          <div style={{ padding: '12px 4px', fontSize: 12, color: '#8b949e' }}>{item.Product?.unit}</div>

                          {/* 수량 (클릭하면 숫자키패드) */}
                          <div style={{ padding: '6px 4px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => { setKeypadTarget({ itemId: item.id, label: `${item.Product?.productName} 수량` }); setKeypadValue(String(curQty)); }}
                              style={{
                                width: 60, background: '#0d1117', padding: '5px 6px', textAlign: 'right',
                                border: `1px solid ${qtyChanged ? '#388bfd' : '#30363d'}`,
                                borderRadius: 4, color: qtyChanged ? '#58a6ff' : '#e6edf3', fontSize: 14, fontWeight: 700,
                                cursor: 'pointer', fontFamily: 'monospace',
                              }}>
                              {curQty}
                            </button>
                          </div>

                          {/* 금액 */}
                          <div style={{ padding: '12px 4px', fontSize: 13, color: '#e6edf3', fontWeight: 600, textAlign: 'right' }}>₩{amt.toLocaleString()}</div>

                          {/* 액션 버튼: 수량저장 + 품목취소 */}
                          <div style={{ padding: '6px 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            <button onClick={() => saveQty(item)} disabled={!qtyChanged}
                              style={btnSm(qtyChanged ? '#238636' : '#1c2128', qtyChanged ? '#2ea043' : '#21262d', qtyChanged ? '#fff' : '#444c56', !qtyChanged)}>
                              저장
                            </button>
                            <button
                              onClick={() => setConfirmAction({
                                type: 'cancelItem',
                                payload: item,
                                message: `"${item.Product?.productName}" (${item.quantity}${item.Product?.unit}) 입고를 취소하시겠습니까?`,
                              })}
                              style={btnSm('#3a1a1a', '#f8514966', '#f85149')}>
                              취소
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 합계 행 */}
                {detailItems.length > 0 && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: '32px 1fr 70px 80px 90px 110px',
                    background: '#1c2128', borderTop: '2px solid #30363d', padding: '0 10px', flexShrink: 0,
                  }}>
                    <div style={{ padding: '10px 4px', gridColumn: '1/4', fontSize: 12, color: '#8b949e' }}>
                      합계 <strong style={{ color: '#e6edf3', marginLeft: 4 }}>{detailItems.length}종</strong>
                    </div>
                    <div style={{ padding: '10px 4px', fontSize: 14, fontWeight: 700, color: '#3fb950', textAlign: 'right' }}>
                      {detailTotalQty.toLocaleString()}
                    </div>
                    <div style={{ padding: '10px 4px', fontSize: 14, fontWeight: 700, color: '#e6edf3', textAlign: 'right' }}>
                      ₩{detailTotalAmt.toLocaleString()}
                    </div>
                    <div />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
