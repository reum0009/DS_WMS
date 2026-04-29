const cron = require('node-cron');
const { query: gwQuery } = require('../config/groupwareDb');
const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

// 로컬 DB 연결 설정 (server.js와 동일한 설정 권장)
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mysql',
    logging: false
  }
);

// 모델 다시 정의 (스크립트 독립 실행용)
const GwDepartment = sequelize.define('GwDepartment', {
  id: { type: Sequelize.BIGINT, primaryKey: true },
  name: { type: Sequelize.STRING, allowNull: false },
  parentId: { type: Sequelize.BIGINT },
  path: { type: Sequelize.STRING }
}, { tableName: 'gw_departments' });

const GwUser = sequelize.define('GwUser', {
  id: { type: Sequelize.BIGINT, primaryKey: true },
  name: { type: Sequelize.STRING, allowNull: false },
  empNo: { type: Sequelize.STRING },
  loginId: { type: Sequelize.STRING },
  deptId: { type: Sequelize.BIGINT },
  deptName: { type: Sequelize.STRING },
  positionName: { type: Sequelize.STRING },
  status: { type: Sequelize.STRING }
}, { tableName: 'gw_users' });

async function sync() {
  console.log('--- Starting GW Org Sync ---');
  try {
    await sequelize.authenticate();
    
    // 테이블 생성 (없을 경우)
    await sequelize.sync({ alter: true });
    
    // 1. 부서 동기화
    console.log('Syncing Departments...');
    const depts = await gwQuery(`SELECT id, name, parent_id, path FROM go_departments WHERE deleted_at IS NULL`);
    for (const d of depts.rows) {
      await GwDepartment.upsert({
        id: d.id,
        name: d.name,
        parentId: d.parent_id,
        path: d.path
      });
    }
    console.log(`Synced ${depts.rows.length} departments.`);

    // 2. 사용자 동기화 (복합 조인)
    console.log('Syncing Users...');
    const users = await gwQuery(`
      SELECT 
          u.id, u.name, u.employee_number, u.login_id, u.status,
          d.id AS dept_id, d.name AS dept_name,
          pos.ko_name AS position_name
      FROM go_users u
      LEFT JOIN go_dept_members m ON u.id = m.user_id AND m.user_department_order = 1
      LEFT JOIN go_departments d ON m.department_id = d.id
      LEFT JOIN go_user_profiles p ON u.user_profile_id = p.id
      LEFT JOIN go_domain_codes pos ON p.position_id = pos.id AND pos.code_type = 'POSITION'
      WHERE u.status != 'DELETE' AND u.deleted_at IS NULL
    `);

    for (const u of users.rows) {
      await GwUser.upsert({
        id: u.id,
        name: u.name,
        empNo: u.employee_number,
        loginId: u.login_id,
        deptId: u.dept_id,
        deptName: u.dept_name,
        positionName: u.position_name,
        status: u.status
      });
    }
    console.log(`Synced ${users.rows.length} users.`);

    console.log('--- GW Org Sync Completed Successfully ---');
  } catch (e) {
    console.error('Sync failed:', e);
  } finally {
    await sequelize.close();
    process.exit(0);
  }
}

sync();