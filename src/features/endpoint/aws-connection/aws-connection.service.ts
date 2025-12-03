import { putSecureParameter } from '../../../shared/aws/parameter-store';
import { logInfo } from '../../../shared/logger';
import {
  findFinopsProjectConnectionByProjectId,
  upsertFinopsProjectConnection,
  UpsertFinopsProjectConnectionParams,
} from './aws-connection.repository';

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

  // Parameter Storeのパスを生成（organizationIdを含める）
  const accessKeyIdParamPath = `/rinstack/finops/${organizationId}/${projectId}/access-key-id`;
  const secretAccessKeyParamPath = `/rinstack/finops/${organizationId}/${projectId}/secret-access-key`;

  // Parameter Storeにアクセスキーとシークレットアクセスキーを保存
  await putSecureParameter(
    accessKeyIdParamPath,
    accessKeyId,
    `FinOps AWS Access Key ID for project ${projectId}`,
  );
  await putSecureParameter(
    secretAccessKeyParamPath,
    secretAccessKey,
    `FinOps AWS Secret Access Key for project ${projectId}`,
  );

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
