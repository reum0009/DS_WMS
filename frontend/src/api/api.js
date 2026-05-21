import axios from 'axios';

const LS_SERVER = 'wms_server_url';

const trimRightSlash = (v) => String(v || '').replace(/\/+$/, '');

const normalizeApiBase = (v) => {
  const base = trimRightSlash(v);
  if (!base) return '';
  return /\/api$/i.test(base) ? base : `${base}/api`;
};

const resolveApiBaseUrl = () => {
  const fromEnv = trimRightSlash(process.env.REACT_APP_API_BASE_URL || '');
  if (fromEnv) return fromEnv;

  if (typeof window !== 'undefined') {
    if (window.location?.port === '5000') return '/api';
    const fromSavedServer = normalizeApiBase(window.localStorage?.getItem(LS_SERVER));
    if (fromSavedServer) return fromSavedServer;
  }

  return '/api';
};

const API_BASE_URL = resolveApiBaseUrl();

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const dashboardAPI = {
  getStats: (params) => axios.get(`${API_BASE_URL}/dashboard/stats`, { headers: getAuthHeader(), params }),
  getLowStockAlerts: (params) => axios.get(`${API_BASE_URL}/dashboard/alerts/low-stock`, { headers: getAuthHeader(), params }),
};

const authAPI = {
  register: (data) => axios.post(`${API_BASE_URL}/auth/register`, data),
  login: (data) => axios.post(`${API_BASE_URL}/auth/login`, data),
  getMe: () => axios.get(`${API_BASE_URL}/auth/me`, { headers: getAuthHeader() })
};

const requestsAPI = {
  create: (data) => axios.post(`${API_BASE_URL}/requests`, data, { headers: getAuthHeader() }),
  getAll: () => axios.get(`${API_BASE_URL}/requests`, { headers: getAuthHeader() }),
  getById: (id) => axios.get(`${API_BASE_URL}/requests/${id}`, { headers: getAuthHeader() }),
  update: (id, data) => axios.put(`${API_BASE_URL}/requests/${id}`, data, { headers: getAuthHeader() }),
  delete: (id) => axios.delete(`${API_BASE_URL}/requests/${id}`, { headers: getAuthHeader() })
};

const gwRequestsAPI = {
  getAll: () => axios.get(`${API_BASE_URL}/gw-requests`, { headers: getAuthHeader() }),
  health: () => axios.get(`${API_BASE_URL}/gw-requests/health`, { headers: getAuthHeader() }),
};

const approvalsAPI = {
  getPending: () => axios.get(`${API_BASE_URL}/approvals/pending`, { headers: getAuthHeader() }),
  approve: (id, data) => axios.put(`${API_BASE_URL}/approvals/${id}/approve`, data, { headers: getAuthHeader() }),
  reject: (id, data) => axios.put(`${API_BASE_URL}/approvals/${id}/reject`, data, { headers: getAuthHeader() })
};

const releasesAPI = {
  getApproved: () => axios.get(`${API_BASE_URL}/releases/approved`, { headers: getAuthHeader() }),
  release: (id, data) => axios.put(`${API_BASE_URL}/releases/${id}/release`, data, { headers: getAuthHeader() }),
  reject: (id, data) => axios.put(`${API_BASE_URL}/releases/${id}/reject`, data, { headers: getAuthHeader() })
};

const reportsAPI = {
  getStats: () => axios.get(`${API_BASE_URL}/reports/stats`, { headers: getAuthHeader() }),
  getCategoryStats: () => axios.get(`${API_BASE_URL}/reports/category-stats`, { headers: getAuthHeader() }),
  getDailyStats: (date) => axios.get(`${API_BASE_URL}/reports/daily-stats?date=${date}`, { headers: getAuthHeader() }),
  getWarehouseSummary: (params) => axios.get(`${API_BASE_URL}/reports/warehouse-summary`, { headers: getAuthHeader(), params })
};

