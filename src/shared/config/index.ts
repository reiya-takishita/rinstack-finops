import { getEnvVariableWithDefault } from '../database/environment';

// アプリケーション設定
export const APP_CONFIG = {
  // サーバー設定
  PORT: parseInt(getEnvVariableWithDefault('PORT', '7070'), 10),
  // フロントエンドのベースURL（Stripeリダイレクト先）
  FRONTEND_BASE_URL: getEnvVariableWithDefault('FRONTEND_BASE_URL', 'http://localhost:3000'),
  
  // リクエスト設定
  REQUEST_SIZE_LIMIT: getEnvVariableWithDefault('REQUEST_SIZE_LIMIT', '10mb'),
  
  // ユニークID設定
  UNIQUE_ID: {
    // 日付部分の抽出位置
    DATE_START_INDEX: parseInt(getEnvVariableWithDefault('UNIQUE_ID_DATE_START_INDEX', '3'), 10),
    DATE_END_INDEX: parseInt(getEnvVariableWithDefault('UNIQUE_ID_DATE_END_INDEX', '11'), 10),
    
    // ID長さの判定基準
    LONG_ID_LENGTH_THRESHOLD: parseInt(getEnvVariableWithDefault('UNIQUE_ID_LONG_LENGTH_THRESHOLD', '18'), 10),
    
    // パディング桁数
    LONG_ID_PADDING: parseInt(getEnvVariableWithDefault('UNIQUE_ID_LONG_PADDING', '9'), 10),
    SHORT_ID_PADDING: parseInt(getEnvVariableWithDefault('UNIQUE_ID_SHORT_PADDING', '7'), 10),
  }
};

// 組織作成APIで使用するpreview版判断のフラグ
export const FEATURE_FLAGS = {
  PREVIEW_MODE: getEnvVariableWithDefault('FEATURE_PREVIEW_MODE', 'false') === 'true',
};