const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const { QueryTypes } = require('sequelize');
const { auth, roleAuth } = require('../middleware/auth');

const router = express.Router();

const PURCHASE_AUTO_API_BASE_URL = String(process.env.PURCHASE_AUTO_API_BASE_URL || 'http://127.0.0.1:5008').replace(/\/+$/, '');
const PURCHASE_AUTO_START_TIMEOUT_MS = parseInt(process.env.PURCHASE_AUTO_START_TIMEOUT_MS || '20000', 10);
const PURCHASE_AUTO_STEP_TIMEOUT_MS = parseInt(process.env.PURCHASE_AUTO_STEP_TIMEOUT_MS || '1800000', 10);
const COMPUZONE_PRODUCT_BASE_URL = 'https://www.compuzone.co.kr/product/product_detail.htm?ProductNo=';
const WRITE_ROLES = ['admin', 'dept_admin'];
const PURCHASE_AUTO_LOG_DIR = process.env.PURCHASE_AUTO_BRIDGE_LOG_DIR
  || path.join(__dirname, '..', 'logs');
const PURCHASE_AUTO_BRIDGE_LOG = path.join(PURCHASE_AUTO_LOG_DIR, 'purchase-auto-bridge.log');
const PURCHASE_AUTO_PROCESS_LOG = path.join(PURCHASE_AUTO_LOG_DIR, 'purchase-auto-process.log');

let schemaReady = false;
let purchaseAutoStartPromise = null;

function ensurePurchaseAutoLogDir() {
  fs.mkdirSync(PURCHASE_AUTO_LOG_DIR, { recursive: true });
}

function sanitizeForLog(value) {
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/password|token|authorization|cookie|secret/i.test(key)) {
        out[key] = '[redacted]';
      } else {
        out[key] = sanitizeForLog(item);
      }
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 1500) return `${value.slice(0, 1500)}...`;
  return value;
}

function appendPurchaseAutoLog(event, details = {}) {
  try {
    ensurePurchaseAutoLogDir();
    const line = JSON.stringify({
      at: new Date().toISOString(),
      event,
      ...sanitizeForLog(details),
    });
    fs.appendFileSync(PURCHASE_AUTO_BRIDGE_LOG, `${line}\n`, 'utf8');
  } catch (err) {
    console.error('[Purchase_Auto bridge log failed]', err);
  }
}

function readTail(filePath, maxBytes = 120000) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    fs.closeSync(fd);
    return buffer.toString('utf8');
  } catch (err) {
    return `log read failed: ${err.message}`;
  }
}

function readPurchaseAutoLogs(limit = 200) {
  const bridgeText = readTail(PURCHASE_AUTO_BRIDGE_LOG);
  const bridgeLines = bridgeText.split(/\r?\n/).filter(Boolean).slice(-limit);
  return {
    bridgeLogPath: PURCHASE_AUTO_BRIDGE_LOG,
    processLogPath: PURCHASE_AUTO_PROCESS_LOG,
    bridge: bridgeLines,
    process: readTail(PURCHASE_AUTO_PROCESS_LOG).split(/\r?\n/).filter(Boolean).slice(-limit),
  };
}

function parsePositiveInt(value, fallback = null) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parseIdList(value, max = 1000) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const ids = [];
  const seen = new Set();
  for (const item of raw) {
    const id = parsePositiveInt(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= max) break;
  }
  return ids;
}

function compuzoneUrl(productNo) {
  const no = String(productNo || '').trim();
  return no ? `${COMPUZONE_PRODUCT_BASE_URL}${encodeURIComponent(no)}` : null;
}