const usersAPI = {
  getAll: () => axios.get(`${API_BASE_URL}/users`, { headers: getAuthHeader() }),
  getById: (id) => axios.get(`${API_BASE_URL}/users/${id}`, { headers: getAuthHeader() }),
  create: (data) => axios.post(`${API_BASE_URL}/users`, data, { headers: getAuthHeader() }),
  update: (id, data) => axios.put(`${API_BASE_URL}/users/${id}`, data, { headers: getAuthHeader() }),
  delete: (id) => axios.delete(`${API_BASE_URL}/users/${id}`, { headers: getAuthHeader() })
};

const productsAPI = {
  getAll: (params) => axios.get(`${API_BASE_URL}/products`, { headers: getAuthHeader(), params }),
  getInactive: () => axios.get(`${API_BASE_URL}/products?inactive=1`, { headers: getAuthHeader() }),
  getById: (id) => axios.get(`${API_BASE_URL}/products/${id}`, { headers: getAuthHeader() }),
  create: (data) => axios.post(`${API_BASE_URL}/products`, data, { headers: getAuthHeader() }),
  update: (id, data) => axios.put(`${API_BASE_URL}/products/${id}`, data, { headers: getAuthHeader() }),
  adjustStock: (id, data) => axios.post(`${API_BASE_URL}/products/${id}/adjust-stock`, data, { headers: getAuthHeader() }),
  delete: (id) => axios.delete(`${API_BASE_URL}/products/${id}`, { headers: getAuthHeader() }),
  restore: (id) => axios.put(`${API_BASE_URL}/products/${id}/restore`, {}, { headers: getAuthHeader() }),
  deletePermanent: (id) => axios.delete(`${API_BASE_URL}/products/${id}/permanent`, { headers: getAuthHeader() }),
  checkDuplicate: (data) => axios.post(`${API_BASE_URL}/products/check-duplicate`, data, { headers: getAuthHeader() }),
  generateBarcode: () => axios.get(`${API_BASE_URL}/products/next-barcode`, { headers: getAuthHeader() }),
  printLabel: (data) => printLabel(data),
  printCommandLabel: (data) => printCommandLabel(data),
  recalculateSafetyStock: (data = {}) => axios.post(`${API_BASE_URL}/products/recalculate-safety-stock`, data, { headers: getAuthHeader() }),
  uploadCSV: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API_BASE_URL}/products/upload/csv`, formData, {
      headers: { ...getAuthHeader(), 'Content-Type': 'multipart/form-data' }
    });
  }
};

const warehousesAPI = {
  getAll: (params) => axios.get(`${API_BASE_URL}/warehouses`, { headers: getAuthHeader(), params }),
  getById: (id) => axios.get(`${API_BASE_URL}/warehouses/${id}`, { headers: getAuthHeader() }),
  create: (data) => axios.post(`${API_BASE_URL}/warehouses`, data, { headers: getAuthHeader() }),
  update: (id, data) => axios.put(`${API_BASE_URL}/warehouses/${id}`, data, { headers: getAuthHeader() }),
  delete: (id) => axios.delete(`${API_BASE_URL}/warehouses/${id}`, { headers: getAuthHeader() })
};

const CODE128_PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
];

const COMMAND_LABELS = {
  inbound: { barcode: 'W99999', productName: '입고바코드' },
  outbound: { barcode: 'W99998', productName: '출고바코드' },
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const code128Bars = (text) => {
  const value = String(text || '');
  const codes = [104];
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error('바코드에 지원하지 않는 문자가 포함되어 있습니다.');
    codes.push(code - 32);
  }
  let checksum = codes[0];
  for (let i = 1; i < codes.length; i += 1) checksum += codes[i] * i;
  codes.push(checksum % 103, 106);

  const bars = [];
  let x = 0;
  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code];
    for (let i = 0; i < pattern.length; i += 1) {
      const width = parseInt(pattern[i], 10);
      if (i % 2 === 0) bars.push({ x, w: width });
      x += width;
    }
  }
  return { bars, modules: x };
};

const buildBarcodeSvg = (barcode) => {
  const { bars, modules } = code128Bars(barcode);
  const width = 420;
  const height = 112;
  const moduleWidth = width / modules;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">${
    bars.map(bar => `<rect x="${(bar.x * moduleWidth).toFixed(3)}" y="0" width="${Math.max(1, bar.w * moduleWidth).toFixed(3)}" height="${height}" />`).join('')
  }</svg>`;
};

