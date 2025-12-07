import * as crypto from 'crypto';
import { logInfo, logWarn, logError } from '../../shared/logger';
import {
  findTargetProjectConnectionsForCurBatch,
  findBillingFileByObjectKeyHashForCurBatch,
  createBillingFileForCurBatch,
  resetBillingFileToPendingWithS3LastModifiedForCurBatch,
} from './cur-batch.repository';
import { enqueueCurAggregationJob } from './cur-batch.queue';
import { getSecureParameter } from '../../shared/aws/parameter-store';
import { createCurS3Client, listCurFiles } from '../../shared/aws/cur-s3-operations';
import {
  AWS_REGION,
  type CurBatchOptions,
  extractBillingPeriod,
  extractBillingVersion,
  determineLatestVersionPerGroup,
  type BillingFileGroupKey,
} from './cur-batch.shared';

/**
 * CUR 取得処理
 * - S3バケットからファイル一覧を取得
 * - 未登録ファイルのみ 課金レポートファイル管理テーブル に PENDING で登録
 */
export async function runCurIngestionBatch(options: CurBatchOptions = {}): Promise<void> {
  const { projectId } = options;

  try {
    // 対象プロジェクトの取得
    const connections = await findTargetProjectConnectionsForCurBatch(projectId);

    if (connections.length === 0) {
      logInfo('[CUR Ingestion] 対象プロジェクトが見つかりません', { projectId });
      return;
    }

    logInfo('[CUR Ingestion] 処理開始', { projectCount: connections.length, projectId });
    for (const connection of connections) {
      try {
        // Parameter Storeから認証情報を取得
        const accessKeyId = await getSecureParameter(connection.access_key_id_param_path);
        const secretAccessKey = await getSecureParameter(connection.secret_access_key_param_path);

        if (!accessKeyId || !secretAccessKey) {
          logError('[CUR Ingestion] 認証情報の取得に失敗', {
            projectId: connection.project_id,
            accessKeyIdParamPath: connection.access_key_id_param_path,
            secretAccessKeyParamPath: connection.secret_access_key_param_path,
          });
          continue;
        }

        // S3クライアントを作成
        const s3Client = createCurS3Client(accessKeyId, secretAccessKey, AWS_REGION);

        // S3からファイル一覧を取得
        const objects = await listCurFiles(
          s3Client,
          connection.cur_bucket_name,
          connection.cur_prefix,
        );

        logInfo('[CUR Ingestion] S3ファイル検出', {
          projectId: connection.project_id,
          bucketName: connection.cur_bucket_name,
          prefix: connection.cur_prefix,
          fileCount: objects.length,
        });

        const newFiles: string[] = [];

        // 1周目: billingPeriod / version 単位でメタ情報を構築
        // グループごとに最新バージョンを算出
        const latestVersionByGroup = determineLatestVersionPerGroup(
          objects,
          (item): BillingFileGroupKey => {
            const billingPeriod = extractBillingPeriod(item.key);
            const groupBillingPeriod = billingPeriod ?? '';
            return `${connection.project_id}::${groupBillingPeriod}`;
          },
          (item): string | null => {
            const billingPeriod = extractBillingPeriod(item.key);
            return billingPeriod ? extractBillingVersion(item.key) : null;
          },
        );

        // 2周目: 最新バージョンかどうかに応じて PENDING / SKIPPED を決定
        for (const item of objects) {
          const objectKey = item.key;
          const s3LastModifiedAt = item.lastModified ?? null;
          const objectKeyHash = crypto.createHash('sha256').update(objectKey).digest('hex');
          const billingPeriod = extractBillingPeriod(objectKey);

          const groupBillingPeriod = billingPeriod ?? '';
          const groupKey: BillingFileGroupKey = `${connection.project_id}::${groupBillingPeriod}`;
          const latestVersion = latestVersionByGroup.get(groupKey) ?? null;
          const versionKey = billingPeriod ? extractBillingVersion(objectKey) : null;

          const isVersionedGroup = latestVersion !== null;
          const isLatestVersion = !isVersionedGroup || versionKey === latestVersion;
          const isOldVersion = isVersionedGroup && !isLatestVersion;

          // 既存レコードをチェック
          const existing = await findBillingFileByObjectKeyHashForCurBatch(
            connection.project_id,
            connection.cur_bucket_name,
            objectKeyHash,
          );

          if (!existing) {
            // 新規登録
            const initialStatus = isOldVersion ? 'SKIPPED' : 'PENDING';

            await createBillingFileForCurBatch({
              projectId: connection.project_id,
              awsAccountId: connection.aws_account_id,
              bucketName: connection.cur_bucket_name,
              objectKey,
              objectKeyHash,
              billingPeriod,
              s3LastModifiedAt,
              status: initialStatus,
            });

            if (initialStatus === 'PENDING') {
              newFiles.push(objectKey);
            }

            logInfo('[CUR Ingestion] ファイル登録', {
              projectId: connection.project_id,
              objectKey,
              billingPeriod,
            });
          } else if (
            s3LastModifiedAt &&
            (!existing.s3_last_modified_at || s3LastModifiedAt > existing.s3_last_modified_at)
          ) {
            // 既存レコードよりS3側が新しければ、PENDINGに戻して再処理対象とする
            await resetBillingFileToPendingWithS3LastModifiedForCurBatch(existing.id, s3LastModifiedAt);

            newFiles.push(objectKey);
            logInfo('[CUR Ingestion] 既存ファイル更新検知、PENDINGに戻す', {
              projectId: connection.project_id,
              objectKey,
              billingPeriod,
            });
          }
        }

        // 新規ファイルがある場合、CUR集計ジョブを登録
        if (newFiles.length > 0) {
          await enqueueCurAggregationJob({ projectId: connection.project_id });
          logInfo('[CUR Ingestion] CUR集計ジョブ登録', {
            projectId: connection.project_id,
            newFileCount: newFiles.length,
          });
        }
      } catch (error) {
        logError('[CUR Ingestion] プロジェクト処理エラー', {
          projectId: connection.project_id,
          error,
        });
        // エラーが発生しても次のプロジェクトの処理を継続
      }
    }

    logInfo('[CUR Ingestion] 処理完了');
  } catch (error) {
    logError('[CUR Ingestion] バッチ処理エラー', { error });
    throw error;
  }
}