function isHttpUrl(value) {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function toAbsoluteUrl(candidate, baseUrl) {
  const cleaned = String(candidate || '').replace(/&amp;/g, '&').trim();
  if (!cleaned) return null;
  try {
    return new URL(cleaned, baseUrl).toString();
  } catch (_) {
    return null;
  }
}

async function tableExists(tableName, transaction = null) {
  const rows = await global.sequelize.query(
    `
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = :tableName
    LIMIT 1
    `,
    { replacements: { tableName }, type: QueryTypes.SELECT, transaction }
  );
  return rows.length > 0;
}

async function ensureSchema() {
  if (schemaReady) return;

  await global.sequelize.query(`
    CREATE TABLE IF NOT EXISTS purchase_product_sources (
      id INT NOT NULL AUTO_INCREMENT,
      productId INT NOT NULL,
      sourceType VARCHAR(30) NOT NULL DEFAULT 'manual',
      sourceProductNo VARCHAR(80) NULL,
      productUrl VARCHAR(500) NULL,
      imageUrl VARCHAR(1000) NULL,
      thumbnailUrl VARCHAR(1000) NULL,
      imageUpdatedAt DATETIME NULL,
      isPurchasable TINYINT(1) NOT NULL DEFAULT 0,
      isPrimary TINYINT(1) NOT NULL DEFAULT 0,
      sourceNote VARCHAR(255) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY ux_purchase_product_sources_product_source (productId, sourceType, sourceProductNo),
      KEY ix_purchase_product_sources_product (productId),
      KEY ix_purchase_product_sources_type (sourceType)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await global.sequelize.query(`
    CREATE TABLE IF NOT EXISTS purchase_cart_items (
      id INT NOT NULL AUTO_INCREMENT,
      userId INT NOT NULL,
      productId INT NOT NULL,
      sourceId INT NULL,
      quantity INT NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY ux_purchase_cart_items_user_product (userId, productId),
      KEY ix_purchase_cart_items_user (userId),
      KEY ix_purchase_cart_items_product (productId),
      KEY ix_purchase_cart_items_source (sourceId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await backfillCompuzoneSources();
  schemaReady = true;
}

async function backfillCompuzoneSources() {
  await global.sequelize.query(`
    INSERT IGNORE INTO purchase_product_sources (
      productId,
      sourceType,
      sourceProductNo,
      productUrl,
      isPurchasable,
      isPrimary,
      sourceNote,
      createdAt,
      updatedAt
    )
    SELECT
      ic.itemId,
      'compuzone',
      SUBSTRING(ic.codeValue, 11),
      CONCAT(:baseUrl, SUBSTRING(ic.codeValue, 11)),
      1,
      0,
      LEFT(ic.notes, 255),
      NOW(),
      NOW()
    FROM item_codes ic
    JOIN products p ON p.id = ic.itemId AND p.isActive = 1
    WHERE ic.codeType = 'vendor'
      AND ic.codeValue LIKE 'COMPUZONE:%'
      AND SUBSTRING(ic.codeValue, 11) <> ''
  `, { replacements: { baseUrl: COMPUZONE_PRODUCT_BASE_URL } });

  if (await tableExists('compuzone_wms_product_map') && await tableExists('compuzone_products')) {
    await global.sequelize.query(`
      INSERT IGNORE INTO purchase_product_sources (
        productId,
        sourceType,
        sourceProductNo,
        productUrl,
        isPurchasable,
        isPrimary,
        sourceNote,
        createdAt,
        updatedAt
      )
      SELECT
        m.suggested_wms_product_id,
        'compuzone',
        p.product_no,
        CONCAT(:baseUrl, p.product_no),
        1,
        0,
        LEFT(p.raw_name, 255),
        NOW(),
        NOW()
      FROM compuzone_wms_product_map m
      JOIN compuzone_products p ON p.product_uid = m.product_uid
      JOIN products wp ON wp.id = m.suggested_wms_product_id AND wp.isActive = 1
      WHERE m.suggested_wms_product_id IS NOT NULL
        AND p.product_no IS NOT NULL
        AND p.product_no <> ''
    `, { replacements: { baseUrl: COMPUZONE_PRODUCT_BASE_URL } });
  }

  await global.sequelize.query(`
    UPDATE purchase_product_sources s
    JOIN (
      SELECT productId, MIN(id) AS primaryId
      FROM purchase_product_sources
      GROUP BY productId
    ) x ON x.productId = s.productId
    SET s.isPrimary = CASE WHEN s.id = x.primaryId THEN 1 ELSE 0 END
  `);
}

async function categoryIdsFor(categoryId, includeDescendants = true) {
  const id = parsePositiveInt(categoryId);
  if (!id) return [];

  if (!includeDescendants) return [id];

  const rows = await global.sequelize.query(
    `
    SELECT id, parentId
    FROM categories
    WHERE isActive = 1
    `,
    { type: QueryTypes.SELECT }
  );

  const childrenByParent = new Map();
  for (const row of rows) {
    const parent = parsePositiveInt(row.parentId, 0);
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(parsePositiveInt(row.id));
  }

  const ids = new Set([id]);
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    for (const childId of childrenByParent.get(current) || []) {
      if (ids.has(childId)) continue;
      ids.add(childId);
      stack.push(childId);
    }
  }

  return Array.from(ids);
}

function mapProduct(row) {
  const productUrl = row.productUrl || (row.sourceType === 'compuzone' ? compuzoneUrl(row.sourceProductNo) : null);
  return {
    id: row.id,
    productCode: row.productCode,
    productName: row.productName,
    specification: row.specification,
    unit: row.unit,
    unitPrice: Number(row.unitPrice || 0),
    currentStock: Number(row.currentStock || 0),
    safetyStock: Number(row.safetyStock || 0),
    categoryId: row.categoryId,
    notes: row.notes,
    source: row.sourceId ? {
      id: row.sourceId,
      type: row.sourceType || 'manual',
      productNo: row.sourceProductNo,
      productUrl,
      imageUrl: row.imageUrl,
      thumbnailUrl: row.thumbnailUrl,
      isPurchasable: !!row.isPurchasable,
      sourceCount: Number(row.sourceCount || 0),
    } : {
      id: null,
      type: 'manual',
      productNo: null,
      productUrl: null,
      imageUrl: null,
      thumbnailUrl: null,
      isPurchasable: false,
      sourceCount: 0,
    },
  };
}

async function loadCatalogProducts({ categoryIds, search = '', limit = 300 }) {
  const replacements = {
    categoryIds,
    search: `%${String(search || '').trim()}%`,
    limit: Math.max(1, Math.min(parsePositiveInt(limit, 300), 1000)),
  };

  const where = [
    'p.isActive = 1',
    categoryIds.length ? 'p.categoryId IN (:categoryIds)' : '1 = 1',
  ];
  if (String(search || '').trim()) {
    where.push('(p.productName LIKE :search OR p.specification LIKE :search OR p.productCode LIKE :search)');
  }

  const rows = await global.sequelize.query(
    `
    SELECT
      p.id,
      p.productCode,
      p.productName,
      p.specification,
      p.unit,
      p.unitPrice,
      p.currentStock,
      p.safetyStock,
      p.categoryId,
      p.notes,
      src.id AS sourceId,
      src.sourceType,
      src.sourceProductNo,
      src.productUrl,
      src.imageUrl,
      src.thumbnailUrl,
      src.isPurchasable,
      (
        SELECT COUNT(*)
        FROM purchase_product_sources sc
        WHERE sc.productId = p.id
      ) AS sourceCount
    FROM products p
    LEFT JOIN purchase_product_sources src
      ON src.id = (
        SELECT s2.id
        FROM purchase_product_sources s2
        WHERE s2.productId = p.id
        ORDER BY s2.isPrimary DESC, s2.isPurchasable DESC, s2.id ASC
        LIMIT 1
      )
    WHERE ${where.join(' AND ')}
    ORDER BY p.productName ASC, p.specification ASC, p.productCode ASC
    LIMIT :limit
    `,
    { replacements, type: QueryTypes.SELECT }
  );

  return rows.map(mapProduct);
}

async function findPrimarySourceId(productId, sourceId = null) {
  if (sourceId) {
    const rows = await global.sequelize.query(
      `
      SELECT id
      FROM purchase_product_sources
      WHERE id = :sourceId
        AND productId = :productId
      LIMIT 1
      `,
      { replacements: { productId, sourceId }, type: QueryTypes.SELECT }
    );
    if (rows[0]?.id) return rows[0].id;
  }

  const rows = await global.sequelize.query(
    `
    SELECT id
    FROM purchase_product_sources
    WHERE productId = :productId
    ORDER BY isPrimary DESC, isPurchasable DESC, id ASC
    LIMIT 1
    `,
    { replacements: { productId }, type: QueryTypes.SELECT }
  );
  return rows[0]?.id || null;
}

async function refreshPurchaseSourceImage(source) {
  if (!source?.sourceId || !source?.productUrl) {
    throw new Error('상품 URL이 없습니다.');
  }

  const imageUrl = await resolveCompuzoneImage(source.productUrl);
  await global.sequelize.query(
    `
    UPDATE purchase_product_sources
    SET imageUrl = :imageUrl,
        thumbnailUrl = :imageUrl,
        imageUpdatedAt = NOW(),
        updatedAt = NOW()
    WHERE id = :sourceId
    `,
    { replacements: { sourceId: source.sourceId, imageUrl } }
  );

  return imageUrl;
}

async function loadSourcesForImageRefresh({ sourceIds = [], productIds = [], categoryIds = [], missingOnly = false, limit = 200 }) {
  const replacements = {
    sourceIds,
    productIds,
    categoryIds,
    limit: Math.max(1, Math.min(parsePositiveInt(limit, 200), 1000)),
  };
  const where = [
    'p.isActive = 1',
    "s.sourceType = 'compuzone'",
    's.productUrl IS NOT NULL',
    "s.productUrl <> ''",
  ];

  if (sourceIds.length) where.push('s.id IN (:sourceIds)');
  else if (productIds.length) where.push('s.productId IN (:productIds)');
  else if (categoryIds.length) where.push('p.categoryId IN (:categoryIds)');

  if (missingOnly) {
    where.push("(s.imageUrl IS NULL OR s.imageUrl = '' OR s.thumbnailUrl IS NULL OR s.thumbnailUrl = '')");
  }

  return global.sequelize.query(
    `
    SELECT
      s.id AS sourceId,
      s.productId,
      s.productUrl,
      p.productName
    FROM purchase_product_sources s
    JOIN products p ON p.id = s.productId
    WHERE ${where.join(' AND ')}
    ORDER BY p.productName ASC, s.isPrimary DESC, s.id ASC
    LIMIT :limit
    `,
    { replacements, type: QueryTypes.SELECT }
  );
}

async function loadCart(userId) {
  const rows = await global.sequelize.query(
    `
    SELECT
      ci.id AS cartItemId,
      ci.quantity,
      p.id,
      p.productCode,
      p.productName,
      p.specification,
      p.unit,
      p.unitPrice,
      p.currentStock,
      p.safetyStock,
      p.categoryId,
      p.notes,
      src.id AS sourceId,
      src.sourceType,
      src.sourceProductNo,
      src.productUrl,
      src.imageUrl,
      src.thumbnailUrl,
      src.isPurchasable,
      (
        SELECT COUNT(*)
        FROM purchase_product_sources sc
        WHERE sc.productId = p.id
      ) AS sourceCount
    FROM purchase_cart_items ci
    JOIN products p ON p.id = ci.productId AND p.isActive = 1
    LEFT JOIN purchase_product_sources src ON src.id = ci.sourceId
    WHERE ci.userId = :userId
    ORDER BY ci.createdAt ASC, ci.id ASC
    `,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );

  const items = rows.map((row) => {
    const product = mapProduct(row);
    const quantity = Number(row.quantity || 0);
    const unitPrice = Number(row.unitPrice || 0);
    return {
      cartItemId: row.cartItemId,
      quantity,
      product,
      subtotal: quantity * unitPrice,
    };
  });

  return {
    items,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    totalAmount: items.reduce((sum, item) => sum + item.subtotal, 0),
  };
}

function splitCartItems(items) {
  const compuzone = [];
  const manual = [];
  const blocked = [];

  for (const item of items) {
    const source = item.product.source || {};
    if (source.type === 'compuzone' && source.productUrl && source.isPurchasable) {
      compuzone.push(item);
    } else if (source.type === 'manual' || !source.type) {
      manual.push(item);
    } else {
      blocked.push(item);
    }
  }

  return { compuzone, manual, blocked };
}

function purchaseTextOfItem(item) {
  const product = item?.product || {};
  return [product.productName, product.specification, product.productCode]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function documentCategoryForItem(item) {
  const text = purchaseTextOfItem(item);
  const consumableMarkers = ['가방', '케이블', '젠더', '더미', '플러그', '마우스', '키보드', '동글', '허브'];
  if (consumableMarkers.some(marker => text.includes(marker))) return '소모품';
  if (text.includes('office') || text.includes('windows') || text.includes('소프트웨어') || text.includes('라이선스')) {
    return '컴퓨터소프트웨어';
  }
  const fixtureMarkers = ['노트북', '아이디어패드', 'thinkpad', '갤럭시북', '그램', 'vivobook', 'zenbook', '데스크탑', '미니 pc', 'pc', '프린터', '복합기', '모니터'];
  if (fixtureMarkers.some(marker => text.includes(marker))) return '집기비품';
  return '소모품';
}

function documentLabelForItems(items) {
  const categories = items.map(documentCategoryForItem);
  if (categories.includes('집기비품')) return '집기비품';
  if (categories.includes('컴퓨터소프트웨어')) return '컴퓨터소프트웨어';
  return '소모품';
}

function purchaseFactory(body) {
  const text = String(body.factory || body.deliveryFactory || body.title || body.memo || '').trim();
  const match = text.match(/\b([DP][0-9])\s*공장\b/i);
  if (match) return `${match[1].toUpperCase()}공장`;
  const corp = String(body.corp || '').replace(/\s+/g, '');
  return corp.includes('정밀') ? 'P3공장' : 'D1공장';
}

function purchaseTitle({ body, compuzoneItems }) {
  const raw = String(body.title || '').trim();
  if (raw) return raw;
  return `전산 ${documentLabelForItems(compuzoneItems)} 구매 건(${purchaseFactory(body)})`;
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function purchaseMemo(body) {
  const factory = purchaseFactory(body);
  const deliveryName = String(body.deliveryName || '').trim();
  const deliveryKeywords = normalizeKeywords(body.deliveryKeywords);
  const businessNumber = String(body.businessNumber || '').trim();
  const businessContactName = String(body.businessContactName || '').trim();
  const userMemo = String(body.memo || '').trim();
  const lines = [factory];
  if (deliveryName) lines.push(`배송지=${deliveryName}`);
  if (deliveryKeywords.length) lines.push(`배송키워드=${deliveryKeywords.join(',')}`);
  if (businessNumber) lines.push(`사업자번호=${businessNumber}`);
  if (businessContactName) lines.push(`사업자담당자=${businessContactName}`);
  if (userMemo) lines.push(userMemo);
  return lines.filter(Boolean).join('\n');
}

function purchaseAutoPayload({ body, compuzoneItems }) {
  return {
    corp: String(body.corp || '').trim(),
    title: purchaseTitle({ body, compuzoneItems }),
    requester: String(body.requester || '').trim(),
    memo: purchaseMemo(body),
    items: compuzoneItems.map((item) => ({
      url: item.product.source.productUrl,
      quantity: item.quantity,
    })),
  };
}


function commandExists(candidate) {
  if (!candidate) return false;
  if (candidate.includes('\\') || candidate.includes('/')) return fs.existsSync(candidate);
  return true;
}

function resolvePurchaseAutoPython() {
  const candidates = [
    process.env.PURCHASE_AUTO_PYTHON,
    'C:\\Users\\user\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
    'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
    'py',
    'python',
  ].filter(Boolean);
  return candidates.find(commandExists) || '';
}

function resolvePurchaseAutoProjectDir() {
  const candidates = [
    process.env.PURCHASE_AUTO_PROJECT_DIR,
    'C:\\Users\\user\\Desktop\\개발파일\\구매, 품의 자동화',
    'C:\\Users\\Administrator\\Desktop\\개발파일\\구매, 품의 자동화',
    'C:\\Purchase_Auto',
    'C:\\PCM-Server\\Purchase_Auto',
    'C:\\Program Files (x86)\\WarehousePOS\\Purchase_Auto',
  ].filter(Boolean);
  return candidates.find(dir => fs.existsSync(path.join(dir, 'purchase_auto', '__main__.py'))) || '';
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function purchaseAutoFetch(pathname, { method = 'GET', body = null, timeoutMs = 5000 } = {}) {
  const startedAt = Date.now();
  appendPurchaseAutoLog('request:start', { method, pathname, timeoutMs, body });
  return new Promise((resolve, reject) => {
    const target = new URL(`${PURCHASE_AUTO_API_BASE_URL}${pathname}`);
    const payload = body ? JSON.stringify(body) : null;
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        timeout: timeoutMs,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            }
          : undefined,
      },
      (response) => {
        const chunks = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let data = {};
          if (raw) {
            try {
              data = JSON.parse(raw);
            } catch (_) {
              data = { raw };
            }
          }
          const responseLike = {
            status: response.statusCode || 0,
            ok: (response.statusCode || 0) >= 200 && (response.statusCode || 0) < 300,
            headers: response.headers || {},
          };
          appendPurchaseAutoLog('request:finish', {
            method,
            pathname,
            status: responseLike.status,
            ok: responseLike.ok,
            elapsedMs: Date.now() - startedAt,
            data,
          });
          resolve({ response: responseLike, data });
        });
      }
    );

    request.on('timeout', () => {
      const err = new Error(`Purchase_Auto request timed out after ${timeoutMs}ms`);
      err.name = 'TimeoutError';
      request.destroy(err);
    });
    request.on('error', (err) => {
      appendPurchaseAutoLog('request:error', {
        method,
        pathname,
        elapsedMs: Date.now() - startedAt,
        error: err.message,
        name: err.name,
        stack: err.stack,
      });
      reject(err);
    });
    if (payload) request.write(payload);
    request.end();
  });
}

async function checkPurchaseAutoHealth() {
  try {
    const { response, data } = await purchaseAutoFetch('/health', { timeoutMs: 2500 });
    return response.ok ? data : null;
  } catch (_) {
    return null;
  }
}

async function waitPurchaseAutoHealth() {
  const deadline = Date.now() + Math.max(5000, PURCHASE_AUTO_START_TIMEOUT_MS || 20000);
  while (Date.now() < deadline) {
    const health = await checkPurchaseAutoHealth();
    if (health?.ok) return health;
    await delay(500);
  }
  return null;
}

function startPurchaseAutoProcess() {
  const projectDir = resolvePurchaseAutoProjectDir();
  if (!projectDir) {
    appendPurchaseAutoLog('process:start-missing-project-dir', {
      envProjectDir: process.env.PURCHASE_AUTO_PROJECT_DIR || '',
    });
    throw new Error('Purchase_Auto 자동 실행 경로를 찾지 못했습니다. 서버에 Purchase_Auto를 설치하거나 PURCHASE_AUTO_PROJECT_DIR 환경변수를 설정하세요.');
  }
  const python = resolvePurchaseAutoPython();
  if (!python) {
    appendPurchaseAutoLog('process:start-missing-python', {
      envPython: process.env.PURCHASE_AUTO_PYTHON || '',
      projectDir,
    });
    throw new Error('Purchase_Auto 실행용 Python을 찾지 못했습니다. PURCHASE_AUTO_PYTHON 환경변수를 설정하세요.');
  }

  const args = python.toLowerCase() === 'py'
    ? ['-3', '-m', 'purchase_auto']
    : ['-m', 'purchase_auto'];
  ensurePurchaseAutoLogDir();
  const stdoutFd = fs.openSync(PURCHASE_AUTO_PROCESS_LOG, 'a');
  const stderrFd = fs.openSync(PURCHASE_AUTO_PROCESS_LOG, 'a');
  const allowExistingBrowserCdp = process.env.PURCHASE_AUTO_ALLOW_EXISTING_BROWSER_CDP === '1' ? '1' : '0';
  const childEnv = {
    ...process.env,
    PURCHASE_AUTO_HOST: process.env.PURCHASE_AUTO_HOST || '127.0.0.1',
    PURCHASE_AUTO_PORT: process.env.PURCHASE_AUTO_PORT || '5008',
    PURCHASE_AUTO_DRY_RUN: process.env.PURCHASE_AUTO_DRY_RUN || '0',
    PURCHASE_AUTO_ENABLE_LIVE_COMPUZONE_ORDER: process.env.PURCHASE_AUTO_ENABLE_LIVE_COMPUZONE_ORDER || '1',
    PURCHASE_AUTO_ENABLE_LIVE_GROUPWARE_SUBMIT: process.env.PURCHASE_AUTO_ENABLE_LIVE_GROUPWARE_SUBMIT || '1',
    PURCHASE_AUTO_ALLOW_EXISTING_BROWSER_CDP: allowExistingBrowserCdp,
  };
  if (allowExistingBrowserCdp !== '1') {
    childEnv.PURCHASE_AUTO_COMPUZONE_CDP_URL = '';
    childEnv.PURCHASE_AUTO_GROUPWARE_CDP_URL = '';
  }
  appendPurchaseAutoLog('process:start', {
    python,
    args,
    projectDir,
    apiBaseUrl: PURCHASE_AUTO_API_BASE_URL,
    processLogPath: PURCHASE_AUTO_PROCESS_LOG,
    env: {
      PURCHASE_AUTO_HOST: childEnv.PURCHASE_AUTO_HOST,
      PURCHASE_AUTO_PORT: childEnv.PURCHASE_AUTO_PORT,
      PURCHASE_AUTO_DRY_RUN: childEnv.PURCHASE_AUTO_DRY_RUN,
      PURCHASE_AUTO_ENABLE_LIVE_COMPUZONE_ORDER: childEnv.PURCHASE_AUTO_ENABLE_LIVE_COMPUZONE_ORDER,
      PURCHASE_AUTO_ENABLE_LIVE_GROUPWARE_SUBMIT: childEnv.PURCHASE_AUTO_ENABLE_LIVE_GROUPWARE_SUBMIT,
      PURCHASE_AUTO_ALLOW_EXISTING_BROWSER_CDP: childEnv.PURCHASE_AUTO_ALLOW_EXISTING_BROWSER_CDP,
      PURCHASE_AUTO_COMPUZONE_CDP_URL: childEnv.PURCHASE_AUTO_COMPUZONE_CDP_URL,
      PURCHASE_AUTO_GROUPWARE_CDP_URL: childEnv.PURCHASE_AUTO_GROUPWARE_CDP_URL,
    },
  });
  const child = spawn(python, args, {
    cwd: projectDir,
    detached: true,
    stdio: ['ignore', stdoutFd, stderrFd],
    windowsHide: true,
    env: childEnv,
  });
  child.on('error', (err) => {
    appendPurchaseAutoLog('process:error', { error: err.message, stack: err.stack });
  });
  child.on('exit', (code, signal) => {
    appendPurchaseAutoLog('process:exit', { pid: child.pid, code, signal });
  });
  appendPurchaseAutoLog('process:started', { pid: child.pid });
  child.unref();
}

async function ensurePurchaseAutoRunning() {
  const current = await checkPurchaseAutoHealth();
  if (current?.ok) {
    appendPurchaseAutoLog('health:already-running', current);
    return current;
  }

  if (!purchaseAutoStartPromise) {
    purchaseAutoStartPromise = (async () => {
      startPurchaseAutoProcess();
      const health = await waitPurchaseAutoHealth();
      if (!health?.ok) {
        appendPurchaseAutoLog('health:start-timeout', { timeoutMs: PURCHASE_AUTO_START_TIMEOUT_MS });
        throw new Error('Purchase_Auto를 자동 실행했지만 health 응답을 받지 못했습니다.');
      }
      appendPurchaseAutoLog('health:started', health);
      return health;
    })().finally(() => {
      purchaseAutoStartPromise = null;
    });
  }
  return purchaseAutoStartPromise;
}

async function purchaseAutoRequest(pathname, { method = 'GET', body = null, autoStart = true, timeoutMs = 5000 } = {}) {
  try {
    return await purchaseAutoFetch(pathname, { method, body, timeoutMs });
  } catch (error) {
    if (!autoStart) throw error;
    appendPurchaseAutoLog('request:retry-after-autostart', {
      method,
      pathname,
      error: error.message,
    });
  }

  await ensurePurchaseAutoRunning();
  return purchaseAutoFetch(pathname, { method, body, timeoutMs });
}

async function purchaseAutoHealth() {
  return checkPurchaseAutoHealth();
}

function purchaseAutoError(data, fallback) {
  return data?.detail || data?.error || fallback;
}

function purchaseAutoErrorDetail(data, fallback) {
  const detail = purchaseAutoError(data, fallback);
  if (detail && typeof detail === 'object') {
    return {
      ...detail,
      message: detail.message || fallback,
    };
  }
  return { message: String(detail || fallback) };
}

function extendPurchaseAutoResponseTimeout(req, res) {
  const timeoutMs = Math.max(PURCHASE_AUTO_STEP_TIMEOUT_MS + 60000, 60000);
  if (typeof req.setTimeout === 'function') req.setTimeout(timeoutMs);
  if (typeof res.setTimeout === 'function') res.setTimeout(timeoutMs);
}

function selectedCompuzoneAccount(value) {
  const account = String(value || '').trim();
  if (['ds1500', 'reum0009'].includes(account)) return account;
  return '';
}

function validatePurchasePayload(payload, body = {}) {
  if (!payload.corp) return '법인/회사 구분을 입력하세요.';
  if (!payload.title) return '품의 제목을 입력하세요.';
  if (!String(body.deliveryName || '').trim()) return '배송지를 선택하세요.';
  if (!String(body.businessNumber || '').trim()) return '사업자번호를 선택하세요.';
  if (!payload.requester) return '요청자를 입력하세요.';
  if (!payload.items.length) return '컴퓨존 자동구매 가능 상품이 없습니다.';
  return null;
}

async function resolveCompuzoneImage(productUrl) {
  if (!isHttpUrl(productUrl)) throw new Error('상품 URL이 올바르지 않습니다.');

  const response = await fetch(productUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!response.ok) throw new Error(`상품 페이지 응답 실패: HTTP ${response.status}`);

  const html = await response.text();
  const candidates = [];
  const metaPatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ];

  for (const pattern of metaPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) candidates.push(match[1]);
  }

  const imageRegex = /(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/ig;
  let match;
  while ((match = imageRegex.exec(html)) && candidates.length < 30) {
    const raw = match[1] || '';
    if (/logo|banner|icon|btn|blank|loading/i.test(raw)) continue;
    if (/product|goods|item|upload|image|img/i.test(raw)) candidates.push(raw);
  }

  for (const candidate of candidates) {
    const absolute = toAbsoluteUrl(candidate, productUrl);
    if (absolute && isHttpUrl(absolute)) return absolute;
  }

  throw new Error('상품 대표 이미지를 찾지 못했습니다.');
}

