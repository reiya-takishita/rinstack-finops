import express, { Router } from 'express';
import { logError } from '../../../shared/logger';
import { requireS2SAuth } from '../../../shared/auth/s2s-jwt.middleware';
import {
  getDashboardSummary,
  getServicesMonthly,
  getDashboardHistory,
} from './cost-dashboard.service';

const router = Router();

/**
 * 現在の月から8ヶ月前まで（8ヶ月分）の月リストを生成
 */
function generateLast8Months(): string[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  const months: string[] = [];
  // 現在の月から8ヶ月前まで（現在の月を含む）
  for (let i = 0; i < 8; i++) {
    const targetDate = new Date(currentYear, currentMonth - 1 - i, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1;
    months.unshift(`${year}-${String(month).padStart(2, '0')}`);
  }
  return months;
}

/**
 * GET /finops/projects/:projectId/dashboard/summary
 * 月次サマリ情報を取得
 */
router.get('/projects/:projectId/dashboard/summary', requireS2SAuth, async (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  try {
    const result = await getDashboardSummary(projectId);
    res.json(result);
  } catch (error) {
    logError('[cost-dashboard] summary取得エラー', { projectId, error });
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'サーバーエラーが発生しました',
    });
  }
});

/**
 * GET /finops/projects/:projectId/dashboard/services-monthly
 * サービス別月次コストを取得
 */
router.get('/projects/:projectId/dashboard/services-monthly', requireS2SAuth, async (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  try {
    const result = await getServicesMonthly(projectId);
    res.json(result);
  } catch (error) {
    logError('[cost-dashboard] services-monthly取得エラー', { projectId, error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'サーバーエラーが発生しました',
      details: errorMessage,
      ...(process.env.NODE_ENV === 'development' && { stack: errorStack }),
    });
  }
});

/**
 * GET /finops/projects/:projectId/dashboard/history
 * 履歴データを取得（services-monthlyと同じデータを異なる形式で返す）
 */
router.get('/projects/:projectId/dashboard/history', requireS2SAuth, async (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  try {
    const result = await getDashboardHistory(projectId);
    res.json(result);
  } catch (error) {
    logError('[cost-dashboard] history取得エラー', { projectId, error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'サーバーエラーが発生しました',
      details: errorMessage,
      ...(process.env.NODE_ENV === 'development' && { stack: errorStack }),
    });
  }
});

export default router;
