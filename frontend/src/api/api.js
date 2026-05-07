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
  getStats: () => axios.get(`${API_BASE_URL}/dashboard/stats`, { headers: getAuthHeader() }),
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
  getDailyStats: (date) => axios.get(`${API_BASE_URL}/reports/daily-stats?date=${date}`, { headers: getAuthHeader() })
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
  delete: (id) => axios.delete(`${API_BASE_URL}/products/${id}`, { headers: getAuthHeader() }),
  restore: (id) => axios.put(`${API_BASE_URL}/products/${id}/restore`, {}, { headers: getAuthHeader() }),
  deletePermanent: (id) => axios.delete(`${API_BASE_URL}/products/${id}/permanent`, { headers: getAuthHeader() }),
  checkDuplicate: (data) => axios.post(`${API_BASE_URL}/products/check-duplicate`, data, { headers: getAuthHeader() }),
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
  syncItems: () => axios.post(`${API_BASE_URL}/gw-mapping/sync`, {}, { headers: getAuthHeader() }),
};

const dbConfigAPI = {
  get: () => axios.get(`${API_BASE_URL}/system/db-config`, { headers: getAuthHeader() }),
  test: (data) => axios.post(`${API_BASE_URL}/system/db-config/test`, data, { headers: getAuthHeader() }),
  save: (data) => axios.put(`${API_BASE_URL}/system/db-config`, data, { headers: getAuthHeader() }),
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
  gwRequestsAPI
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
  gwRequestsAPI
};

export default api;
