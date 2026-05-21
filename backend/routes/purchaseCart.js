const express = require('express');
const { QueryTypes } = require('sequelize');
const { auth, roleAuth } = require('../middleware/auth');

const router = express.Router();

const PURCHASE_AUTO_API_BASE_URL = String(process.env.PURCHASE_AUTO_API_BASE_URL || 'http://127.0.0.1:5008').replace(/\/+$/, '');
const COMPUZONE_PRODUCT_BASE_URL = 'https://www.compuzone.co.kr/product/product_detail.htm?ProductNo=';
const WRITE_ROLES = ['admin', 'dept_admin'];

let schemaReady = false;

function parsePositiveInt(value, fallback = null) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
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

function purchaseAutoPayload({ body, compuzoneItems }) {
  return {
    corp: String(body.corp || '').trim(),
    title: String(body.title || '').trim(),
    requester: String(body.requester || '').trim(),
    memo: String(body.memo || '').trim(),
    items: compuzoneItems.map((item) => ({
      url: item.product.source.productUrl,
      quantity: item.quantity,
    })),
  };
}

function validatePurchasePayload(payload) {
  if (!payload.corp) return '법인/회사 구분을 입력하세요.';
  if (!payload.title) return '품의 제목을 입력하세요.';
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
    const validationError = validatePurchasePayload(payload);
    if (validationError) return res.status(400).json({ error: validationError, split });

    const response = await fetch(`${PURCHASE_AUTO_API_BASE_URL}/api/purchase-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.detail || data?.error || 'Purchase_Auto 구매 작업 생성에 실패했습니다.',
        purchaseAutoStatus: response.status,
        split,
      });
    }

    res.json({
      purchaseJob: data,
      sentTo: PURCHASE_AUTO_API_BASE_URL,
      split,
      payload,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      { replacements: { sourceId, imageUrl } }
    );

    res.json({ productId, sourceId, imageUrl });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
