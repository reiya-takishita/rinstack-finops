import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../shared/database/connection';

/**
 * FinOpsプロジェクト接続設定モデル
 * 設計書参照: Finops_MVP_detail_design_v9.md 2.4
 */
interface FinopsProjectConnectionAttributes {
  project_id: string;
  aws_account_id: string;
  access_key_id_param_path: string;
  secret_access_key_param_path: string;
  cur_bucket_name: string;
  cur_prefix: string;
  created_at?: Date;
  updated_at?: Date;
}

interface FinopsProjectConnectionCreationAttributes
  extends Optional<FinopsProjectConnectionAttributes, 'created_at' | 'updated_at'> {}

class FinopsProjectConnection
  extends Model<FinopsProjectConnectionAttributes, FinopsProjectConnectionCreationAttributes>
  implements FinopsProjectConnectionAttributes
{
  declare project_id: string;
  declare aws_account_id: string;
  declare access_key_id_param_path: string;
  declare secret_access_key_param_path: string;
  declare cur_bucket_name: string;
  declare cur_prefix: string;
  declare created_at: Date;
  declare updated_at: Date;
}

FinopsProjectConnection.init(
  {
    project_id: {
      type: DataTypes.STRING(30),
      allowNull: false,
      primaryKey: true,
      comment: 'Rinstack プロジェクトID（PK相当）',
    },
    aws_account_id: {
      type: DataTypes.STRING(12),
      allowNull: false,
      comment: 'AWSアカウントID',
    },
    access_key_id_param_path: {
      type: DataTypes.STRING(500),
      allowNull: false,
      comment: 'アクセスキー用パラメータストアパス',
    },
    secret_access_key_param_path: {
      type: DataTypes.STRING(500),
      allowNull: false,
      comment: 'シークレットアクセスキー用パラメータストアパス',
    },
    cur_bucket_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'CUR 出力先 S3バケット名',
    },
    cur_prefix: {
      type: DataTypes.STRING(500),
      allowNull: false,
      comment: 'CUR ファイルのプレフィックス',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'finops_project_connections',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: false, // deleted_atカラムを使用しない
    indexes: [
      {
        unique: true,
        fields: ['project_id'],
        name: 'idx_fpc_project_id',
      },
      {
        fields: ['aws_account_id'],
        name: 'idx_fpc_aws_account_id',
      },
    ],
  }
);

export default FinopsProjectConnection;

