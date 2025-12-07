import type { Sequelize } from 'sequelize';
import FinopsProjectConnection from './finops-project-connection';
import FinopsBillingFile from './finops-billing-file';
import FinopsCostSummary from './finops-cost-summary';
import FinopsCostServiceMonthly from './finops-cost-service-monthly';

/**
 * FinOpsモデルの初期化
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initModels(_sequelize: Sequelize) {
  // モデルを初期化（既にinit()でsequelizeに登録済み）
  // ここでは型チェックとエクスポートのために関連付けを返す
  return {
    FinopsProjectConnection,
    FinopsBillingFile,
    FinopsCostSummary,
    FinopsCostServiceMonthly,
  };
}

