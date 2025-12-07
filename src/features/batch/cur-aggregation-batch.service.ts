import { logInfo, logError } from '../../shared/logger';
import { getEnvVariableWithDefault } from '../../shared/database';
import { rinstackApiClient } from '../../shared/services/rinstack-api-client';
import {
  findPendingBillingFilesForCurBatch,
  lockBillingFileAsProcessingForCurBatch,
  updateBillingFileStatusToDoneForCurBatch,
  updateBillingFileStatusToErrorForCurBatch,
  findProjectConnectionByProjectIdForCurBatch,
  saveCurAggregatedCostsForCurBatch,
  findBillingFilesByProjectAndPeriodForCurBatch,
} from './cur-batch.repository';
import { getSecureParameter } from '../../shared/aws/parameter-store';
import { createCurS3Client, downloadAndDecompressCurFile } from '../../shared/aws/cur-s3-operations';
import {
  AWS_REGION,
  type CurBatchOptions,
  extractBillingPeriod,
  extractBillingVersion,
  determineLatestVersionPerGroup,
  type BillingFileGroupKey,
} from './cur-batch.shared';

/**
 * CSV行をパース（簡易実装）
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // 次の文字をスキップ
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * コスト値をパース（空文字、0、0.0などを0として扱う）
 */
function parseCostValue(value: string): number {
  if (!value || value.trim() === '') {
    return 0;
  }

  // クォートを除去
  const cleaned = value.replace(/^"|"$/g, '').trim();

  if (!cleaned || cleaned === '0' || cleaned === '0.0') {
    return 0;
  }

  const parsed = parseFloat(cleaned);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * 行からコストを取得（net_unblended_costを優先、なければunblended_cost）
 */
function getCostFromRow(
  row: string[],
  netUnblendedIdx: number | undefined,
  unblendedIdx: number | undefined,
): number {
  // net_unblended_costを優先的に使用
  if (netUnblendedIdx !== undefined && row.length > netUnblendedIdx) {
    const netUnblendedCost = parseCostValue(row[netUnblendedIdx]);
    if (netUnblendedCost > 0) {
      return netUnblendedCost;
    }
  }

  // net_unblended_costが使えない場合はunblended_costを使用
  if (unblendedIdx !== undefined && row.length > unblendedIdx) {
    const unblendedCost = parseCostValue(row[unblendedIdx]);
    return unblendedCost;
  }

  return 0;
}

/**
 * productカラム（JSON形式）からproduct_nameを抽出
 */
function parseProductName(productStr: string): string {
  if (!productStr || productStr.trim() === '') {
    return '';
  }

  try {
    // クォートを除去してJSONパース
    let cleaned = productStr.replace(/^"|"$/g, '').trim();
    // ダブルクォートのエスケープを処理
    cleaned = cleaned.replace(/""/g, '"');

    if (!cleaned || cleaned === '{}' || !cleaned.startsWith('{')) {
      return '';
    }

    const productData = JSON.parse(cleaned);
    return productData.product_name || productData.servicename || '';
  } catch {
    // JSONパースエラーは無視
    return '';
  }
}

/**
 * 日付文字列をYYYY-MM-DD形式に変換
 */
function normalizeDate(dateStr: string): string {
  if (!dateStr) {
    return '';
  }

  const cleaned = dateStr.replace(/^"|"$/g, '').trim();

  // 既にYYYY-MM-DD形式の場合
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }

  // ISO形式（2025-11-01T00:00:00Zなど）の場合
  if (cleaned.includes('T')) {
    try {
      const dt = new Date(cleaned.replace('Z', '+00:00'));
      if (!Number.isNaN(dt.getTime())) {
        return dt.toISOString().substring(0, 10);
      }
    } catch {
      // パースエラーは無視
    }
  }

  // YYYY-MM-DD形式を抽出
  const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return match[0];
  }

  return '';
}

// ここからGrouped集計用の実装

