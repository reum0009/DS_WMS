const express = require('express');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();
const ENV_PATH = path.join(__dirname, '..', '.env');

const DB_KEYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];

function parseEnv(text) {
  const env = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    env[line.slice(0, idx).trim()] = line.slice(idx + 1);
  }
  return env;
}

function readEnv() {
  const text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  return { text, env: parseEnv(text) };
}

function publicConfig(env) {
  return {
    host: env.DB_HOST || process.env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || process.env.DB_PORT || 3306),
    database: env.DB_NAME || process.env.DB_NAME || 'warehouse_pos',
    user: env.DB_USER || process.env.DB_USER || 'root',
    hasPassword: Boolean(env.DB_PASSWORD || process.env.DB_PASSWORD),
  };
}

function normalizeConfig(body, fallback = {}) {
  const cfg = {
    host: String(body.host ?? fallback.host ?? '').trim(),
    port: Number(body.port ?? fallback.port ?? 3306),
    database: String(body.database ?? fallback.database ?? '').trim(),
    user: String(body.user ?? fallback.user ?? '').trim(),
    password: body.password === undefined || body.password === ''
      ? fallback.password
      : String(body.password),
  };

  if (!cfg.host) throw new Error('DB 호스트를 입력하세요.');
  if (!Number.isInteger(cfg.port) || cfg.port <= 0 || cfg.port > 65535) {
    throw new Error('DB 포트가 올바르지 않습니다.');
  }
  if (!cfg.database) throw new Error('DB 이름을 입력하세요.');
  if (!cfg.user) throw new Error('DB 사용자를 입력하세요.');
  return cfg;
}

async function testConnection(cfg) {
  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password || '',
    database: cfg.database,
    connectTimeout: 5000,
    charset: 'utf8mb4',
  });

  try {
    const [versionRows] = await conn.query('SELECT VERSION() AS version');
    const [tableRows] = await conn.query(
      `SELECT COUNT(*) AS count
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?`,
      [cfg.database]
    );
    const [mappingRows] = await conn.query(
      `SELECT COUNT(*) AS count
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = 'gw_product_mappings'`,
      [cfg.database]
    );
    return {
      ok: true,
      version: versionRows?.[0]?.version || '',
      tableCount: Number(tableRows?.[0]?.count || 0),
      hasGwMappingTable: Number(mappingRows?.[0]?.count || 0) > 0,
    };
  } finally {
    await conn.end();
  }
}

function updateEnvText(text, cfg) {
  const values = {
    DB_HOST: cfg.host,
    DB_PORT: String(cfg.port),
    DB_NAME: cfg.database,
    DB_USER: cfg.user,
    DB_PASSWORD: cfg.password || '',
  };
  const seen = new Set();
  const lines = String(text || '').split(/\r?\n/).map((line) => {
    const idx = line.indexOf('=');
    if (idx < 0) return line;
    const key = line.slice(0, idx).trim();
    if (!DB_KEYS.includes(key)) return line;
    seen.add(key);
    return `${key}=${values[key]}`;
  });

  for (const key of DB_KEYS) {
    if (!seen.has(key)) lines.push(`${key}=${values[key]}`);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

router.get('/db-config', auth, adminOnly, (req, res) => {
  const { env } = readEnv();
  res.json({
    config: publicConfig(env),
    currentProcess: publicConfig(process.env),
    envPath: ENV_PATH,
    requiresRestartToApply: true,
  });
});

router.post('/db-config/test', auth, adminOnly, async (req, res) => {
  try {
    const { env } = readEnv();
    const fallback = {
      host: env.DB_HOST,
      port: Number(env.DB_PORT || 3306),
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
    };
    const cfg = normalizeConfig(req.body || {}, fallback);
    const result = await testConnection(cfg);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.put('/db-config', auth, adminOnly, async (req, res) => {
  try {
    const { text, env } = readEnv();
    const fallback = {
      host: env.DB_HOST,
      port: Number(env.DB_PORT || 3306),
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
    };
    const cfg = normalizeConfig(req.body || {}, fallback);
    const test = await testConnection(cfg);

    fs.writeFileSync(ENV_PATH, updateEnvText(text, cfg), 'utf8');

    res.json({
      ok: true,
      test,
      config: publicConfig({
        DB_HOST: cfg.host,
        DB_PORT: cfg.port,
        DB_NAME: cfg.database,
        DB_USER: cfg.user,
        DB_PASSWORD: cfg.password,
      }),
      message: 'DB 설정을 저장했습니다. 백엔드 재시작 후 적용됩니다.',
      requiresRestartToApply: true,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
