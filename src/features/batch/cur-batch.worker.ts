import { Worker } from 'bullmq';
import { getEnvVariableWithDefault } from '../../shared/database/environment';
import { checkConnection, sequelize } from '../../shared/database';
import { initModels } from '../../models/init-models';
import { logError, logInfo } from '../../shared/logger';
import { CUR_BATCH_JOB_NAMES, CUR_BATCH_QUEUE_NAME } from './cur-batch.queue';
import { runCurAggregateBatch, runCurFetchBatch, type CurBatchOptions } from './cur-batch.service';

const connection = {
  host: getEnvVariableWithDefault('REDIS_HOST', 'redis'),
  port: parseInt(getEnvVariableWithDefault('REDIS_PORT', '6379'), 10),
};

export const startCurBatchWorker = async () => {
  // データベース接続とモデル初期化はapp.tsで既に実行済みのため、ここでは実行しない
  logInfo('CUR batch worker: initializing worker...');

  const worker = new Worker(
    CUR_BATCH_QUEUE_NAME,
    async (job) => {
      const data = job.data as CurBatchOptions;

      if (job.name === CUR_BATCH_JOB_NAMES.CUR_FETCH) {
        await runCurFetchBatch(data);
        return;
      }

      if (job.name === CUR_BATCH_JOB_NAMES.CUR_AGGREGATE) {
        await runCurAggregateBatch(data);
        return;
      }

      logError('CUR batch worker: received unknown job name', { jobName: job.name, jobId: job.id });
    },
    { connection },
  );

  worker.on('completed', (job) => {
    logInfo('CUR batch job completed', { jobId: job.id, name: job.name });
  });

  worker.on('failed', (job, err) => {
    logError('CUR batch job failed', { jobId: job?.id, name: job?.name, err });
  });

  logInfo('CUR batch worker started');
};
