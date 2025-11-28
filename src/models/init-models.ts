import type { Sequelize } from 'sequelize';

/**
 * ベースリポジトリ用のプレースホルダ。
 * 各 rinstack-* プロジェクトで Sequelize モデルを定義し、
 * この関数内で initModel を呼び出す実装に差し替える想定。
 */
export function initModels(_sequelize: Sequelize) {
  // プロジェクト固有のモデル初期化は各リポジトリ側で実装してください。
  return {};
}

