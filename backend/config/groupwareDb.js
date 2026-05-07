const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const DEFAULT_GW_CONFIG = {
  host: '35.216.85.162',
  port: 5432,
  database: 'do',
  user: 'daeseung',
  password: 'daeseung@3$',
};

function buildConfig(overrides = {}) {
  return {
    ...DEFAULT_GW_CONFIG,
    ...overrides,
    port: parseInt(overrides.port || DEFAULT_GW_CONFIG.port, 10),
  };
}

const configured = buildConfig({
  host: process.env.GW_DB_HOST || DEFAULT_GW_CONFIG.host,
  port: process.env.GW_DB_PORT || DEFAULT_GW_CONFIG.port,
  database: process.env.GW_DB_NAME || DEFAULT_GW_CONFIG.database,
  user: process.env.GW_DB_USER || DEFAULT_GW_CONFIG.user,
  password: process.env.GW_DB_PASS || DEFAULT_GW_CONFIG.password,
});

const fallback = buildConfig();

const poolConfigs = [configured];
if (
  configured.host !== fallback.host ||
  configured.port !== fallback.port ||
  configured.database !== fallback.database ||
  configured.user !== fallback.user
) {
  poolConfigs.push(fallback);
}

function createPool(config) {
  return new Pool({
    ...config,
    ssl: false,
    connectionTimeoutMillis: parseInt(process.env.GW_DB_CONNECT_TIMEOUT_MS || '20000', 10),
    idleTimeoutMillis: 30000,
    max: 5,
    // Ensure timestamp text format is ISO so node-postgres can parse consistently.
    options: '-c DateStyle=ISO,YMD'
  });
}

const pools = poolConfigs.map(config => ({
  config,
  pool: createPool(config),
}));

async function query(text, params) {
  let lastError = null;

  for (const candidate of pools) {
    try {
      return await candidate.pool.query(text, params);
    } catch (err) {
      lastError = err;
      console.error(
        `[GW DB] query failed via ${candidate.config.host}:${candidate.config.port}/${candidate.config.database} (${err.code || err.message})`
      );
    }
  }

  throw lastError;
}

function getConnectionInfo() {
  return poolConfigs.map(config => ({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
  }));
}

const pool = pools[0].pool;

module.exports = {
  query,
  pool,
  getConnectionInfo,
};
