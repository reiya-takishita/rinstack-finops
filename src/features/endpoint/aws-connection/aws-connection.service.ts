import { randomUUID } from 'crypto';
import { putSecureParameter, deleteSecureParameter } from '../../../shared/aws/parameter-store';
import { logInfo, logError } from '../../../shared/logger';
import {
  findFinopsProjectConnectionByProjectId,
  upsertFinopsProjectConnection,
  deleteFinopsProjectConnection,
  UpsertFinopsProjectConnectionParams,
} from './aws-connection.repository';
import FinopsCostSummary from '../../../models/finops-cost-summary';
import FinopsCostServiceMonthly from '../../../models/finops-cost-service-monthly';
import FinopsBillingFile from '../../../models/finops-billing-file';
import { sequelize } from '../../../shared/database/connection';

export type AwsConnectionResponse = {
  projectId: string;
  awsAccountId: string;
  accessKeyIdParamPath: string;
  secretAccessKeyParamPath: string;
  curBucketName: string;
  curPrefix: string;
  createdAt: string;
  updatedAt: string;
};

export async function getAwsConnection(
  projectId: string,
): Promise<AwsConnectionResponse | null> {
  const connection = await findFinopsProjectConnectionByProjectId(projectId);

  if (!connection) {
    return null;
  }

  return {
    projectId: connection.project_id,
    awsAccountId: connection.aws_account_id,
    accessKeyIdParamPath: connection.access_key_id_param_path,
    secretAccessKeyParamPath: connection.secret_access_key_param_path,
    curBucketName: connection.cur_bucket_name,
    curPrefix: connection.cur_prefix,
    createdAt: connection.created_at ? connection.created_at.toISOString() : new Date().toISOString(),
    updatedAt: connection.updated_at ? connection.updated_at.toISOString() : new Date().toISOString(),
  };
}

export type SaveAwsConnectionInput = {
  projectId: string;
  organizationId: string;
  awsAccountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  curBucketName: string;
  curPrefix: string;
};

export async function saveAwsConnection(
  input: SaveAwsConnectionInput,
): Promise<AwsConnectionResponse> {
  const {
    projectId,
    organizationId,
    awsAccountId,
    accessKeyId,
    secretAccessKey,
    curBucketName,
    curPrefix,
  } = input;
  

  // 既存の接続設定を確認
  const existingConnection = await findFinopsProjectConnectionByProjectId(projectId);
  
  let accessKeyIdParamPath: string;
  let secretAccessKeyParamPath: string;

  if (existingConnection?.access_key_id_param_path && existingConnection?.secret_access_key_param_path) {
    // 既存の接続がある場合は既存のパスを再利用（更新時）
    accessKeyIdParamPath = existingConnection.access_key_id_param_path;
    secretAccessKeyParamPath = existingConnection.secret_access_key_param_path;
  } else {
    // 新規作成時はランダム値を含めて開発環境での上書きを防ぐ
    const randomId = randomUUID();
    accessKeyIdParamPath = `/rinstack/finops/${organizationId}/${projectId}/${randomId}/access-key-id`;
    secretAccessKeyParamPath = `/rinstack/finops/${organizationId}/${projectId}/${randomId}/secret-access-key`;
  }

  // 認証情報が空文字列でない場合のみParameter Storeを更新
  // 空文字列の場合は既存の値を保持（更新しない）
  if (accessKeyId && accessKeyId.trim() !== '') {
    await putSecureParameter(
      accessKeyIdParamPath,
      accessKeyId,
      `FinOps AWS Access Key ID for project ${projectId}`,
    );
  }
  if (secretAccessKey && secretAccessKey.trim() !== '') {
    await putSecureParameter(
      secretAccessKeyParamPath,
      secretAccessKey,
      `FinOps AWS Secret Access Key for project ${projectId}`,
    );
  }

  // curPrefixの末尾スラッシュを統一（末尾に付加）
  const normalizedCurPrefix = curPrefix.endsWith('/') ? curPrefix : `${curPrefix}/`;

  const upsertParams: UpsertFinopsProjectConnectionParams = {
    projectId,
    awsAccountId,
    accessKeyIdParamPath,
    secretAccessKeyParamPath,
    curBucketName,
    curPrefix: normalizedCurPrefix,
  };

  // DBに保存または更新
  const connection = await upsertFinopsProjectConnection(upsertParams);

  logInfo('FinOps connection saved', {
    projectId,
    awsAccountId,
    curBucketName,
    // 機密情報は含めない
  });

  return {
    projectId: connection.project_id,
    awsAccountId: connection.aws_account_id,
    accessKeyIdParamPath: connection.access_key_id_param_path,
    secretAccessKeyParamPath: connection.secret_access_key_param_path,
    curBucketName: connection.cur_bucket_name,
    curPrefix: connection.cur_prefix,
    createdAt: connection.created_at?.toISOString() ?? new Date().toISOString(),
    updatedAt: connection.updated_at?.toISOString() ?? new Date().toISOString(),
  };
}

