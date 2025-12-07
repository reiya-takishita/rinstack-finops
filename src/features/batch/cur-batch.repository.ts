import FinopsProjectConnection from '../../models/finops-project-connection';
import FinopsBillingFile from '../../models/finops-billing-file';
import FinopsCostSummary from '../../models/finops-cost-summary';
import FinopsCostServiceMonthly from '../../models/finops-cost-service-monthly';
import { sequelize } from '../../shared/database/connection';

/**
 * CUR バッチ処理専用のリポジトリ関数群
 *
 * FinOps 関連モデルへの永続化アクセスを集約し、service からの models 直アクセスを防ぐ。
 */

export async function findTargetProjectConnectionsForCurBatch(projectId?: string) {
  const where: Record<string, unknown> = {};
  if (projectId) {
    where.project_id = projectId;
  }

  return FinopsProjectConnection.findAll({ where });
}

export async function findBillingFileByObjectKeyHashForCurBatch(
  projectId: string,
  bucketName: string,
  objectKeyHash: string,
) {
  return FinopsBillingFile.findOne({
    where: {
      project_id: projectId,
      bucket_name: bucketName,
      object_key_hash: objectKeyHash,
    },
  });
}

export async function createBillingFileForCurBatch(params: {
  projectId: string;
  awsAccountId: string;
  bucketName: string;
  objectKey: string;
  objectKeyHash: string;
  billingPeriod: string | null;
  s3LastModifiedAt?: Date | null;
  status?: 'PENDING' | 'PROCESSING' | 'DONE' | 'ERROR' | 'SKIPPED';
}) {
  const { projectId, awsAccountId, bucketName, objectKey, objectKeyHash, billingPeriod, s3LastModifiedAt, status } =
    params;

  return FinopsBillingFile.create({
    project_id: projectId,
    aws_account_id: awsAccountId,
    bucket_name: bucketName,
    object_key: objectKey,
    object_key_hash: objectKeyHash,
    s3_last_modified_at: s3LastModifiedAt ?? null,
    billing_period: billingPeriod,
    status: status ?? 'PENDING',
  });
}

export async function resetBillingFileToPendingWithS3LastModifiedForCurBatch(
  id: string,
  s3LastModifiedAt: Date | null,
): Promise<void> {
  await FinopsBillingFile.update(
    {
      status: 'PENDING',
      s3_last_modified_at: s3LastModifiedAt,
    },
    {
      where: {
        id,
      },
    },
  );
}

export async function findPendingBillingFilesForCurBatch(projectId?: string, limit = 100) {
  const where: Record<string, unknown> = { status: 'PENDING' };
  if (projectId) {
    where.project_id = projectId;
  }

  return FinopsBillingFile.findAll({
    where,
    limit,
    order: [['created_at', 'ASC']],
  });
}

export async function lockBillingFileAsProcessingForCurBatch(id: string): Promise<boolean> {
  const [updatedCount] = await FinopsBillingFile.update(
    { status: 'PROCESSING' },
    {
      where: {
        id,
        status: 'PENDING',
      },
    },
  );

  return updatedCount === 1;
}

export async function updateBillingFileStatusToDoneForCurBatch(id: string): Promise<void> {
  await FinopsBillingFile.update(
    { status: 'DONE' },
    { where: { id } },
  );
}

export async function updateBillingFileStatusToErrorForCurBatch(
  id: string,
  errorMessage: string,
): Promise<void> {
  await FinopsBillingFile.update(
    {
      status: 'ERROR',
      error_message: errorMessage,
    },
    { where: { id } },
  );
}

export async function findProjectConnectionByProjectIdForCurBatch(projectId: string) {
  return FinopsProjectConnection.findOne({
    where: { project_id: projectId },
  });
}

export async function getExistingServiceCostsForCurBatch(
  projectId: string,
  billingPeriod: string,
): Promise<Record<string, number>> {
  const existingServices = await FinopsCostServiceMonthly.findAll({
    where: {
      project_id: projectId,
      billing_period: billingPeriod,
    },
  });

  const serviceCosts: Record<string, number> = {};
  for (const existing of existingServices) {
    serviceCosts[existing.service_name] = Number(existing.cost) || 0;
  }

  return serviceCosts;
}

