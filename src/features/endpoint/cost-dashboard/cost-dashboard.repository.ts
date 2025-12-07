import { Op } from 'sequelize';
import FinopsCostSummary from '../../../models/finops-cost-summary';
import FinopsCostServiceMonthly from '../../../models/finops-cost-service-monthly';

export async function findCurrentCostSummaryForProject(
  projectId: string,
  billingPeriod: string,
): Promise<FinopsCostSummary | null> {
  return FinopsCostSummary.findOne({
    where: {
      project_id: projectId,
      billing_period: billingPeriod,
    },
  });
}

export async function findServiceMonthlyForProjectInPeriods(
  projectId: string,
  billingPeriods: string[],
): Promise<FinopsCostServiceMonthly[]> {
  return FinopsCostServiceMonthly.findAll({
    where: {
      project_id: projectId,
      billing_period: {
        [Op.in]: billingPeriods,
      },
    },
    order: [['billing_period', 'ASC']],
  });
}
