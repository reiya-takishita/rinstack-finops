# CURバッチ処理 要件定義（ドラフト）

※現状の実装・設計コメント（Batch A/B・BullMQ採用・projectId単位ジョブ）を前提とした要件定義です。詳細設計書に落とし込む際のたたき台として利用できます。

---

## 1. 対象範囲

- 本要件定義は、AWS CUR（Cost and Usage Report）を用いた**コスト可視化のためのバッチ処理**を対象とする。
- 対象バッチ:
  - **Batch A: CUR取得バッチ**
  - **Batch B: CUR解析・集計バッチ**
- 実行形態:
  - 非同期バッチ（BullMQ + Worker）
  - トリガーは API / CLI / スケジューラ（Job Scheduler）

---

## 2. 用語定義（簡易）

- **projectId**  
  FinOps対象プロジェクトの一意なID。AWSアカウントや組織設定にひも付く。
- **finops_project_connections**  
  projectId ごとの AWS 接続設定（AssumeRole, CURバケット名/プレフィックスなど）を管理するテーブル（想定）。
- **finops_billing_files**  
  取得済みCURファイルを管理するテーブル。S3オブジェクトのメタ情報と処理状態(status)を持つ想定。
- **status（finops_billing_files）**
  - `PENDING`: 解析待ち
  - `PROCESSING`: 解析中
  - `DONE`: 解析完了
  - `ERROR`: 解析失敗
- **finops_cost_summary / finops_cost_service_monthly**  
  集計済みのコスト情報を持つテーブル（想定）。

---

## 3. 機能要件

### 3.1 Batch A: CUR取得バッチ（runCurFetchBatch）

#### 3.1.1 入力

- `CurBatchOptions`:
  - `projectId?: string`
    - 指定あり: 当該 projectId のみ対象
    - 指定なし: 有効なすべての projectId が対象（要件として定義）

#### 3.1.2 処理内容（論理）

1. **対象プロジェクトの決定**
   - `projectId` 指定あり:
     - `finops_project_connections` から該当 projectId を取得
   - `projectId` 指定なし:
     - `finops_project_connections` から「有効な接続設定を持つ全ての projectId」を取得

2. **CURファイル一覧の取得**
   - 各 project について:
     - 接続設定から AssumeRole 用の情報（Role ARN 等）を取得し、STS AssumeRole で一時クレデンシャルを取得する
       - 仕様としては常に **IAM Role（AssumeRole）方式を前提**とする
       - 実装上の暫定措置として、AssumeRole の接続準備が整うまでは環境変数に設定した `accessKeyId` / `secretAccessKey` から同等の一時クレデンシャルを構成する場合がある（固定鍵方式は将来的に廃止）
     - `curBucketName` + `curPrefix` 以下を `ListObjectsV2` 等で列挙
     - 既存レコードと付き合わせ、**未登録のファイルのみ**を対象とする

3. **課金レポートファイル管理テーブルへの登録**
   - 新規ファイルごとに `finops_billing_files` に以下を登録:
     - `projectId`
     - `bucketName`
     - `objectKey`
     - `status = 'PENDING'`
     - その他必要なメタデータ（ファイルサイズ、最終更新日時など）

4. **エラー処理**
   - 個別プロジェクトでエラーが発生した場合:
     - ログに projectId・原因を出力しつつ、**他プロジェクトの処理は継続**する。
   - 全体として致命的なエラーがあれば、ジョブを `failed` として終了。

#### 3.1.3 出力

- `finops_billing_files` に `PENDING` レコードが追加される。
- ログ出力:
  - プロジェクト単位の処理開始・終了ログ
  - ファイル登録件数
  - エラー発生時の詳細ログ

---

### 3.2 Batch B: CUR解析・集計バッチ（runCurAggregateBatch）

#### 3.2.1 入力

- `CurBatchOptions`:
  - `projectId?: string`
    - 指定あり: 当該 projectId の `PENDING` ファイルのみ対象
    - 指定なし: 全プロジェクトの `PENDING` ファイルから一定件数を対象（件数上限はパラメータ化を要件化してもよい）

#### 3.2.2 処理内容（論理）

1. **対象ファイルの取得**
   - `finops_billing_files` から
     - `status = 'PENDING'`
     - `projectId` 条件（指定されていれば一致するもののみ）
     - 上限件数（例: 100件）を取得

2. **処理ロック（多重実行防止）**
   - 対象レコードを `status = 'PROCESSING'` に更新する際、
     - `WHERE status = 'PENDING'` を条件に含めて**早い者勝ち**で更新する。
   - 更新に成功しなかったレコードは他 Worker に奪われたものとしてスキップ。
   - これにより、複数 Worker / 複数インスタンスからの同時実行を許容しつつ、同一ファイルの二重処理を防ぐ。

