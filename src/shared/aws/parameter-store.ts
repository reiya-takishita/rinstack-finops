import { SSMClient, PutParameterCommand, GetParameterCommand, DeleteParameterCommand, ParameterType } from '@aws-sdk/client-ssm';
import { getEnvVariable } from '../database/environment';
import { logError, logInfo } from '../logger';

// AWS設定
const AWS_REGION = getEnvVariable('AWS_REGION');

// AWS共通設定
const awsConfig = {
  region: AWS_REGION,
};

// SSMクライアント
export const ssmClient = new SSMClient(awsConfig);

/**
 * Parameter Storeにパラメータを保存（SecureStringタイプ）
 * @param parameterPath - パラメータパス（例: /rinstack/finops/proj_123/access-key-id）
 * @param value - 保存する値
 * @param description - パラメータの説明（オプション）
 * @returns 保存されたパラメータのバージョン
 */
export async function putSecureParameter(
  parameterPath: string,
  value: string,
  description?: string
): Promise<number> {
  try {
    const command = new PutParameterCommand({
      Name: parameterPath,
      Value: value,
      Type: ParameterType.SECURE_STRING,
      Description: description,
      Overwrite: true, // 既存のパラメータを上書き
    });

    const response = await ssmClient.send(command);
    logInfo('Parameter saved to Parameter Store', { parameterPath, version: response.Version });
    return response.Version || 1;
  } catch (error) {
    logError('Failed to put parameter to Parameter Store', { parameterPath, error });
    throw error;
  }
}

/**
 * Parameter Storeからパラメータを取得
 * @param parameterPath - パラメータパス
 * @returns パラメータの値
 */
export async function getSecureParameter(parameterPath: string): Promise<string> {
  try {
    const command = new GetParameterCommand({
      Name: parameterPath,
      WithDecryption: true, // SecureStringの場合は復号化が必要
    });

    const response = await ssmClient.send(command);
    return response.Parameter?.Value || '';
  } catch (error) {
    logError('Failed to get parameter from Parameter Store', { parameterPath, error });
    throw error;
  }
}

/**
 * Parameter Storeからパラメータを削除
 * @param parameterPath - パラメータパス
 * @throws パラメータが存在しない場合や削除に失敗した場合にエラーをスロー
 */
export async function deleteSecureParameter(parameterPath: string): Promise<void> {
  try {
    const command = new DeleteParameterCommand({
      Name: parameterPath,
    });

    await ssmClient.send(command);
    logInfo('Parameter deleted from Parameter Store', { parameterPath });
  } catch (error: any) {
    // パラメータが存在しない場合はエラーにしない（冪等性を確保）
    if (error?.name === 'ParameterNotFound') {
      logInfo('Parameter not found in Parameter Store (already deleted)', { parameterPath });
      return;
    }
    logError('Failed to delete parameter from Parameter Store', { parameterPath, error });
    throw error;
  }
}

