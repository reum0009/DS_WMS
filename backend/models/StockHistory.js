const { DataTypes } = require('sequelize');

module.exports = (sequelize, User, Product) => {
  const StockHistory = sequelize.define('StockHistory', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    productId: {
      type: DataTypes.INTEGER,
      references: {
        model: Product,
        key: 'id'
      },
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM('inbound', 'outbound', 'adjustment', 'return'),
      allowNull: false
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    balanceBefore: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    balanceAfter: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    reference: {
      type: DataTypes.STRING,
      allowNull: true // requestId, inboundId 등
    },
    referenceType: {
      type: DataTypes.ENUM('request', 'inbound', 'manual'),
      allowNull: false
    },
    userId: {
      type: DataTypes.INTEGER,
      references: {
        model: User,
        key: 'id'
      },
      allowNull: false
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    timestamps: true,
    underscored: true
  });

  return StockHistory;
};