3. **CURファイルの取得とパース**
   - 対象ファイルごとに:
     - S3 GetObject で CUR ファイルを取得
     - CUR フォーマットに従いレコードをパース
     - 設計書 4.3 のロジックに基づき、コストを集計

4. **コストテーブルへの反映**
   - `finops_cost_summary`, `finops_cost_service_monthly` への upsert
   - 同一ファイル再処理時の idempotent 性を確保する:
     - ファイル単位のバージョン/ハッシュでの再計算ポリシー
     - 対象期間＋projectId＋サービスキーなどで一意制約を設計

5. **ステータス更新**
   - 正常終了:
     - 対象ファイルごとに `status = 'DONE'`
   - エラー発生:
     - 当該ファイルのみ `status = 'ERROR'`
     - `errorMessage` 等のフィールドに原因を保存

#### 3.2.3 出力

- コストテーブル（summary / service_monthly）の更新
- `finops_billing_files.status` の更新
- ログ出力:
  - 処理対象ファイル数
  - 成功・失敗件数
  - 失敗ファイルの詳細（projectId, objectKey, エラー内容）

---

## 4. トリガー要件

### 4.1 BullMQ ジョブ定義

- キュー名: `cur-batch`
- ジョブ名:
  - `cur-fetch`（Batch A）
  - `cur-aggregate`（Batch B）
- ジョブデータ:
  - `{ projectId?: string }`

### 4.2 ジョブ ID ポリシー

- **通常ジョブ（API / CLI からの enqueue）**
  - jobId は明示指定せず、BullMQ デフォルトの jobId（UUID）を採用する。
  - `projectId` はジョブデータおよびログの context として扱い、識別する。
- **スケジュールジョブ（repeatable jobs）**
  - `setupCurBatchSchedulers` 内で登録する repeatable job については、
    - `cur-fetch-schedule`
    - `cur-aggregate-schedule`
    などの固定 jobId を用いて「1種別につき1つの定期ジョブ」に制限する。

### 4.3 トリガー手段

- **API**
  - `POST /projects/:projectId/batch/cur-fetch`
    - 当該 projectId 向け `cur-fetch` ジョブを enqueue
  - `POST /projects/:projectId/batch/cur-aggregate`
    - 当該 projectId 向け `cur-aggregate` ジョブを enqueue
- **CLI**
  - `pnpm tsx scripts/run_cur_fetch_batch.ts <projectId?>`
  - `pnpm tsx scripts/run_cur_aggregate_batch.ts <projectId?>`
- **Scheduler（定期実行）**
  - `CUR_BATCH_SCHEDULER_ENABLED = true` の場合のみ起動
  - env の cron 設定:
    - `CUR_FETCH_CRON` 例: `0 * * * *`
    - `CUR_AGGREGATE_CRON` 例: `15 * * * *`
  - 現状要件:
    - `projectId` 未指定のグローバルジョブを一定間隔で enqueue
    - 実装時には「全 projectId を対象に処理する」か「内部で分割」するポリシーを詳細設計で決定する。

---

## 5. 運用・監視要件

- **ログ**
  - すべて共通ロガー（`logInfo`, `logError` 等）経由で出力。
  - プロジェクト・ファイル単位で追跡可能な context（projectId, objectKey, jobId）を付与。
- **再実行**
  - `status = ERROR` のレコードについて再実行できるようにする（将来要件として `requeue` 機能を検討）。
- **監視**
  - ジョブ失敗率、処理時間、キュー長など BullMQ メトリクスの監視（外部ツール or ログ集計）。
- **構成管理**
  - Redis 接続情報、cron パターン、有効/無効フラグは `.env` 経由で環境ごとに変更可能とする。

---

## 6. 非機能要件（ざっくり）

- **パフォーマンス**
  - Batch B は1回のジョブで処理するファイル数に上限を設ける（例: 100件）。
  - Worker は水平スケール可能（コンテナ複数起動）であること。
- **信頼性**
  - 多重実行時にも同一CURファイルが重複登録・重複集計されないよう、status管理＋upsertで整合性を保つ。
- **セキュリティ**
  - AssumeRoleに必要なIAMロールは最小権限。
  - projectId ごとの接続情報は暗号化もしくは安全なストレージに保持（Secrets Manager等、詳細は別要件）。

---

## 7. 実装ファイル構成（リポジトリ内）

CUR バッチ機能に関わる主なファイル構成を以下に整理する。

