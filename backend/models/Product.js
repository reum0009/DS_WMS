const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Product = sequelize.define('Product', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    productCode: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false
    },
    productName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    category: {
      type: DataTypes.ENUM('office', 'equipment', 'site', 'package', 'facility', 'fixed'),
      allowNull: false
    },
    unit: {
      type: DataTypes.STRING, // 다리, 박스, 개, 상자 등
      allowNull: false
    },
    unitPrice: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0
    },
    currentStock: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    safetyStock: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    warehouseId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    description: {
      type: DataTypes.TEXT
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    timestamps: true,
    tableName: 'products'
  });

  return Product;
};
