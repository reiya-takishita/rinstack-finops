import express from 'express';

const router = express.Router();

// ベースリポジトリ用の最小ルーター
// 各 rinstack-* プロジェクトはここに機能別ルーターをマウントしていく

router.get('/health', (_req: express.Request, res: express.Response) => {
  res.json({ status: 'ok' });
});

export default router;
