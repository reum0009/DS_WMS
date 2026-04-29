const { Sequelize, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const GwDepartment = sequelize.define('GwDepartment', {
    id: { type: DataTypes.BIGINT, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    parentId: { type: DataTypes.BIGINT },
    path: { type: DataTypes.STRING }
  }, { tableName: 'gw_departments', timestamps: true });

  const GwUser = sequelize.define('GwUser', {
    id: { type: DataTypes.BIGINT, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    empNo: { type: DataTypes.STRING },
    loginId: { type: DataTypes.STRING },
    deptId: { type: DataTypes.BIGINT },
    deptName: { type: DataTypes.STRING },
    positionName: { type: DataTypes.STRING },
    status: { type: DataTypes.STRING }
  }, { tableName: 'gw_users', timestamps: true });

  return { GwDepartment, GwUser };
};