type ParseAndAggregateOptions = {
  lines: string[];
  usageStartDateIdx: number;
  unblendedCostIdx: number;
  netUnblendedCostIdx: number | undefined;
  currencyIdx: number | undefined;
  productIdx: number | undefined;
  productServiceCodeIdx: number | undefined;
  productCodeIdx: number | undefined;
  billingYear: number;
  billingMonth: number;
  serviceCosts: Record<string, number>;
  dailyCosts: Record<string, number>;
  currencyCodeRef: { value: string };
};

function parseAndAggregateCurFile(options: ParseAndAggregateOptions): void {
  const {
    lines,
    usageStartDateIdx,
    unblendedCostIdx,
    netUnblendedCostIdx,
    currencyIdx,
    productIdx,
    productServiceCodeIdx,
    productCodeIdx,
    billingYear,
    billingMonth,
    serviceCosts,
    dailyCosts,
    currencyCodeRef,
  } = options;

  for (const line of lines) {
    if (!line.trim()) continue;

    const values = parseCsvLine(line);

    const maxIdx = Math.max(
      usageStartDateIdx,
      unblendedCostIdx,
      netUnblendedCostIdx !== undefined ? netUnblendedCostIdx : -1,
      productIdx !== undefined ? productIdx : -1,
      productServiceCodeIdx !== undefined ? productServiceCodeIdx : -1,
      productCodeIdx !== undefined ? productCodeIdx : -1,
    );

    if (values.length <= maxIdx) {
      continue; // カラム数が足りない行をスキップ
    }

    // 通貨コードを取得（ファイル内で一貫している想定）
    if (!currencyCodeRef.value && currencyIdx !== undefined && values.length > currencyIdx) {
      currencyCodeRef.value = values[currencyIdx].replace(/^"|"$/g, '').trim();
    }

    // コストを取得（スクリプトと同じロジック）
    const cost = getCostFromRow(values, netUnblendedCostIdx, unblendedCostIdx);

    if (cost <= 0) {
      continue; // コストが0以下の行はスキップ
    }

    // サービス名を取得
    let serviceName = '';
    if (productIdx !== undefined && values[productIdx]) {
      serviceName = parseProductName(values[productIdx]);
    }
    if (!serviceName && productServiceCodeIdx !== undefined && values[productServiceCodeIdx]) {
      serviceName = values[productServiceCodeIdx].replace(/^"|"$/g, '').trim();
    }
    if (!serviceName && productCodeIdx !== undefined && values[productCodeIdx]) {
      serviceName = values[productCodeIdx].replace(/^"|"$/g, '').trim();
    }
    if (!serviceName) {
      serviceName = 'Unknown';
    }

    // 日付を取得
    const usageStartDate = values[usageStartDateIdx]?.replace(/^"|"$/g, '') || '';
    const normalizedDate = normalizeDate(usageStartDate);

    if (!normalizedDate) {
      continue; // 日付が取得できない行はスキップ
    }

    // 日付をパース
    const dateMatch = normalizedDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!dateMatch) continue;

    const [, recordYear, recordMonth] = dateMatch;
    const recordYearNum = parseInt(recordYear, 10);
    const recordMonthNum = parseInt(recordMonth, 10);

    // 対象月のデータのみを集計
    if (recordYearNum === billingYear && recordMonthNum === billingMonth) {
      // サービス別集計
      if (!serviceCosts[serviceName]) {
        serviceCosts[serviceName] = 0;
      }
      serviceCosts[serviceName] += cost;

      // 日別集計（予測用）
      const day = normalizedDate.substring(0, 10); // YYYY-MM-DD
      if (!dailyCosts[day]) {
        dailyCosts[day] = 0;
      }
      dailyCosts[day] += cost;
    }
  }
}

type GroupAggregationState = {
  projectId: string;
  billingPeriod: string;
  billingYear: number;
  billingMonth: number;
  serviceCosts: Record<string, number>;
  dailyCosts: Record<string, number>;
  currencyCodeRef: { value: string };
};