router.use(auth);

router.get('/diagnostics/logs', roleAuth(WRITE_ROLES), async (req, res) => {
  try {
    const limit = Math.max(20, Math.min(parsePositiveInt(req.query.limit, 200), 500));
    res.json({
      apiBaseUrl: PURCHASE_AUTO_API_BASE_URL,
      health: await purchaseAutoHealth(),
      ...readPurchaseAutoLogs(limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/catalog', roleAuth(WRITE_ROLES), async (req, res) => {
  try {
    await ensureSchema();
    const includeDescendants = String(req.query.includeDescendants ?? '1') !== '0';
    const ids = req.query.categoryId
      ? await categoryIdsFor(req.query.categoryId, includeDescendants)
      : [];
    const products = await loadCatalogProducts({
      categoryIds: ids,
      search: req.query.search || '',
      limit: req.query.limit || 300,
    });
    res.json({ categoryIds: ids, products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', roleAuth(WRITE_ROLES), async (req, res) => {
  try {
    await ensureSchema();
    res.json(await loadCart(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/items', roleAuth(WRITE_ROLES), async (req, res) => {
  try {
    await ensureSchema();
    const productId = parsePositiveInt(req.body.productId);
    const quantity = parsePositiveInt(req.body.quantity, 1);
    if (!productId) return res.status(400).json({ error: '상품을 선택하세요.' });

    const productRows = await global.sequelize.query(
      `SELECT id FROM products WHERE id = :productId AND isActive = 1 LIMIT 1`,
      { replacements: { productId }, type: QueryTypes.SELECT }
    );
    if (!productRows.length) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });

    const sourceId = await findPrimarySourceId(productId, parsePositiveInt(req.body.sourceId));

    await global.sequelize.query(
      `
      INSERT INTO purchase_cart_items (userId, productId, sourceId, quantity, createdAt, updatedAt)
      VALUES (:userId, :productId, :sourceId, :quantity, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        sourceId = VALUES(sourceId),
        quantity = GREATEST(1, quantity + VALUES(quantity)),
        updatedAt = NOW()
      `,
      {
        replacements: {
          userId: req.user.id,
          productId,
          sourceId,
          quantity,
        },
      }
    );

    res.json(await loadCart(req.user.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/items/:id', roleAuth(WRITE_ROLES), async (req, res) => {
  try {
    await ensureSchema();
    const itemId = parsePositiveInt(req.params.id);
    const quantity = parsePositiveInt(req.body.quantity, 0);
    if (!itemId) return res.status(400).json({ error: '장바구니 항목이 올바르지 않습니다.' });

    if (quantity <= 0) {
      await global.sequelize.query(
        `DELETE FROM purchase_cart_items WHERE id = :itemId AND userId = :userId`,
        { replacements: { itemId, userId: req.user.id } }
      );
    } else {
      await global.sequelize.query(
        `
        UPDATE purchase_cart_items
        SET quantity = :quantity, updatedAt = NOW()
        WHERE id = :itemId
          AND userId = :userId
        `,
        { replacements: { itemId, userId: req.user.id, quantity } }
      );
    }

    res.json(await loadCart(req.user.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/items/:id', roleAuth(WRITE_ROLES), async (req, res) => {
  try {
    await ensureSchema();
    const itemId = parsePositiveInt(req.params.id);
    await global.sequelize.query(
      `DELETE FROM purchase_cart_items WHERE id = :itemId AND userId = :userId`,
      { replacements: { itemId, userId: req.user.id } }
    );
    res.json(await loadCart(req.user.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/', roleAuth(WRITE_ROLES), async (req, res) => {
  try {
    await ensureSchema();
    await global.sequelize.query(
      `DELETE FROM purchase_cart_items WHERE userId = :userId`,
      { replacements: { userId: req.user.id } }
    );
    res.json(await loadCart(req.user.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/preview', roleAuth(WRITE_ROLES), async (req, res) => {
  try {
    await ensureSchema();
    const cart = await loadCart(req.user.id);
    const split = splitCartItems(cart.items);
    res.json({
      ...cart,
      split,
      purchaseAutoPayload: purchaseAutoPayload({ body: req.body || {}, compuzoneItems: split.compuzone }),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/checkout', roleAuth(WRITE_ROLES), async (req, res) => {
  try {
    await ensureSchema();
    const cart = await loadCart(req.user.id);
    const split = splitCartItems(cart.items);
    const allowPartial = req.body?.allowPartial === true;

    if (!allowPartial && (split.manual.length || split.blocked.length)) {
      return res.status(409).json({
        error: '컴퓨존 자동구매가 불가능한 항목이 포함되어 있습니다. 수동구매 항목을 분리하거나 제외하세요.',
        split,
      });
    }

    const payload = purchaseAutoPayload({ body: req.body || {}, compuzoneItems: split.compuzone });
    const validationError = validatePurchasePayload(payload, req.body || {});
    if (validationError) return res.status(400).json({ error: validationError, split });

    const { response, data } = await purchaseAutoRequest('/api/purchase-jobs', {
      method: 'POST',
      body: payload,
    });
    if (!response.ok) {
      return res.status(response.status).json({
        error: purchaseAutoError(data, 'Purchase_Auto 구매 작업 생성에 실패했습니다.'),
        purchaseAutoStatus: response.status,
        split,
      });
    }

    res.json({
      purchaseJob: data,
      split,
      payload,
      purchaseAutoHealth: await purchaseAutoHealth(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.post('/jobs/:jobId/run-compuzone-order', roleAuth(WRITE_ROLES), async (req, res) => {
  extendPurchaseAutoResponseTimeout(req, res);
  try {
    const jobId = String(req.params.jobId || '').trim();
    const account = selectedCompuzoneAccount(req.body?.compuzoneAccount || req.body?.compuzone_login_id);
    if (!jobId) return res.status(400).json({ error: '구매 작업 ID가 없습니다.' });
    if (!account) return res.status(400).json({ error: '컴퓨존 구매계정을 선택하세요.' });

    const { response, data } = await purchaseAutoRequest(`/api/purchase-jobs/${encodeURIComponent(jobId)}/run-compuzone-order`, {
      method: 'POST',
      body: { compuzone_login_id: account },
      timeoutMs: PURCHASE_AUTO_STEP_TIMEOUT_MS,
    });
    if (!response.ok) {
      const detail = purchaseAutoErrorDetail(data, '컴퓨존 주문/견적 실행에 실패했습니다.');
      return res.status(response.status).json({
        error: detail.message,
        purchaseAutoError: detail,
        purchaseAutoStatus: response.status,
      });
    }
    res.json({ ...data, purchaseAutoHealth: await purchaseAutoHealth() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/jobs/:jobId/submit-approval', roleAuth(WRITE_ROLES), async (req, res) => {
  extendPurchaseAutoResponseTimeout(req, res);
  try {
    const jobId = String(req.params.jobId || '').trim();
    const loginId = String(req.body?.groupwareLoginId || req.body?.groupware_login_id || '').trim();
    const loginPassword = String(req.body?.groupwareLoginPassword || req.body?.groupware_login_password || '').trim();
    if (!jobId) return res.status(400).json({ error: '구매 작업 ID가 없습니다.' });
    if (!loginId || !loginPassword) return res.status(400).json({ error: '그룹웨어 계정과 비밀번호를 입력하세요.' });

    const { response, data } = await purchaseAutoRequest(`/api/purchase-jobs/${encodeURIComponent(jobId)}/submit-approval`, {
      method: 'POST',
      body: { groupware_login_id: loginId, groupware_login_password: loginPassword },
      timeoutMs: PURCHASE_AUTO_STEP_TIMEOUT_MS,
    });
    if (!response.ok) {
      return res.status(response.status).json({
        error: purchaseAutoError(data, '그룹웨어 품의 상신에 실패했습니다.'),
        purchaseAutoStatus: response.status,
      });
    }
    res.json({ ...data, purchaseAutoHealth: await purchaseAutoHealth() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/images/refresh', roleAuth(WRITE_ROLES), async (req, res) => {
  try {
    await ensureSchema();
    const body = req.body || {};
    const sourceIds = parseIdList(body.sourceIds);
    const productIds = parseIdList(body.productIds);
    const includeDescendants = String(body.includeDescendants ?? '1') !== '0';
    const categoryIds = body.categoryId ? await categoryIdsFor(body.categoryId, includeDescendants) : [];
    const missingOnly = body.missingOnly === true || ['1', 'true', 'Y', 'y'].includes(String(body.missingOnly || ''));

    const sources = await loadSourcesForImageRefresh({
      sourceIds,
      productIds,
      categoryIds,
      missingOnly,
      limit: body.limit || 200,
    });

    const results = [];
    for (const source of sources) {
      try {
        const imageUrl = await refreshPurchaseSourceImage(source);
        results.push({
          sourceId: source.sourceId,
          productId: source.productId,
          productName: source.productName,
          imageUrl,
          ok: true,
        });
      } catch (err) {
        results.push({
          sourceId: source.sourceId,
          productId: source.productId,
          productName: source.productName,
          ok: false,
          error: err.message,
        });
      }
    }

    const updated = results.filter(r => r.ok).length;
    res.json({
      total: sources.length,
      updated,
      failed: results.length - updated,
      missingOnly,
      results,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/products/:productId/refresh-image', roleAuth(WRITE_ROLES), async (req, res) => {
  try {
    await ensureSchema();
    const productId = parsePositiveInt(req.params.productId);
    if (!productId) return res.status(400).json({ error: '상품이 올바르지 않습니다.' });

    const sourceId = await findPrimarySourceId(productId, parsePositiveInt(req.body?.sourceId));
    if (!sourceId) return res.status(404).json({ error: '구매처 정보가 없습니다.' });

    const rows = await global.sequelize.query(
      `
      SELECT id, productUrl
      FROM purchase_product_sources
      WHERE id = :sourceId
        AND productId = :productId
      LIMIT 1
      `,
      { replacements: { sourceId, productId }, type: QueryTypes.SELECT }
    );
    const source = rows[0];
    if (!source?.productUrl) return res.status(400).json({ error: '상품 URL이 없습니다.' });

    const imageUrl = await refreshPurchaseSourceImage({
      sourceId: source.id,
      productId,
      productUrl: source.productUrl,
    });

    res.json({ productId, sourceId, imageUrl });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
