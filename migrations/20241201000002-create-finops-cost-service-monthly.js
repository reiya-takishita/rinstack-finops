'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('finops_cost_service_monthly', {
      project_id: {
        type: Sequelize.STRING(30),
        allowNull: false,
        primaryKey: true,
        comment: 'プロジェクトID',
      },
      billing_period: {
        type: Sequelize.STRING(7),
        allowNull: false,
        primaryKey: true,
        comment: '対象月（例：2025-11）',
      },
      currency: {
        type: Sequelize.STRING(10),
        allowNull: false,
        comment: '通貨コード（例：USD）',
      },
      service_name: {
        type: Sequelize.STRING(255),
        allowNull: false,
        primaryKey: true,
        comment: 'サービス名',
      },
      cost: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
        comment: '対象月の当該サービスのコスト',
      },
      last_updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: '最終更新日時',
      },
    });

    await queryInterface.addIndex('finops_cost_service_monthly', ['project_id', 'billing_period', 'service_name'], {
      unique: true,
      name: 'uk_fcsm_project_period_service',
    });

    await queryInterface.addIndex('finops_cost_service_monthly', ['project_id', 'billing_period'], {
      name: 'idx_fcsm_project_period',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('finops_cost_service_monthly');
  },
};

