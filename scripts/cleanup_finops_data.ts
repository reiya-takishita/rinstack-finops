#!/usr/bin/env ts-node
/**
 * FinOpsデータクリーンアップスクリプト
 * finops_project_connections以外のfinopsテーブルのデータを削除します
 */

import { sequelize } from '../src/shared/database/connection';
import { initModels } from '../src/models/init-models';
import FinopsBillingFile from '../src/models/finops-billing-file';
import FinopsCostSummary from '../src/models/finops-cost-summary';
import FinopsCostServiceMonthly from '../src/models/finops-cost-service-monthly';
import { logInfo, logError } from '../src/shared/logger/logger';

async function cleanupFinopsData() {
  try {
    // データベース接続確認
    await sequelize.authenticate();
    logInfo('Database connection established.');

    // モデル初期化
    initModels(sequelize);
    logInfo('Models initialized.');

    // トランザクション開始
    const transaction = await sequelize.transaction();

    try {
      // 削除前の件数を確認
      const billingFilesCount = await FinopsBillingFile.count({ transaction });
      const costSummaryCount = await FinopsCostSummary.count({ transaction });
      const costServiceMonthlyCount = await FinopsCostServiceMonthly.count({ transaction });

      logInfo('削除前のデータ件数:', {
        finops_billing_files: billingFilesCount,
        finops_cost_summary: costSummaryCount,
        finops_cost_service_monthly: costServiceMonthlyCount,
      });

      // データ削除（finops_project_connectionsは残す）
      await FinopsBillingFile.destroy({
        where: {},
        transaction,
        force: true, // 物理削除
      });
      logInfo('finops_billing_files のデータを削除しました');

      await FinopsCostServiceMonthly.destroy({
        where: {},
        transaction,
        force: true,
      });
      logInfo('finops_cost_service_monthly のデータを削除しました');

      await FinopsCostSummary.destroy({
        where: {},
        transaction,
        force: true,
      });
      logInfo('finops_cost_summary のデータを削除しました');

      // 削除後の件数を確認
      const billingFilesCountAfter = await FinopsBillingFile.count({ transaction });
      const costSummaryCountAfter = await FinopsCostSummary.count({ transaction });
      const costServiceMonthlyCountAfter = await FinopsCostServiceMonthly.count({ transaction });

      logInfo('削除後のデータ件数:', {
        finops_billing_files: billingFilesCountAfter,
        finops_cost_summary: costSummaryCountAfter,
        finops_cost_service_monthly: costServiceMonthlyCountAfter,
      });

      // コミット
      await transaction.commit();
      logInfo('データクリーンアップが完了しました。finops_project_connectionsのデータは保持されています。');
    } catch (error) {
      // ロールバック
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    logError('データクリーンアップエラー:', error);
    throw error;
  } finally {
    // データベース接続を閉じる
    await sequelize.close();
  }
}

// スクリプト実行
if (require.main === module) {
  cleanupFinopsData()
    .then(() => {
      logInfo('スクリプトが正常に完了しました');
      process.exit(0);
    })
    .catch((error) => {
      logError('スクリプト実行エラー:', error);
      process.exit(1);
    });
}

export { cleanupFinopsData };

