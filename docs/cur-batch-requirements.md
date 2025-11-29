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

## 2.1 CURファイル形式とサンプルデータ

### 2.1.1 CUR形式の扱い

- **実装方針**: CUR 1.0形式（スラッシュ区切り）で実装
- **将来対応**: CUR 2.0形式（アンダースコア区切り）への置換を容易にするため、カラム名マッピングを定義
- **サンプルデータ**: 実際のS3データがないため、開発・テスト用にサンプルCURファイルを使用
  - サンプルファイル: `docs/Dec2018-WorkshopCUR-00001.csv`
  - 注意: サンプルファイルはCUR 2.0形式だが、実装ではCUR 1.0形式のカラム名マッピングを使用

### 2.1.2 CURカラム名マッピング

実装では以下のマッピング定義を使用し、CUR 1.0形式で実装する。後からCUR 2.0形式に置換可能な設計とする。

```typescript
/**
 * CURカラム名マッピング
 * CUR 1.0形式（スラッシュ区切り）で実装し、後からCUR 2.0形式に置換可能
 */
export const CUR_COLUMN_MAPPING = {
  // CUR 1.0形式（現在の実装）
  USAGE_START_DATE: 'lineItem/UsageStartDate',
  UNBLENDED_COST: 'lineItem/UnblendedCost',
  USAGE_AMOUNT: 'lineItem/UsageAmount',
  PRODUCT_NAME: 'product/ProductName',
  
  // 将来的にCUR 2.0形式に置換する場合：
  // USAGE_START_DATE: 'line_item_usage_start_date',
  // UNBLENDED_COST: 'line_item_unblended_cost',
  // USAGE_AMOUNT: 'line_item_usage_amount',
  // PRODUCT_NAME: 'product_product_name',
} as const;
```

**実装時の注意事項:**
- CURファイルのパース時は、このマッピング定義を使用してカラム名を参照する
- CUR 2.0形式への移行時は、マッピング定義のみを変更すれば対応可能
- サンプルファイル（CUR 2.0形式）を使用する場合は、一時的にマッピングを変更するか、変換処理を実装する

---

## 3. 機能要件

### 3.0 処理フロー概要

```
┌─────────────────────────────────────────────────────────────┐
│ スケジューラー（3分ごと）                                      │
│ → cur-fetch ジョブを enqueue（projectId 未指定）            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Batch A: CUR取得バッチ（runCurFetchBatch）                  │
│                                                             │
│ 1. 全プロジェクトをチェック                                  │
│ 2. 各プロジェクトについて:                                    │
│    ├─ 新規CURファイルを検出                                  │
│    ├─ finops_billing_files に PENDING で登録               │
│    └─ 新規ファイルがある場合:                                │
│       └─ 当該プロジェクトの cur-aggregate ジョブを登録      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Batch B: CUR解析・集計バッチ（runCurAggregateBatch）        │
│ （プロジェクト単位で並列実行）                                │
│                                                             │
│ プロジェクト1のBatch B → プロジェクト1のPENDINGファイル処理 │
│ プロジェクト2のBatch B → プロジェクト2のPENDINGファイル処理 │
│ プロジェクト3のBatch B → プロジェクト3のPENDINGファイル処理 │
└─────────────────────────────────────────────────────────────┘
```

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

4. **Batch Bジョブの動的登録**
   - 新規ファイルが登録されたプロジェクトについて:
     - 当該プロジェクトの `cur-aggregate` ジョブをキューに登録
     - ジョブデータには `{ projectId: <対象プロジェクトID> }` を指定
     - これにより、プロジェクト単位で並列にBatch Bが実行される
   - 新規ファイルがないプロジェクト:
     - Batch Bジョブは登録しない（不要な処理を回避）

5. **エラー処理**
   - 個別プロジェクトでエラーが発生した場合:
     - ログに projectId・原因を出力しつつ、**他プロジェクトの処理は継続**する。
   - 全体として致命的なエラーがあれば、ジョブを `failed` として終了。

