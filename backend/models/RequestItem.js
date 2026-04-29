const { DataTypes } = require('sequelize');

module.exports = (sequelize, Request, Product) => {
  const RequestItem = sequelize.define('RequestItem', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    requestId: {
      type: DataTypes.INTEGER,
      references: {
        model: Request,
        key: 'id'
      },
      allowNull: false
    },
    productId: {
      type: DataTypes.INTEGER,
      references: {
        model: Product,
        key: 'id'
      },
      allowNull: false
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1
      }
    },
    unitPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    totalPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'picked', 'released'),
      defaultValue: 'pending'
    }
  }, {
    timestamps: true,
    underscored: true
  });

  return RequestItem;
};
