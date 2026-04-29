const { query } = require('./backend/config/groupwareDb');

async function analyzeOrgTablesV2() {
  const tables = ['go_user_profiles', 'go_domain_codes'];
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

      const sample = await query(`SELECT * FROM ${table} LIMIT 1`);
      console.log(`Sample data from ${table}:`, JSON.stringify(sample.rows[0], null, 2));
    }
    
    // 연계성 확인을 위한 쿼리
    console.log("\n--- Checking potential joins ---");
    const joins = await query(`
        SELECT u.id, u.name, p.position_id, p.grade_id, p.duty_id
        FROM go_users u
        LEFT JOIN go_user_profiles p ON u.user_profile_id = p.id
        LIMIT 5
    `);
    console.log("Users to Profiles Join Sample:", JSON.stringify(joins.rows, null, 2));

  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
analyzeOrgTablesV2();