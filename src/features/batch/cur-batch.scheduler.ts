import { getEnvVariableWithDefault } from '../../shared/database/environment';
import { logInfo } from '../../shared/logger';
import { CUR_BATCH_JOB_NAMES, curBatchQueue } from './cur-batch.queue';

/**
 * CURバッチスケジューラーの設定
 *
 * - CUR Ingestionのみ定期実行（CUR_FETCH_CRON）
 * - CUR Aggregationは定期実行しない（CUR Ingestionから動的に登録される）
 */
export const setupCurBatchSchedulers = async () => {
  const fetchCron = getEnvVariableWithDefault('CUR_FETCH_CRON', '*/3 * * * *');

  logInfo('Registering CUR batch repeatable jobs', { fetchCron });

  // CUR取得のみ定期実行
  await curBatchQueue.add(
    CUR_BATCH_JOB_NAMES.CUR_INGESTION,
    {}, // projectId未指定で全プロジェクト対象
    {
      repeat: {
        pattern: fetchCron,
      },
      jobId: 'cur-fetch-schedule', // 固定jobIdで1つの定期ジョブに制限
    },
  );

  logInfo('CUR batch repeatable jobs registered', { fetchCron });
};
