import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getEnvVariable } from '../database/environment';
import { logError, logWarn, createAuthError, AuthErrorCode } from '../logger';

/**
 * S2S JWT認証ミドルウェア
 * 設計書参照: Finops_MVP_detail_design_v9.md 1.X.2
 * 
 * rinstack-appからのリクエストのみを受け入れる
 */
export const requireS2SAuth = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Authorization ヘッダの取得
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!token) {
      logWarn('Missing S2S JWT token', { path: req.path });
      throw createAuthError(
        AuthErrorCode.MISSING_AUTH_HEADER,
        'Missing service token'
      );
    }

    // JWT検証
    const secret = getEnvVariable('S2S_JWT_SECRET');
    const decoded = jwt.verify(token, secret) as {
      iss?: string;
      aud?: string;
      client_id?: string;
      iat?: number;
      exp?: number;
      organizationId?: string;
      projectId?: string;
      userId?: string;
    };

    // 必須クレームの検証
    if (decoded.iss !== 'rinstack-app') {
      logWarn('Invalid issuer in S2S JWT', { iss: decoded.iss, path: req.path });
      throw createAuthError(
        AuthErrorCode.INVALID_TOKEN,
        'Invalid issuer'
      );
    }

    if (decoded.aud !== 'finops-service') {
      logWarn('Invalid audience in S2S JWT', { aud: decoded.aud, path: req.path });
      throw createAuthError(
        AuthErrorCode.INVALID_TOKEN,
        'Invalid audience'
      );
    }

    if (decoded.client_id !== 'rinstack-app') {
      logWarn('Invalid client_id in S2S JWT', { client_id: decoded.client_id, path: req.path });
      throw createAuthError(
        AuthErrorCode.INVALID_TOKEN,
        'Invalid client'
      );
    }

    // 有効期限の検証（jwt.verifyで自動検証されるが、明示的にチェック）
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      logWarn('Expired S2S JWT token', { exp: decoded.exp, path: req.path });
      throw createAuthError(
        AuthErrorCode.TOKEN_EXPIRED,
        'Token expired'
      );
    }

    // リクエストに認証情報を付与
    res.locals.serviceClientId = decoded.client_id;
    res.locals.organizationId = decoded.organizationId;
    res.locals.projectId = decoded.projectId;
    res.locals.userId = decoded.userId;
    res.locals.operatorId = `SERVICE:${decoded.client_id}`;

    next();
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      logWarn('Invalid S2S JWT token', { error: error.message, path: req.path });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid service token',
      });
      return;
    }

    // カスタムエラーの場合
    if (error.statusCode) {
      res.status(error.statusCode).json({
        error: error.name,
        message: error.message,
        code: error.code,
      });
      return;
    }

    // その他のエラー
    logError('S2S JWT authentication error', { error, path: req.path });
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication failed',
    });
  }
};

