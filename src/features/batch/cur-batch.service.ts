// CUR バッチ処理（Batch A / Batch B）のユースケース関数を定義するサービスレイヤー
//
// - Batch A: S3 上の CUR ファイル一覧を取得し、課金レポートファイル管理テーブルに登録する
// - Batch B: PENDING 状態の CUR ファイルを処理し、コスト集計テーブルへ反映する
//
// 現時点では DB モデルや AWS 接続設定が未整備のため、処理本体は TODO コメントで示し、
// 実行トリガー（API / CLI）から呼び出せるインターフェイスのみ定義する。

import { logInfo } from '../../shared/logger';

export type CurBatchOptions = {
  projectId?: string;
};

/**
 * Batch A: CUR 取得処理
 *
 * 設計書 3. CUR取得処理（Batch A）に対応。
 * - 対象プロジェクトの接続設定を列挙
 * - AssumeRole して S3 ListObjectsV2 で CUR ファイルを列挙
 * - 未登録ファイルのみ 課金レポートファイル管理テーブル に PENDING で登録
 */
export async function runCurFetchBatch(options: CurBatchOptions = {}): Promise<void> {
  const { projectId } = options;

  // TODO: finops_project_connections 相当のテーブルから、対象プロジェクト(群)を取得する
  // TODO: 各プロジェクトごとに AssumeRole し、curBucketName + curPrefix 配下のオブジェクト一覧を取得
  // TODO: finops_billing_files 相当のテーブルに存在しない (projectId, bucketName, objectKey) のみ PENDING で登録
  // TODO: 失敗したプロジェクトはログ出力しつつスキップする（バッチ全体は継続）

  // 現状は実装スケルトンのみ。
  logInfo('[Batch A] CUR 取得処理を実行 (stub)', { projectId });
}

/**
 * Batch B: CUR 解析・集計処理
 *
 * 設計書 4. CUR解析・集計処理（Batch B）に対応。
 * - finops_billing_files から PENDING レコードを取得
 * - S3 GetObject で CUR ファイルを取得
 * - レコードをパースしてコスト集計
 * - finops_cost_summary / finops_cost_service_monthly に upsert
 */
export async function runCurAggregateBatch(options: CurBatchOptions = {}): Promise<void> {
  const { projectId } = options;

  // TODO: finops_billing_files から対象 (status = PENDING) のファイルを一定件数取得
  // TODO: status を PROCESSING に更新
  // TODO: S3 GetObject で CUR ファイルを取得・パース
  // TODO: 集計ロジック（設計書 4.3）に基づき、コストを集計
  // TODO: finops_cost_summary / finops_cost_service_monthly に upsert
  // TODO: 成功したら status = DONE, 失敗時は status = ERROR + errorMessage を設定

  // 現状は実装スケルトンのみ。
  logInfo('[Batch B] CUR 集計処理を実行 (stub)', { projectId });
}
