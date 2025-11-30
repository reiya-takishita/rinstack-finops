import express, { Router } from 'express';
import FinopsCostSummary from '../../../models/finops-cost-summary';
import FinopsCostServiceMonthly from '../../../models/finops-cost-service-monthly';
import { logError } from '../../../shared/logger';

const router = Router();

/**
 * GET /finops/projects/:projectId/dashboard/summary
 * 月次サマリ情報を取得
 */
router.get('/projects/:projectId/dashboard/summary', async (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  try {
    // 最新のbillingPeriodを取得
    const latestSummary = await FinopsCostSummary.findOne({
      where: { project_id: projectId },
      order: [['billing_period', 'DESC']],
    });

    if (!latestSummary) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'コストデータが見つかりません',
      });
    }

    res.json({
      projectId: latestSummary.project_id,
      billingPeriod: latestSummary.billing_period,
      totalCost: Number(latestSummary.total_cost),
      executedActionsCount: 0, // MVPでは固定値
      optimizationProposalsCount: 0, // MVPでは固定値
      forecastCost: Number(latestSummary.forecast_cost),
      previousSamePeriodCost: Number(latestSummary.previous_same_period_cost),
      previousMonthTotalCost: Number(latestSummary.previous_month_total_cost),
      costReducedByActions: 0, // MVPでは固定値
      lastUpdatedAt: latestSummary.last_updated_at.toISOString(),
    });
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
router.get('/projects/:projectId/dashboard/services-monthly', async (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  try {
    // 全期間のサービス別データを取得
    const serviceMonthlyData = await FinopsCostServiceMonthly.findAll({
      where: { project_id: projectId },
      order: [['billing_period', 'ASC']],
    });

    if (serviceMonthlyData.length === 0) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'コストデータが見つかりません',
      });
    }

    // 月の一覧を取得（重複除去・ソート）
    const monthsSet = new Set<string>();
    serviceMonthlyData.forEach((d) => {
      if (d.billing_period) monthsSet.add(d.billing_period);
    });
    const months = Array.from(monthsSet).sort();

    // サービス名の一覧を取得
    const serviceNamesSet = new Set<string>();
    serviceMonthlyData.forEach((d) => {
      if (d.service_name) serviceNamesSet.add(d.service_name);
    });
    const serviceNames = Array.from(serviceNamesSet).sort();

    // サービス別に月次コストを集計
    const services = serviceNames.map((serviceName) => {
      const costs = months.map((month) => {
        const data = serviceMonthlyData.find(
          (d) => d.billing_period === month && d.service_name === serviceName
        );
        return data ? Number(data.cost) : 0;
      });
      return {
        serviceName,
        costs,
      };
    });

    res.json({
      projectId,
      months,
      services,
    });
  } catch (error) {
    logError('[cost-dashboard] services-monthly取得エラー', { projectId, error });
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'サーバーエラーが発生しました',
    });
  }
});

/**
 * GET /finops/projects/:projectId/dashboard/history
 * 履歴データを取得（services-monthlyと同じデータを異なる形式で返す）
 */
router.get('/projects/:projectId/dashboard/history', async (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  try {
    // services-monthlyと同じロジックでデータを取得
    const serviceMonthlyData = await FinopsCostServiceMonthly.findAll({
      where: { project_id: projectId },
      order: [['billing_period', 'ASC']],
    });

    if (serviceMonthlyData.length === 0) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'コストデータが見つかりません',
      });
    }

    // 月の一覧を取得
    const monthsSet = new Set<string>();
    serviceMonthlyData.forEach((d) => {
      if (d.billing_period) monthsSet.add(d.billing_period);
    });
    const months = Array.from(monthsSet).sort();

    // サービス名の一覧を取得
    const serviceNamesSet = new Set<string>();
    serviceMonthlyData.forEach((d) => {
      if (d.service_name) serviceNamesSet.add(d.service_name);
    });
    const serviceNames = Array.from(serviceNamesSet).sort();

    // 履歴形式に変換
    const rows = serviceNames.map((serviceName) => {
      const monthlyCosts = months.map((month) => {
        const data = serviceMonthlyData.find(
          (d) => d.billing_period === month && d.service_name === serviceName
        );
        return data ? Number(data.cost) : 0;
      });
      return {
        serviceName,
        monthlyCosts,
      };
    });

    res.json({
      projectId,
      months,
      rows,
    });
  } catch (error) {
    logError('[cost-dashboard] history取得エラー', { projectId, error });
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'サーバーエラーが発生しました',
    });
  }
});

export default router;
