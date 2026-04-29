const { query } = require('./backend/config/groupwareDb');

async function run() {
  try {
    // 1. Find all doc IDs containing '평택' or '김제'
    const res = await query(`
      SELECT adv.applet_doc_id, adv.values_key, v.string_value, d.applet_id
      FROM go_applet_doc_values adv
      JOIN go_applet_vals v ON adv.value_id = v.id
      JOIN go_applet_docs d ON adv.applet_doc_id = d.id
      WHERE v.type = 'STRING' AND (v.string_value LIKE '%평택%' OR v.string_value LIKE '%김제%')
    `);
    
    console.log(`Found ${res.rows.length} records matching '평택' or '김제'.`);
    
    const appletMap = {};
    for (const r of res.rows) {
      if (!appletMap[r.applet_id]) appletMap[r.applet_id] = new Set();
      appletMap[r.applet_id].add(r.values_key);
    }
    
    console.log("\nApplet IDs containing the regions and their field keys:");
    for (const [appletId, keys] of Object.entries(appletMap)) {
      console.log(`Applet ID: ${appletId}, Field Keys: ${Array.from(keys).join(', ')}`);
    }

  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();