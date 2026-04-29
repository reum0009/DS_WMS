const { query } = require('./backend/config/groupwareDb');

async function run() {
  try {
    // Applet 22에 등록된 문서들의 모든 필드 값(values_key)과 실제 값들을 샘플로 가져옴
    const res = await query(`
      SELECT adv.values_key, v.string_value, count(*) as cnt
      FROM go_applet_docs d
      JOIN go_applet_doc_values adv ON d.id = adv.applet_doc_id
      JOIN go_applet_vals v ON adv.value_id = v.id
      WHERE d.applet_id = 22 AND v.type = 'STRING'
      GROUP BY adv.values_key, v.string_value
      ORDER BY adv.values_key, cnt DESC
      LIMIT 100
    `);
    
    console.log("Applet 22 String Values:");
    const map = {};
    res.rows.forEach(r => {
      if (!map[r.values_key]) map[r.values_key] = [];
      map[r.values_key].push(r.string_value);
    });
    
    for (const [k, v] of Object.entries(map)) {
      console.log(`Key: ${k} => `, v.slice(0, 5).join(', '));
      if (v.some(val => val && (val.includes('평택') || val.includes('김제')))) {
        console.log(`\n★★★ FOUND REGION FIELD: ${k} ★★★\n`);
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();