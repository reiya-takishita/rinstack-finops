import { getEnvVariableWithDefault } from '../database/environment';

// アプリケーション設定
export const APP_CONFIG = {
  // サーバー設定
  PORT: parseInt(getEnvVariableWithDefault('PORT', '7070'), 10),
  // フロントエンドのベースURL（Stripeリダイレクト先）
  FRONTEND_BASE_URL: getEnvVariableWithDefault('FRONTEND_BASE_URL', 'http://localhost:3000'),

  // リクエスト設定
  REQUEST_SIZE_LIMIT: getEnvVariableWithDefault('REQUEST_SIZE_LIMIT', '10mb'),
};