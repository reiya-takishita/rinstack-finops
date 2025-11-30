import { getEnvVariableWithDefault } from '../../shared/database/environment';
import { logInfo } from '../../shared/logger';
import { CUR_BATCH_JOB_NAMES, curBatchQueue } from './cur-batch.queue';

/**
 * CURバッチスケジューラーの設定
 * 
 * 要件定義: cur-batch-requirements.md 4.2, 4.3
 * - Batch Aのみ定期実行（CUR_FETCH_CRON）
 * - Batch Bは定期実行しない（Batch Aから動的に登録される）
 */
export const setupCurBatchSchedulers = async () => {
  const fetchCron = getEnvVariableWithDefault('CUR_FETCH_CRON', '*/3 * * * *');

  logInfo('Registering CUR batch repeatable jobs', { fetchCron });

  // Batch Aのみ定期実行
  await curBatchQueue.add(
    CUR_BATCH_JOB_NAMES.CUR_FETCH,
    {}, // projectId未指定で全プロジェクト対象
    {
      repeat: {
        pattern: fetchCron,
      },
      jobId: 'cur-fetch-schedule', // 固定jobIdで1つの定期ジョブに制限
    },
  );

  // Batch Bは定期実行しない（Batch Aから動的に登録される）
  // CUR_AGGREGATE_CRONは使用しない

  logInfo('CUR batch repeatable jobs registered', { fetchCron });
};
