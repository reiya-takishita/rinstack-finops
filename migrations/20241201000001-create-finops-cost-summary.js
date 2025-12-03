'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('finops_cost_summary', {
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
      total_cost: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
        comment: '当月コスト合計',
      },
      forecast_cost: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
        comment: '当月予測コスト',
      },
      previous_same_period_cost: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
        comment: '前月同時期コスト',
      },
      previous_month_total_cost: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
        comment: '前月総コスト',
      },
      last_updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: '最終更新日時',
      },
    });

    await queryInterface.addIndex('finops_cost_summary', ['project_id', 'billing_period'], {
      unique: true,
      name: 'uk_fcs_project_period',
    });

    await queryInterface.addIndex('finops_cost_summary', ['project_id'], {
      name: 'idx_fcs_project_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('finops_cost_summary');
  },
};

