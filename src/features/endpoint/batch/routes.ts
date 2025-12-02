import express, { Router } from 'express';
import { triggerCurAggregateBatch, triggerCurFetchBatch } from './batch.service';

const router = Router();

// CUR 取得バッチをオンデマンドで実行するエンドポイント
router.post('/projects/:projectId/batch/cur-fetch', async (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  // TODO: 認可・バリデーションなどが必要になったらここで実装する

  const result = await triggerCurFetchBatch(projectId);

  res.json(result);
});

// CUR 解析・集計バッチをオンデマンドで実行するエンドポイント
router.post('/projects/:projectId/batch/cur-aggregate', async (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  // TODO: 認可・バリデーションなどが必要になったらここで実装する

  const result = await triggerCurAggregateBatch(projectId);

  res.json(result);
});

export default router;
