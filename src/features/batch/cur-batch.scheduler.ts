import { getEnvVariableWithDefault } from '../../shared/database/environment';
import { logInfo } from '../../shared/logger';
import { CUR_BATCH_JOB_NAMES, curBatchQueue } from './cur-batch.queue';

export const setupCurBatchSchedulers = async () => {
  const enabled = getEnvVariableWithDefault('CUR_BATCH_SCHEDULER_ENABLED', 'false') === 'true';

  if (!enabled) {
    logInfo('CUR batch scheduler is disabled by CUR_BATCH_SCHEDULER_ENABLED flag');
    return;
  }

  const fetchCron = getEnvVariableWithDefault('CUR_FETCH_CRON', '0 * * * *');
  const aggregateCron = getEnvVariableWithDefault('CUR_AGGREGATE_CRON', '15 * * * *');

  await curBatchQueue.add(
    CUR_BATCH_JOB_NAMES.CUR_FETCH,
    {},
    {
      repeat: {
        pattern: fetchCron,
      },
      jobId: 'cur-fetch-schedule',
    },
  );

  await curBatchQueue.add(
    CUR_BATCH_JOB_NAMES.CUR_AGGREGATE,
    {},
    {
      repeat: {
        pattern: aggregateCron,
      },
      jobId: 'cur-aggregate-schedule',
    },
  );

  logInfo('CUR batch repeatable jobs registered');
};
