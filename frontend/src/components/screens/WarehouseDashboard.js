import React, { useState, useEffect, useRef, useCallback } from 'react';
import { productsAPI, warehousesAPI, requestsAPI, requestItemsAPI, dashboardAPI } from '../../api/api';
import './WarehouseDashboard.css';

// ── 카테고리 매핑 ──────────────────────────────────────────
const CATEGORY_GROUPS = {
  office:    '소모품',
  package:   '소모품',
  equipment: '비품',
  fixed:     '비품',
  site:      '유지보수',
  facility:  '유지보수',
};
const CATEGORY_COLORS = {
  '소모품':   '#58a6ff',
  '비품':     '#d2a8ff',
  '유지보수': '#f0883e',
};

function getStockStatus(p) {
  const stock = Number(p?.currentStock || 0);
  const safety = Number(p?.safetyStock || 0);
  if (stock === 0)        return { label: '소진', code: 'empty', color: '#f85149' };
  if (safety > 0 && stock < safety * 0.3) return { label: '저재고', code: 'low', color: '#e3b341' };
  return                         { label: '정상', code: 'ok',    color: '#3fb950' };
}

function ProductNameSpec({ product, nameClassName, specClassName, nameStyle = {}, specStyle = {} }) {
  return (
    <span>
      <span className={nameClassName} style={nameStyle}>{product?.productName || product?.name || '상품'}</span>
      {product?.specification && (
        <span className={specClassName} style={{ display: 'block', color: '#8b949e', fontSize: 11, marginTop: 2, ...specStyle }}>
          {product.specification}
        </span>
      )}
    </span>
  );
}

const MENU_ITEMS = [
  { id: 'inbound',      label: '입고',    sub: 'Inbound',         key: 'F2',  color: '#3fb950' },
  { id: 'outbound',     label: '출고',    sub: 'Outbound',        key: 'F3',  color: '#f85149' },
  { id: 'req-outbound', label: '요청출고', sub: 'Req. Outbound',  key: 'F5',  color: '#f0883e' },
  { id: 'inventory',    label: '재고조회', sub: 'Inventory',      key: 'F4',  color: '#58a6ff' },
  { id: 'low-stock',    label: '저재고',  sub: 'Low Stock',       key: 'F6',  color: '#e3b341' },
  { id: 'location',     label: '위치조회', sub: 'Location',       key: null,  color: '#56d364' },
  { id: 'report',       label: '리포트',  sub: 'Report',          key: 'F10', color: '#d2a8ff' },
  { id: 'auto-order',   label: '자동발주', sub: 'Auto-Order',     key: null,  color: '#555', disabled: true },
];

const COMMAND_BARCODES = {
  W99999: { func: 'inbound', label: '입고바코드', type: 'inbound' },
  W99998: { func: 'outbound', label: '출고바코드', type: 'outbound' },
};

// ── 넘버패드 처리 ───────────────────────────────────────────
function applyNumpad(prev, key) {
  if (key === 'C')  return '0';
  if (key === '←')  return prev.length > 1 ? prev.slice(0, -1) : '0';
  const next = (prev === '0' ? '' : prev) + key;
  return String(Math.min(99999, parseInt(next) || 0));
}

