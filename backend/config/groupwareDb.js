const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const pool = new Pool({
  host:     process.env.GW_DB_HOST || '35.216.85.162',
  port:     process.env.GW_DB_PORT || 5432,
  database: process.env.GW_DB_NAME || 'do',
  user:     process.env.GW_DB_USER || 'daeseung',
  password: process.env.GW_DB_PASS || 'daeseung@3$',
  ssl: false,
  // Ensure timestamp text format is ISO so node-postgres can parse consistently.
  options: '-c DateStyle=ISO,YMD'
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
