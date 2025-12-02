import express, { Router } from 'express';
import { Op } from 'sequelize';
import FinopsCostSummary from '../../../models/finops-cost-summary';
import FinopsCostServiceMonthly from '../../../models/finops-cost-service-monthly';
import { logError } from '../../../shared/logger';
import { getCurrencyConversionContext } from '../../../shared/currency';
import { requireS2SAuth } from '../../../shared/auth/s2s-jwt.middleware';

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
    // 実際の当月を取得
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentBillingPeriod = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    // 当月のサマリを取得
    const currentSummary = await FinopsCostSummary.findOne({
      where: {
        project_id: projectId,
        billing_period: currentBillingPeriod,
      },
    });

    // 当月のデータがない場合は空のレスポンスを返す
    if (!currentSummary) {
      return res.json({
        projectId,
        billingPeriod: currentBillingPeriod,
        totalCost: 0,
        executedActionsCount: 0,
        optimizationProposalsCount: 0,
        forecastCost: 0,
        previousSamePeriodCost: 0,
        previousMonthTotalCost: 0,
        costReducedByActions: 0,
        lastUpdatedAt: new Date().toISOString(),
      });
    }

    // 言語に応じた通貨変換コンテキストを取得
    const lang = 'ja'; // TODO: 言語設定を考慮する
    const baseCurrency = currentSummary.currency as string;
    const { displayCurrency, rate } = getCurrencyConversionContext(baseCurrency, lang);

    const totalCost = Number(currentSummary.total_cost) * rate;
    const forecastCost = Number(currentSummary.forecast_cost) * rate;
    const previousSamePeriodCost = Number(currentSummary.previous_same_period_cost) * rate;
    const previousMonthTotalCost = Number(currentSummary.previous_month_total_cost) * rate;

    res.json({
      projectId: currentSummary.project_id,
      billingPeriod: currentSummary.billing_period,
      currency: displayCurrency,
      totalCost,
      executedActionsCount: 0, // MVPでは固定値
      optimizationProposalsCount: 0, // MVPでは固定値
      forecastCost,
      previousSamePeriodCost,
      previousMonthTotalCost,
      costReducedByActions: 0, // MVPでは固定値
      lastUpdatedAt: currentSummary.last_updated_at.toISOString(),
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
router.get('/projects/:projectId/dashboard/services-monthly', requireS2SAuth, async (req: express.Request, res: express.Response) => {
  const { projectId } = req.params;

  try {
    // 過去8ヶ月分の月リストを生成
    const targetMonths = generateLast8Months();

    // 過去8ヶ月分のサービス別データを取得
    const serviceMonthlyData = await FinopsCostServiceMonthly.findAll({
      where: {
        project_id: projectId,
        billing_period: {
          [Op.in]: targetMonths,
        },
      },
      order: [['billing_period', 'ASC']],
    });

    // 月の一覧は常に過去8ヶ月分を返す（データがない場合でも）
    const months = targetMonths;

    // サービス名の一覧を取得
    const serviceNamesSet = new Set<string>();
    serviceMonthlyData.forEach((d) => {
      if (d.service_name) serviceNamesSet.add(d.service_name);
    });
    const serviceNames = Array.from(serviceNamesSet).sort();

    // 言語に応じた通貨変換コンテキストを取得
    const lang = 'ja'; // TODO: 言語設定を考慮する
    const baseCurrency = serviceMonthlyData[0].currency as string;
    const { displayCurrency, rate } = getCurrencyConversionContext(baseCurrency, lang);

    // サービス別に月次コストを集計
    // データがない月でも、過去8ヶ月分のコスト配列を返す（データがない月は0）
    const services = serviceNames.map((serviceName) => {
      const costs = months.map((month) => {
        const data = serviceMonthlyData.find(
          (d) => d.billing_period === month && d.service_name === serviceName
        );
        return data ? Number(data.cost) * rate : 0;
      });
      return {
        serviceName,
        costs,
      };
    });

    // データがない場合でも、過去8ヶ月分の月リストと空のservices配列を返す
    res.json({
      projectId,
      months,
      currency: displayCurrency,
      services,
    });
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
    // 過去8ヶ月分の月リストを生成
    const targetMonths = generateLast8Months();

    // 過去8ヶ月分のサービス別データを取得
    const serviceMonthlyData = await FinopsCostServiceMonthly.findAll({
      where: {
        project_id: projectId,
        billing_period: {
          [Op.in]: targetMonths,
        },
      },
      order: [['billing_period', 'ASC']],
    });

    // 月の一覧は常に過去8ヶ月分を返す
    const months = targetMonths;

    // サービス名の一覧を取得
    const serviceNamesSet = new Set<string>();
    serviceMonthlyData.forEach((d) => {
      if (d.service_name) serviceNamesSet.add(d.service_name);
    });
    const serviceNames = Array.from(serviceNamesSet).sort();

    // 言語に応じた通貨変換コンテキストを取得
    const lang = 'ja'; // TODO: 言語設定を考慮する

    const baseCurrency = serviceMonthlyData[0].currency as string;
    const { displayCurrency, rate } = getCurrencyConversionContext(baseCurrency, lang);

    // 履歴形式に変換
    const rows = serviceNames.map((serviceName) => {
      const monthlyCosts = months.map((month) => {
        const data = serviceMonthlyData.find(
          (d) => d.billing_period === month && d.service_name === serviceName
        );
        return data ? Number(data.cost) * rate : null;
      });
      return {
        serviceName,
        monthlyCosts,
      };
    });

    res.json({
      projectId,
      months,
      currency: displayCurrency,
      rows,
    });
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
