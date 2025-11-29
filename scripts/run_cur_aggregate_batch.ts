import { enqueueCurAggregateJob } from '../src/features/batch/cur-batch.queue';

async function main() {
  try {
    const projectId = process.argv[2];

    const job = await enqueueCurAggregateJob(projectId ? { projectId } : {});

    // eslint-disable-next-line no-console
    console.log('CUR aggregate job enqueued.', { jobId: job.id, projectId });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('CUR aggregate enqueue failed.', error);
    process.exitCode = 1;
  }
}

void main();
