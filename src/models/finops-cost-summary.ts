import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../shared/database/connection';

/**
 * FinOps月次サマリモデル
 * 設計書参照: Finops_MVP_detail_design_v9.md 4.4.1
 */
interface FinopsCostSummaryAttributes {
  project_id: string;
  billing_period: string;
  total_cost: number;
  forecast_cost: number;
  previous_same_period_cost: number;
  previous_month_total_cost: number;
  last_updated_at?: Date;
}

interface FinopsCostSummaryCreationAttributes
  extends Optional<FinopsCostSummaryAttributes, 'last_updated_at'> {}

class FinopsCostSummary
  extends Model<FinopsCostSummaryAttributes, FinopsCostSummaryCreationAttributes>
  implements FinopsCostSummaryAttributes
{
  declare project_id: string;
  declare billing_period: string;
  declare total_cost: number;
  declare forecast_cost: number;
  declare previous_same_period_cost: number;
  declare previous_month_total_cost: number;
  declare last_updated_at: Date;
}

FinopsCostSummary.init(
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
    total_cost: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
      comment: '当月コスト合計',
    },
    forecast_cost: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
      comment: '当月予測コスト',
    },
    previous_same_period_cost: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
      comment: '前月同時期コスト',
    },
    previous_month_total_cost: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
      comment: '前月総コスト',
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
    tableName: 'finops_cost_summary',
    timestamps: false, // last_updated_atを手動管理
    indexes: [
      {
        unique: true,
        fields: ['project_id', 'billing_period'],
        name: 'uk_fcs_project_period',
      },
      {
        fields: ['project_id'],
        name: 'idx_fcs_project_id',
      },
    ],
  }
);

export default FinopsCostSummary;