async function computePreviousSamePeriodCostFromContent(
  content: string,
  billingYear: number,
  billingMonth: number,
  daysLimit: number,
): Promise<number> {
  const aggregation: GroupAggregationState = {
    projectId: '',
    billingPeriod: `${billingYear}-${String(billingMonth).padStart(2, '0')}`,
    billingYear,
    billingMonth,
    serviceCosts: {},
    dailyCosts: {},
    currencyCodeRef: { value: '' },
  };

  await aggregateCurFileContentIntoAggregation(content, aggregation);

  let total = 0;
  for (const [day, cost] of Object.entries(aggregation.dailyCosts)) {
    if (!day) continue;
    const match = day.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) continue;
    const dayNum = parseInt(match[3], 10);
    if (Number.isNaN(dayNum)) continue;
    if (dayNum <= daysLimit) {
      total += cost;
    }
  }

  return total;
}

async function computePreviousSamePeriodCostForGroup(
  projectId: string,
  billingYear: number,
  billingMonth: number,
  daysLimit: number,
): Promise<number> {
  if (daysLimit <= 0) {
    return 0;
  }

  const prevMonth = billingMonth === 1 ? 12 : billingMonth - 1;
  const prevYear = billingMonth === 1 ? billingYear - 1 : billingYear;
  const prevBillingPeriod = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

  const files = await findBillingFilesByProjectAndPeriodForCurBatch(projectId, prevBillingPeriod);

  if (files.length === 0) {
    return 0;
  }

  const latestVersionByGroup = determineLatestVersionPerGroup(
    files,
    (file): BillingFileGroupKey => {
      const billingPeriod = file.billing_period || extractBillingPeriod(file.object_key) || prevBillingPeriod;
      return `${file.project_id}::${billingPeriod}`;
    },
    (file): string | null => {
      const billingPeriod = file.billing_period || extractBillingPeriod(file.object_key);
      return billingPeriod ? extractBillingVersion(file.object_key) : null;
    },
  );

  const connection = await findProjectConnectionByProjectIdForCurBatch(projectId);
  if (!connection) {
    throw new Error(`接続設定が見つかりません: projectId=${projectId}`);
  }

  const accessKeyId = await getSecureParameter(connection.access_key_id_param_path);
  const secretAccessKey = await getSecureParameter(connection.secret_access_key_param_path);

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('認証情報の取得に失敗しました');
  }

  const s3Client = createCurS3Client(accessKeyId, secretAccessKey, AWS_REGION);

  let total = 0;

  for (const file of files) {
    const billingPeriod = file.billing_period || extractBillingPeriod(file.object_key);
    const groupBillingPeriod = billingPeriod ?? prevBillingPeriod;
    const groupKey: BillingFileGroupKey = `${file.project_id}::${groupBillingPeriod}`;

    const latestVersion = latestVersionByGroup.get(groupKey) ?? null;
    const versionKey = billingPeriod ? extractBillingVersion(file.object_key) : null;

    const isVersionedGroup = latestVersion !== null;
    const isLatestVersion = !isVersionedGroup || versionKey === latestVersion;

    if (!isLatestVersion) {
      continue;
    }

    const content = await downloadAndDecompressCurFile(s3Client, file.bucket_name, file.object_key);

    const partial = await computePreviousSamePeriodCostFromContent(content, prevYear, prevMonth, daysLimit);

    total += partial;
  }

  return total;
}

