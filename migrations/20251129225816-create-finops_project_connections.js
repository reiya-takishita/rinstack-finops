'use strict';

module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('finops_project_connections', {
      project_id: {
        type: Sequelize.STRING(30),
        allowNull: false,
        primaryKey: true,
        comment: 'Rinstack プロジェクトID（PK相当）'
      },
      aws_account_id: {
        type: Sequelize.STRING(12),
        allowNull: false,
        comment: 'AWSアカウントID'
      },
      access_key_id_param_path: {
        type: Sequelize.STRING(500),
        allowNull: false,
        comment: 'アクセスキー用パラメータストアパス'
      },
      secret_access_key_param_path: {
        type: Sequelize.STRING(500),
        allowNull: false,
        comment: 'シークレットアクセスキー用パラメータストアパス'
      },
      cur_bucket_name: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'CUR 出力先 S3バケット名'
      },
      cur_prefix: {
        type: Sequelize.STRING(500),
        allowNull: false,
        comment: 'CUR ファイルのプレフィックス'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('finops_project_connections', ['project_id'], {
      unique: true,
      name: 'idx_fpc_project_id'
    });

    await queryInterface.addIndex('finops_project_connections', ['aws_account_id'], {
      name: 'idx_fpc_aws_account_id'
    });
  },

  async down (queryInterface) {
    await queryInterface.dropTable('finops_project_connections');
  }
};