const openBrowserLabelPrint = ({ productName, barcode }) => {
  const labelName = String(productName || '').trim();
  const labelBarcode = String(barcode || '').trim();
  if (!labelName || !labelBarcode) throw new Error('출력할 바코드 정보가 없습니다.');

  const popup = window.open('', 'wms_label_print', 'width=420,height=320');
  if (!popup) throw new Error('인쇄 팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.');

  popup.document.open();
  popup.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(labelBarcode)}</title>
  <style>
    @page label { size: 30mm 50mm; margin: 0; }
    @page { size: 30mm 50mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; overflow: hidden; }
    body { font-family: "Malgun Gothic", Arial, sans-serif; color: #000; background: #fff; }
    .page { page: label; position: absolute; left: 0; top: 0; width: 30mm; height: 50mm; overflow: hidden; background: #fff; }
    .label { position: absolute; left: 0; top: 0; width: 50mm; height: 30mm; padding: 3mm 1.5mm 0 0.5mm; display: flex; flex-direction: column; align-items: stretch; overflow: hidden; transform-origin: top left; transform: translate(0, 50mm) rotate(-90deg); }
    .title { height: 6mm; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 7pt; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 1mm; position: relative; z-index: 0; }
    .title::before { content: ""; position: absolute; inset: 0; background: #000; z-index: -1; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .barcode { height: 12mm; margin-top: 2mm; }
    .code { height: 4.5mm; margin-top: .6mm; display: flex; align-items: center; justify-content: center; font: 700 8.5pt Consolas, monospace; }
    svg { display: block; fill: #000; }
    @media screen { html, body { width: 30mm; height: 50mm; } body { background: #f3f4f6; } .page { background: #fff; outline: 1px solid #bbb; } }
    @media print { html, body { width: 30mm !important; height: 50mm !important; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="label">
      <div class="title">품목명 : ${escapeHtml(labelName)}</div>
      <div class="barcode">${buildBarcodeSvg(labelBarcode)}</div>
      <div class="code">${escapeHtml(labelBarcode)}</div>
    </div>
  </div>
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 80);
    });
  </script>
</body>
</html>`);
  popup.document.close();

  return { data: { ok: true, browserPrint: true, productName: labelName, barcode: labelBarcode } };
};

const printLabel = async (data) => openBrowserLabelPrint(data || {});

const printCommandLabel = async (data) => {
  const command = COMMAND_LABELS[String(data?.type || '').trim()];
  if (!command) throw new Error('지원하지 않는 명령 바코드입니다.');
  return openBrowserLabelPrint(command);
};

const noticesAPI = {
  getAll: () => axios.get(`${API_BASE_URL}/notices`, { headers: getAuthHeader() }),
  getActive: (params) => axios.get(`${API_BASE_URL}/notices/active`, { headers: getAuthHeader(), params }),
  create: (data) => axios.post(`${API_BASE_URL}/notices`, data, { headers: getAuthHeader() }),
  update: (id, data) => axios.put(`${API_BASE_URL}/notices/${id}`, data, { headers: getAuthHeader() }),
  delete: (id) => axios.delete(`${API_BASE_URL}/notices/${id}`, { headers: getAuthHeader() }),
};

const requestItemsAPI = {
  getByRequest: (requestId) => axios.get(`${API_BASE_URL}/request-items/request/${requestId}`, { headers: getAuthHeader() }),
  addItem: (data) => axios.post(`${API_BASE_URL}/request-items`, data, { headers: getAuthHeader() }),
  updateItem: (id, data) => axios.put(`${API_BASE_URL}/request-items/${id}`, data, { headers: getAuthHeader() }),
  deleteItem: (id) => axios.delete(`${API_BASE_URL}/request-items/${id}`, { headers: getAuthHeader() }),
  getSummary: (requestId) => axios.get(`${API_BASE_URL}/request-items/summary/${requestId}`, { headers: getAuthHeader() })
};

const stockHistoryAPI = {
  getByProduct: (productId) => axios.get(`${API_BASE_URL}/stock-history/product/${productId}`, { headers: getAuthHeader() }),
  getAll: (filters) => axios.get(`${API_BASE_URL}/stock-history`, { headers: getAuthHeader(), params: filters }),
  getByReference: (reference) => axios.get(`${API_BASE_URL}/stock-history/reference/${reference}`, { headers: getAuthHeader() })
};

const inboundAPI = {
  process:    (data)              => axios.post(`${API_BASE_URL}/inbound`, data, { headers: getAuthHeader() }),
  getToday:   ()                  => axios.get(`${API_BASE_URL}/inbound/today`, { headers: getAuthHeader() }),
  getSessions:(params)            => axios.get(`${API_BASE_URL}/inbound/sessions`, { headers: getAuthHeader(), params }),
  getSession: (reference)         => axios.get(`${API_BASE_URL}/inbound/session/${encodeURIComponent(reference)}`, { headers: getAuthHeader() }),
  updateItem: (reference, id, data) => axios.put(`${API_BASE_URL}/inbound/session/${encodeURIComponent(reference)}/item/${id}`, data, { headers: getAuthHeader() }),
  deleteItem: (reference, id)     => axios.delete(`${API_BASE_URL}/inbound/session/${encodeURIComponent(reference)}/item/${id}`, { headers: getAuthHeader() }),
};

const outboundAPI = {
  process: (data) => axios.post(`${API_BASE_URL}/outbound`, data, { headers: getAuthHeader() }),
  getToday: () => axios.get(`${API_BASE_URL}/outbound/today`, { headers: getAuthHeader() }),
  getSessions:(params)            => axios.get(`${API_BASE_URL}/outbound/sessions`, { headers: getAuthHeader(), params }),
  getSession: (reference)         => axios.get(`${API_BASE_URL}/outbound/session/${encodeURIComponent(reference)}`, { headers: getAuthHeader() }),
  updateItem: (reference, id, data) => axios.put(`${API_BASE_URL}/outbound/session/${encodeURIComponent(reference)}/item/${id}`, data, { headers: getAuthHeader() }),
  deleteItem: (reference, id)     => axios.delete(`${API_BASE_URL}/outbound/session/${encodeURIComponent(reference)}/item/${id}`, { headers: getAuthHeader() }),
};

const categoriesAPI = {
  getAll:          (params)  => axios.get(`${API_BASE_URL}/categories`, { headers: getAuthHeader(), params }),
  getInactive:     ()        => axios.get(`${API_BASE_URL}/categories/inactive`, { headers: getAuthHeader() }),
  getTree:         (params)  => axios.get(`${API_BASE_URL}/categories/tree`, { headers: getAuthHeader(), params }),
  getDepts:        ()        => axios.get(`${API_BASE_URL}/categories/depts`, { headers: getAuthHeader() }),
  getAllDepts:     ()        => axios.get(`${API_BASE_URL}/categories/depts-all`, { headers: getAuthHeader() }),
  createDept:      (data)    => axios.post(`${API_BASE_URL}/categories/dept`, data, { headers: getAuthHeader() }),
  create:          (data)    => axios.post(`${API_BASE_URL}/categories`, data, { headers: getAuthHeader() }),
  update:          (id, data)=> axios.put(`${API_BASE_URL}/categories/${id}`, data, { headers: getAuthHeader() }),
  delete:          (id)      => axios.delete(`${API_BASE_URL}/categories/${id}`, { headers: getAuthHeader() }),
  move:            (id, newParentId) => axios.put(`${API_BASE_URL}/categories/${id}/move`, { newParentId }, { headers: getAuthHeader() }),
  reorder:         (id, data)       => axios.put(`${API_BASE_URL}/categories/${id}/reorder`, data, { headers: getAuthHeader() }),
  moveAfter:       (id, afterId)    => axios.put(`${API_BASE_URL}/categories/${id}/move-after`, { afterId }, { headers: getAuthHeader() }),
  restore:         (id)      => axios.put(`${API_BASE_URL}/categories/${id}/restore`, {}, { headers: getAuthHeader() }),
  deletePermanent: (id)      => axios.delete(`${API_BASE_URL}/categories/${id}/permanent`, { headers: getAuthHeader() }),
  getDeptFields:         (deptId)  => axios.get(`${API_BASE_URL}/categories/dept-fields/${deptId}`, { headers: getAuthHeader() }),
  createField:           (data)    => axios.post(`${API_BASE_URL}/categories/dept-fields`, data, { headers: getAuthHeader() }),
  deleteField:           (id)      => axios.delete(`${API_BASE_URL}/categories/dept-fields/${id}`, { headers: getAuthHeader() }),
  getWarehouseStocks:    (id)      => axios.get(`${API_BASE_URL}/categories/${id}/warehouse-stocks`, { headers: getAuthHeader() }),
  setWarehouseStocks:    (id, data)=> axios.put(`${API_BASE_URL}/categories/${id}/warehouse-stocks`, data, { headers: getAuthHeader() }),
};

const suppliersAPI = {
  getAll: () => axios.get(`${API_BASE_URL}/suppliers`, { headers: getAuthHeader() }),
  getById: (id) => axios.get(`${API_BASE_URL}/suppliers/${id}`, { headers: getAuthHeader() }),
  create: (data) => axios.post(`${API_BASE_URL}/suppliers`, data, { headers: getAuthHeader() }),
  update: (id, data) => axios.put(`${API_BASE_URL}/suppliers/${id}`, data, { headers: getAuthHeader() }),
  delete: (id) => axios.delete(`${API_BASE_URL}/suppliers/${id}`, { headers: getAuthHeader() }),
};

const invitationsAPI = {
  getAll:   ()       => axios.get(`${API_BASE_URL}/invitations`, { headers: getAuthHeader() }),
  send:     (data)   => axios.post(`${API_BASE_URL}/invitations`, data, { headers: getAuthHeader() }),
  resend:   (id)     => axios.post(`${API_BASE_URL}/invitations/${id}/resend`, {}, { headers: getAuthHeader() }),
  approve:  (id)     => axios.put(`${API_BASE_URL}/invitations/${id}/approve`, {}, { headers: getAuthHeader() }),
  reject:   (id, reason) => axios.put(`${API_BASE_URL}/invitations/${id}/reject`, { reason }, { headers: getAuthHeader() }),
};

const warehouseTransferAPI = {
  create:   (data)   => axios.post(`${API_BASE_URL}/warehouse-transfer`, data, { headers: getAuthHeader() }),
  getAll:   (params) => axios.get(`${API_BASE_URL}/warehouse-transfer`, { headers: getAuthHeader(), params }),
  getByOut: (number) => axios.get(`${API_BASE_URL}/warehouse-transfer/out/${encodeURIComponent(number)}`, { headers: getAuthHeader() }),
  confirm:  (id, data) => axios.post(`${API_BASE_URL}/warehouse-transfer/${id}/confirm`, data, { headers: getAuthHeader() }),
  update:   (id, data) => axios.put(`${API_BASE_URL}/warehouse-transfer/${id}`, data, { headers: getAuthHeader() }),
  cancel:   (id)       => axios.delete(`${API_BASE_URL}/warehouse-transfer/${id}`, { headers: getAuthHeader() }),
};

const productsQuickAdd = (data) =>
  axios.post(`${API_BASE_URL}/products/quick-add`, data, { headers: getAuthHeader() });

const gwMappingAPI = {
  getItems: () => axios.get(`${API_BASE_URL}/gw-mapping/items`, { headers: getAuthHeader() }),
  mapItem: (data) => axios.post(`${API_BASE_URL}/gw-mapping/map`, data, { headers: getAuthHeader() }),
  excludeItem: (data) => axios.post(`${API_BASE_URL}/gw-mapping/exclude`, data, { headers: getAuthHeader() }),
  syncItems: () => axios.post(`${API_BASE_URL}/gw-mapping/sync`, {}, { headers: getAuthHeader() }),
};

const dbConfigAPI = {
  get: () => axios.get(`${API_BASE_URL}/system/db-config`, { headers: getAuthHeader() }),
  test: (data) => axios.post(`${API_BASE_URL}/system/db-config/test`, data, { headers: getAuthHeader() }),
  save: (data) => axios.put(`${API_BASE_URL}/system/db-config`, data, { headers: getAuthHeader() }),
};

const updateAPI = {
  check: () => axios.get(`${API_BASE_URL}/update/check`),
};

const purchaseCartAPI = {
  getCatalog: (params) => axios.get(`${API_BASE_URL}/purchase-cart/catalog`, { headers: getAuthHeader(), params }),
  getCart: () => axios.get(`${API_BASE_URL}/purchase-cart`, { headers: getAuthHeader() }),
  addItem: (data) => axios.post(`${API_BASE_URL}/purchase-cart/items`, data, { headers: getAuthHeader() }),
  updateItem: (id, data) => axios.patch(`${API_BASE_URL}/purchase-cart/items/${id}`, data, { headers: getAuthHeader() }),
  removeItem: (id) => axios.delete(`${API_BASE_URL}/purchase-cart/items/${id}`, { headers: getAuthHeader() }),
  clear: () => axios.delete(`${API_BASE_URL}/purchase-cart`, { headers: getAuthHeader() }),
  preview: (data = {}) => axios.post(`${API_BASE_URL}/purchase-cart/preview`, data, { headers: getAuthHeader() }),
  checkout: (data) => axios.post(`${API_BASE_URL}/purchase-cart/checkout`, data, { headers: getAuthHeader() }),
  refreshImage: (productId, data = {}) => axios.post(`${API_BASE_URL}/purchase-cart/products/${productId}/refresh-image`, data, { headers: getAuthHeader() }),
};

export {
  dashboardAPI,
  authAPI,
  requestsAPI,
  approvalsAPI,
  releasesAPI,
  reportsAPI,
  usersAPI,
  productsAPI,
  warehousesAPI,
  noticesAPI,
  requestItemsAPI,
  stockHistoryAPI,
  inboundAPI,
  outboundAPI,
  categoriesAPI,
  suppliersAPI,
  invitationsAPI,
  warehouseTransferAPI,
  productsQuickAdd,
  gwMappingAPI,
  dbConfigAPI,
  gwRequestsAPI,
  updateAPI,
  purchaseCartAPI
};

const api = {
  dashboardAPI,
  authAPI,
  requestsAPI,
  approvalsAPI,
  releasesAPI,
  reportsAPI,
  usersAPI,
  productsAPI,
  warehousesAPI,
  noticesAPI,
  requestItemsAPI,
  stockHistoryAPI,
  inboundAPI,
  outboundAPI,
  categoriesAPI,
  suppliersAPI,
  invitationsAPI,
  warehouseTransferAPI,
  productsQuickAdd,
  gwMappingAPI,
  dbConfigAPI,
  gwRequestsAPI,
  updateAPI,
  purchaseCartAPI
};

export default api;
