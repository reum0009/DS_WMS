const { query } = require('./backend/config/groupwareDb');

async function run() {
  try {
    // 1. 8509번 필드의 cid(values_key) 찾기
    const fieldRes = await query(`
      SELECT id, cid, name, type 
      FROM go_applet_fields 
      WHERE id = 8509 OR (applet_id = 22 AND name LIKE '%구분%')
    `);
    console.log("Field Info:", JSON.stringify(fieldRes.rows, null, 2));

    if (fieldRes.rows.length > 0) {
      const targetKey = fieldRes.rows[0].cid;
      // 2. 해당 키값으로 저장된 실제 데이터 샘플 확인
      const valRes = await query(`
        SELECT v.string_value, v.long_value, v.type, count(*) as cnt
        FROM go_applet_doc_values adv
        JOIN go_applet_vals v ON adv.value_id = v.id
        WHERE adv.values_key = $1
        GROUP BY v.string_value, v.long_value, v.type
      `, [targetKey]);
      console.log(`\nActual Values for Key (${targetKey}):`, JSON.stringify(valRes.rows, null, 2));
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();