### 7.1 バッチ機能本体（ドメインロジック）

- `src/features/batch/cur-batch.service.ts`
  - Batch A / Batch B のユースケース関数を定義する。
  - 実装方針:
    - `runCurFetchBatch(options: { projectId?: string })`
      - `finops_project_connections` から接続設定を取得
      - STS AssumeRole により一時クレデンシャルを取得
      - `finops_billing_files` への `PENDING` 登録
    - `runCurAggregateBatch(options: { projectId?: string })`
      - `finops_billing_files` の `PENDING` → `PROCESSING` → `DONE/ERROR` 管理
      - CUR 取得・パース・集計
      - `finops_cost_summary` / `finops_cost_service_monthly` への upsert

### 7.2 キュー定義・ジョブ投入

- `src/features/batch/cur-batch.queue.ts`
  - BullMQ の `Queue` インスタンス定義:
    - キュー名: `cur-batch`
    - ジョブ名: `cur-fetch` / `cur-aggregate`
  - Redis 接続定義:
    - `REDIS_HOST`, `REDIS_PORT` を環境変数から取得
  - 外部公開関数:
    - `enqueueCurFetchJob(data?: { projectId?: string }, options?)`
    - `enqueueCurAggregateJob(data?: { projectId?: string }, options?)`
  - ジョブ ID ポリシー:
    - 通常ジョブ: jobId は指定せず BullMQ デフォルトを使用
    - スケジュールジョブ: 固定の jobId（例: `cur-fetch-schedule`）を使用

### 7.3 Worker プロセス

- `src/features/batch/cur-batch.worker.ts`
  - BullMQ の `Worker` を起動し、`cur-batch` キューを監視する。
  - Redis 接続は `cur-batch.queue.ts` と同じ環境変数から構成。
  - 起動時処理:
    - `checkConnection()` で DB 接続確認
    - `initModels(sequelize)` による Sequelize モデル初期化
  - ジョブハンドラ:
    - `cur-fetch` → `runCurFetchBatch(job.data)` を実行
    - `cur-aggregate` → `runCurAggregateBatch(job.data)` を実行
  - イベントハンドラ:
    - `completed` / `failed` を共通ロガーに出力

### 7.4 スケジューラ（定期実行設定）

- `src/features/batch/cur-batch.scheduler.ts`
  - BullMQ の repeatable job を登録する初期化処理を持つ。
  - 環境変数:
    - 有効フラグ: `CUR_BATCH_SCHEDULER_ENABLED`（`true` のときのみスケジュール登録）
    - cron パターン: `CUR_FETCH_CRON`, `CUR_AGGREGATE_CRON`
  - 登録されるジョブ:
    - `cur-fetch`（データ空オブジェクト）
    - `cur-aggregate`（データ空オブジェクト）
  - 現状は `projectId` 未指定のグローバルジョブとし、内部で対象プロジェクトを列挙する方針とする。

### 7.5 エントリポイントスクリプト

- `scripts/start_cur_worker.ts`
  - `startCurBatchWorker()` を呼び出して Worker プロセスを起動する。
- `scripts/start_cur_scheduler.ts`
  - `setupCurBatchSchedulers()` を呼び出して repeatable job を登録する。
- `scripts/run_cur_fetch_batch.ts`
  - 手動実行用 CLI。
  - 使い方: `pnpm tsx scripts/run_cur_fetch_batch.ts <projectId?>`
  - 指定された `projectId` 向けに `cur-fetch` ジョブを enqueue する。
- `scripts/run_cur_aggregate_batch.ts`
  - 手動実行用 CLI。
  - 使い方: `pnpm tsx scripts/run_cur_aggregate_batch.ts <projectId?>`
  - 指定された `projectId` 向けに `cur-aggregate` ジョブを enqueue する。

### 7.6 アプリケーション構成との関連

- `src/app.ts`
  - Express アプリのエントリポイント。
  - DB 接続確認・モデル初期化・マスターデータ初期化を行い、ルーターをマウントする。
- `src/routes/index.ts`
  - ルートレベルのルーティング定義。
  - FinOps バッチ関連ルート:
    - `src/features/endpoint/batch/routes.ts` をマウントし、
      - `POST /projects/:projectId/batch/cur-fetch`
      - `POST /projects/:projectId/batch/cur-aggregate`
      を公開する。

---

このファイル構成により、

- ドメインロジック（`cur-batch.service.ts`）
- 非同期実行レイヤー（Queue / Worker / Scheduler）
- 外部インターフェイス（API / CLI）

が明確に分離され、設計書（基本設計・詳細設計）との対応関係を保ったまま拡張しやすい構成とする。
