const { query } = require('./backend/config/groupwareDb');

async function run() {
  try {
    // 1. 컬럼명 확인 및 8509번 필드 찾기
    const cols = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'go_applet_fields'
    `);
    console.log("Available columns in go_applet_fields:", cols.rows.map(c => c.column_name).join(', '));

    // 2. 8509번 필드 상세 조회 (컬럼명을 추측하여 조회)
    const fieldRes = await query(`
      SELECT * FROM go_applet_fields WHERE id = 8509
    `);
    console.log("Field 8509 Data:", JSON.stringify(fieldRes.rows, null, 2));

  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();