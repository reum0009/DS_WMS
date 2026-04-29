const { query } = require('./backend/config/groupwareDb');
async function run() {
  try {
    const r = await query("SELECT * FROM go_applet_fields WHERE form_id = 22");
    console.log(JSON.stringify(r.rows, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
run();
