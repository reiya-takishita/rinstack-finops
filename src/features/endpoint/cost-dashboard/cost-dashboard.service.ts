import { getCurrencyConversionContext } from '../../../shared/currency';
import {
  findCurrentCostSummaryForProject,
  findServiceMonthlyForProjectInPeriods,
} from './cost-dashboard.repository';

function generateLast8Months(): string[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  const months: string[] = [];
  for (let i = 0; i < 8; i++) {
    const targetDate = new Date(currentYear, currentMonth - 1 - i, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1;
    months.unshift(`${year}-${String(month).padStart(2, '0')}`);
  }
  return months;
}

export async function getDashboardSummary(projectId: string) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentBillingPeriod = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  const currentSummary = await findCurrentCostSummaryForProject(projectId, currentBillingPeriod);

  if (!currentSummary) {
    return {
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
    };
  }

  const lang = 'ja'; // TODO: 言語設定を考慮する
  const baseCurrency = currentSummary.currency as string;
  const { displayCurrency, rate } = getCurrencyConversionContext(baseCurrency, lang);

  const totalCost = Number(currentSummary.total_cost) * rate;
  const forecastCost = Number(currentSummary.forecast_cost) * rate;
  const previousSamePeriodCost = Number(currentSummary.previous_same_period_cost) * rate;
  const previousMonthTotalCost = Number(currentSummary.previous_month_total_cost) * rate;

  return {
    projectId: currentSummary.project_id,
    billingPeriod: currentSummary.billing_period,
    currency: displayCurrency,
    totalCost,
    executedActionsCount: 0,
    optimizationProposalsCount: 0,
    forecastCost,
    previousSamePeriodCost,
    previousMonthTotalCost,
    costReducedByActions: 0,
    lastUpdatedAt: currentSummary.last_updated_at.toISOString(),
  };
}

export async function getServicesMonthly(projectId: string) {
  const targetMonths = generateLast8Months();

  const serviceMonthlyData = await findServiceMonthlyForProjectInPeriods(projectId, targetMonths);

  const months = targetMonths;

  const serviceNamesSet = new Set<string>();
  serviceMonthlyData.forEach((d) => {
    if (d.service_name) serviceNamesSet.add(d.service_name);
  });
  const serviceNames = Array.from(serviceNamesSet).sort();

  const lang = 'ja'; // TODO: 言語設定を考慮する
  const baseCurrency = serviceMonthlyData[0]?.currency as string | undefined;
  const { displayCurrency, rate } = baseCurrency
    ? getCurrencyConversionContext(baseCurrency, lang)
    : { displayCurrency: undefined, rate: 1 };

  const services = serviceNames.map((serviceName) => {
    const costs = months.map((month) => {
      const data = serviceMonthlyData.find(
        (d) => d.billing_period === month && d.service_name === serviceName,
      );
      return data ? Number(data.cost) * rate : 0;
    });
    return {
      serviceName,
      costs,
    };
  });

  return {
    projectId,
    months,
    currency: displayCurrency,
    services,
  };
}

export async function getDashboardHistory(projectId: string) {
  const targetMonths = generateLast8Months();

  const serviceMonthlyData = await findServiceMonthlyForProjectInPeriods(projectId, targetMonths);

  const months = targetMonths;

  const serviceNamesSet = new Set<string>();
  serviceMonthlyData.forEach((d) => {
    if (d.service_name) serviceNamesSet.add(d.service_name);
  });
  const serviceNames = Array.from(serviceNamesSet).sort();

  const lang = 'ja'; // TODO: 言語設定を考慮する
  const baseCurrency = serviceMonthlyData[0]?.currency as string | undefined;
  const { displayCurrency, rate } = baseCurrency
    ? getCurrencyConversionContext(baseCurrency, lang)
    : { displayCurrency: undefined, rate: 1 };

  const rows = serviceNames.map((serviceName) => {
    const monthlyCosts = months.map((month) => {
      const data = serviceMonthlyData.find(
        (d) => d.billing_period === month && d.service_name === serviceName,
      );
      return data ? Number(data.cost) * rate : null;
    });
    return {
      serviceName,
      monthlyCosts,
    };
  });

  return {
    projectId,
    months,
    currency: displayCurrency,
    rows,
  };
}
