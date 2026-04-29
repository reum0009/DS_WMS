const { query } = require('./backend/config/groupwareDb');

async function analyzeOrgTables() {
  const tables = ['go_dept_members', 'go_departments', 'go_users'];
  try {
    for (const table of tables) {
      console.log(`\n--- Structure of ${table} ---`);
      const cols = await query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [table]);
      cols.rows.forEach(c => {
        console.log(`${c.column_name.padEnd(25)} | ${c.data_type.padEnd(15)} | Nullable: ${c.is_nullable}`);
      });

      // 데이터 샘플도 1건씩 확인
      const sample = await query(`SELECT * FROM ${table} LIMIT 1`);
      console.log(`Sample data from ${table}:`, JSON.stringify(sample.rows[0], null, 2));
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
analyzeOrgTables();