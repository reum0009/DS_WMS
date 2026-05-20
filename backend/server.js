const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { Sequelize } = require('sequelize');
const cors = require('cors');
const dotenv = require('dotenv');
const cron = require('node-cron');
const { query: gwQuery } = require('./config/groupwareDb');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// MariaDB 연결 (mysql2 드라이버, mysql dialect 호환)
const sequelize = new Sequelize(
  process.env.DB_NAME || 'warehouse_pos',
  process.env.DB_USER || 'root',
  process.env.DB_PASSWORD || '',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: false,
    timezone: '+09:00', // 한국 시간 설정
    dialectOptions: {
      charset: 'utf8mb4',
      dateStrings: true,
      typeCast: true
    },
    define: {
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci',
    },
    pool: {
      afterCreate: (conn, done) => {
        // UTF8 설정 및 시간대 KST(+09:00) 강제 설정
        conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci; SET time_zone = '+09:00';", (err) => done(err, conn));
      },
    },
  }
);

// 데이터베이스 연결 테스트
sequelize.authenticate()
  .then(() => console.log('MariaDB connection established'))
  .catch(err => {
    console.error('MariaDB connection error:', err);
    process.exit(1);
  });

// 모델 정의
const User = sequelize.define('User', {
  id: {
    type: Sequelize.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  email: {
    type: Sequelize.STRING,
    unique: 'users_email_unique',
    allowNull: false
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
    type: Sequelize.ENUM('applicant', 'approver', 'releaser', 'admin', 'dept_admin', 'warehouse'),
    defaultValue: 'warehouse',
    allowNull: false
  },
  // 소속 부서 (L1 Category.id) — 데이터 사일로 기준
  deptId: { type: Sequelize.INTEGER, allowNull: true },
  // 소속 창고 (warehouse 사용자 전용)
  warehouseId: { type: Sequelize.INTEGER, allowNull: true },
}, {
  timestamps: true,
  tableName: 'users'
});

const Request = sequelize.define('Request', {
  id: {
    type: Sequelize.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  requestNumber: {
    type: Sequelize.STRING,
    unique: 'requests_request_number_unique',
    allowNull: false
  },
  type: {
    type: Sequelize.ENUM('goods', 'cash', 'documents'),
    allowNull: false
  },
  category: {
    type: Sequelize.STRING,
    allowNull: false
  },
  description: {
    type: Sequelize.TEXT,
    allowNull: false
  },
  amount: {
    type: Sequelize.DECIMAL(10, 2)
  },
  quantity: {
    type: Sequelize.INTEGER
  },
  applicantId: {
    type: Sequelize.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  approverId: {
    type: Sequelize.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  releaserId: {
    type: Sequelize.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  warehouseId: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  status: {
    type: Sequelize.ENUM('pending', 'approved', 'rejected', 'released'),
    defaultValue: 'pending'
  },
  approvedAt: {
    type: Sequelize.DATE
  },
  releasedAt: {
    type: Sequelize.DATE
  },
  rejectionReason: {
    type: Sequelize.TEXT
  }
}, {
  timestamps: true,
  tableName: 'requests'
});

const Warehouse = sequelize.define('Warehouse', {
  id: {
    type: Sequelize.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  warehouseName: {
    type: Sequelize.STRING,
    allowNull: false
  },
  location: {
    type: Sequelize.STRING,
    allowNull: false
  },
  capacity: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  currentUsage: {
    type: Sequelize.INTEGER,
    defaultValue: 0
  },
  manager: {
    type: Sequelize.STRING
  },
  // 소속 부서 (Category L1)
  deptId: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  isActive: {
    type: Sequelize.BOOLEAN,
    defaultValue: true
  }
}, {
  timestamps: true,
  tableName: 'warehouses'
});

const WarehouseNotice = sequelize.define('WarehouseNotice', {
  id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  warehouseId: {
    type: Sequelize.INTEGER,
    allowNull: false,
    references: { model: Warehouse, key: 'id' }
  },
  content: { type: Sequelize.TEXT, allowNull: false },
  startDate: { type: Sequelize.DATEONLY, allowNull: false },
  endDate: { type: Sequelize.DATEONLY, allowNull: false },
  isActive: { type: Sequelize.BOOLEAN, defaultValue: true },
  createdBy: { type: Sequelize.INTEGER, allowNull: true },
}, {
  timestamps: true,
  tableName: 'warehouse_notices'
});

const Product = sequelize.define('Product', {
  id: {
    type: Sequelize.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  // 내부 품목코드 (ITM-000001 형식, 자동생성)
  productCode: {
    type: Sequelize.STRING,
    unique: 'products_product_code_unique',
    allowNull: false
  },
  productName: {
    type: Sequelize.STRING,
    allowNull: false
  },
  // 상품명(기존 DB 필드명: specification) — 동일 품명이라도 상품명이 다르면 별개 품목
  specification: {
    type: Sequelize.STRING,
    allowNull: true
  },
  // 레거시 ENUM (하위호환)
  category: {
    type: Sequelize.ENUM('office', 'equipment', 'site', 'package', 'facility', 'fixed'),
    allowNull: true,
    defaultValue: 'office'
  },
  categoryId: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  // 바코드는 ItemCode 테이블로 이관 (레거시 호환용 유지)
  barcode: {
    type: Sequelize.STRING,
    allowNull: true
  },
  unit: {
    type: Sequelize.STRING,
    allowNull: false
  },
  unitPrice: {
    type: Sequelize.DECIMAL(10, 2),
    defaultValue: 0
  },
  currentStock: {
    type: Sequelize.INTEGER,
    defaultValue: 0
  },
  safetyStock: {
    type: Sequelize.INTEGER,
    defaultValue: 0
  },
  warehouseId: {
    type: Sequelize.INTEGER,
    references: {
      model: Warehouse,
      key: 'id'
    }
  },
  description: {
    type: Sequelize.TEXT
  },
  notes: {
    type: Sequelize.TEXT,
    allowNull: true
  },
  isActive: {
    type: Sequelize.BOOLEAN,
    defaultValue: true
  },
  isDraft: {
    type: Sequelize.BOOLEAN,
    defaultValue: false
  }
}, {
  timestamps: true,
  tableName: 'products'
});

// 품목-창고 매핑 (다중 창고별 안전재고)
const ProductWarehouseStock = sequelize.define('ProductWarehouseStock', {
  id:          { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  productId:   { type: Sequelize.INTEGER, allowNull: false },
  warehouseId: { type: Sequelize.INTEGER, allowNull: false },
  currentStock:{ type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  safetyStock: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  // 자동 안전재고 정책/계산 메타
  safetyStockMode:        { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'manual' }, // manual | auto
  manualSafetyStock:      { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  autoSafetyStock:        { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  leadTimeDays:           { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3 },
  serviceLevel:           { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 95.00 },
  zValue:                 { type: Sequelize.DECIMAL(6, 3), allowNull: false, defaultValue: 1.650 },
  avgDailyUsage3m:        { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
  stddevDailyUsage3m:     { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
  anomalyExcludedCount3m: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  newItemRuleApplied:     { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
  nextReviewDate:         { type: Sequelize.DATEONLY, allowNull: true },
  lastAutoCalculatedAt:   { type: Sequelize.DATE, allowNull: true },
}, {
  timestamps: true,
  tableName: 'product_warehouse_stocks'
});

// 자동 안전재고 계산 이력 (품목×창고×실행일)
const SafetyStockRun = sequelize.define('SafetyStockRun', {
  id:                    { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  productId:             { type: Sequelize.INTEGER, allowNull: false },
  warehouseId:           { type: Sequelize.INTEGER, allowNull: false },
  runDate:               { type: Sequelize.DATEONLY, allowNull: false },
  windowStart:           { type: Sequelize.DATEONLY, allowNull: false },
  windowEnd:             { type: Sequelize.DATEONLY, allowNull: false },
  avgDailyUsage:         { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
  stddevDailyUsage:      { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
  reviewDays:            { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  leadTimeDays:          { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3 },
  serviceLevel:          { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 95.00 },
  zValue:                { type: Sequelize.DECIMAL(6, 3), allowNull: false, defaultValue: 1.650 },
  demandDuringProtection:{ type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
  safetyStockCalc:       { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
  recommendedSafetyStock:{ type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  appliedSafetyStock:    { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  anomalyExcludedCount:  { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  newItemRuleApplied:    { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
  notes:                 { type: Sequelize.TEXT, allowNull: true },
}, {
  timestamps: true,
  tableName: 'safety_stock_runs',
  indexes: [
    { fields: ['productId', 'warehouseId', 'runDate'] },
    { fields: ['runDate'] },
  ],
});

// ── 품목 코드 매핑 (바코드/거래처코드 다중 연결) ─────────────────
// codeType: 'barcode' | 'vendor' | 'internal'
const ItemCode = sequelize.define('ItemCode', {
  id:        { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  itemId:    { type: Sequelize.INTEGER, allowNull: false },
  codeType:  { type: Sequelize.ENUM('barcode', 'vendor', 'internal', 'gw_mapping'), allowNull: false },
  codeValue: { type: Sequelize.STRING, allowNull: false },
  supplierId:{ type: Sequelize.INTEGER, allowNull: true },  // vendor 코드인 경우 연결
  notes:     { type: Sequelize.STRING, allowNull: true },
}, { timestamps: true, tableName: 'item_codes' });

// ── GW 소모품 매핑 중간 테이블 (문서 ID와 품목 ID 직접 연결) ───────
const GwProductMapping = sequelize.define('GwProductMapping', {
  id:        { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  gwDocId:   { type: Sequelize.STRING, allowNull: false, unique: 'gw_product_mappings_gw_doc_id_unique' },
  productId: { type: Sequelize.INTEGER, allowNull: false },
  status:    { type: Sequelize.STRING, allowNull: false, defaultValue: 'mapped' },
}, { timestamps: true, tableName: 'gw_product_mappings' });

// RequestItem 모델 - Request와 Product의 다대다 관계
const RequestItem = sequelize.define('RequestItem', {
  id: {
    type: Sequelize.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  requestId: {
    type: Sequelize.INTEGER,
    allowNull: false,
    references: {
      model: Request,
      key: 'id'
    }
  },
  productId: {
    type: Sequelize.INTEGER,
    allowNull: false,
    references: {
      model: Product,
      key: 'id'
    }
  },
  quantity: {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  unitPrice: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false
  },
  subtotal: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false
  }
}, {
  timestamps: true,
  tableName: 'request_items'
});

// StockHistory 모델 - 모든 재고 변동 기록
const StockHistory = sequelize.define('StockHistory', {
  id: {
    type: Sequelize.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  productId: {
    type: Sequelize.INTEGER,
    allowNull: false,
    references: {
      model: Product,
      key: 'id'
    }
  },
  type: {
    type: Sequelize.ENUM('inbound', 'outbound', 'adjustment', 'return'),
    allowNull: false
  },
  quantity: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  balanceBefore: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  balanceAfter: {
    type: Sequelize.INTEGER,
    allowNull: false
  },
  reference: {
    type: Sequelize.STRING,
    allowNull: true
  },
  referenceType: {
    type: Sequelize.ENUM('request', 'inbound', 'manual'),
    allowNull: false
  },
  userId: {
    type: Sequelize.INTEGER,
    references: {
      model: User,
      key: 'id'
    },
    allowNull: false
  },
  warehouseId: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  reason: {
    type: Sequelize.TEXT,
    allowNull: true
  },
  notes: {
    type: Sequelize.TEXT,
    allowNull: true
  }
}, {
  timestamps: true,
  tableName: 'stock_histories'
});

// WarehouseTransfer 모델 — 창고간 이동
const WarehouseTransfer = sequelize.define('WarehouseTransfer', {
  id:                 { type: Sequelize.INTEGER,  primaryKey: true, autoIncrement: true },
  transferOutNumber:  { type: Sequelize.STRING(30), unique: 'warehouse_transfers_out_number_unique', allowNull: false },  // TO-YYYYMMDD-NNNN
  transferInNumber:   { type: Sequelize.STRING(30), unique: 'warehouse_transfers_in_number_unique', allowNull: true  },  // TI-YYYYMMDD-NNNN
  fromWarehouseId:    { type: Sequelize.INTEGER,  allowNull: false },
  toWarehouseId:      { type: Sequelize.INTEGER,  allowNull: false },
  status:             { type: Sequelize.ENUM('pending','confirmed','cancelled'), defaultValue: 'pending' },
  notes:              { type: Sequelize.TEXT,     allowNull: true },
  outUserId:          { type: Sequelize.INTEGER,  allowNull: true },
  inUserId:           { type: Sequelize.INTEGER,  allowNull: true },
  outAt:              { type: Sequelize.DATE,     defaultValue: Sequelize.NOW },
  inAt:               { type: Sequelize.DATE,     allowNull: true },
}, { timestamps: true, tableName: 'warehouse_transfers' });

// WarehouseTransferItem 모델
const WarehouseTransferItem = sequelize.define('WarehouseTransferItem', {
  id:               { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  transferId:       { type: Sequelize.INTEGER, allowNull: false },
  productId:        { type: Sequelize.INTEGER, allowNull: false },
  quantity:         { type: Sequelize.INTEGER, allowNull: false },
  receivedQuantity: { type: Sequelize.INTEGER, allowNull: true },
}, { timestamps: true, tableName: 'warehouse_transfer_items' });

// Invitation 모델
const Invitation = sequelize.define('Invitation', {
  id:       { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  email:    { type: Sequelize.STRING,  allowNull: false },
  role:     { type: Sequelize.ENUM('applicant','approver','releaser','admin','dept_admin','warehouse'), defaultValue: 'warehouse' },
  // 초대 대상의 소속 부서 (admin 지정 / dept_admin 자동 귀속)
  deptId:   { type: Sequelize.INTEGER, allowNull: true },
  // 초대 대상의 소속 창고 (warehouse 역할에서 사용)
  warehouseId: { type: Sequelize.INTEGER, allowNull: true },
  token:    { type: Sequelize.STRING(64), unique: 'invitations_token_unique', allowNull: false },
  status:   { type: Sequelize.ENUM('invited','pending','approved','rejected'), defaultValue: 'invited' },
  // 사용자가 수락 시 입력
  name:           { type: Sequelize.STRING,  allowNull: true },
  passwordHash:   { type: Sequelize.STRING,  allowNull: true },
  rejectionReason:{ type: Sequelize.TEXT,    allowNull: true },
  invitedBy:      { type: Sequelize.INTEGER, allowNull: true },
  approvedBy:     { type: Sequelize.INTEGER, allowNull: true },
  expiresAt:      { type: Sequelize.DATE,    allowNull: false },
}, { timestamps: true, tableName: 'invitations' });

// Category 모델 (5단계 계층)
// L1=부서(Dept), L2=자산유형(고정·소모·기타), L3=대분류, L4=중분류, L5=소분류
const Category = sequelize.define('Category', {
  id:            { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  name:          { type: Sequelize.STRING,  allowNull: false },
  level:         { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 }, // 1~5
  parentId:      { type: Sequelize.INTEGER, allowNull: true },
  accessDeptIds: { type: Sequelize.TEXT, allowNull: true },
  // L1 전용: 부서 코드 (IT, PROD, GA …), 색상, 정렬순서
  code:          { type: Sequelize.STRING(20), allowNull: true },
  color:         { type: Sequelize.STRING(10), allowNull: true }, // hex: #58a6ff
  safetyStock:   { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  sortOrder:     { type: Sequelize.INTEGER, defaultValue: 0 },
  isActive:      { type: Sequelize.BOOLEAN, defaultValue: true },
}, { timestamps: true, tableName: 'categories' });

// 카테고리-창고별 안전재고 (카테고리 단위 per-warehouse 안전재고)
const CategoryWarehouseStock = sequelize.define('CategoryWarehouseStock', {
  id:          { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  categoryId:  { type: Sequelize.INTEGER, allowNull: false },
  warehouseId: { type: Sequelize.INTEGER, allowNull: false },
  safetyStock: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  timestamps: true,
  tableName: 'category_warehouse_stocks',
  indexes: [{ unique: true, fields: ['categoryId', 'warehouseId'] }],
});
CategoryWarehouseStock.belongsTo(Category, { foreignKey: 'categoryId' });
CategoryWarehouseStock.belongsTo(Warehouse, { as: 'warehouse', foreignKey: 'warehouseId' });
Category.hasMany(CategoryWarehouseStock, { as: 'warehouseStocks', foreignKey: 'categoryId', onDelete: 'CASCADE' });

// ── GW 조직도 모델 ──
const GwDepartment = sequelize.define('GwDepartment', {
  id: { type: Sequelize.BIGINT, primaryKey: true },
  name: { type: Sequelize.STRING, allowNull: false },
  parentId: { type: Sequelize.BIGINT },
  path: { type: Sequelize.STRING }
}, { tableName: 'gw_departments', timestamps: true });

const GwUser = sequelize.define('GwUser', {
  id: { type: Sequelize.BIGINT, primaryKey: true },
  name: { type: Sequelize.STRING, allowNull: false },
  empNo: { type: Sequelize.STRING },
  loginId: { type: Sequelize.STRING },
  deptId: { type: Sequelize.BIGINT },
  deptName: { type: Sequelize.STRING },
  positionName: { type: Sequelize.STRING },
  status: { type: Sequelize.STRING }
}, { tableName: 'gw_users', timestamps: true });

// 부서 커스텀 필드 정의 (L1 dept 별 추가 속성 템플릿)
// 예: IT → MAC Address, IP Address  /  Production → Calibration Date
const DeptCustomField = sequelize.define('DeptCustomField', {
  id:         { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  deptId:     { type: Sequelize.INTEGER, allowNull: false },   // L1 Category.id
  fieldName:  { type: Sequelize.STRING,  allowNull: false },   // 표시명 (MAC Address)
  fieldKey:   { type: Sequelize.STRING,  allowNull: false },   // 저장 키  (mac_address)
  fieldType:  { type: Sequelize.ENUM('text', 'date', 'number', 'select'), defaultValue: 'text' },
  options:    { type: Sequelize.TEXT,    allowNull: true },    // select 타입 시 JSON 배열
  isRequired: { type: Sequelize.BOOLEAN, defaultValue: false },
  sortOrder:  { type: Sequelize.INTEGER, defaultValue: 0 },
  isActive:   { type: Sequelize.BOOLEAN, defaultValue: true },
}, { timestamps: true, tableName: 'dept_custom_fields' });

// 품목별 커스텀 필드 값
const ProductAttribute = sequelize.define('ProductAttribute', {
  id:       { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  itemId:   { type: Sequelize.INTEGER, allowNull: false },
  fieldId:  { type: Sequelize.INTEGER, allowNull: false },
  value:    { type: Sequelize.TEXT,    allowNull: true },
}, { timestamps: true, tableName: 'product_attributes' });

// Supplier 모델
const Supplier = sequelize.define('Supplier', {
  id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  supplierCode: { type: Sequelize.STRING, unique: 'suppliers_supplier_code_unique', allowNull: false },
  supplierName: { type: Sequelize.STRING, allowNull: false },
  contactPerson: { type: Sequelize.STRING, allowNull: true },
  phone: { type: Sequelize.STRING, allowNull: true },
  email: { type: Sequelize.STRING, allowNull: true },
  address: { type: Sequelize.TEXT, allowNull: true },
  isActive: { type: Sequelize.BOOLEAN, defaultValue: true }
}, { timestamps: true, tableName: 'suppliers' });

// WarehouseTransfer 관계
WarehouseTransfer.hasMany(WarehouseTransferItem, { foreignKey: 'transferId', as: 'items' });
WarehouseTransferItem.belongsTo(WarehouseTransfer, { foreignKey: 'transferId' });
WarehouseTransferItem.belongsTo(Product, { foreignKey: 'productId' });
WarehouseTransfer.belongsTo(Warehouse, { as: 'fromWarehouse', foreignKey: 'fromWarehouseId' });
WarehouseTransfer.belongsTo(Warehouse, { as: 'toWarehouse',   foreignKey: 'toWarehouseId'   });
WarehouseTransfer.belongsTo(User, { as: 'outUser', foreignKey: 'outUserId' });
WarehouseTransfer.belongsTo(User, { as: 'inUser',  foreignKey: 'inUserId'  });

// Invitation 관계
Invitation.belongsTo(User, { as: 'inviter', foreignKey: 'invitedBy' });

// ItemCode 관계
Product.hasMany(ItemCode, { as: 'codes', foreignKey: 'itemId', onDelete: 'CASCADE' });
ItemCode.belongsTo(Product, { as: 'product', foreignKey: 'itemId' });
ItemCode.belongsTo(Supplier, { as: 'supplier', foreignKey: 'supplierId' });

// GW 매핑 관계
Product.hasOne(GwProductMapping, { foreignKey: 'productId', as: 'gwMapping', constraints: false });
GwProductMapping.belongsTo(Product, { foreignKey: 'productId', as: 'product', constraints: false });

// DeptCustomField / ProductAttribute 관계
Category.hasMany(DeptCustomField, { as: 'customFields', foreignKey: 'deptId' });
DeptCustomField.belongsTo(Category, { as: 'dept', foreignKey: 'deptId' });
Product.hasMany(ProductAttribute, { as: 'attributes', foreignKey: 'itemId', onDelete: 'CASCADE' });
ProductAttribute.belongsTo(Product, { foreignKey: 'itemId' });
ProductAttribute.belongsTo(DeptCustomField, { as: 'field', foreignKey: 'fieldId' });
User.belongsTo(Category, { as: 'dept', foreignKey: 'deptId' });
User.belongsTo(Warehouse, { as: 'warehouseInfo', foreignKey: 'warehouseId' });
WarehouseNotice.belongsTo(Warehouse, { as: 'warehouse', foreignKey: 'warehouseId' });
WarehouseNotice.belongsTo(User, { as: 'creator', foreignKey: 'createdBy' });
Product.hasMany(ProductWarehouseStock, { as: 'warehouseStocks', foreignKey: 'productId', onDelete: 'CASCADE' });
ProductWarehouseStock.belongsTo(Product, { foreignKey: 'productId' });
ProductWarehouseStock.belongsTo(Warehouse, { as: 'warehouse', foreignKey: 'warehouseId' });
Product.belongsTo(Category, { as: 'categoryInfo', foreignKey: 'categoryId' });
SafetyStockRun.belongsTo(Product, { foreignKey: 'productId' });
SafetyStockRun.belongsTo(Warehouse, { as: 'warehouse', foreignKey: 'warehouseId' });

// 관계 정의
Request.belongsTo(User, { as: 'applicant', foreignKey: 'applicantId' });
Request.belongsTo(User, { as: 'approver', foreignKey: 'approverId' });
Request.belongsTo(User, { as: 'releaser', foreignKey: 'releaserId' });
Request.belongsTo(Warehouse, { as: 'warehouse', foreignKey: 'warehouseId', constraints: false });
User.hasMany(Request, { foreignKey: 'applicantId', as: 'requests' });
Product.belongsTo(Warehouse, { foreignKey: 'warehouseId' });
RequestItem.belongsTo(Request, { foreignKey: 'requestId', onDelete: 'CASCADE' });
RequestItem.belongsTo(Product, { foreignKey: 'productId' });
Request.hasMany(RequestItem, { foreignKey: 'requestId', as: 'items' });
Product.hasMany(RequestItem, { foreignKey: 'productId' });
StockHistory.belongsTo(User, { foreignKey: 'userId' });
StockHistory.belongsTo(Product, { foreignKey: 'productId' });
Product.hasMany(StockHistory, { foreignKey: 'productId' });

const UpdateHistory = sequelize.define('UpdateHistory', {
  id:            { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  versionBefore: { type: Sequelize.STRING },
  versionAfter:  { type: Sequelize.STRING },
  releaseFile:   { type: Sequelize.STRING },           // 적용한 release zip 파일명
  backupFile:    { type: Sequelize.STRING },           // 롤백용 백업 zip 파일명
  changedFiles:  { type: Sequelize.INTEGER },          // 변경된 파일 수
  appliedBy:     { type: Sequelize.INTEGER },
  status:        { type: Sequelize.ENUM('in_progress', 'success', 'failed', 'rolled_back', 'rollback_failed'), defaultValue: 'in_progress' },
  notes:         { type: Sequelize.TEXT },
}, { timestamps: true, tableName: 'update_history' });

UpdateHistory.belongsTo(User, { as: 'applier', foreignKey: 'appliedBy' });

// 모델을 전역으로 설정
sequelize.models = { User, Request, Warehouse, WarehouseNotice, Product, ProductWarehouseStock, SafetyStockRun, ItemCode, GwProductMapping, GwDepartment, GwUser, RequestItem, StockHistory, Category, CategoryWarehouseStock, DeptCustomField, ProductAttribute, Supplier, WarehouseTransfer, WarehouseTransferItem, Invitation, UpdateHistory };
global.sequelize = sequelize;

// 데이터베이스 동기화 — alter:true 로 새 컬럼/테이블 자동 추가
// DB 및 테이블 charset 을 utf8mb4 로 강제 설정 후 sync
async function initDB() {
  const dbName = process.env.DB_NAME || 'warehouse_pos';
  try {
    await sequelize.query(
      `ALTER DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await cleanupUsersEmailUniqueIndexes();
    await sequelize.sync({ alter: true });
    console.log('Database models synced (utf8mb4)');
  } catch (err) {
    console.error('Database sync error:', err);
  }
}

async function cleanupUsersEmailUniqueIndexes() {
  try {
    const [tables] = await sequelize.query("SHOW TABLES LIKE 'users'");
    if (!Array.isArray(tables) || tables.length === 0) return;

    const [indexes] = await sequelize.query(
      "SHOW INDEX FROM `users` WHERE `Column_name` = 'email' AND `Non_unique` = 0"
    );
    if (!Array.isArray(indexes) || indexes.length <= 1) return;

    const keyNames = [...new Set(indexes.map((x) => x.Key_name).filter(Boolean))];
    if (keyNames.length <= 1) return;

    const keepKey = keyNames.includes('users_email_unique') ? 'users_email_unique' : keyNames[0];
    const dropKeys = keyNames.filter((k) => k !== keepKey && k !== 'PRIMARY');

    for (const key of dropKeys) {
      await sequelize.query(`ALTER TABLE \`users\` DROP INDEX \`${key}\``);
    }

    if (dropKeys.length > 0) {
      console.log(`[DB] cleaned duplicate users.email unique indexes: kept=${keepKey}, dropped=${dropKeys.join(', ')}`);
    }
  } catch (e) {
    console.warn('[DB] users.email unique index cleanup skipped:', e.message);
  }
}
initDB();

// Routes
try {
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/requests', require('./routes/requests'));
  app.use('/api/gw-requests', require('./routes/gwRequests'));
  app.use('/api/approvals', require('./routes/approvals'));
  app.use('/api/releases', require('./routes/releases'));
  app.use('/api/reports', require('./routes/reports'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/products', require('./routes/products'));
  app.use('/api/warehouses', require('./routes/warehouses'));
  app.use('/api/notices', require('./routes/notices'));
  app.use('/api/request-items', require('./routes/requestItems'));
  app.use('/api/dashboard', require('./routes/dashboard'));
  app.use('/api/stock-history', require('./routes/stockHistory'));
  app.use('/api/inbound',       require('./routes/inbound'));
  app.use('/api/outbound',      require('./routes/outbound'));
  app.use('/api/categories',         require('./routes/categories'));
  app.use('/api/suppliers',          require('./routes/suppliers'));
  app.use('/api/warehouse-transfer', require('./routes/warehouseTransfer'));
  app.use('/api/invitations',        require('./routes/invitations'));
  app.use('/api/gw-mapping',         require('./routes/gwMapping'));
  app.use('/api/system',             require('./routes/system'));
  app.use('/api/update',             require('./routes/update'));
  app.use('/api/compuzone', require('./routes/compuzone'));
} catch (err) {
  console.error('Route loading error:', err);
  process.exit(1);
}

// Error handler
app.use(require('./middleware/errorHandler'));

// 프론트엔드 정적 파일 서빙 (프로덕션 빌드)
const FRONTEND_BUILD = path.join(__dirname, '../frontend/build');
if (fs.existsSync(FRONTEND_BUILD)) {
  app.use(express.static(FRONTEND_BUILD, {
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }));
  app.get('*', (req, res) => res.sendFile(path.join(FRONTEND_BUILD, 'index.html')));
}

// ── GW 조직도 동기화 로직 ──
async function syncGwOrg() {
  console.log('[Cron] Starting GW Org Sync...');
  try {
    const { GwDepartment, GwUser } = sequelize.models;

    // 1. 부서 동기화
    const depts = await gwQuery(`SELECT id, name, parent_id, path FROM go_departments WHERE deleted_at IS NULL`);
    for (const d of depts.rows) {
      await GwDepartment.upsert({
        id: d.id,
        name: d.name,
        parentId: d.parent_id,
        path: d.path
      });
    }

    // 2. 사용자 동기화 (복합 조인)
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
    console.log(`[Cron] Sync completed: ${depts.rows.length} depts, ${users.rows.length} users.`);
  } catch (e) {
    console.error('[Cron] Sync failed:', e);
  }
}

// 평일(1-5) 오전 8시~오후 4시 매시 정각에 실행
cron.schedule('0 8-16 * * 1-5', syncGwOrg);

// 서버 시작 시 최초 1회 실행 (선택 사항)
setTimeout(syncGwOrg, 5000);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