// ══════════════════════════════════════════════════════════════
const WarehouseDashboard = ({ user, onLogout, defaultFunc = 'inbound', onGoHome, initialProduct }) => {

  // ── 모드 / 활성 메뉴 ─────────────────────────────────────
  const [mode,       setMode]       = useState('shortcut');
  const [activeFunc, setActiveFunc] = useState(defaultFunc);

  // ── 공통 데이터 ───────────────────────────────────────────
  const [products,    setProducts]    = useState([]);
  const [productMap,  setProductMap]  = useState({});
  const [warehouses,  setWarehouses]  = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [toast,       setToast]       = useState(null);
  const [currentTime, setCurrentTime] = useState('');
  const [stats,       setStats]       = useState({ total: 0, lowStock: 0, pending: 0 });

  // ── 세션 (우측 패널) ──────────────────────────────────────
  const [sessionItems,       setSessionItems]       = useState([]);
  const [selectedSessionIdx, setSelectedSessionIdx] = useState(null);

  // ── 스캔 / 입력 (중앙 패널) ──────────────────────────────
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannedItem,  setScannedItem]  = useState(null);
  const [quantity,     setQuantity]     = useState('1');
  const [scanError,    setScanError]    = useState(false);
  const [selectedWarehouse, setSelectedWarehouse] = useState('');

  // ── 요청출고 ─────────────────────────────────────────────
  const [approvedRequests, setApprovedRequests] = useState([]);
  const [selectedRequest,  setSelectedRequest]  = useState(null);
  const [requestItems,     setRequestItems]     = useState([]);
  const [verifiedIds,      setVerifiedIds]      = useState(new Set());

  // ── 재고조회 필터 ─────────────────────────────────────────
  const [invFilter, setInvFilter] = useState({ category: 'all', status: 'all', search: '' });
  const [selectedProduct, setSelectedProduct] = useState(null);

  // ── 리포트 ───────────────────────────────────────────────
  const [reportType, setReportType] = useState('weekly');
  const [reportView, setReportView] = useState('category');

  // ── Refs ─────────────────────────────────────────────────
  const barcodeRef = useRef(null);
  const qtyRef     = useRef(null);
  const searchRef  = useRef(null);
  const qtyScanRef = useRef({ buf: [], startQuantity: null, timer: null });

  // ── 시계 ──────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => setCurrentTime(
      new Date().toLocaleString('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      })
    );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── 초기 데이터 로드 ──────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [wRes, rRes, sRes] = await Promise.all([
        warehousesAPI.getAll(),
        requestsAPI.getAll(),
        dashboardAPI.getStats(),
      ]);
      const wList = wRes.data || [];
      setWarehouses(wList);
      const defaultWh = String(user?.warehouseId || wList[0]?.id || '');
      if (defaultWh) setSelectedWarehouse(prev => prev || defaultWh);

      const scopeWh = Number(selectedWarehouse || defaultWh) || null;
      const pRes = await productsAPI.getAll(scopeWh ? { warehouseId: scopeWh } : undefined);
      const pList = (pRes.data || []).map(p => ({ ...p, unitPrice: parseInt(p.unitPrice, 10) || 0 }));
      setProducts(pList);
      const backendStats = sRes.data || {};

      const map = {};
      pList.forEach(p => {
        if (p.productCode) map[String(p.productCode).toLowerCase().trim()] = p;
        if (p.barcode)     map[String(p.barcode).toLowerCase().trim()] = p;
        if (p.codes && Array.isArray(p.codes)) {
          p.codes.forEach(c => {
            if (c.codeValue) map[String(c.codeValue).toLowerCase().trim()] = p;
          });
        }
      });
      setProductMap(map);

      const rList = rRes.data || [];
      setApprovedRequests(rList.filter(r => r.status === 'approved'));

      const overview = backendStats.overview || {};
      const inventory = backendStats.inventory || {};

      setStats({
        total:    inventory.totalProducts || pList.length,
        lowStock: inventory.lowStockProducts || 0,
        pending:  overview.pendingRequests || 0,
      });

      // initialProduct 처리
      if (initialProduct && initialProduct.id) {
        const latest = pList.find(p => p.id === initialProduct.id) || initialProduct;
        setScannedItem(latest);
        setMode('input');
        setTimeout(() => qtyRef.current?.focus(), 100);
      }
    } catch {
      showToast('데이터 로드 실패', 'error');
    } finally {
      setLoading(false);
    }
  }, [initialProduct, selectedWarehouse, user?.warehouseId]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    if (!selectedWarehouse) return;
    productsAPI.getAll({ warehouseId: Number(selectedWarehouse) })
      .then(r => {
        const list = (r.data || []).map(p => ({ ...p, unitPrice: parseInt(p.unitPrice, 10) || 0 }));
        setProducts(list);
        const map = {};
        list.forEach(p => {
          if (p.productCode) map[String(p.productCode).toLowerCase().trim()] = p;
          if (p.barcode) map[String(p.barcode).toLowerCase().trim()] = p;
          (p.codes || []).forEach(c => { if (c.codeValue) map[String(c.codeValue).toLowerCase().trim()] = p; });
        });
        setProductMap(map);
      })
      .catch(() => {});
  }, [selectedWarehouse]);

  // ── 전체화면: 마운트 시 자동 진입 ───────────────────────────
  useEffect(() => {
    const enter = () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    const onFirst = () => { enter(); window.removeEventListener('click', onFirst); };
    window.addEventListener('click', onFirst);
    return () => window.removeEventListener('click', onFirst);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }, []);

  // ── 탭 전환 시 바코드 포커스 ───────────────────────────────
  useEffect(() => {
    const scanFuncs = ['inbound', 'outbound', 'req-outbound'];
    if (scanFuncs.includes(activeFunc)) setTimeout(() => barcodeRef.current?.focus(), 80);
  }, [activeFunc]);

  // ── 토스트 ────────────────────────────────────────────────
  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  // ── 스캔 오류 애니메이션 ──────────────────────────────────
  const triggerScanError = () => {
    setScanError(true);
    setTimeout(() => setScanError(false), 400);
  };

  // ── 메뉴 전환 ─────────────────────────────────────────────
  const switchFunc = useCallback((id) => {
    if (MENU_ITEMS.find(m => m.id === id)?.disabled) {
      showToast('자동발주 기능은 추후 업데이트 예정입니다', 'warning');
      return;
    }
    setActiveFunc(id);
    setBarcodeInput('');
    setScannedItem(null);
    setQuantity('1');
    setScanError(false);
    setSelectedProduct(null);
  }, []);

  // ── 바코드 스캔 ───────────────────────────────────────────
  const applyScannedCode = (code, baseQuantity = null) => {
    if (!code) return true;
    const command = COMMAND_BARCODES[String(code).trim().toUpperCase()];
    if (command) {
      setBarcodeInput('');
      setScannedItem(null);
      setQuantity('1');
      switchFunc(command.func);
      showToast(`${command.label} 인식`, 'success');
      setTimeout(() => barcodeRef.current?.focus(), 80);
      return true;
    }
    const product = productMap[code.toLowerCase()];
    if (!product) {
      showToast(`"${code}" 미등록 상품`, 'error');
      triggerScanError();
      setBarcodeInput('');
      barcodeRef.current?.focus();
      return true;
    }

    if (scannedItem?.id === product.id) {
      setQuantity(prev => {
        const base = baseQuantity !== null ? baseQuantity : prev;
        const current = parseInt(base, 10) || 0;
        const next = Math.min(99999, current + 1);
        if (activeFunc === 'outbound' && next > (product.currentStock || 0)) {
          showToast('재고 초과', 'error');
          return String(current || 1);
        }
        showToast(`${product.productName} 수량 +1`, 'success');
        return String(next || 1);
      });
      setBarcodeInput('');
      setMode('input');
      setTimeout(() => qtyRef.current?.focus(), 60);
      return true;
    }

    setScannedItem(product);
    setQuantity('1');
    setBarcodeInput('');
    setMode('input');
    showToast(`${product.productName} 조회됨`, 'success');
    setTimeout(() => qtyRef.current?.focus(), 60);
    return true;
  };

  const handleScan = (e) => {
    e?.preventDefault();
    const code = barcodeInput.trim();
    if (!code) return;
    if (applyScannedCode(code)) return;

    const product = productMap[code.toLowerCase()];
    if (!product) {
      showToast(`"${code}" — 등록되지 않은 상품`, 'error');
      triggerScanError();
      setBarcodeInput('');
      barcodeRef.current?.focus();
      return;
    }

    setScannedItem(product);
    setBarcodeInput('');
    setMode('input');
    showToast(`${product.productName} 조회됨`, 'success');
    setTimeout(() => qtyRef.current?.focus(), 60);
  };

  // ── 세션에 항목 추가 ──────────────────────────────────────
  const handlePrintCommandBarcode = async (type) => {
    try {
      const command = Object.values(COMMAND_BARCODES).find(x => x.type === type);
      await productsAPI.printCommandLabel({ type });
      showToast(`${command?.label || '명령 바코드'} 출력 요청 완료`, 'success');
    } catch (e) {
      showToast(e.response?.data?.error || '명령 바코드 출력 실패', 'error');
    }
  };

  const handleAdd = () => {
    if (!scannedItem) { showToast('상품을 먼저 스캔하세요', 'warning'); return; }
    const qty = parseInt(quantity) || 0;
    if (qty <= 0) { showToast('수량을 입력하세요', 'warning'); return; }

    if (activeFunc === 'outbound') {
      if (qty > (scannedItem.currentStock || 0)) {
        showToast(`재고 부족 — 현재 ${scannedItem.currentStock || 0}개`, 'error');
        return;
      }
    }

    const existing = sessionItems.findIndex(i => i.productId === scannedItem.id);
    if (existing >= 0) {
      setSessionItems(prev =>
        prev.map((it, i) => i === existing
          ? { ...it, quantity: it.quantity + qty, amount: it.unitPrice * (it.quantity + qty) }
          : it
        )
      );
      showToast(`${scannedItem.productName} 수량 +${qty}`, 'success');
    } else {
      const unitPrice = scannedItem.unitPrice || 0;
      setSessionItems(prev => [...prev, {
        id: Date.now(),
        productId:   scannedItem.id,
        productCode: scannedItem.productCode,
        productName: scannedItem.productName,
        specification: scannedItem.specification || '',
        category:    CATEGORY_GROUPS[scannedItem.category] || scannedItem.category,
        location:    scannedItem.warehouseId ? `W${scannedItem.warehouseId}` : '-',
        quantity:    qty,
        unitPrice,
        amount:      unitPrice * qty,
        currentStock: scannedItem.currentStock || 0,
      }]);
      showToast(`${scannedItem.productName} 추가됨`, 'success');
    }

    setScannedItem(null);
    setQuantity('1');
    setBarcodeInput('');
    setMode('shortcut');
    barcodeRef.current?.focus();
  };

  // ── 세션 완료 (입고/출고 확정) ───────────────────────────
  const handleComplete = useCallback(async () => {
    if (sessionItems.length === 0) { showToast('항목이 없습니다', 'warning'); return; }
    const totalQty = sessionItems.reduce((s, i) => s + i.quantity, 0);
    const totalAmt = sessionItems.reduce((s, i) => s + i.amount, 0);
    const label    = activeFunc === 'inbound' ? '입고' : '출고';

    if (!window.confirm(
      `${label} 확정\n${sessionItems.length}종 · ${totalQty}개 · ₩${totalAmt.toLocaleString()}\n\n저장하시겠습니까?`
    )) return;

    try {
      setLoading(true);
      for (const item of sessionItems) {
        const p = products.find(x => x.id === item.productId);
        if (!p) continue;
        const newStock = activeFunc === 'inbound'
          ? (p.currentStock || 0) + item.quantity
          : Math.max(0, (p.currentStock || 0) - item.quantity);
        await productsAPI.update(p.id, { ...p, currentStock: newStock });
      }
      showToast(`${label} 완료! ${sessionItems.length}종 ${totalQty}개`, 'success');
      setSessionItems([]);
      setSelectedSessionIdx(null);
      await loadData();
    } catch (err) {
      showToast(`${label} 실패: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [sessionItems, activeFunc, products, loadData]);

  // ── 글로벌 키보드 핸들러 ─────────────────────────────────
  //
  // 설계 원칙:
  //  • F-키는 입력창 포커스 여부와 무관하게 항상 동작
  //  • 입력창에서는 일반 문자 타이핑만 허용, F-키는 차단하지 않음
  //  • ESC: 항상 입력 초기화 + 포커스 해제
  //  • Ctrl+Shift+F: 전체화면 토글 (F11 충돌 대체)
  //  • Ctrl+Shift+M: 모드 표시 토글 (F12 DevTools 충돌 대체)
  //
  useEffect(() => {
    const onKey = (e) => {

      // ── Ctrl+Shift+F: 전체화면 토글 ──────────────────────
      if (e.key === 'F' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        toggleFullscreen();
        return;
      }

      // ── Ctrl+Shift+M: 모드 표시 전환 ────────────────────
      if (e.key === 'M' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        setMode(m => m === 'shortcut' ? 'input' : 'shortcut');
        return;
      }

      // ── 수식키 조합은 이하 처리 안 함 ────────────────────
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // ── 모든 F-키: 브라우저 기본 동작 차단 ────────────────
      // (F1=도움말, F3=찾기, F5=새로고침, F11=전체화면 등 방지)
      const isFKey = /^F\d+$/.test(e.key);
      if (isFKey) e.preventDefault();

      // ── ESC: 항상 초기화 + 포커스 해제 ───────────────────
      if (e.key === 'Escape') {
        setBarcodeInput('');
        setScannedItem(null);
        setQuantity('1');
        setScanError(false);
        document.activeElement?.blur();
        setMode('shortcut');
        setTimeout(() => barcodeRef.current?.focus(), 50);
        return;
      }

      // ── F7: 저장 / 완료 ───────────────────────────────────
      if (e.key === 'F7') { handleComplete(); return; }

      // ── F8: 선택 항목 삭제 ────────────────────────────────
      if (e.key === 'F8') {
        if (selectedSessionIdx !== null) {
          if (window.confirm('선택한 항목을 삭제하시겠습니까?')) {
            setSessionItems(prev => prev.filter((_, i) => i !== selectedSessionIdx));
            setSelectedSessionIdx(null);
          }
        }
        return;
      }

      // ── F9: 폼 초기화 ─────────────────────────────────────
      if (e.key === 'F9') {
        setBarcodeInput('');
        setScannedItem(null);
        setQuantity('1');
        document.activeElement?.blur();
        setTimeout(() => barcodeRef.current?.focus(), 50);
        return;
      }

      // ── 메뉴 F-키: 입력창 포커스와 무관하게 항상 동작 ────
      switch (e.key) {
        case 'F1':  searchRef.current?.focus(); setMode('input');    break;
        case 'F2':  switchFunc('inbound');                           break;
        case 'F3':  switchFunc('outbound');                          break;
        case 'F4':  switchFunc('inventory');                         break;
        case 'F5':  switchFunc('req-outbound');                      break;
        case 'F6':  switchFunc('low-stock');                         break;
        case 'F10': switchFunc('report');                            break;
        default: break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedSessionIdx, switchFunc, handleComplete, toggleFullscreen]);

  // ── 요청출고: 요청 선택 ───────────────────────────────────
  const handleSelectRequest = async (req) => {
    setSelectedRequest(req);
    setVerifiedIds(new Set());
    try {
      const res = await requestItemsAPI.getByRequest(req.id);
      setRequestItems(res.data || []);
    } catch {
      setRequestItems([]);
    }
    barcodeRef.current?.focus();
  };

  // ── 요청출고: 바코드 검증 스캔 ───────────────────────────
  const handleVerifyScan = (e) => {
    e?.preventDefault();
    const code = barcodeInput.trim();
    if (!code || !selectedRequest) return;

    const product = productMap[code.toLowerCase()];
    if (!product) {
      showToast(`"${code}" — 등록되지 않은 상품`, 'error');
      triggerScanError();
      setBarcodeInput('');
      return;
    }

    const inList = requestItems.some(
      ri => ri.productId === product.id || ri.product?.id === product.id
    );
    if (inList) {
      setVerifiedIds(prev => new Set([...prev, product.id]));
      showToast(`${product.productName} 확인됨 ✓`, 'success');
    } else {
      showToast(`${product.productName} — 요청 목록에 없음`, 'warning');
    }
    setBarcodeInput('');
    barcodeRef.current?.focus();
  };

  // ── 요청출고 완료 ────────────────────────────────────────
  const handleReqOutboundComplete = async () => {
    if (!selectedRequest) return;
    try {
      setLoading(true);
      await requestsAPI.update(selectedRequest.id, { status: 'released' });
      showToast(`출고 완료 #${selectedRequest.requestNumber}`, 'success');
      setSelectedRequest(null);
      setRequestItems([]);
      setVerifiedIds(new Set());
      await loadData();
    } catch (err) {
      showToast('출고 실패: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // ── 계산값 ───────────────────────────────────────────────
  const sessionTotalQty = sessionItems.reduce((s, i) => s + i.quantity, 0);
  const sessionTotalAmt = sessionItems.reduce((s, i) => s + i.amount, 0);

  const filteredInventory = products.filter(p => {
    const cat     = CATEGORY_GROUPS[p.category] || p.category;
    const st      = getStockStatus(p);
    const term    = invFilter.search.toLowerCase();
    return (invFilter.category === 'all' || cat === invFilter.category)
        && (invFilter.status   === 'all' || st.code === invFilter.status)
        && (!term || (p.productName || '').toLowerCase().includes(term)
                  || (p.productCode || '').toLowerCase().includes(term));
  }).sort((a, b) => {
    const catA = CATEGORY_GROUPS[a.category] || a.category || 'zzz 미분류';
    const catB = CATEGORY_GROUPS[b.category] || b.category || 'zzz 미분류';
    const catCmp = catA.localeCompare(catB, 'ko');
    if (catCmp !== 0) return catCmp;
    const nameCmp = (a.productName || '').localeCompare(b.productName || '', 'ko');
    if (nameCmp !== 0) return nameCmp;
    return (a.productCode || '').localeCompare(b.productCode || '', 'ko');
  });

  const lowStockList = [...products]
    .filter(p => getStockStatus(p).code !== 'ok')
    .sort((a, b) => {
      const catA = CATEGORY_GROUPS[a.category] || a.category || 'zzz 미분류';
      const catB = CATEGORY_GROUPS[b.category] || b.category || 'zzz 미분류';
      const catCmp = catA.localeCompare(catB, 'ko');
      if (catCmp !== 0) return catCmp;
      const stockCmp = (a.currentStock || 0) - (b.currentStock || 0);
      if (stockCmp !== 0) return stockCmp;
      return (a.productName || '').localeCompare(b.productName || '', 'ko');
    });

  const activeColor = MENU_ITEMS.find(m => m.id === activeFunc)?.color || '#58a6ff';
  const activeLabel = MENU_ITEMS.find(m => m.id === activeFunc)?.label || '';

  // ── 공통 인벤토리 행 렌더 ────────────────────────────────
  const renderInvRow = (p, onClick) => {
    const st       = getStockStatus(p);
    const cat      = CATEGORY_GROUPS[p.category] || p.category;
    const catColor = CATEGORY_COLORS[cat] || '#8b949e';
    return (
      <div key={p.id} className="pos-inv-row" style={{ borderLeft: `3px solid ${st.color}` }}
        onClick={() => onClick && onClick(p)}>
        <span className="pir-name"><ProductNameSpec product={p} /></span>
        <span className="pir-cat"  style={{ color: catColor }}>{cat}</span>
        <span className="pir-loc">{p.warehouseId ? `W${p.warehouseId}` : '—'}</span>
        <span className="pir-stock" style={{ color: st.color, fontWeight: 700 }}>
          {(p.currentStock || 0).toLocaleString()}
        </span>
        <span className="pir-safety">{(p.safetyStock || 0).toLocaleString()}</span>
        <span className="pir-status">
          <span className="pos-status-badge" style={{
            color: st.color,
            background: st.color + '22',
            border: `1px solid ${st.color}`,
          }}>{st.label}</span>
        </span>
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════
  return (
    <div className="pos-root">

      {/* Toast */}
      {toast && <div className={`pos-toast pos-toast--${toast.type}`}>{toast.msg}</div>}

      {/* Loading overlay */}
      {loading && (
        <div className="pos-overlay">
          <div className="pos-overlay__box">처리 중…</div>
        </div>
      )}

      {/* ═══ TOP BAR ═══════════════════════════════════════ */}
      <div className="pos-top">
        <div className="pos-top__left">
          <span className="pos-top__warehouse">
            {warehouses.find(w => String(w.id) === selectedWarehouse)?.warehouseName || '창고 WMS'}
          </span>
          <span className="pos-top__divider">|</span>
          <span className="pos-top__user">{user?.name || '사용자'}</span>
          <span className="pos-top__func" style={{ color: activeColor }}>▶ {activeLabel}</span>
        </div>

        <form className="pos-top__search-wrap" onSubmit={e => { e.preventDefault(); }}>
          <input
            ref={searchRef}
            type="text"
            className="pos-top__search"
            placeholder="F1 전체검색 — 바코드 또는 상품명"
            onFocus={() => setMode('input')}
            onBlur={() => setMode('shortcut')}
          />
        </form>

        <div className="pos-top__right">
          <div className={`pos-mode-pill pos-mode-pill--${mode}`}>
            {mode === 'shortcut' ? '⌨ 단축키 모드' : '✏ 입력 모드'}
          </div>
          <span className="pos-top__time">{currentTime}</span>
          <button className="pos-logout" onClick={onLogout}>로그아웃</button>
        </div>
      </div>

      {/* ═══ MAIN ═══════════════════════════════════════════ */}
      <div className="pos-main">

        {/* ── CENTER PANEL ──────────────────────────────── */}
        <div className="pos-center">

          {/* ── 입고 / 출고 ── */}
          {(activeFunc === 'inbound' || activeFunc === 'outbound') && (
            <div className="pos-center__inner">

              {/* 입고: 창고 선택 */}
              {activeFunc === 'inbound' && (
                <div className="pos-field-row">
                  <label className="pos-field-label">입고 창고</label>
                  <select className="pos-select" value={selectedWarehouse}
                    onChange={e => setSelectedWarehouse(e.target.value)}>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouseName}</option>)}
                  </select>
                </div>
              )}

              {/* 바코드 입력 */}
              <div className="pos-field-row">
                <label className="pos-field-label">바코드 스캔 / 상품코드</label>
                <form onSubmit={handleScan} className="pos-scan-row">
                  <input
                    ref={barcodeRef}
                    type="text"
                    className={`pos-scan-input${scanError ? ' pos-scan-input--error' : ''}`}
                    value={barcodeInput}
                    onChange={e => setBarcodeInput(e.target.value)}
                    onFocus={() => setMode('input')}
                    placeholder="스캔하거나 코드 입력 후 Enter"
                    autoComplete="off"
                  />
                  <button type="submit" className="pos-scan-btn">확인</button>
                </form>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => handlePrintCommandBarcode('inbound')}
                    style={{ flex: 1, background: '#0d2616', border: '1px solid #238636', color: '#3fb950', borderRadius: 6, padding: '8px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                  >
                    입고바코드 출력
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePrintCommandBarcode('outbound')}
                    style={{ flex: 1, background: '#3a1a1a', border: '1px solid #b62324', color: '#f85149', borderRadius: 6, padding: '8px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                  >
                    출고바코드 출력
                  </button>
                </div>
              </div>

              {/* 상품 정보 카드 */}
              {scannedItem ? (
                <div className="pos-item-card">
                  <div className="pos-item-card__head">
                    <ProductNameSpec product={scannedItem} nameClassName="pos-item-card__name" />
                    {(() => {
                      const cat   = CATEGORY_GROUPS[scannedItem.category] || scannedItem.category;
                      const color = CATEGORY_COLORS[cat] || '#8b949e';
                      return <span className="pos-cat-badge" style={{ color, background: color + '22', border: `1px solid ${color}` }}>{cat}</span>;
                    })()}
                    {(() => {
                      const st = getStockStatus(scannedItem);
                      return <span className="pos-status-badge" style={{ color: st.color, background: st.color + '22', border: `1px solid ${st.color}` }}>{st.label}</span>;
                    })()}
                  </div>

                  <div className="pos-item-card__grid">
                    <div className="pos-item-field">
                      <span className="pos-item-field__lbl">바코드</span>
                      <span className="pos-item-field__val mono">{scannedItem.productCode}</span>
                    </div>
                    <div className="pos-item-field">
                      <span className="pos-item-field__lbl">현재재고</span>
                      <span className="pos-item-field__val" style={{ color: getStockStatus(scannedItem).color, fontWeight: 700 }}>
                        {(scannedItem.currentStock || 0).toLocaleString()} {scannedItem.unit || '개'}
                      </span>
                    </div>
                    <div className="pos-item-field">
                      <span className="pos-item-field__lbl">위치</span>
                      <span className="pos-item-field__val bold">
                        {scannedItem.warehouseId ? `W${scannedItem.warehouseId}` : '—'}
                      </span>
                    </div>
                    <div className="pos-item-field">
                      <span className="pos-item-field__lbl">단가</span>
                      <span className="pos-item-field__val">₩{(scannedItem.unitPrice || 0).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* 수량 + 넘버패드 */}
                  <div className="pos-qty-section">
                    <div className="pos-qty-row">
                      <label className="pos-field-label">수량</label>
                      <input
                        ref={qtyRef}
                        type="text"
                        className="pos-qty-input"
                        value={quantity}
                        onChange={e => {
                          const v = e.target.value.replace(/[^0-9]/g, '');
                          setQuantity(v ? String(Math.min(99999, parseInt(v))) : '0');
                        }}
                        onKeyDown={e => {
                          if (e.key.length === 1 || e.key === 'Enter') {
                            const now = Date.now();
                            const scan = qtyScanRef.current;
                            if (e.key.length === 1) {
                              if (scan.buf.length === 0) scan.startQuantity = quantity;
                              scan.buf.push({ char: e.key, ts: now });
                              clearTimeout(scan.timer);
                              scan.timer = setTimeout(() => { qtyScanRef.current = { buf: [], startQuantity: null, timer: null }; }, 280);
                            } else if (e.key === 'Enter' && scan.buf.length >= 3) {
                              const isScanner = scan.buf.every((item, i) => i === 0 || (item.ts - scan.buf[i - 1].ts) <= 50);
                              const scannedCode = scan.buf.map(item => item.char).join('');
                              const startQuantity = scan.startQuantity;
                              qtyScanRef.current = { buf: [], startQuantity: null, timer: null };
                              if (isScanner) {
                                e.preventDefault();
                                applyScannedCode(scannedCode, startQuantity);
                                return;
                              }
                            }
                          }
                          if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
                          if (e.key === 'Escape') { e.preventDefault(); setScannedItem(null); setMode('shortcut'); barcodeRef.current?.focus(); }
                          if (e.key >= '0' && e.key <= '9') {
                            e.preventDefault();
                            setQuantity(prev => applyNumpad(prev, e.key));
                          }
                          if (e.key === 'Backspace') {
                            e.preventDefault();
                            setQuantity(prev => applyNumpad(prev, '←'));
                          }
                        }}
                        onFocus={() => setMode('input')}
                      />
                      <span className="pos-qty-unit">{scannedItem.unit || '개'}</span>
                      <span className="pos-qty-amount">
                        = ₩{((parseInt(quantity) || 0) * (scannedItem.unitPrice || 0)).toLocaleString()}
                      </span>
                    </div>
                    <div className="pos-numpad">
                      {[['7','8','9'],['4','5','6'],['1','2','3'],['C','0','←']].map((row, ri) => (
                        <div key={ri} className="pos-numpad__row">
                          {row.map(k => (
                            <button key={k}
                              className={`pos-numpad__key${k==='C'?' --clear':k==='←'?' --back':''}`}
                              onClick={() => setQuantity(prev => applyNumpad(prev, k))}>
                              {k}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="pos-empty-card">
                  <span className="pos-empty-card__icon">📦</span>
                  <span className="pos-empty-card__text">바코드를 스캔하거나 상품코드를 입력하세요</span>
                </div>
              )}

              {/* 액션 버튼 */}
              <div className="pos-action-row">
                <button className="pos-btn pos-btn--add"    onClick={handleAdd}      disabled={!scannedItem}>
                  ➕ 추가 <kbd>Enter</kbd>
                </button>
                <button className="pos-btn pos-btn--save"   onClick={handleComplete} disabled={sessionItems.length === 0}>
                  💾 저장 <kbd>F7</kbd>
                </button>
                <button className="pos-btn pos-btn--reset"  onClick={() => { setBarcodeInput(''); setScannedItem(null); setQuantity('1'); barcodeRef.current?.focus(); }}>
                  🔄 초기화 <kbd>F9</kbd>
                </button>
                <button className="pos-btn pos-btn--cancel" onClick={() => { setBarcodeInput(''); setScannedItem(null); setQuantity('1'); setMode('shortcut'); }}>
                  ✕ 취소 <kbd>ESC</kbd>
                </button>
              </div>
            </div>
          )}

          {/* ── 요청출고 ── */}
          {activeFunc === 'req-outbound' && (
            <div className="pos-center__inner pos-reqout">
              {/* 요청 목록 */}
              <div className="pos-reqout__list">
                <div className="pos-section-title">출고 대기 요청</div>
                {approvedRequests.length === 0 ? (
                  <div className="pos-empty-msg">대기 중인 요청이 없습니다</div>
                ) : approvedRequests.map(req => (
                  <button
                    key={req.id}
                    className={`pos-req-card${selectedRequest?.id === req.id ? ' pos-req-card--active' : ''}`}
                    onClick={() => handleSelectRequest(req)}
                  >
                    <div className="pos-req-card__num">#{req.requestNumber}</div>
                    <div className="pos-req-card__meta">
                      <span>{req.applicant?.name || '신청자'}</span>
                      <span>{new Date(req.createdAt).toLocaleDateString('ko-KR')}</span>
                    </div>
                    {req.description && <div className="pos-req-card__desc">{req.description}</div>}
                  </button>
                ))}
              </div>

              {/* 검증 패널 */}
              <div className="pos-reqout__verify">
                {!selectedRequest ? (
                  <div className="pos-empty-card">
                    <span className="pos-empty-card__icon">📋</span>
                    <span className="pos-empty-card__text">좌측에서 요청을 선택하세요</span>
                  </div>
                ) : (
                  <>
                    <div className="pos-req-info">
                      <div className="pos-req-info__row"><span>요청번호</span><strong>#{selectedRequest.requestNumber}</strong></div>
                      <div className="pos-req-info__row"><span>신청자</span><strong>{selectedRequest.applicant?.name}</strong></div>
                      <div className="pos-req-info__row">
                        <span>검증</span>
                        <strong style={{ color: '#3fb950' }}>{verifiedIds.size} / {requestItems.length}</strong>
                      </div>
                    </div>

                    <div className="pos-progress-bar">
                      <div className="pos-progress-bar__fill"
                        style={{ width: requestItems.length > 0 ? `${(verifiedIds.size / requestItems.length) * 100}%` : '0%' }} />
                    </div>

                    <form onSubmit={handleVerifyScan} className="pos-scan-row" style={{ marginBottom: 12 }}>
                      <input
                        ref={barcodeRef}
                        type="text"
                        className={`pos-scan-input${scanError ? ' pos-scan-input--error' : ''}`}
                        value={barcodeInput}
                        onChange={e => setBarcodeInput(e.target.value)}
                        onFocus={() => setMode('input')}
                        placeholder="바코드 스캔으로 항목 확인"
                        autoComplete="off"
                      />
                      <button type="submit" className="pos-scan-btn">확인</button>
                    </form>

                    <div className="pos-verify-list">
                      {requestItems.map(ri => {
                        const pid      = ri.productId || ri.product?.id;
                        const verified = verifiedIds.has(pid);
                        return (
                          <div key={ri.id} className={`pos-verify-item${verified ? ' pos-verify-item--ok' : ''}`}>
                            <span className="pos-verify-item__check">{verified ? '✓' : '○'}</span>
                            <ProductNameSpec product={ri.product} nameClassName="pos-verify-item__name" />
                            <span className="pos-verify-item__qty">{ri.quantity}개</span>
                            <span className={`pos-verify-item__st ${verified ? 'ok' : 'pend'}`}>
                              {verified ? '확인' : '대기'}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="pos-action-row">
                      <button className="pos-btn pos-btn--save" onClick={handleReqOutboundComplete} disabled={loading}>
                        출고 완료 <kbd>F7</kbd>
                      </button>
                      <button className="pos-btn pos-btn--cancel" onClick={() => { setSelectedRequest(null); setRequestItems([]); setVerifiedIds(new Set()); }}>
                        취소 <kbd>ESC</kbd>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── 재고조회 ── */}
          {activeFunc === 'inventory' && (
            <div className="pos-center__inner">
              <div className="pos-inv-filters">
                <input type="text" className="pos-scan-input" style={{ flex: 1 }}
                  placeholder="상품명 또는 코드 검색..."
                  value={invFilter.search}
                  onChange={e => setInvFilter(f => ({ ...f, search: e.target.value }))}
                  onFocus={() => setMode('input')} />
                <select className="pos-select" style={{ width: 120 }}
                  value={invFilter.category}
                  onChange={e => setInvFilter(f => ({ ...f, category: e.target.value }))}>
                  <option value="all">전체 카테고리</option>
                  <option value="소모품">소모품</option>
                  <option value="비품">비품</option>
                  <option value="유지보수">유지보수</option>
                </select>
                <select className="pos-select" style={{ width: 100 }}
                  value={invFilter.status}
                  onChange={e => setInvFilter(f => ({ ...f, status: e.target.value }))}>
                  <option value="all">전체 상태</option>
                  <option value="ok">정상</option>
                  <option value="low">부족</option>
                  <option value="empty">소진</option>
                </select>
              </div>

              {selectedProduct && (
                <div className="pos-item-card pos-item-card--detail">
                  <div className="pos-item-card__head">
                    <ProductNameSpec product={selectedProduct} nameClassName="pos-item-card__name" />
                    {(() => {
                      const cat   = CATEGORY_GROUPS[selectedProduct.category] || selectedProduct.category;
                      const color = CATEGORY_COLORS[cat] || '#8b949e';
                      return <span className="pos-cat-badge" style={{ color, background: color+'22', border:`1px solid ${color}` }}>{cat}</span>;
                    })()}
                    {(() => {
                      const st = getStockStatus(selectedProduct);
                      return <span className="pos-status-badge" style={{ color: st.color, background: st.color+'22', border:`1px solid ${st.color}` }}>{st.label}</span>;
                    })()}
                    <button className="pos-close-btn" onClick={() => setSelectedProduct(null)}>✕</button>
                  </div>
                  <div className="pos-item-card__grid">
                    <div className="pos-item-field"><span className="pos-item-field__lbl">바코드</span><span className="pos-item-field__val mono">{selectedProduct.productCode}</span></div>
                    <div className="pos-item-field"><span className="pos-item-field__lbl">현재재고</span>
                      <span className="pos-item-field__val" style={{ color: getStockStatus(selectedProduct).color, fontWeight: 700 }}>
                        {(selectedProduct.currentStock||0).toLocaleString()} {selectedProduct.unit||'개'}
                      </span>
                    </div>
                    <div className="pos-item-field"><span className="pos-item-field__lbl">안전재고</span><span className="pos-item-field__val">{(selectedProduct.safetyStock||0).toLocaleString()} {selectedProduct.unit||'개'}</span></div>
                    <div className="pos-item-field"><span className="pos-item-field__lbl">단가</span><span className="pos-item-field__val">₩{(selectedProduct.unitPrice||0).toLocaleString()}</span></div>
                    <div className="pos-item-field"><span className="pos-item-field__lbl">위치</span><span className="pos-item-field__val bold">{selectedProduct.warehouseId ? `W${selectedProduct.warehouseId}` : '—'}</span></div>
                  </div>
                </div>
              )}

              <div className="pos-inv-table">
                <div className="pos-inv-table__head">
                  <span className="pir-name">상품명</span>
                  <span className="pir-cat">카테고리</span>
                  <span className="pir-loc">위치</span>
                  <span className="pir-stock">현재재고</span>
                  <span className="pir-safety">안전재고</span>
                  <span className="pir-status">상태</span>
                </div>
                <div className="pos-inv-table__body">
                  {filteredInventory.length === 0
                    ? <div className="pos-empty-msg">검색 결과가 없습니다</div>
                    : filteredInventory.map(p => renderInvRow(p, setSelectedProduct))
                  }
                </div>
                <div className="pos-inv-table__foot">
                  <span>총 {filteredInventory.length}종</span>
                  <span style={{ color: '#f85149' }}>소진 {filteredInventory.filter(p => getStockStatus(p).code === 'empty').length}종</span>
                  <span style={{ color: '#e3b341' }}>저재고 {filteredInventory.filter(p => getStockStatus(p).code === 'low').length}종</span>
                </div>
              </div>
            </div>
          )}

          {/* ── 저재고 ── */}
          {activeFunc === 'low-stock' && (
            <div className="pos-center__inner">
              <div className="pos-section-header">
                <span className="pos-section-title">저재고 현황</span>
                <span className="pos-badge pos-badge--empty">
                  소진 {lowStockList.filter(p => (p.currentStock||0)===0).length}건
                </span>
                <span className="pos-badge pos-badge--low">
                  저재고 {lowStockList.filter(p => getStockStatus(p).code === 'low').length}건
                </span>
                <button className="pos-btn pos-btn--reset pos-btn--sm" onClick={loadData} style={{ marginLeft: 'auto' }}>
                  🔄 새로고침
                </button>
              </div>

              <div className="pos-inv-table">
                <div className="pos-inv-table__head">
                  <span className="pir-name">상품명</span>
                  <span className="pir-cat">카테고리</span>
                  <span className="pir-loc">위치</span>
                  <span className="pir-stock">현재재고</span>
                  <span className="pir-safety">안전재고</span>
                  <span className="pir-status">상태</span>
                </div>
                <div className="pos-inv-table__body">
                  {lowStockList.length === 0
                    ? <div className="pos-empty-msg" style={{ color: '#3fb950' }}>✅ 모든 재고가 안전 수준입니다</div>
                    : lowStockList.map(p => renderInvRow(p, null))
                  }
                </div>
              </div>
            </div>
          )}

          {/* ── 위치조회 ── */}
          {activeFunc === 'location' && (
            <div className="pos-center__inner">
              <div className="pos-field-row">
                <label className="pos-field-label">위치 코드</label>
                <div className="pos-scan-row">
                  <input type="text" className="pos-scan-input"
                    placeholder="예: A-01-02" onFocus={() => setMode('input')} />
                  <button className="pos-scan-btn">조회</button>
                </div>
              </div>
              <div className="pos-empty-card" style={{ marginTop: 24 }}>
                <span className="pos-empty-card__icon">📍</span>
                <span className="pos-empty-card__text">위치 코드를 입력하면 해당 구역의 상품 목록이 표시됩니다</span>
              </div>
            </div>
          )}

          {/* ── 리포트 ── */}
          {activeFunc === 'report' && (
            <div className="pos-center__inner">
              <div className="pos-report-bar">
                <div className="pos-report-type">
                  {[['weekly','주간'],['monthly','월말']].map(([v,l]) => (
                    <button key={v} className={`pos-report-btn${reportType===v?' pos-report-btn--active':''}`}
                      onClick={() => setReportType(v)}>{l} 리포트</button>
                  ))}
                </div>
                <div className="pos-report-view">
                  {[['category','카테고리별'],['warehouse','창고별'],['item','품목별']].map(([v,l]) => (
                    <button key={v} className={`pos-report-btn pos-report-btn--sm${reportView===v?' pos-report-btn--active':''}`}
                      onClick={() => setReportView(v)}>{l}</button>
                  ))}
                </div>
              </div>

              <div className="pos-report-table-wrap">
                <table className="pos-report-table">
                  <thead>
                    <tr>
                      <th>{reportView==='item'?'상품명':reportView==='warehouse'?'창고':'카테고리'}</th>
                      <th>입고수량</th><th>입고금액(₩)</th>
                      <th>출고수량</th><th>출고금액(₩)</th>
                      {reportType==='monthly' && <><th>이월재고</th><th>기말재고</th></>}
                    </tr>
                  </thead>
                  <tbody>
                    {reportView === 'category' && ['소모품','비품','유지보수'].map(cat => (
                      <tr key={cat}>
                        <td>{cat}</td><td>—</td><td>—</td><td>—</td><td>—</td>
                        {reportType==='monthly' && <><td>—</td>
                        <td>{products.filter(p=>CATEGORY_GROUPS[p.category]===cat).reduce((s,p)=>s+(p.currentStock||0),0).toLocaleString()}</td></>}
                      </tr>
                    ))}
                    {reportView === 'warehouse' && warehouses.map(w => (
                      <tr key={w.id}><td>{w.warehouseName}</td><td>—</td><td>—</td><td>—</td><td>—</td>
                        {reportType==='monthly'&&<><td>—</td><td>—</td></>}</tr>
                    ))}
                    {reportView === 'item' && products.slice(0,20).map(p => (
                      <tr key={p.id}><td><ProductNameSpec product={p} /></td><td>—</td><td>—</td><td>—</td><td>—</td>
                        {reportType==='monthly'&&<><td>—</td><td>{(p.currentStock||0).toLocaleString()}</td></>}</tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td><strong>합계</strong></td><td>—</td><td>—</td><td>—</td><td>—</td>
                      {reportType==='monthly'&&<><td>—</td><td>{products.reduce((s,p)=>s+(p.currentStock||0),0).toLocaleString()}</td></>}
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="pos-action-row" style={{ marginTop: 'auto', paddingTop: 12 }}>
                <button className="pos-btn pos-btn--save">엑셀 다운로드 <kbd>F7</kbd></button>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL ───────────────────────────────── */}
        <div className="pos-right">
          <div className="pos-right__title">
            {activeFunc === 'inbound'  ? '입고 세션' :
             activeFunc === 'outbound' ? '출고 세션' : '처리 목록'}
          </div>

          <div className="pos-right__head">
            <span className="rp-num">#</span>
            <span className="rp-name">상품명</span>
            <span className="rp-loc">위치</span>
            <span className="rp-qty">수량</span>
            <span className="rp-amt">금액</span>
            <span className="rp-del"></span>
          </div>

          <div className="pos-right__body">
            {sessionItems.length === 0 ? (
              <div className="pos-empty-msg" style={{ fontSize: '0.9rem' }}>세션 항목이 없습니다</div>
            ) : sessionItems.map((item, i) => (
              <div key={item.id}
                className={`pos-right__row${selectedSessionIdx===i?' pos-right__row--sel':''}`}
                onClick={() => setSelectedSessionIdx(i)}>
                <span className="rp-num">{i + 1}</span>
                <span className="rp-name">
                  <ProductNameSpec product={item} nameClassName="rp-pname" />
                  <span className="rp-pcode">{item.productCode}</span>
                </span>
                <span className="rp-loc">{item.location}</span>
                <span className="rp-qty">{item.quantity.toLocaleString()}</span>
                <span className="rp-amt">₩{item.amount.toLocaleString()}</span>
                <button className="rp-del"
                  onClick={e => {
                    e.stopPropagation();
                    setSessionItems(prev => prev.filter((_,j) => j !== i));
                    if (selectedSessionIdx === i) setSelectedSessionIdx(null);
                  }}>✕</button>
              </div>
            ))}
          </div>

          <div className="pos-right__foot">
            <div className="pos-right__totals">
              <span>{sessionItems.length}종 · {sessionTotalQty.toLocaleString()}개</span>
              <span className="pos-right__total-amt">₩{sessionTotalAmt.toLocaleString()}</span>
            </div>
            <button
              className="pos-right__complete"
              style={{ background: activeColor }}
              onClick={handleComplete}
              disabled={sessionItems.length === 0}>
              ✅ {activeFunc === 'inbound' ? '입고' : '출고'} 완료 &nbsp;F7
            </button>
          </div>
        </div>

        {/* ── RIGHT NAV MENU ────────────────────────────── */}
        <nav className="pos-left">
          {onGoHome && (
            <button className="pos-menu-btn pos-menu-btn--home" onClick={onGoHome}>
              <span className="pos-menu-btn__label">🏠</span>
              <span className="pos-menu-btn__sub">Home</span>
            </button>
          )}
          {MENU_ITEMS.map(item => (
            <button
              key={item.id}
              className={[
                'pos-menu-btn',
                activeFunc === item.id  ? 'pos-menu-btn--active'  : '',
                item.disabled           ? 'pos-menu-btn--disabled' : '',
              ].join(' ')}
              style={activeFunc === item.id ? { borderColor: item.color, color: item.color } : {}}
              onClick={() => switchFunc(item.id)}
              title={item.disabled ? '자동발주 기능은 추후 업데이트 예정입니다' : undefined}
            >
              <span className="pos-menu-btn__label">{item.label}</span>
              <span className="pos-menu-btn__sub">{item.sub}</span>
              {item.key      && <span className="pos-menu-btn__key">{item.key}</span>}
              {item.disabled && <span className="pos-menu-btn__coming">준비중</span>}
              {item.id === 'low-stock' && stats.lowStock > 0 && (
                <span className="pos-menu-btn__badge">{stats.lowStock}</span>
              )}
            </button>
          ))}
        </nav>

      </div>

      {/* ═══ BOTTOM BAR ════════════════════════════════════ */}
      <div className="pos-bottom">
        {[
          ['F1','검색'],['F2','입고'],['F3','출고'],['F4','재고조회'],
          ['F5','요청출고'],['F6','저재고'],['F7','저장'],['F8','삭제'],
          ['F9','초기화'],['F10','리포트'],['Ctrl+Shift+F','전체화면'],['Ctrl+Shift+M','모드전환'],['ESC','취소'],
        ].map(([k, l]) => (
          <span key={k} className="pos-bottom__item">
            <kbd className="pos-bottom__kbd">{k}</kbd>{l}
          </span>
        ))}
        <span className={`pos-bottom__mode pos-bottom__mode--${mode}`}>
          {mode === 'shortcut' ? '⌨ 단축키 모드' : '✏ 입력 모드'}
        </span>
      </div>

    </div>
  );
};

export default WarehouseDashboard;
