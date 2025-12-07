import { Request, Response } from 'express';
import { z } from 'zod';
import { logError } from '../../../shared/logger';
import {
  getAwsConnection,
  saveAwsConnection,
  deleteAwsConnection,
} from './aws-connection.service';

/**
 * FinOps接続設定のリクエストスキーマ
 * 認証情報（accessKeyId, secretAccessKey）は空文字列を許可（更新時に既存値を保持するため）
 */
const finOpsConnectionSchema = z.object({
  awsAccountId: z.string()
    .regex(/^\d{12}$/, 'AWSアカウントIDは12桁の数字である必要があります'),
  accessKeyId: z.string()
    .refine((val) => val === '' || /^AKIA[0-9A-Z]{16}$/.test(val), {
      message: 'アクセスキーの形式が正しくありません',
    }),
  secretAccessKey: z.string()
    .refine((val) => val === '' || val.length >= 40, {
      message: 'シークレットアクセスキーは40文字以上である必要があります',
    }),
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
      const connection = await getAwsConnection(projectId);

      if (!connection) {
        res.status(404).json({
          error: 'Not Found',
          message: 'Connection not found',
        });
        return;
      }
      // レスポンス（機密情報は含めない）
      res.status(200).json(connection);
    } catch (error: unknown) {
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

      // 設計書準拠（パターンB）: FinOpsコンテナがParameter Storeを管理
      const connection = await saveAwsConnection({
        projectId,
        organizationId,
        awsAccountId,
        accessKeyId: accessKeyIdValue,
        secretAccessKey: secretAccessKeyValue,
        curBucketName,
        curPrefix,
      });

      // メモリクリア（可能な限り早く）
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      accessKeyId = null;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      secretAccessKey = null;

      // レスポンス（実際のアクセスキーとシークレットアクセスキーは返さない）
      res.status(200).json(connection);
    } catch (error: unknown) {
      // メモリクリア（変数はスコープ外のため削除）

      // エラーログには機密情報を含めない
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError('Failed to save FinOps connection', {
        projectId: req.params.projectId,
        // accessKeyId, secretAccessKey は含めない
        error: errorMessage,
      });

      // エラーレスポンスには詳細情報を含めない
      if (error instanceof Error && error.name === 'SequelizeUniqueConstraintError') {
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

  /**
   * DELETE /finops/projects/{projectId}/connection
   * プロジェクトのAWS接続設定を削除
   */
  static async deleteConnection(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;

      if (!projectId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'projectId is required',
        });
        return;
      }

      // 接続設定を削除（パラメータストア削除 → コネクション削除）
      const deletedConnection = await deleteAwsConnection(projectId);

      if (!deletedConnection) {
        // 接続設定が存在しない場合は404を返す
        res.status(404).json({
          error: 'Not Found',
          message: 'Connection not found',
        });
        return;
      }

      // レスポンス（機密情報は含めない）
      res.status(200).json(deletedConnection);
    } catch (error: unknown) {
      logError('Failed to delete FinOps connection', {
        projectId: req.params.projectId,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
      });

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to delete connection',
      });
    }
  }
}