#### 3.1.3 出力

- `finops_billing_files` に `PENDING` レコードが追加される。
- 新規ファイルがあるプロジェクトの `cur-aggregate` ジョブがキューに登録される。
- ログ出力:
  - プロジェクト単位の処理開始・終了ログ
  - ファイル登録件数
  - Batch Bジョブ登録情報（projectId、登録件数）
  - エラー発生時の詳細ログ

---

### 3.2 Batch B: CUR解析・集計バッチ（runCurAggregateBatch）

#### 3.2.1 入力

- `CurBatchOptions`:
  - `projectId?: string`
    - **通常は指定あり**: Batch Aから動的に登録される際に `projectId` が指定される
    - 指定あり: 当該 projectId の `PENDING` ファイルのみ対象
    - 指定なし: 手動実行時やフォールバック時の動作として、全プロジェクトの `PENDING` ファイルから一定件数を対象（件数上限はパラメータ化を要件化してもよい）

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
     - S3 GetObject で CUR ファイルを取得（開発時はサンプルファイル `docs/Dec2018-WorkshopCUR-00001.csv` を使用可能）
     - CUR フォーマットに従いレコードをパース
     - **カラム名マッピング（`CUR_COLUMN_MAPPING`）を使用してカラム名を参照**
     - 設計書 4.3 のロジックに基づき、コストを集計
     - 集計時に以下の情報を取得（マッピング定義経由）:
       - `CUR_COLUMN_MAPPING.USAGE_START_DATE`: 使用開始日（日付範囲の判定に使用）
       - `CUR_COLUMN_MAPPING.UNBLENDED_COST`: コスト
       - `CUR_COLUMN_MAPPING.PRODUCT_NAME`: サービス名
       - `CUR_COLUMN_MAPPING.USAGE_AMOUNT`: 使用量（必要に応じて）

4. **コストテーブルへの反映**
   - `finops_cost_summary` への upsert:
     - `totalCost`: 対象月の全期間のコスト合計
     - `forecastCost`: 当月の「本日までの平均日次コスト × 当月の日数」で計算
     - `previousSamePeriodCost`: 前月の同じ日付範囲（1日〜本日）のコスト合計
     - `previousMonthTotalCost`: 前月の全期間のコスト合計（前月の `finops_cost_summary` から取得）
   - `finops_cost_service_monthly` への upsert:
     - サービス名 × 月別のコストを保存
     - 複数月分のデータが蓄積され、フロントエンドのグラフ表示に使用される
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
  - `finops_cost_summary`: 月次サマリ情報（totalCost, forecastCost, previousSamePeriodCost, previousMonthTotalCost）
  - `finops_cost_service_monthly`: サービス別月次コスト（複数月分のデータが蓄積される）
- `finops_billing_files.status` の更新
- ログ出力:
  - 処理対象ファイル数
  - 成功・失敗件数
  - 失敗ファイルの詳細（projectId, objectKey, エラー内容）

#### 3.2.4 フロントエンド表示に必要な情報の取得状況

Batch Bの処理により、以下の情報が取得・計算され、フロントエンドで表示可能になる：

**✅ 取得可能な情報:**
- `totalCost`: 当月コスト合計（CURファイルから直接集計）
- `previousMonthTotalCost`: 前月総コスト（前月の `finops_cost_summary` から取得）
- サービス別月次コスト: 複数月分のデータが `finops_cost_service_monthly` に蓄積される

**⚠️ 計算が必要な情報:**
- `forecastCost`: 当月予測コスト
  - 計算式: `(本日までの合計コスト / 本日までの日数) × 当月の総日数`
  - Batch BでCURファイルをパースする際に、日付範囲を考慮して計算
