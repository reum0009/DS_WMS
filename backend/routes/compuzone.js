const express = require('express');
const { QueryTypes } = require('sequelize');
const { auth, roleAuth } = require('../middleware/auth');

const router = express.Router();

const IT_DEPT_ID = Number(process.env.COMPUZONE_WMS_DEPT_ID || 22);
const AUTO_NOTE = '컴퓨존 구매이력 기반 자동 생성';
const BACKUP_TABLES = [
  'products',
  'item_codes',
  'product_warehouse_stocks',
  'compuzone_wms_product_map',
];

const RESERVED_BARCODES = new Set(['W99998', 'W99999']);

function qi(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

async function tableExists(tableName, transaction) {
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

async function backupTables(transaction) {
  const suffix = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);

  const created = [];

  for (const table of BACKUP_TABLES) {
    if (!(await tableExists(table, transaction))) continue;

    const backupName = `${table}_bak_${suffix}`;
    await global.sequelize.query(
      `CREATE TABLE ${qi(backupName)} LIKE ${qi(table)}`,
      { transaction }
    );
    await global.sequelize.query(
      `INSERT INTO ${qi(backupName)} SELECT * FROM ${qi(table)}`,
      { transaction }
    );
    created.push(backupName);
  }

  return created;
}

async function loadCandidates(transaction) {
  return global.sequelize.query(
    `
    SELECT
      p.product_uid,
      p.product_no,
      p.item_name,
      p.model_name,
      p.raw_name,
      m.target_category_id,
      m.target_category_path,
      COALESCE(SUM(l.quantity), 0) AS purchase_quantity,
      ROUND(
        SUM(CASE WHEN l.unit_price IS NOT NULL THEN l.unit_price * l.quantity ELSE 0 END)
        / NULLIF(SUM(CASE WHEN l.unit_price IS NOT NULL THEN l.quantity ELSE 0 END), 0)
      ) AS average_unit_price
    FROM compuzone_products p
    JOIN compuzone_wms_product_map m ON m.product_uid = p.product_uid
    LEFT JOIN compuzone_order_lines l ON l.product_uid = p.product_uid
    WHERE m.stock_policy = 'stock'
      AND m.mapping_status = 'new_candidate'
      AND m.suggested_wms_product_id IS NULL
      AND m.target_category_id IS NOT NULL
    GROUP BY
      p.product_uid,
      p.product_no,
      p.item_name,
      p.model_name,
      p.raw_name,
      m.target_category_id,
      m.target_category_path
    ORDER BY m.target_category_path, p.item_name, p.model_name, p.product_no
    `,
    { type: QueryTypes.SELECT, transaction }
  );
}

async function loadSummary() {
  const statuses = await global.sequelize.query(
    `
    SELECT stock_policy, mapping_status, COUNT(*) AS count
    FROM compuzone_wms_product_map
    GROUP BY stock_policy, mapping_status
    ORDER BY stock_policy, mapping_status
    `,
    { type: QueryTypes.SELECT }
  );

  const candidates = await global.sequelize.query(
    `
    SELECT
      p.product_no,
      p.item_name,
      p.model_name,
      p.raw_name,
      m.target_category_path
    FROM compuzone_products p
    JOIN compuzone_wms_product_map m ON m.product_uid = p.product_uid
    WHERE m.stock_policy = 'stock'
      AND m.mapping_status = 'new_candidate'
      AND m.suggested_wms_product_id IS NULL
    ORDER BY m.target_category_path, p.item_name, p.model_name
    LIMIT 50
    `,
    { type: QueryTypes.SELECT }
  );

  return { statuses, candidates };
}

function groupCandidates(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const key = [
      row.target_category_id,
      String(row.item_name || '').trim(),
      String(row.model_name || '').trim(),
    ].join('|');

    if (!grouped.has(key)) {
      grouped.set(key, {
        categoryId: Number(row.target_category_id),
        itemName: String(row.item_name || '').trim(),
        modelName: String(row.model_name || '').trim(),
        rows: [],
      });
    }

    grouped.get(key).rows.push(row);
  }

  return Array.from(grouped.values());
}

async function maxProductSeq(transaction) {
  const rows = await global.sequelize.query(
    `
    SELECT COALESCE(MAX(CAST(SUBSTRING(productCode, 5) AS UNSIGNED)), 0) AS seq
    FROM products
    WHERE productCode REGEXP '^ITM-[0-9]+$'
    `,
    { type: QueryTypes.SELECT, transaction }
  );
  return Number(rows[0]?.seq || 0);
}

