'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('finops_billing_files', {
      id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('(UUID())'),
        comment: '内部ID（UUID）',
      },
      project_id: {
        type: Sequelize.STRING(30),
        allowNull: false,
        comment: '紐づくプロジェクトID',
      },
      aws_account_id: {
        type: Sequelize.STRING(12),
        allowNull: false,
        comment: '接続設定に対応するAWSアカウントID',
      },
      bucket_name: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'CURバケット名',
      },
      object_key: {
        type: Sequelize.STRING(1000),
        allowNull: false,
        comment: 'S3オブジェクトキー',
      },
      object_key_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
        comment: 'S3オブジェクトキーのハッシュ値（SHA256）',
      },
      billing_period: {
        type: Sequelize.STRING(7),
        allowNull: true,
        comment: '請求月（例：2025-11）',
      },
      status: {
        type: Sequelize.ENUM('PENDING', 'PROCESSING', 'DONE', 'ERROR'),
        allowNull: false,
        defaultValue: 'PENDING',
        comment: '処理状態',
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'エラー時メッセージ',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('finops_billing_files', ['project_id', 'bucket_name', 'object_key_hash'], {
      unique: true,
      name: 'uk_fbf_project_bucket_key_hash',
    });

    await queryInterface.addIndex('finops_billing_files', ['project_id', 'status'], {
      name: 'idx_fbf_project_status',
    });

    await queryInterface.addIndex('finops_billing_files', ['billing_period'], {
      name: 'idx_fbf_billing_period',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('finops_billing_files');
  },
};

