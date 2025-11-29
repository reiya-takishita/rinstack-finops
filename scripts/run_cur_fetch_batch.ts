import { enqueueCurFetchJob } from '../src/features/batch/cur-batch.queue';

async function main() {
  try {
    const projectId = process.argv[2];

    const job = await enqueueCurFetchJob(projectId ? { projectId } : {});

    // eslint-disable-next-line no-console
    console.log('CUR fetch job enqueued.', { jobId: job.id, projectId });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('CUR fetch enqueue failed.', error);
    process.exitCode = 1;
  }
}

void main();