/**
 * プロジェクトのAWS接続設定を削除
 * フロー:
 * 1. DB削除処理（トランザクション内）
 *    - finops_billing_files削除
 *    - finops_cost_summary削除
 *    - finops_cost_service_monthly削除
 *    - finops_project_connections削除
 * 2. パラメータストア削除（外部サービス、トランザクション外だがコミット前）
 *    - パラメータストア削除が失敗した場合、DBもロールバックされる
 * 3. トランザクションコミット
 * 
 * @param projectId - プロジェクトID
 * @returns 削除された接続設定、存在しない場合はnull
 * @throws DB削除に失敗した場合、またはパラメータストア削除に失敗した場合にエラーをスロー（DBはロールバックされる）
 */
export async function deleteAwsConnection(
  projectId: string,
): Promise<AwsConnectionResponse | null> {
  // 接続設定を取得
  const connection = await findFinopsProjectConnectionByProjectId(projectId);

  if (!connection) {
    return null;
  }

  const accessKeyIdParamPath = connection.access_key_id_param_path;
  const secretAccessKeyParamPath = connection.secret_access_key_param_path;

  // トランザクション開始
  const transaction = await sequelize.transaction();

  try {
    // 1. DB削除処理（トランザクション内で実行）
    logInfo('Deleting finops data from database', { projectId });

    // 1-1. finops_billing_files削除
    await FinopsBillingFile.destroy({
      where: { project_id: projectId },
      force: true, // 物理削除
      transaction,
    });
    logInfo('finops_billing_files deleted', { projectId });

    // 1-2. finops_cost_summary削除
    await FinopsCostSummary.destroy({
      where: { project_id: projectId },
      force: true, // 物理削除
      transaction,
    });
    logInfo('finops_cost_summary deleted', { projectId });

    // 1-3. finops_cost_service_monthly削除
    await FinopsCostServiceMonthly.destroy({
      where: { project_id: projectId },
      force: true, // 物理削除
      transaction,
    });
    logInfo('finops_cost_service_monthly deleted', { projectId });

    // 1-4. コネクション削除
    await deleteFinopsProjectConnection(projectId, transaction);
    logInfo('finops_project_connections deleted', { projectId });

    // 2. パラメータストア削除
    logInfo('Deleting parameters from Parameter Store', {
      projectId,
      accessKeyIdParamPath,
      secretAccessKeyParamPath,
    });

    await deleteSecureParameter(accessKeyIdParamPath);
    await deleteSecureParameter(secretAccessKeyParamPath);

    logInfo('Parameters deleted from Parameter Store successfully', {
      projectId,
    });

    // トランザクションコミット
    await transaction.commit();

    logInfo('FinOps connection deleted successfully', {
      projectId,
      awsAccountId: connection.aws_account_id,
      // 機密情報は含めない
    });

    return {
      projectId: connection.project_id,
      awsAccountId: connection.aws_account_id,
      accessKeyIdParamPath: connection.access_key_id_param_path,
      secretAccessKeyParamPath: connection.secret_access_key_param_path,
      curBucketName: connection.cur_bucket_name,
      curPrefix: connection.cur_prefix,
      createdAt: connection.created_at?.toISOString() ?? new Date().toISOString(),
      updatedAt: connection.updated_at?.toISOString() ?? new Date().toISOString(),
    };
  } catch (error) {
    // トランザクションロールバック
    await transaction.rollback();
    logError('Failed to delete FinOps connection', {
      projectId,
      accessKeyIdParamPath,
      secretAccessKeyParamPath,
      error,
    });
    throw error;
  }
}
