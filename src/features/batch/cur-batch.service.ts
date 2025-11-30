// CUR バッチ処理（Batch A / Batch B）のユースケース関数を定義するサービスレイヤー
//
// - Batch A: S3 上の CUR ファイル一覧を取得し、課金レポートファイル管理テーブルに登録する
// - Batch B: PENDING 状態の CUR ファイルを処理し、コスト集計テーブルへ反映する
//
// モック実装: ローカルディレクトリ（docs/s3_mock）からファイルを取得

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { logInfo, logError } from '../../shared/logger';
import FinopsProjectConnection from '../../models/finops-project-connection';
import FinopsBillingFile from '../../models/finops-billing-file';
import FinopsCostSummary from '../../models/finops-cost-summary';
import FinopsCostServiceMonthly from '../../models/finops-cost-service-monthly';
import { enqueueCurAggregateJob } from './cur-batch.queue';

export type CurBatchOptions = {
  projectId?: string;
};

// モックディレクトリのパス（環境変数で上書き可能）
const MOCK_S3_DIR = process.env.MOCK_S3_DIR || path.join(__dirname, '../../../docs/s3_mock');

/**
 * ファイル名からbillingPeriodを抽出
 * 例: "Dec2018-WorkshopCUR-00001.csv" -> "2018-12"
 */
function extractBillingPeriod(fileName: string): string | null {
  // パターン: {Month}{Year}-*.csv
  // 月のマッピング
  const monthMap: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04',
    May: '05', Jun: '06', Jul: '07', Aug: '08',
    Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };

  const match = fileName.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{4})/);
  if (match) {
    const [, month, year] = match;
    const monthNum = monthMap[month];
    if (monthNum) {
      return `${year}-${monthNum}`;
    }
  }
  return null;
}

