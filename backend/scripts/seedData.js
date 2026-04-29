const { Sequelize } = require('sequelize');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME || 'warehouse_pos',
  process.env.DB_USER || 'root',
  process.env.DB_PASSWORD || '',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: false
  }
);

// User 모델 정의
const User = sequelize.define('User', {
  id: {
    type: Sequelize.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  email: {
    type: Sequelize.STRING,
    unique: true,
    allowNull: false,
    validate: {
      isEmail: true
    }
  },
  password: {
    type: Sequelize.STRING,
    allowNull: false
  },
  name: {
    type: Sequelize.STRING,
    allowNull: false
  },
  role: {
    type: Sequelize.ENUM('applicant', 'approver', 'releaser', 'admin', 'warehouse'),
    defaultValue: 'warehouse',
    allowNull: false
  }
}, {
  timestamps: true,
  tableName: 'users'
});

const seedData = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ 데이터베이스 연결 성공');

    const demoUsers = [
      {
        email: 'admin@warehouse.com',
        password: 'admin123',
        name: '관리자',
        role: 'admin'
      },
      {
        email: 'applicant@warehouse.com',
        password: 'app123',
        name: '신청자',
        role: 'applicant'
      },
      {
        email: 'warehouse@warehouse.com',
        password: 'warehouse123',
        name: '창고담당자',
        role: 'warehouse'
      }
    ];

    // 기존 사용자 초기화 (선택사항 - 주석 처리됨)
    // await User.destroy({ where: {} });

    // 각 사용자 생성 또는 업데이트
    for (const userData of demoUsers) {
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      
      const [user, created] = await User.findOrCreate({
        where: { email: userData.email },
        defaults: {
          ...userData,
          password: hashedPassword
        }
      });

      if (created) {
        console.log(`✅ 생성됨: ${userData.email} (${userData.name})`);
      } else {
        console.log(`⏭️  이미 존재: ${userData.email}`);
      }
    }

    console.log('\n✨ 시드 데이터 초기화 완료!');
    console.log('\n📝 테스트 계정 정보:');
    console.log('1. admin@warehouse.com / admin123 (관리자)');
    console.log('2. applicant@warehouse.com / app123 (신청자)');
    console.log('3. warehouse@warehouse.com / warehouse123 (창고담당자)');

    process.exit(0);
  } catch (err) {
    console.error('❌ 오류:', err.message);
    process.exit(1);
  }
};

seedData();