async function maxBarcodeSeq(transaction) {
  const rows = await global.sequelize.query(
    `
    SELECT COALESCE(MAX(CAST(SUBSTRING(codeValue, 2) AS UNSIGNED)), 0) AS seq
    FROM item_codes
    WHERE codeType = 'barcode'
      AND codeValue REGEXP '^W[0-9]{5}$'
      AND codeValue NOT IN ('W99998', 'W99999')
    `,
    { type: QueryTypes.SELECT, transaction }
  );
  return Number(rows[0]?.seq || 0);
}

async function makeProductCodes(count, transaction) {
  const start = await maxProductSeq(transaction);
  return Array.from({ length: count }, (_, i) => `ITM-${String(start + i + 1).padStart(6, '0')}`);
}

async function makeBarcodes(count, transaction) {
  let seq = await maxBarcodeSeq(transaction);
  const barcodes = [];

  while (barcodes.length < count) {
    seq += 1;
    const code = `W${String(seq).padStart(5, '0')}`;
    if (RESERVED_BARCODES.has(code)) continue;
    barcodes.push(code);
  }

  return barcodes;
}

async function findExistingProduct({ itemName, modelName, categoryId }, transaction) {
  const rows = await global.sequelize.query(
    `
    SELECT id
    FROM products
    WHERE isActive = 1
      AND productName = :itemName
      AND COALESCE(specification, '') = :modelName
      AND categoryId = :categoryId
      AND unit = '개'
    ORDER BY id
    LIMIT 1
    `,
    {
      replacements: { itemName, modelName, categoryId },
      type: QueryTypes.SELECT,
      transaction,
    }
  );

  return rows[0]?.id || null;
}

async function insertItemCode({ productId, codeType, codeValue, notes }, transaction) {
  if (!codeValue) return 0;

  const [, meta] = await global.sequelize.query(
    `
    INSERT INTO item_codes (itemId, codeType, codeValue, supplierId, notes, createdAt, updatedAt)
    SELECT :productId, :codeType, :codeValue, NULL, :notes, NOW(), NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM item_codes WHERE codeValue = :codeValue
    )
    `,
    {
      replacements: {
        productId,
        codeType,
        codeValue,
        notes: notes ? String(notes).slice(0, 250) : null,
      },
      transaction,
    }
  );

  return meta?.affectedRows || 0;
}

async function ensureWarehouseRows({ productId, categoryId }, transaction) {
  const warehouses = await global.sequelize.query(
    `
    SELECT id
    FROM warehouses
    WHERE isActive = 1
      AND deptId = :deptId
    ORDER BY id
    `,
    {
      replacements: { deptId: IT_DEPT_ID },
      type: QueryTypes.SELECT,
      transaction,
    }
  );

  const categorySafetyRows = await global.sequelize.query(
    `
    SELECT id, safetyStock
    FROM categories
    WHERE id = :categoryId
    `,
    {
      replacements: { categoryId },
      type: QueryTypes.SELECT,
      transaction,
    }
  );

  const defaultSafety = Number(categorySafetyRows[0]?.safetyStock || 0);
  let inserted = 0;

  for (const warehouse of warehouses) {
    const whSafetyRows = await global.sequelize.query(
      `
      SELECT safetyStock
      FROM category_warehouse_stocks
      WHERE categoryId = :categoryId
        AND warehouseId = :warehouseId
      LIMIT 1
      `,
      {
        replacements: { categoryId, warehouseId: warehouse.id },
        type: QueryTypes.SELECT,
        transaction,
      }
    );

    const safetyStock = Number(whSafetyRows[0]?.safetyStock ?? defaultSafety);

    const [, meta] = await global.sequelize.query(
      `
      INSERT INTO product_warehouse_stocks (
        productId,
        warehouseId,
        currentStock,
        safetyStock,
        safetyStockMode,
        manualSafetyStock,
        autoSafetyStock,
        leadTimeDays,
        serviceLevel,
        zValue,
        createdAt,
        updatedAt
      )
      SELECT
        :productId,
        :warehouseId,
        0,
        :safetyStock,
        'manual',
        :safetyStock,
        0,
        3,
        95.00,
        1.650,
        NOW(),
        NOW()
      WHERE NOT EXISTS (
        SELECT 1
        FROM product_warehouse_stocks
        WHERE productId = :productId
          AND warehouseId = :warehouseId
      )
      `,
      {
        replacements: {
          productId,
          warehouseId: warehouse.id,
          safetyStock,
        },
        transaction,
      }
    );

    inserted += meta?.affectedRows || 0;
  }

  return inserted;
}