- `previousSamePeriodCost`: 前月同時期コスト
  - 計算式: 前月の1日〜本日と同じ日付までのコスト合計
  - Batch BでCURファイルをパースする際に、`CUR_COLUMN_MAPPING.USAGE_START_DATE` を参照して日付範囲でフィルタリング

**❌ MVPでは固定値（別機能で実装）:**
- `executedActionsCount`: 実行した施策数（MVPでは0固定）
- `optimizationProposalsCount`: 最適化提案数（MVPでは0固定）
- `costReducedByActions`: 削減コスト（MVPでは0固定）

**注意事項:**
- 複数月分のデータが必要なため、初回実行時は過去数ヶ月分のCURファイルを処理する必要がある
- フロントエンドのグラフ表示には、最低でも2ヶ月分以上のデータが必要

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

- **通常ジョブ（API / CLI / Batch Aからの動的登録）**
  - jobId は明示指定せず、BullMQ デフォルトの jobId（UUID）を採用する。
  - `projectId` はジョブデータおよびログの context として扱い、識別する。
  - Batch Aから動的に登録されるBatch Bジョブも通常ジョブとして扱う。
- **スケジュールジョブ（repeatable jobs）**
  - `setupCurBatchSchedulers` 内で登録する repeatable job については、
    - `cur-fetch-schedule` のみ（Batch Aのみ定期実行）
    - Batch Bは定期実行しない（Batch Aから動的に登録される）
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
  - スケジューラーは常に有効（無効化フラグは削除）
  - env の cron 設定:
    - `CUR_FETCH_CRON` 例: `*/3 * * * *`（3分ごと）
    - `CUR_AGGREGATE_CRON` は使用しない（Batch Bは定期実行しない）
  - 実行方針:
    - Batch Aのみ定期実行（`cur-fetch` ジョブを `projectId` 未指定で enqueue）
    - Batch Aが新規ファイルを検出したプロジェクトについて、当該プロジェクトの `cur-aggregate` ジョブを動的に登録
    - Batch Bは定期実行しない（Batch Aからの動的登録のみ）

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
      - **新規ファイルがあるプロジェクトの `cur-aggregate` ジョブを動的に登録**
    - `runCurAggregateBatch(options: { projectId?: string })`
      - `finops_billing_files` の `PENDING` → `PROCESSING` → `DONE/ERROR` 管理
      - CUR 取得・パース・集計
      - `finops_cost_summary` / `finops_cost_service_monthly` への upsert
      - 通常は `projectId` が指定されており、当該プロジェクトのファイルのみ処理

- `src/features/batch/cur-column-mapping.ts`（新規作成）
  - CURカラム名マッピング定義
  - CUR 1.0形式（スラッシュ区切り）で実装
  - 後からCUR 2.0形式（アンダースコア区切り）に置換可能な設計
  - 定義内容:
    ```typescript
    export const CUR_COLUMN_MAPPING = {
      USAGE_START_DATE: 'lineItem/UsageStartDate',
      UNBLENDED_COST: 'lineItem/UnblendedCost',
      USAGE_AMOUNT: 'lineItem/UsageAmount',
      PRODUCT_NAME: 'product/ProductName',
    } as const;
    ```

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
    - cron パターン: `CUR_FETCH_CRON`（デフォルト: `*/3 * * * *`）
    - `CUR_AGGREGATE_CRON` は使用しない（Batch Bは定期実行しない）
  - 登録されるジョブ:
    - `cur-fetch`（データ空オブジェクト、`projectId` 未指定）
    - `cur-aggregate` は登録しない（Batch Aから動的に登録される）
  - 実行フロー:
    1. スケジューラーが3分ごとに `cur-fetch` ジョブを enqueue
    2. Batch Aが全プロジェクトをチェックし、新規ファイルがあるプロジェクトを特定
    3. 新規ファイルがあるプロジェクトについて、当該プロジェクトの `cur-aggregate` ジョブを動的に登録
    4. Batch Bはプロジェクト単位で並列実行される

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
