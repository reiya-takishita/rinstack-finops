import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../shared/database/connection';

/**
 * FinOpsサービス別月次コストモデル
 * 設計書参照: Finops_MVP_detail_design_v9.md 4.4.2
 */
interface FinopsCostServiceMonthlyAttributes {
  project_id: string;
  billing_period: string;
  service_name: string;
  cost: number;
  currency: string;
  last_updated_at?: Date;
}

type FinopsCostServiceMonthlyCreationAttributes = Optional<FinopsCostServiceMonthlyAttributes, 'last_updated_at'>;

class FinopsCostServiceMonthly
  extends Model<FinopsCostServiceMonthlyAttributes, FinopsCostServiceMonthlyCreationAttributes>
  implements FinopsCostServiceMonthlyAttributes
{
  declare project_id: string;
  declare billing_period: string;
  declare service_name: string;
  declare cost: number;
  declare currency: string;
  declare last_updated_at: Date;
}

FinopsCostServiceMonthly.init(
  {
    project_id: {
      type: DataTypes.STRING(30),
      allowNull: false,
      primaryKey: true,
      comment: 'プロジェクトID',
    },
    billing_period: {
      type: DataTypes.STRING(7),
      allowNull: false,
      primaryKey: true,
      comment: '対象月（例：2025-11）',
    },
    currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      comment: '通貨コード（例：USD）',
    },
    service_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      primaryKey: true,
      comment: 'サービス名',
    },
    cost: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
      comment: '対象月の当該サービスのコスト',
    },
    last_updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: '最終更新日時',
    },
  },
  {
    sequelize,
    tableName: 'finops_cost_service_monthly',
    timestamps: false, // last_updated_atを手動管理
    indexes: [
      {
        unique: true,
        fields: ['project_id', 'billing_period', 'service_name'],
        name: 'uk_fcsm_project_period_service',
      },
      {
        fields: ['project_id', 'billing_period'],
        name: 'idx_fcsm_project_period',
      },
    ],
  }
);

export default FinopsCostServiceMonthly;

