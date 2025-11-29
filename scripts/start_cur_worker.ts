import { startCurBatchWorker } from '../src/features/batch/cur-batch.worker';

async function main() {
  await startCurBatchWorker();
}

void main();
