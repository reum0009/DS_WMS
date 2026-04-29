const { query } = require('./backend/config/groupwareDb');

async function run() {
  try {
    const res = await query(`
      SELECT adv.values_key, v.string_value
      FROM go_applet_docs d
      JOIN go_applet_doc_values adv ON d.id = adv.applet_doc_id
      JOIN go_applet_vals v ON adv.value_id = v.id
      WHERE d.applet_id = 22 AND v.type = 'STRING'
    `);
    
    let found = false;
    res.rows.forEach(r => {
      if (r.string_value && (r.string_value.includes('평택') || r.string_value.includes('김제'))) {
        console.log(`★★★ FOUND REGION FIELD: ${r.values_key} => ${r.string_value} ★★★`);
        found = true;
      }
    });
    
    if (!found) console.log("No region field found in Applet 22 string values.");
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();