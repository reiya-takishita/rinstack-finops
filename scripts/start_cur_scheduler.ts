import { setupCurBatchSchedulers } from '../src/features/batch/cur-batch.scheduler';

async function main() {
  await setupCurBatchSchedulers();
}

void main();
