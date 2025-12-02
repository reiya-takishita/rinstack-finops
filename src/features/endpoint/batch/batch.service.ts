import { enqueueCurAggregateJob, enqueueCurFetchJob } from '../../batch/cur-batch.queue';

export async function triggerCurFetchBatch(projectId: string) {
  const job = await enqueueCurFetchJob({ projectId });

  return {
    projectId,
    status: 'accepted',
    message: 'CUR fetch batch is triggered.',
    jobId: job.id,
  };
}

export async function triggerCurAggregateBatch(projectId: string) {
  const job = await enqueueCurAggregateJob({ projectId });

  return {
    projectId,
    status: 'accepted',
    message: 'CUR aggregate batch is triggered.',
    jobId: job.id,
  };
}
