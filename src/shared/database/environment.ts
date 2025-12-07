import * as dotenv from 'dotenv';

// 環境変数ファイルの読み込み
dotenv.config();

// 環境変数取得関数
export const getEnvVariable = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value;
};

// 環境変数取得関数（デフォルト値付き）
export const getEnvVariableWithDefault = (key: string, defaultValue: string): string => {
  return process.env[key] || defaultValue;
};