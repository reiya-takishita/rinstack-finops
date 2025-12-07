import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../shared/database/connection';

/**
 * FinOps課金レポートファイル管理モデル
 * 設計書参照: Finops_MVP_detail_design_v9.md 3.3
 */
interface FinopsBillingFileAttributes {
  id: string;
  project_id: string;
  aws_account_id: string;
  bucket_name: string;
  object_key: string;
  object_key_hash: string;
  s3_last_modified_at: Date | null;
  billing_period: string | null;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'ERROR' | 'SKIPPED';
  error_message: string | null;
  created_at?: Date;
  updated_at?: Date;
}

type FinopsBillingFileCreationAttributes = Optional<
  FinopsBillingFileAttributes,
  'id' | 'created_at' | 'updated_at' | 'billing_period' | 'error_message' | 'object_key_hash' | 's3_last_modified_at'
>;

class FinopsBillingFile
  extends Model<FinopsBillingFileAttributes, FinopsBillingFileCreationAttributes>
  implements FinopsBillingFileAttributes
{
  declare id: string;
  declare project_id: string;
  declare aws_account_id: string;
  declare bucket_name: string;
  declare object_key: string;
  declare object_key_hash: string;
  declare s3_last_modified_at: Date | null;
  declare billing_period: string | null;
  declare status: 'PENDING' | 'PROCESSING' | 'DONE' | 'ERROR' | 'SKIPPED';
  declare error_message: string | null;
  declare created_at: Date;
  declare updated_at: Date;
}

FinopsBillingFile.init(
  {
    id: {
      type: DataTypes.UUID,
      allowNull: false,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
      comment: '内部ID（UUID）',
    },
    project_id: {
      type: DataTypes.STRING(30),
      allowNull: false,
      comment: '紐づくプロジェクトID',
    },
    aws_account_id: {
      type: DataTypes.STRING(12),
      allowNull: false,
      comment: '接続設定に対応するAWSアカウントID',
    },
    bucket_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'CURバケット名',
    },
    object_key: {
      type: DataTypes.STRING(1000),
      allowNull: false,
      comment: 'S3オブジェクトキー',
    },
    object_key_hash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: 'S3オブジェクトキーのハッシュ値（SHA256）',
    },
    s3_last_modified_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'S3オブジェクトの最終更新日時',
    },
    billing_period: {
      type: DataTypes.STRING(7),
      allowNull: true,
      comment: '請求月（例：2025-11）',
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'PROCESSING', 'DONE', 'ERROR', 'SKIPPED'),
      allowNull: false,
      defaultValue: 'PENDING',
      comment: '処理状態',
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'エラー時メッセージ',
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
    tableName: 'finops_billing_files',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: false,
    indexes: [
      {
        unique: true,
        fields: ['project_id', 'bucket_name', 'object_key_hash'],
        name: 'uk_fbf_project_bucket_key_hash',
      },
      {
        fields: ['project_id', 'status'],
        name: 'idx_fbf_project_status',
      },
      {
        fields: ['billing_period'],
        name: 'idx_fbf_billing_period',
      },
    ],
  }
);

export default FinopsBillingFile;

