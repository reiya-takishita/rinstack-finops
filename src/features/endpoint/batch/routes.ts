import express, { Router } from 'express';
import { enqueueCurAggregateJob, enqueueCurFetchJob } from '../../batch/cur-batch.queue';

const router = Router();

// CUR 取得バッチをオンデマンドで実行するエンドポイント
router.post('/projects/:projectId/batch/cur-fetch', async (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  // TODO: 認可・バリデーションなどが必要になったらここで実装する

  const job = await enqueueCurFetchJob({ projectId });

  res.json({
    projectId,
    status: 'accepted',
    message: 'CUR fetch batch is triggered.',
    jobId: job.id,
  });
});

// CUR 解析・集計バッチをオンデマンドで実行するエンドポイント
router.post('/projects/:projectId/batch/cur-aggregate', async (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  // TODO: 認可・バリデーションなどが必要になったらここで実装する

  const job = await enqueueCurAggregateJob({ projectId });

  res.json({
    projectId,
    status: 'accepted',
    message: 'CUR aggregate batch is triggered.',
    jobId: job.id,
  });
});

export default router;