/**
 * Batch A: CUR 取得処理（モック実装）
 *
 * 設計書 3. CUR取得処理（Batch A）に対応。
 * - モックディレクトリからファイル一覧を取得
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

    // モックディレクトリからファイル一覧を取得
    const files = await fs.readdir(MOCK_S3_DIR);
    const csvFiles = files.filter((f) => f.endsWith('.csv'));

    logInfo('[Batch A] モックファイル検出', { fileCount: csvFiles.length, mockDir: MOCK_S3_DIR });

    // 各プロジェクトについて処理
    for (const connection of connections) {
      try {
        const newFiles: string[] = [];

        for (const fileName of csvFiles) {
          const objectKey = fileName;
          const objectKeyHash = crypto.createHash('sha256').update(objectKey).digest('hex');
          const billingPeriod = extractBillingPeriod(fileName);

          // 既存レコードをチェック
          const existing = await FinopsBillingFile.findOne({
            where: {
              project_id: connection.project_id,
              bucket_name: 'mock-bucket', // モック用
              object_key_hash: objectKeyHash,
            },
          });

          if (!existing) {
            // 新規登録
            await FinopsBillingFile.create({
              project_id: connection.project_id,
              aws_account_id: connection.aws_account_id,
              bucket_name: 'mock-bucket',
              object_key: objectKey,
              object_key_hash: objectKeyHash,
              billing_period: billingPeriod,
              status: 'PENDING',
            });

            newFiles.push(fileName);
            logInfo('[Batch A] ファイル登録', {
              projectId: connection.project_id,
              fileName,
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
 * Batch B: CUR 解析・集計処理（モック実装）
 *
 * 設計書 4. CUR解析・集計処理（Batch B）に対応。
 * - finops_billing_files から PENDING レコードを取得
 * - モックファイルを読み込んでパース
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

        // モックファイルを読み込み
        const filePath = path.join(MOCK_S3_DIR, file.object_key);
        const content = await fs.readFile(filePath, 'utf-8');
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
        const productNameIdx = headerMap[CUR_COLUMN_MAPPING.PRODUCT_NAME];

        if (usageStartDateIdx === undefined || unblendedCostIdx === undefined || productNameIdx === undefined) {
          throw new Error('必要なカラムが見つかりません');
        }

        // データ行をパースして集計
        const billingPeriod = file.billing_period || extractBillingPeriod(file.object_key);
        if (!billingPeriod) {
          throw new Error('billingPeriodが取得できません');
        }

        const [year, month] = billingPeriod.split('-');
        const billingYear = parseInt(year, 10);
        const billingMonth = parseInt(month, 10);

        // 既存のサービス別コストを読み込む（複数ファイル対応）
        const existingServices = await FinopsCostServiceMonthly.findAll({
          where: {
            project_id: file.project_id,
            billing_period: billingPeriod,
          },
        });

        // 集計用のデータ構造（既存データから初期化）
        const serviceCosts: Record<string, number> = {};
        for (const existing of existingServices) {
          serviceCosts[existing.service_name] = Number(existing.cost) || 0;
        }
        let totalCost = 0;
        const dailyCosts: Record<string, number> = {}; // 日別コスト（予測用）

        // データ行を処理（ヘッダーを除く）
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line.trim()) continue;

          const values = parseCsvLine(line);
          if (values.length <= Math.max(usageStartDateIdx, unblendedCostIdx, productNameIdx)) {
            continue; // カラム数が足りない行をスキップ
          }

          const usageStartDate = values[usageStartDateIdx]?.replace(/^"|"$/g, '') || '';
          const unblendedCostStr = values[unblendedCostIdx]?.replace(/^"|"$/g, '') || '0';
          const productName = values[productNameIdx]?.replace(/^"|"$/g, '') || '';

          if (!usageStartDate || !productName) continue;

          // 日付をパース（例: "2018-12-01 11:00:00.000"）
          const dateMatch = usageStartDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (!dateMatch) continue;

          const [, recordYear, recordMonth] = dateMatch;
          const recordYearNum = parseInt(recordYear, 10);
          const recordMonthNum = parseInt(recordMonth, 10);

          // 対象月のデータのみを集計
          if (recordYearNum === billingYear && recordMonthNum === billingMonth) {
            const cost = parseFloat(unblendedCostStr) || 0;
            totalCost += cost;

            // サービス別集計
            if (!serviceCosts[productName]) {
              serviceCosts[productName] = 0;
            }
            serviceCosts[productName] += cost;

            // 日別集計（予測用）
            const day = usageStartDate.substring(0, 10); // YYYY-MM-DD
            if (!dailyCosts[day]) {
              dailyCosts[day] = 0;
            }
            dailyCosts[day] += cost;
          }
        }

        // サービス別コストの合計を計算（予測コスト計算に使用）
        const calculatedTotalCost = Object.values(serviceCosts).reduce((sum, cost) => sum + cost, 0);

        // 予測コストを計算（本日までの平均日次コスト × 当月の日数）
        // 既存の日別コストも考慮する必要があるが、簡易実装として現在のファイルのデータのみを使用
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1;
        const isCurrentMonth = billingYear === currentYear && billingMonth === currentMonth;

        // 既存のサマリーを取得して予測コストを計算
        const existingSummary = await FinopsCostSummary.findOne({
          where: {
            project_id: file.project_id,
            billing_period: billingPeriod,
          },
        });

        let forecastCost = calculatedTotalCost;
        if (isCurrentMonth) {
          const daysInMonth = new Date(billingYear, billingMonth, 0).getDate();
          const daysSoFar = Object.keys(dailyCosts).length;
          if (daysSoFar > 0) {
            // サービス別コストの合計から予測
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
            project_id: file.project_id,
            billing_period: prevBillingPeriod,
          },
        });

        const previousMonthTotalCost = prevSummary?.total_cost || 0;

        // 前月同時期コストを計算
        // 現在のファイルの日付範囲を取得して、前月の同じ日付範囲のコストを計算
        let previousSamePeriodCost = 0;
        
        // 現在のファイルの日付範囲を取得
        const currentFileDates = Object.keys(dailyCosts).sort();
        if (currentFileDates.length > 0 && prevSummary) {
          // 現在のファイルの最後の日付を取得（処理済みの日付範囲の終了日）
          const lastDate = currentFileDates[currentFileDates.length - 1];
          const [, , currentDay] = lastDate.split('-');
          const currentDayNum = parseInt(currentDay, 10);
          
          // 前月の同じ日付範囲（1日〜現在の日付まで）のコストを計算
          // 前月のファイルを取得
          const prevFiles = await FinopsBillingFile.findAll({
            where: {
          project_id: file.project_id,
              billing_period: prevBillingPeriod,
              status: 'DONE',
            },
          });
          
          if (prevFiles.length > 0) {
            // 前月のファイルから同じ日付範囲のコストを集計
            for (const prevFile of prevFiles) {
              try {
                const prevFilePath = path.join(MOCK_S3_DIR, prevFile.object_key);
                const prevContent = await fs.readFile(prevFilePath, 'utf-8');
                const prevLines = prevContent.split('\n').filter((line) => line.trim());
                
                if (prevLines.length === 0) continue;
                
                const prevHeaderLine = prevLines[0];
                const prevHeaders = parseCsvLine(prevHeaderLine);
                const prevHeaderMap: Record<string, number> = {};
                prevHeaders.forEach((h, i) => {
                  prevHeaderMap[h.replace(/^"|"$/g, '')] = i;
                });
                
                const prevUsageStartDateIdx = prevHeaderMap[CUR_COLUMN_MAPPING.USAGE_START_DATE];
                const prevUnblendedCostIdx = prevHeaderMap[CUR_COLUMN_MAPPING.UNBLENDED_COST];
                
                if (prevUsageStartDateIdx === undefined || prevUnblendedCostIdx === undefined) {
                  continue;
                }
                
                // 前月の同じ日付範囲（1日〜現在の日付まで）のコストを集計
                for (let j = 1; j < prevLines.length; j++) {
                  const prevLine = prevLines[j];
                  if (!prevLine.trim()) continue;
                  
                  const prevValues = parseCsvLine(prevLine);
                  if (prevValues.length <= Math.max(prevUsageStartDateIdx, prevUnblendedCostIdx)) {
                    continue;
                  }
                  
                  const prevUsageStartDate = prevValues[prevUsageStartDateIdx]?.replace(/^"|"$/g, '') || '';
                  const prevUnblendedCostStr = prevValues[prevUnblendedCostIdx]?.replace(/^"|"$/g, '') || '0';
                  
                  if (!prevUsageStartDate) continue;
                  
                  const prevDateMatch = prevUsageStartDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
                  if (!prevDateMatch) continue;
                  
                  const [, prevRecordYear, prevRecordMonth, prevRecordDay] = prevDateMatch;
                  const prevRecordYearNum = parseInt(prevRecordYear, 10);
                  const prevRecordMonthNum = parseInt(prevRecordMonth, 10);
                  const prevRecordDayNum = parseInt(prevRecordDay, 10);
                  
                  // 前月の同じ日付範囲（1日〜現在の日付まで）のコストを集計
                  if (
                    prevRecordYearNum === prevYear &&
                    prevRecordMonthNum === prevMonth &&
                    prevRecordDayNum <= currentDayNum
                  ) {
                    const prevCost = parseFloat(prevUnblendedCostStr) || 0;
                    previousSamePeriodCost += prevCost;
                  }
                }
              } catch (error) {
                // ファイル読み込みエラーは無視して続行
                logError('[Batch B] 前月ファイル読み込みエラー', {
                  fileId: prevFile.id,
                  fileName: prevFile.object_key,
                  error,
        });
              }
            }
          }
        }
        
        // 前月のファイルが存在しない場合や計算できない場合は、前月の総コストを使用
        if (previousSamePeriodCost === 0 && prevSummary) {
          previousSamePeriodCost = previousMonthTotalCost;
        }

        // finops_cost_service_monthlyにupsert（先にサービス別コストを保存）
        for (const [serviceName, cost] of Object.entries(serviceCosts)) {
          await FinopsCostServiceMonthly.upsert({
            project_id: file.project_id,
            billing_period: billingPeriod,
            service_name: serviceName,
            cost: cost,
            last_updated_at: new Date(),
          });
        }

        // finops_cost_summaryにupsert
        await FinopsCostSummary.upsert({
          project_id: file.project_id,
          billing_period: billingPeriod,
          total_cost: calculatedTotalCost,
          forecast_cost: forecastCost,
          previous_same_period_cost: previousSamePeriodCost,
          previous_month_total_cost: previousMonthTotalCost,
          last_updated_at: new Date(),
        });

        // ステータスをDONEに更新
        await FinopsBillingFile.update(
          { status: 'DONE' },
          { where: { id: file.id } }
        );

        logInfo('[Batch B] ファイル処理完了', {
          fileId: file.id,
          fileName: file.object_key,
          billingPeriod,
          fileTotalCost: totalCost,
          calculatedTotalCost: calculatedTotalCost,
          serviceCount: Object.keys(serviceCosts).length,
        });
      } catch (error) {
        // エラー時はERRORステータスに更新
        await FinopsBillingFile.update(
          {
            status: 'ERROR',
            error_message: error instanceof Error ? error.message : String(error),
          },
          { where: { id: file.id } }
        );

        logError('[Batch B] ファイル処理エラー', {
          fileId: file.id,
          fileName: file.object_key,
          error,
        });
      }
    }

    logInfo('[Batch B] 処理完了');
  } catch (error) {
    logError('[Batch B] バッチ処理エラー', { error });
    throw error;
  }
}