async function aggregateCurFileContentIntoAggregation(
  content: string,
  aggregation: GroupAggregationState,
): Promise<void> {
  const lines = content.split('\n').filter((line) => line.trim());

  if (lines.length === 0) {
    throw new Error('ファイルが空です');
  }

  // ヘッダー行を取得
  const headerLine = lines[0];
  const headers = parseCsvLine(headerLine);
  const headerMap: Record<string, number> = {};
  headers.forEach((h, i) => {
    headerMap[h.replace(/^"|"$/g, '')] = i; // クォートを除去
  });

  // カラムマッピングからインデックスを取得
  const CUR_COLUMN_MAPPING = (await import('./cur-column-mapping.js')).CUR_COLUMN_MAPPING;
  const usageStartDateIdx = headerMap[CUR_COLUMN_MAPPING.USAGE_START_DATE];
  const unblendedCostIdx = headerMap[CUR_COLUMN_MAPPING.UNBLENDED_COST];
  const netUnblendedCostIdx = headerMap[CUR_COLUMN_MAPPING.NET_UNBLENDED_COST];
  const currencyIdx = headerMap[CUR_COLUMN_MAPPING.CURRENCY_CODE];
  const productIdx = headerMap[CUR_COLUMN_MAPPING.PRODUCT];
  const productServiceCodeIdx = headerMap[CUR_COLUMN_MAPPING.PRODUCT_SERVICECODE];
  const productCodeIdx = headerMap[CUR_COLUMN_MAPPING.PRODUCT_CODE];

  if (usageStartDateIdx === undefined || unblendedCostIdx === undefined || currencyIdx === undefined) {
    const missingColumns = [];
    if (usageStartDateIdx === undefined) missingColumns.push(CUR_COLUMN_MAPPING.USAGE_START_DATE);
    if (unblendedCostIdx === undefined) missingColumns.push(CUR_COLUMN_MAPPING.UNBLENDED_COST);
    if (currencyIdx === undefined) missingColumns.push(CUR_COLUMN_MAPPING.CURRENCY_CODE);
    throw new Error(`必要なカラムが見つかりません: ${missingColumns.join(', ')}`);
  }

  if (productIdx === undefined && productServiceCodeIdx === undefined && productCodeIdx === undefined) {
    throw new Error('productカラムまたはproduct_servicecodeカラムまたはproduct_codeカラムが見つかりません');
  }

  const dataLines = lines.slice(1);

  parseAndAggregateCurFile({
    lines: dataLines,
    usageStartDateIdx,
    unblendedCostIdx,
    netUnblendedCostIdx,
    currencyIdx,
    productIdx,
    productServiceCodeIdx,
    productCodeIdx,
    billingYear: aggregation.billingYear,
    billingMonth: aggregation.billingMonth,
    serviceCosts: aggregation.serviceCosts,
    dailyCosts: aggregation.dailyCosts,
    currencyCodeRef: aggregation.currencyCodeRef,
  });
}

// ACU減算処理
async function consumeAcuForCurAnalysis(fileId: string, projectId: string): Promise<void> {
  try {
    // ACU消費量を環境変数から取得
    const acuAmountEnv = getEnvVariableWithDefault(
      'ACU_FIXED_FINOPS_CUR_ANALYSIS_AMOUNT',
      '0',
    );
    const acuAmount = parseFloat(acuAmountEnv);

    if (Number.isNaN(acuAmount) || acuAmount <= 0) {
      logError(
        '[CUR Aggregation] Invalid ACU amount from environment variable, skipping ACU consumption',
        {
          fileId,
          projectId,
          acuAmountEnv,
        },
      );
      return;
    }

    logInfo('[CUR Aggregation] Consuming ACU after CUR analysis', {
      fileId,
      projectId,
      acuAmount,
    });

    const acuResult = await rinstackApiClient.consumeFixedAcu(projectId, acuAmount);

    logInfo('[CUR Aggregation] ACU consumption completed', {
      fileId,
      projectId,
      acuAmount,
      consumed: acuResult.consumption.consumed,
      balance: acuResult.consumption.balance,
      overdrawn: acuResult.consumption.overdrawn,
    });
  } catch (acuError) {
    // ACU減算エラーはログに記録するが、CUR解析処理自体は成功として扱う
    logError('[CUR Aggregation] ACU consumption failed (non-fatal)', {
      fileId,
      projectId,
      error: acuError instanceof Error ? acuError.message : String(acuError),
    });
  }
}

