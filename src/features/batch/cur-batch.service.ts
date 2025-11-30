// CUR バッチ処理（Batch A / Batch B）のユースケース関数を定義するサービスレイヤー
//
// - Batch A: S3 上の CUR ファイル一覧を取得し、課金レポートファイル管理テーブルに登録する
// - Batch B: PENDING 状態の CUR ファイルを処理し、コスト集計テーブルへ反映する
//
// S3実装: 実際のS3バケットからファイルを取得

import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { logInfo, logError } from '../../shared/logger';
import FinopsProjectConnection from '../../models/finops-project-connection';
import FinopsBillingFile from '../../models/finops-billing-file';
import FinopsCostSummary from '../../models/finops-cost-summary';
import FinopsCostServiceMonthly from '../../models/finops-cost-service-monthly';
import { enqueueCurAggregateJob } from './cur-batch.queue';
import { getSecureParameter } from '../../shared/aws/parameter-store';
import { createCurS3Client, listCurFiles, downloadAndDecompressCurFile } from '../../shared/aws/cur-s3-operations';
import { getEnvVariable } from '../../shared/database';

export type CurBatchOptions = {
  projectId?: string;
};

const AWS_REGION = getEnvVariable('AWS_REGION') || 'ap-northeast-1';

/**
 * S3オブジェクトキーからbillingPeriodを抽出
 * 
 * 対応パターン:
 * - Hiveパーティション形式:
 *   - reports/cur2-daily-versioned-personal/data/BILLING_PERIOD=2025-11/2025-11-30T01:39:08.326Z-7eff4bd3-559c-4b1f-88ce-0b715856262c/cur2-daily-versioned-personal-00001.csv.gz
 *   - reports/cur2-daily-overwrite-personal/data/BILLING_PERIOD=2025-11/cur2-daily-overwrite-personal-00001.csv.gz
 * 
 * @param objectKey S3オブジェクトキー（フルパス）
 * @returns billingPeriod (例: "2025-11") または null
 */
function extractBillingPeriod(objectKey: string): string | null {
  // Hiveパーティション形式 BILLING_PERIOD=YYYY-MM
  const hivePartitionMatch = objectKey.match(/BILLING_PERIOD=(\d{4})-(\d{2})/);
  if (hivePartitionMatch) {
    const [, year, month] = hivePartitionMatch;
    return `${year}-${month}`;
  }

  return null;
}

/**
 * Batch A: CUR 取得処理
 *
 * 設計書 3. CUR取得処理（Batch A）に対応。
 * - S3バケットからファイル一覧を取得
 * - 未登録ファイルのみ 課金レポートファイル管理テーブル に PENDING で登録
 */
export async function runCurFetchBatch(options: CurBatchOptions = {}): Promise<void> {
  const { projectId } = options;

  try {
    // 対象プロジェクトの取得
    const whereCondition: any = {};
    if (projectId) {
      whereCondition.project_id = projectId;
    }

    const connections = await FinopsProjectConnection.findAll({
      where: whereCondition,
    });

    if (connections.length === 0) {
      logInfo('[Batch A] 対象プロジェクトが見つかりません', { projectId });
      return;
    }

    logInfo('[Batch A] 処理開始', { projectCount: connections.length, projectId });
    for (const connection of connections) {
      try {
        // Parameter Storeから認証情報を取得
        const accessKeyId = await getSecureParameter(connection.access_key_id_param_path);
        const secretAccessKey = await getSecureParameter(connection.secret_access_key_param_path);

        if (!accessKeyId || !secretAccessKey) {
          logError('[Batch A] 認証情報の取得に失敗', {
            projectId: connection.project_id,
            accessKeyIdParamPath: connection.access_key_id_param_path,
            secretAccessKeyParamPath: connection.secret_access_key_param_path,
          });
          continue;
        }

        // S3クライアントを作成
        const s3Client = createCurS3Client(accessKeyId, secretAccessKey, AWS_REGION);

        // S3からファイル一覧を取得
        const objectKeys = await listCurFiles(
          s3Client,
          connection.cur_bucket_name,
          connection.cur_prefix
        );

        logInfo('[Batch A] S3ファイル検出', {
          projectId: connection.project_id,
          bucketName: connection.cur_bucket_name,
          prefix: connection.cur_prefix,
          fileCount: objectKeys.length,
        });

        const newFiles: string[] = [];

        for (const objectKey of objectKeys) {
          const objectKeyHash = crypto.createHash('sha256').update(objectKey).digest('hex');
          const billingPeriod = extractBillingPeriod(objectKey);

          // 既存レコードをチェック
          const existing = await FinopsBillingFile.findOne({
            where: {
              project_id: connection.project_id,
              bucket_name: connection.cur_bucket_name,
              object_key_hash: objectKeyHash,
            },
          });

          if (!existing) {
            // 新規登録
            await FinopsBillingFile.create({
              project_id: connection.project_id,
              aws_account_id: connection.aws_account_id,
              bucket_name: connection.cur_bucket_name,
              object_key: objectKey,
              object_key_hash: objectKeyHash,
              billing_period: billingPeriod,
              status: 'PENDING',
            });

            newFiles.push(objectKey);
            logInfo('[Batch A] ファイル登録', {
              projectId: connection.project_id,
              objectKey,
              billingPeriod,
            });
          }
        }

        // 新規ファイルがある場合、Batch Bジョブを登録
        if (newFiles.length > 0) {
          await enqueueCurAggregateJob({ projectId: connection.project_id });
          logInfo('[Batch A] Batch Bジョブ登録', {
            projectId: connection.project_id,
            newFileCount: newFiles.length,
          });
        }
      } catch (error) {
        logError('[Batch A] プロジェクト処理エラー', {
          projectId: connection.project_id,
          error,
        });
        // エラーが発生しても次のプロジェクトの処理を継続
      }
    }

    logInfo('[Batch A] 処理完了');
  } catch (error) {
    logError('[Batch A] バッチ処理エラー', { error });
    throw error;
  }
}

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
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * 行からコストを取得（net_unblended_costを優先、なければunblended_cost）
 */
