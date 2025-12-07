import { Router } from 'express';
import { requireS2SAuth } from '../../../shared/auth/s2s-jwt.middleware';
import { AwsConnectionController } from './controller';

const router = Router();

/**
 * AWS接続設定API
 * 設計書参照: Finops_MVP_detail_design_v9.md 2.3
 *
 * 全エンドポイントにS2S JWT認証を適用
 */
router.get(
  '/projects/:projectId/connection',
  requireS2SAuth,
  AwsConnectionController.getConnection.bind(AwsConnectionController)
);

router.put(
  '/projects/:projectId/connection',
  requireS2SAuth,
  AwsConnectionController.putConnection.bind(AwsConnectionController)
);

router.delete(
  '/projects/:projectId/connection',
  requireS2SAuth,
  AwsConnectionController.deleteConnection.bind(AwsConnectionController)
);

export default router;