/**
 * CUR Aggregation: CUR 解析・集計処理
 * - finops_billing_files から PENDING レコードを取得
 * - S3からファイルをダウンロードしてパース
 * - レコードをパースしてコスト集計
 * - finops_cost_summary / finops_cost_service_monthly に upsert
 */
export async function runCurAggregationBatch(options: CurBatchOptions = {}): Promise<void> {
  const { projectId } = options;

  try {
    // PENDINGファイルを取得（上限100件）
    const pendingFiles = await findPendingBillingFilesForCurBatch(projectId, 100);

    if (pendingFiles.length === 0) {
      logInfo('[CUR Aggregation] 処理対象ファイルなし', { projectId });
      return;
    }

    // 1周目: billingPeriod / version 単位でメタ情報を構築
    // グループごとに最新バージョンを算出
    const latestVersionByGroup = determineLatestVersionPerGroup(
      pendingFiles,
      (file): BillingFileGroupKey => {
        const billingPeriod = file.billing_period || extractBillingPeriod(file.object_key);
        const groupBillingPeriod = billingPeriod ?? '';
        return `${file.project_id}::${groupBillingPeriod}`;
      },
      (file): string | null => {
        const billingPeriod = file.billing_period || extractBillingPeriod(file.object_key);
        return billingPeriod ? extractBillingVersion(file.object_key) : null;
      },
    );

    const allowedFileIds = new Set<string>();
    const firstFileGroupKeys = new Set<BillingFileGroupKey>(latestVersionByGroup.keys());
    const processedFirstFileGroupKeys = new Set<BillingFileGroupKey>();
    const groupAggregations = new Map<BillingFileGroupKey, GroupAggregationState>();
    const fileIdToGroupKey = new Map<string, BillingFileGroupKey>();

    for (const file of pendingFiles) {
      const billingPeriod = file.billing_period || extractBillingPeriod(file.object_key);
      const groupBillingPeriod = billingPeriod ?? '';
      const groupKey: BillingFileGroupKey = `${file.project_id}::${groupBillingPeriod}`;
      fileIdToGroupKey.set(file.id, groupKey);

      const latestVersion = latestVersionByGroup.get(groupKey) ?? null;
      const versionKey = billingPeriod ? extractBillingVersion(file.object_key) : null;

      const isVersionedGroup = latestVersion !== null;
      const isLatestVersion = !isVersionedGroup || versionKey === latestVersion;

      // CURがバージョン管理されている場合は最新バージョンのファイルのみを処理対象とする
      // バージョン管理されていない（上書き更新の）場合は全てのファイルを処理対象とする
      if (isLatestVersion) {
        allowedFileIds.add(file.id);
      }
    }

    logInfo('[CUR Aggregation] 処理開始', { fileCount: pendingFiles.length, projectId });

    for (const file of pendingFiles) {
      try {
        const groupKey = fileIdToGroupKey.get(file.id);
        const shouldProcess = !groupKey || allowedFileIds.has(file.id);

        if (!shouldProcess) {
          await updateBillingFileStatusToDoneForCurBatch(file.id);
          logInfo('[CUR Aggregation] 古いバージョンのCURファイルをスキップ', {
            fileId: file.id,
            fileName: file.object_key,
          });
          continue;
        }

        const resetExisting =
          groupKey !== undefined &&
          firstFileGroupKeys.has(groupKey) &&
          !processedFirstFileGroupKeys.has(groupKey);

        // PROCESSINGに更新（ロック）
        const locked = await lockBillingFileAsProcessingForCurBatch(file.id);

        if (!locked) {
          // 他のWorkerに奪われた
          logInfo('[CUR Aggregation] ファイルは他のWorkerに処理中', { fileId: file.id });
          continue;
        }

        // S3からファイルをダウンロード
        const connection = await findProjectConnectionByProjectIdForCurBatch(file.project_id);

        if (!connection) {
          throw new Error(`接続設定が見つかりません: projectId=${file.project_id}`);
        }

        // Parameter Storeから認証情報を取得
        const accessKeyId = await getSecureParameter(connection.access_key_id_param_path);
        const secretAccessKey = await getSecureParameter(connection.secret_access_key_param_path);

        if (!accessKeyId || !secretAccessKey) {
          throw new Error('認証情報の取得に失敗しました');
        }

        // S3クライアントを作成
        const s3Client = createCurS3Client(accessKeyId, secretAccessKey, AWS_REGION);

        // S3からファイルをダウンロード・解凍
        const content = await downloadAndDecompressCurFile(
          s3Client,
          file.bucket_name,
          file.object_key,
        );

        // billingPeriodを取得
        const billingPeriod = file.billing_period || extractBillingPeriod(file.object_key);
        if (!billingPeriod) {
          throw new Error('billingPeriodが取得できません');
        }

        // グループ集計用の状態を取得・初期化
        if (groupKey) {
          let aggregation = groupAggregations.get(groupKey);
          if (!aggregation) {
            const [yearStr, monthStr] = billingPeriod.split('-');
            const billingYear = parseInt(yearStr, 10);
            const billingMonth = parseInt(monthStr, 10);

            aggregation = {
              projectId: file.project_id,
              billingPeriod,
              billingYear,
              billingMonth,
              serviceCosts: {},
              dailyCosts: {},
              currencyCodeRef: { value: '' },
            };

            groupAggregations.set(groupKey, aggregation);
          }

          await aggregateCurFileContentIntoAggregation(content, aggregation);
        }

        // ACU減算
        await consumeAcuForCurAnalysis(file.id, file.project_id);

        // ファイル処理完了としてDONEに更新
        await updateBillingFileStatusToDoneForCurBatch(file.id);

        if (resetExisting && groupKey !== undefined) {
          processedFirstFileGroupKeys.add(groupKey);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        await updateBillingFileStatusToErrorForCurBatch(file.id, errorMessage);

        logError('[CUR Aggregation] ファイル処理エラー', {
          fileId: file.id,
          fileName: file.object_key,
          errorMessage,
          errorStack,
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : error,
        });
      }
    }

    // グループごとに集計結果を保存（billingPeriod昇順 = 前月→当月の順で処理）
    const sortedAggregations = Array.from(groupAggregations.entries()).sort(([, a], [, b]) =>
      a.billingPeriod.localeCompare(b.billingPeriod),
    );

    for (const [, aggregation] of sortedAggregations) {
      const {
        projectId: aggProjectId,
        billingPeriod,
        billingYear,
        billingMonth,
        serviceCosts,
        dailyCosts,
        currencyCodeRef,
      } = aggregation;

      const currencyCode = currencyCodeRef.value;

      // 前月同時期コストの期間は「1日〜本日」とする（カレンダー日付ベース）
      const today = new Date();
      const isCurrentMonth =
        billingYear === today.getFullYear() && billingMonth === today.getMonth() + 1;

      const daysLimit = isCurrentMonth ? today.getDate() : undefined;

      const previousSamePeriodCostOverride =
        daysLimit !== undefined
          ? await computePreviousSamePeriodCostForGroup(aggProjectId, billingYear, billingMonth, daysLimit)
          : undefined;

      await saveCurAggregatedCostsForCurBatch({
        projectId: aggProjectId,
        billingPeriod,
        billingYear,
        billingMonth,
        currencyCode,
        serviceCosts,
        dailyCosts,
        previousSamePeriodCostOverride,
      });
    }

    logInfo('[CUR Aggregation] 処理完了');
  } catch (error) {
    logError('[CUR Aggregation] バッチ処理エラー', { error });
    throw error;
  }
}
