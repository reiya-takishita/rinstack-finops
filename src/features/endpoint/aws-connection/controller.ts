import { Request, Response } from 'express';
import { z } from 'zod';
import { putSecureParameter } from '../../../shared/aws/parameter-store';
import { logError, logInfo, createSystemError, SystemErrorCode, createBusinessError, BusinessErrorCode } from '../../../shared/logger';
import FinopsProjectConnection from '../../../models/finops-project-connection';

/**
 * FinOps接続設定のリクエストスキーマ
 */
const finOpsConnectionSchema = z.object({
  awsAccountId: z.string()
    .regex(/^\d{12}$/, 'AWSアカウントIDは12桁の数字である必要があります'),
  accessKeyId: z.string()
    .regex(/^AKIA[0-9A-Z]{16}$/, 'アクセスキーの形式が正しくありません'),
  secretAccessKey: z.string()
    .min(40, 'シークレットアクセスキーは40文字以上である必要があります'),
  curBucketName: z.string()
    .regex(/^[a-z0-9.-]{3,63}$/, 'S3バケット名の形式が正しくありません'),
  curPrefix: z.string()
    .min(1, 'CURプレフィックスは必須です'),
});

/**
 * AWS接続設定コントローラー
 * 設計書参照: Finops_MVP_detail_design_v9.md 2.3
 */
export class AwsConnectionController {
  /**
   * GET /finops/projects/{projectId}/connection
   * プロジェクトのAWS接続設定を取得
   */
  static async getConnection(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;

      if (!projectId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'projectId is required',
        });
        return;
      }

      // DBから接続設定を取得
      const connection = await FinopsProjectConnection.findByPk(projectId);

      if (!connection) {
        res.status(404).json({
          error: 'Not Found',
          message: 'Connection not found',
        });
        return;
      }

      // レスポンス（機密情報は含めない）
      res.status(200).json({
        projectId: connection.project_id,
        awsAccountId: connection.aws_account_id,
        accessKeyIdParamPath: connection.access_key_id_param_path,
        secretAccessKeyParamPath: connection.secret_access_key_param_path,
        curBucketName: connection.cur_bucket_name,
        curPrefix: connection.cur_prefix,
        createdAt: connection.created_at ? connection.created_at.toISOString() : new Date().toISOString(),
        updatedAt: connection.updated_at ? connection.updated_at.toISOString() : new Date().toISOString(),
      });
    } catch (error: any) {
      logError('Failed to get FinOps connection', { 
        projectId: req.params.projectId,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
        // エラーログには機密情報を含めない
      });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get connection',
      });
    }
  }

  /**
   * PUT /finops/projects/{projectId}/connection
   * プロジェクトのAWS接続設定を保存・更新
   * 設計書準拠（パターンB）: FinOpsコンテナがParameter Storeを管理
   */
  static async putConnection(req: Request, res: Response): Promise<void> {
    let accessKeyId: string | null = null;
    let secretAccessKey: string | null = null;

    try {
      const { projectId } = req.params;
      const organizationId = res.locals.organizationId as string | undefined;

      if (!projectId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'projectId is required',
        });
        return;
      }

      // リクエストボディのバリデーション
      const validationResult = finOpsConnectionSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid request body',
          details: validationResult.error.issues,
        });
        return;
      }

      const { awsAccountId, accessKeyId: accessKeyIdValue, secretAccessKey: secretAccessKeyValue, curBucketName, curPrefix } = validationResult.data;

      // 一時変数に保存（後でクリアするため）
      accessKeyId = accessKeyIdValue;
      secretAccessKey = secretAccessKeyValue;

      // organizationIdが必須
      if (!organizationId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'organizationId is required',
        });
        return;
      }

      // Parameter Storeのパスを生成（organizationIdを含める）
      const accessKeyIdParamPath = `/rinstack/finops/${organizationId}/${projectId}/access-key-id`;
      const secretAccessKeyParamPath = `/rinstack/finops/${organizationId}/${projectId}/secret-access-key`;

      // Parameter Storeにアクセスキーとシークレットアクセスキーを保存
      // 設計書準拠（パターンB）: FinOpsコンテナがParameter Storeを管理
      await putSecureParameter(
        accessKeyIdParamPath,
        accessKeyIdValue,
        `FinOps AWS Access Key ID for project ${projectId}`
      );
      await putSecureParameter(
        secretAccessKeyParamPath,
        secretAccessKeyValue,
        `FinOps AWS Secret Access Key for project ${projectId}`
      );

      // curPrefixの末尾スラッシュを統一（末尾に付加）
      const normalizedCurPrefix = curPrefix.endsWith('/') ? curPrefix : `${curPrefix}/`;

      // DBに保存または更新
      const [connection, created] = await FinopsProjectConnection.upsert({
        project_id: projectId,
        aws_account_id: awsAccountId,
        access_key_id_param_path: accessKeyIdParamPath,
        secret_access_key_param_path: secretAccessKeyParamPath,
        cur_bucket_name: curBucketName,
        cur_prefix: normalizedCurPrefix,
      }, {
        returning: true,
      });

      logInfo('FinOps connection saved', {
        projectId,
        awsAccountId,
        curBucketName,
        // 機密情報は含めない
      });

      // メモリクリア（可能な限り早く）
      accessKeyId = null;
      secretAccessKey = null;

      // レスポンス（実際のアクセスキーとシークレットアクセスキーは返さない）
      res.status(200).json({
        projectId: connection.project_id,
        awsAccountId: connection.aws_account_id,
        accessKeyIdParamPath: connection.access_key_id_param_path,
        secretAccessKeyParamPath: connection.secret_access_key_param_path,
        curBucketName: connection.cur_bucket_name,
        curPrefix: connection.cur_prefix,
        createdAt: connection.created_at?.toISOString(),
        updatedAt: connection.updated_at?.toISOString(),
      });
    } catch (error: any) {
      // メモリクリア
      accessKeyId = null;
      secretAccessKey = null;

      // エラーログには機密情報を含めない
      logError('Failed to save FinOps connection', {
        projectId: req.params.projectId,
        // accessKeyId, secretAccessKey は含めない
        error: error.message,
      });

      // エラーレスポンスには詳細情報を含めない
      if (error.name === 'SequelizeUniqueConstraintError') {
        res.status(409).json({
          error: 'Conflict',
          message: 'Connection already exists',
        });
        return;
      }

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to save connection',
      });
    }
  }
}

