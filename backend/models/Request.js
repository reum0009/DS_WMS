const { DataTypes } = require('sequelize');

module.exports = (sequelize, User) => {
  const Request = sequelize.define('Request', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    requestNumber: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM('goods', 'cash', 'documents'),
      allowNull: false
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2)
    },
    quantity: {
      type: DataTypes.INTEGER
    },
    applicantId: {
      type: DataTypes.INTEGER,
      references: {
        model: User,
        key: 'id'
      }
    },
    approverId: {
      type: DataTypes.INTEGER,
      references: {
        model: User,
        key: 'id'
      }
    },
    releaserId: {
      type: DataTypes.INTEGER,
      references: {
        model: User,
        key: 'id'
      }
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected', 'released'),
      defaultValue: 'pending'
    },
    approvedAt: {
      type: DataTypes.DATE
    },
    releasedAt: {
      type: DataTypes.DATE
    },
    rejectionReason: {
      type: DataTypes.TEXT
    }
  }, {
    timestamps: true,
    tableName: 'requests'
  });

  Request.belongsTo(User, { as: 'applicant', foreignKey: 'applicantId' });
  Request.belongsTo(User, { as: 'approver', foreignKey: 'approverId' });
  Request.belongsTo(User, { as: 'releaser', foreignKey: 'releaserId' });

  return Request;
};