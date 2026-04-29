const { query } = require('./backend/config/groupwareDb');

async function run() {
  try {
    const res = await query(`
      SELECT adv.applet_doc_id, adv.values_key, v.string_value
      FROM go_applet_doc_values adv
      JOIN go_applet_vals v ON adv.value_id = v.id
      WHERE v.type = 'STRING' AND (v.string_value LIKE '%평택%' OR v.string_value LIKE '%김제%')
      LIMIT 10
    `);
    
    if (res.rows.length > 0) {
      console.log("Found regions in the following Applet Docs:");
      for (const r of res.rows) {
        console.log(`Doc ID: ${r.applet_doc_id}, Key: ${r.values_key}, Value: ${r.string_value}`);
      }
    } else {
      console.log("No regions found across ANY applet doc values.");
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();