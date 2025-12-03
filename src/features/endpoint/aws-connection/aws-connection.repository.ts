import FinopsProjectConnection from '../../../models/finops-project-connection';

/**
 * Aws-connection ドメイン用のリポジトリ関数群
 *
 * FinopsProjectConnection への DB アクセスを集約し、controller からの models 直アクセスを防ぐ。
 */

export async function findFinopsProjectConnectionByProjectId(
  projectId: string,
): Promise<FinopsProjectConnection | null> {
  return FinopsProjectConnection.findByPk(projectId);
}

export type UpsertFinopsProjectConnectionParams = {
  projectId: string;
  awsAccountId: string;
  accessKeyIdParamPath: string;
  secretAccessKeyParamPath: string;
  curBucketName: string;
  curPrefix: string;
};

export async function upsertFinopsProjectConnection(
  params: UpsertFinopsProjectConnectionParams,
): Promise<FinopsProjectConnection> {
  const {
    projectId,
    awsAccountId,
    accessKeyIdParamPath,
    secretAccessKeyParamPath,
    curBucketName,
    curPrefix,
  } = params;

  const [connection] = await FinopsProjectConnection.upsert(
    {
      project_id: projectId,
      aws_account_id: awsAccountId,
      access_key_id_param_path: accessKeyIdParamPath,
      secret_access_key_param_path: secretAccessKeyParamPath,
      cur_bucket_name: curBucketName,
      cur_prefix: curPrefix,
    },
    {
      returning: true,
    },
  );

  return connection;
}