function weightedUnitPrice(rows) {
  let qtySum = 0;
  let amountSum = 0;
  let fallback = 0;

  for (const row of rows) {
    const qty = Number(row.purchase_quantity || 0);
    const avg = Number(row.average_unit_price || 0);

    if (avg > 0) fallback = Math.max(fallback, avg);
    if (qty > 0 && avg > 0) {
      qtySum += qty;
      amountSum += qty * avg;
    }
  }

  if (qtySum > 0) return Math.round(amountSum / qtySum);
  return Math.round(fallback);
}

router.get('/summary', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  try {
    res.json(await loadSummary());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/import-products', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const transaction = await global.sequelize.transaction();

  try {
    const dryRun = req.body?.dryRun === true;
    const backupTables = dryRun ? [] : await backupTables(transaction);
    const candidates = await loadCandidates(transaction);
    const groups = groupCandidates(candidates);
    const productCodes = await makeProductCodes(groups.length, transaction);
    const barcodes = await makeBarcodes(groups.length, transaction);

    const counts = {
      candidateRows: candidates.length,
      productGroups: groups.length,
      createdProducts: 0,
      reusedProducts: 0,
      barcodeCodes: 0,
      vendorCodes: 0,
      warehouseRows: 0,
      mappedRows: 0,
    };

    let codeIndex = 0;
    let barcodeIndex = 0;

    for (const group of groups) {
      let productId = await findExistingProduct(group, transaction);
      let barcode = null;

      if (productId) {
        counts.reusedProducts += 1;
      } else {
        const productCode = productCodes[codeIndex++];
        barcode = barcodes[barcodeIndex++];
        const unitPrice = weightedUnitPrice(group.rows);

        const categoryRows = await global.sequelize.query(
          `SELECT safetyStock FROM categories WHERE id = :categoryId LIMIT 1`,
          {
            replacements: { categoryId: group.categoryId },
            type: QueryTypes.SELECT,
            transaction,
          }
        );

        const safetyStock = Number(categoryRows[0]?.safetyStock || 0);

        const [, meta] = await global.sequelize.query(
          `
          INSERT INTO products (
            productCode,
            productName,
            specification,
            category,
            categoryId,
            barcode,
            unit,
            unitPrice,
            currentStock,
            safetyStock,
            warehouseId,
            description,
            notes,
            isActive,
            isDraft,
            createdAt,
            updatedAt
          )
          VALUES (
            :productCode,
            :productName,
            :specification,
            'office',
            :categoryId,
            :barcode,
            '개',
            :unitPrice,
            0,
            :safetyStock,
            NULL,
            NULL,
            :notes,
            1,
            0,
            NOW(),
            NOW()
          )
          `,
          {
            replacements: {
              productCode,
              productName: group.itemName,
              specification: group.modelName || null,
              categoryId: group.categoryId,
              barcode,
              unitPrice,
              safetyStock,
              notes: AUTO_NOTE,
            },
            transaction,
          }
        );

        productId = meta?.insertId;
        counts.createdProducts += 1;
        counts.barcodeCodes += await insertItemCode({
          productId,
          codeType: 'barcode',
          codeValue: barcode,
          notes: 'WMS 자동 생성 바코드',
        }, transaction);
      }

      counts.warehouseRows += await ensureWarehouseRows({
        productId,
        categoryId: group.categoryId,
      }, transaction);

      for (const row of group.rows) {
        if (row.product_no) {
          counts.vendorCodes += await insertItemCode({
            productId,
            codeType: 'vendor',
            codeValue: `COMPUZONE:${row.product_no}`,
            notes: row.raw_name,
          }, transaction);
        }

        const [, meta] = await global.sequelize.query(
          `
          UPDATE compuzone_wms_product_map
          SET suggested_wms_product_id = :productId,
              mapping_status = 'imported',
              mapping_confidence = GREATEST(COALESCE(mapping_confidence, 0), 0.950),
              mapping_reason = 'WMS 품목 생성/연결 완료',
              mapping_source = 'wms_api_import',
              reviewed_by = :reviewedBy,
              reviewed_at = NOW()
          WHERE product_uid = :productUid
            AND suggested_wms_product_id IS NULL
          `,
          {
            replacements: {
              productId,
              productUid: row.product_uid,
              reviewedBy: String(req.user?.id || req.user?.email || 'system'),
            },
            transaction,
          }
        );

        counts.mappedRows += meta?.affectedRows || 0;
      }
    }

    if (dryRun) {
      await transaction.rollback();
      return res.json({ dryRun: true, backupTables: [], counts });
    }

    await transaction.commit();
    res.json({ ok: true, backupTables, counts });
  } catch (err) {
    await transaction.rollback();
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
