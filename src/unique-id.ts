/**
 * ベースリポジトリ用の簡易ユニーク ID 生成ユーティリティ。
 *
 * 各 rinstack-* プロジェクトでは、必要に応じて
 * - 専用テーブルを使った採番
 * - 既存 ID 採番基盤のラッパー
 * などに差し替えて利用してください。
 */

export const getNewId = async (contextId: string): Promise<string> => {
  const randomPart = Math.random().toString(36).slice(2, 10);
  const timestamp = Date.now().toString(36);
  return `${contextId}-${timestamp}-${randomPart}`;
};