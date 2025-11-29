import { Queue, JobsOptions } from 'bullmq';
import { getEnvVariableWithDefault } from '../../shared/database/environment';
import type { CurBatchOptions } from './cur-batch.service';

const connection = {
  host: getEnvVariableWithDefault('REDIS_HOST', 'redis'),
  port: parseInt(getEnvVariableWithDefault('REDIS_PORT', '6379'), 10),
};

export const CUR_BATCH_QUEUE_NAME = 'cur-batch';

export const CUR_BATCH_JOB_NAMES = {
  CUR_FETCH: 'cur-fetch',
  CUR_AGGREGATE: 'cur-aggregate',
} as const;

export type CurBatchJobName = (typeof CUR_BATCH_JOB_NAMES)[keyof typeof CUR_BATCH_JOB_NAMES];

export const curBatchQueue = new Queue(CUR_BATCH_QUEUE_NAME, {
  connection,
});

export const enqueueCurFetchJob = async (
  data: CurBatchOptions = {},
  options?: JobsOptions,
) => {
  return curBatchQueue.add(CUR_BATCH_JOB_NAMES.CUR_FETCH, data, options);
};

export const enqueueCurAggregateJob = async (
  data: CurBatchOptions = {},
  options?: JobsOptions,
) => {
  return curBatchQueue.add(CUR_BATCH_JOB_NAMES.CUR_AGGREGATE, data, options);
};