export async function findBillingFilesByProjectAndPeriodForCurBatch(
  projectId: string,
  billingPeriod: string,
) {
  return FinopsBillingFile.findAll({
    where: {
      project_id: projectId,
      billing_period: billingPeriod,
    },
  });
}

export async function saveCurAggregatedCostsForCurBatch(params: {
  projectId: string;
  billingPeriod: string;
  billingYear: number;
  billingMonth: number;
  currencyCode: string;
  serviceCosts: Record<string, number>;
  dailyCosts: Record<string, number>;
  previousSamePeriodCostOverride?: number;
}): Promise<void> {
  const {
    projectId,
    billingPeriod,
    billingYear,
    billingMonth,
    currencyCode,
    serviceCosts,
    dailyCosts,
    previousSamePeriodCostOverride,
  } = params;

  const calculatedTotalCost = Object.values(serviceCosts).reduce((sum, cost) => sum + cost, 0);

  await sequelize.transaction(async (t) => {
    // 対象プロジェクト・対象月のサービス別コストを一括削除
    await FinopsCostServiceMonthly.destroy({
      where: {
        project_id: projectId,
        billing_period: billingPeriod,
      },
      transaction: t,
    });

    // finops_cost_service_monthlyに一括INSERT
    const now = new Date();
    const serviceRows = Object.entries(serviceCosts).map(([serviceName, cost]) => ({
      project_id: projectId,
      billing_period: billingPeriod,
      service_name: serviceName,
      currency: currencyCode,
      cost,
      last_updated_at: now,
    }));

    if (serviceRows.length > 0) {
      await FinopsCostServiceMonthly.bulkCreate(serviceRows, { transaction: t });
    }

    // 既存のサマリーを取得
    const existingSummary = await FinopsCostSummary.findOne({
      where: {
        project_id: projectId,
        billing_period: billingPeriod,
      },
      transaction: t,
    });

    // 予測コストを計算（本日までの平均日次コスト × 当月の日数）
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const isCurrentMonth = billingYear === currentYear && billingMonth === currentMonth;

    let forecastCost = calculatedTotalCost;
    if (isCurrentMonth) {
      const daysInMonth = new Date(billingYear, billingMonth, 0).getDate();
      const daysSoFar = Object.keys(dailyCosts).length;
      if (daysSoFar > 0) {
        const avgDailyCost = calculatedTotalCost / daysSoFar;
        forecastCost = avgDailyCost * daysInMonth;
      } else if (existingSummary) {
        forecastCost = Number(existingSummary.forecast_cost) || calculatedTotalCost;
      }
    } else if (existingSummary) {
      // 過去月の場合は既存の予測コストを維持
      forecastCost = Number(existingSummary.forecast_cost) || calculatedTotalCost;
    }

    // 前月のデータを取得
    const prevMonth = billingMonth === 1 ? 12 : billingMonth - 1;
    const prevYear = billingMonth === 1 ? billingYear - 1 : billingYear;
    const prevBillingPeriod = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

    const prevSummary = await FinopsCostSummary.findOne({
      where: {
        project_id: projectId,
        billing_period: prevBillingPeriod,
      },
      transaction: t,
    });

    const previousMonthTotalCost = prevSummary?.total_cost || 0;
    const previousSamePeriodCost =
      previousSamePeriodCostOverride !== undefined
        ? previousSamePeriodCostOverride
        : prevSummary?.previous_same_period_cost || 0;

    // finops_cost_summaryにupsert
    await FinopsCostSummary.upsert(
      {
        project_id: projectId,
        billing_period: billingPeriod,
        currency: currencyCode,
        total_cost: calculatedTotalCost,
        forecast_cost: forecastCost,
        previous_same_period_cost: previousSamePeriodCost,
        previous_month_total_cost: previousMonthTotalCost,
        last_updated_at: now,
      },
      { transaction: t },
    );
  });
}