function getCostFromRow(
  row: string[],
  netUnblendedIdx: number | undefined,
  unblendedIdx: number | undefined
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
  } catch (e) {
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
      if (!isNaN(dt.getTime())) {
        return dt.toISOString().substring(0, 10);
      }
    } catch (e) {
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

/**
 * CURファイルからコストを集計してDBに保存
 */
async function aggregateAndSaveCosts(
  content: string,
  projectId: string,
  billingPeriod: string,
  awsAccountId: string
): Promise<void> {
  // ファイルを行に分割
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
  const productIdx = headerMap[CUR_COLUMN_MAPPING.PRODUCT];
  const productCodeIdx = headerMap[CUR_COLUMN_MAPPING.PRODUCT_CODE];

  if (usageStartDateIdx === undefined || unblendedCostIdx === undefined) {
    const missingColumns = [];
    if (usageStartDateIdx === undefined) missingColumns.push(CUR_COLUMN_MAPPING.USAGE_START_DATE);
    if (unblendedCostIdx === undefined) missingColumns.push(CUR_COLUMN_MAPPING.UNBLENDED_COST);
    throw new Error(`必要なカラムが見つかりません: ${missingColumns.join(', ')}`);
  }

  if (productIdx === undefined && productCodeIdx === undefined) {
    throw new Error(`productカラムまたはproduct_codeカラムが見つかりません`);
  }

  const [year, month] = billingPeriod.split('-');
  const billingYear = parseInt(year, 10);
  const billingMonth = parseInt(month, 10);

  // 既存のサービス別コストを読み込む（複数ファイル対応）
  const existingServices = await FinopsCostServiceMonthly.findAll({
    where: {
      project_id: projectId,
      billing_period: billingPeriod,
    },
  });

  // 集計用のデータ構造（既存データから初期化）
  const serviceCosts: Record<string, number> = {};
  for (const existing of existingServices) {
    serviceCosts[existing.service_name] = Number(existing.cost) || 0;
  }
  const dailyCosts: Record<string, number> = {}; // 日別コスト（予測用）

  // データ行を処理（ヘッダーを除く）
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const values = parseCsvLine(line);

    const maxIdx = Math.max(
      usageStartDateIdx,
      unblendedCostIdx,
      netUnblendedCostIdx !== undefined ? netUnblendedCostIdx : -1,
      productIdx !== undefined ? productIdx : -1,
      productCodeIdx !== undefined ? productCodeIdx : -1
    );

    if (values.length <= maxIdx) {
      continue; // カラム数が足りない行をスキップ
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

  // サービス別コストの合計を計算
  const calculatedTotalCost = Object.values(serviceCosts).reduce((sum, cost) => sum + cost, 0);

  // finops_cost_service_monthlyにupsert（先にサービス別コストを保存）
  for (const [serviceName, cost] of Object.entries(serviceCosts)) {
    await FinopsCostServiceMonthly.upsert({
      project_id: projectId,
      billing_period: billingPeriod,
      service_name: serviceName,
      cost: cost,
      last_updated_at: new Date(),
    });
  }

  // 既存のサマリーを取得
  const existingSummary = await FinopsCostSummary.findOne({
    where: {
      project_id: projectId,
      billing_period: billingPeriod,
    },
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
  });

  const previousMonthTotalCost = prevSummary?.total_cost || 0;
  const previousSamePeriodCost = prevSummary?.previous_same_period_cost || 0;

  // finops_cost_summaryにupsert
  await FinopsCostSummary.upsert({
    project_id: projectId,
    billing_period: billingPeriod,
    total_cost: calculatedTotalCost,
    forecast_cost: forecastCost,
    previous_same_period_cost: previousSamePeriodCost,
    previous_month_total_cost: previousMonthTotalCost,
    last_updated_at: new Date(),
  });

  logInfo('[Batch B] コスト集計完了', {
    projectId,
    billingPeriod,
    totalCost: calculatedTotalCost,
    forecastCost,
    serviceCount: Object.keys(serviceCosts).length,
  });
}

/**
 * Batch B: CUR 解析・集計処理
 *
 * 設計書 4. CUR解析・集計処理（Batch B）に対応。
 * - finops_billing_files から PENDING レコードを取得
 * - S3からファイルをダウンロードしてパース
 * - レコードをパースしてコスト集計
 * - finops_cost_summary / finops_cost_service_monthly に upsert
 */
export async function runCurAggregateBatch(options: CurBatchOptions = {}): Promise<void> {
  const { projectId } = options;

  try {
    // PENDINGファイルを取得（上限100件）
    const whereCondition: any = { status: 'PENDING' };
    if (projectId) {
      whereCondition.project_id = projectId;
    }

    const pendingFiles = await FinopsBillingFile.findAll({
      where: whereCondition,
      limit: 100,
      order: [['created_at', 'ASC']],
    });

    if (pendingFiles.length === 0) {
      logInfo('[Batch B] 処理対象ファイルなし', { projectId });
      return;
    }

    logInfo('[Batch B] 処理開始', { fileCount: pendingFiles.length, projectId });

    for (const file of pendingFiles) {
      try {
        // PROCESSINGに更新（ロック）
        const [updatedCount] = await FinopsBillingFile.update(
          { status: 'PROCESSING' },
          {
            where: {
              id: file.id,
              status: 'PENDING', // 早い者勝ちでロック
            },
          }
        );

        if (updatedCount === 0) {
          // 他のWorkerに奪われた
          logInfo('[Batch B] ファイルは他のWorkerに処理中', { fileId: file.id });
          continue;
        }

        // S3からファイルをダウンロード
        const connection = await FinopsProjectConnection.findOne({
          where: { project_id: file.project_id },
        });

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
          file.object_key
        );

        // billingPeriodを取得
        const billingPeriod = file.billing_period || extractBillingPeriod(file.object_key);
        if (!billingPeriod) {
          throw new Error('billingPeriodが取得できません');
        }

        // 解凍後のファイルをtmpディレクトリに保存（デバッグ用）
        try {
          const tmpDir = path.join(process.cwd(), 'tmp', 'cur-decompressed', file.project_id, billingPeriod);
          await fs.mkdir(tmpDir, { recursive: true });
          
          // ファイル名を生成（.gzを除去）
          const fileName = path.basename(file.object_key).replace(/\.gz$/, '');
          const tmpFilePath = path.join(tmpDir, fileName);
          
          await fs.writeFile(tmpFilePath, content, 'utf-8');
          logInfo('[Batch B] 解凍後のファイルをtmpに保存', {
            fileId: file.id,
            tmpFilePath,
            contentLength: content.length,
          });
        } catch (saveError) {
          // tmp保存エラーは無視して処理を継続
          logError('[Batch B] tmpファイル保存エラー', {
            fileId: file.id,
            error: saveError instanceof Error ? saveError.message : String(saveError),
          });
        }

        // コスト集計処理を実行
        await aggregateAndSaveCosts(
          content,
          file.project_id,
          billingPeriod,
          file.aws_account_id
        );

        // ステータスをDONEに更新
        await FinopsBillingFile.update(
          { status: 'DONE' },
          { where: { id: file.id } }
        );

        logInfo('[Batch B] ファイル処理完了', {
          fileId: file.id,
          fileName: file.object_key,
        });
      } catch (error) {
        // エラーメッセージを取得
        const errorMessage = error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);

        const errorStack = error instanceof Error ? error.stack : undefined;

        // エラー時はERRORステータスに更新
        await FinopsBillingFile.update(
          {
            status: 'ERROR',
            error_message: errorMessage,
          },
          { where: { id: file.id } }
        );

        logError('[Batch B] ファイル処理エラー', {
          fileId: file.id,
          fileName: file.object_key,
          errorMessage,
          errorStack,
          error: error instanceof Error ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          } : error,
        });
      }
    }

    logInfo('[Batch B] 処理完了');
  } catch (error) {
    logError('[Batch B] バッチ処理エラー', { error });
    throw error;
  }
}
