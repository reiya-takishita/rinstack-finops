# Rinstack FinOps 機能 詳細設計書（MVP：AWSコスト可視化）

## 0. 概要

### 0.1 目的

本書は、Rinstack に追加する FinOps 機能のうち、**AWS のクラウドコスト可視化（取得〜集計〜ダッシュボード表示）** に関する詳細設計を定義する。

本書の対象範囲は以下とする。

- Rinstack プロジェクトごとの AWS 接続設定
- AWS CUR（Cost and Usage Report）の取得バッチ
- CUR の解析・集計処理
- 集計結果のデータ永続化
- ダッシュボード用 REST API（Figma 1枚目「コスト運用」画面）
- フロントエンド（Nuxt3）からの利用パターン

本書は以下の設計レイヤのうち、**「詳細設計（実装直前レベル）」** に相当し、  
FinOps 機能全体に関する基本設計書（全体）を前提とする。

### 0.2 今回スコープ（MVP）

今回の詳細設計のスコープは、FinOps 機能全体のうち **「AWS コスト可視化」** の部分に限定する。

具体的には以下を含む。

- AWS アカウントとの接続設定（プロジェクト単位）
- AWS CUR の取得（S3 → FinOps サービス）
- CUR からのコスト集計（プロジェクト単位）
- 集計結果の保存（DB）
- Figma 1枚目のダッシュボード要素を返す API
  - KPI カード群
  - サービス別棒グラフ
  - 月次コスト履歴テーブル

### 0.3 非スコープ（本書では扱わない範囲）

以下は FinOps 機能全体のスコープには含まれるが、本書の詳細設計対象外とする。

- コスト最適化提案（Figma 2枚目・3枚目）
- LLM による改善案生成・リスク評価
- IaC（Terraform）や GitHub との連携による自動修正提案・PR
- 改善施策の実行履歴・削減実績管理
- 任意タイミングでの FinOps 解析実行（オンデマンド実行）
- 他クラウド（GCP/Azure）の FinOps 対応

これらは将来フェーズで別途詳細設計書を作成する。

### 0.4 参照文書

- FinOps 機能基本設計書（全体）
- コスト改善のデータ構造イメージ（スプレッドシート）
- Figma デザイン
  - コスト運用画面（プロジェクト別で独立）
  - コスト最適化管理画面（※本書では参照のみ）
  - コスト最適化詳細画面（※本書では参照のみ）



---


### 0.x ユーザーUXフロー（MVP）

本書で対象とする FinOps 機能（AWSコスト可視化）は、Rinstack 全体の UX の中で以下の流れで利用されることを想定する。

1. **ユーザー登録**
   - ユーザーは Rinstack にアカウント登録を行う。

2. **ホーム画面でのサービス選択**
   - ログイン後のホーム画面で、以下のいずれかを選択する。
     - `Rinstack Cloud`
     - `Rinstack University`

3. **Rinstack Cloud 選択時のデフォルト組織／プロジェクト作成**
   - ユーザーが `Rinstack Cloud` を選択すると、初回アクセス時に以下が自動作成される。
     - デフォルト組織
     - デフォルトプロジェクト
   - 以降、本書で扱う FinOps 機能はこのプロジェクト配下で動作する。

4. **サイドバー構成（MVP時点）**
   - 組織単位のメニュー例：
     - `ダッシュボード`
     - `サブスクリプション`
   - プロジェクト単位のメニュー例：
     - `インフラ生成`
     - `FinOps` 系メニュー（本書の対象：例「コスト運用」）

5. **クラウドプロバイダー情報入力（接続設定）**
   - プロジェクト単位で AWS との接続情報を入力する画面から、以下の情報を入力する。
     - AWSアカウントID
     - AssumeRole 用の Role ARN
     - External ID（任意）
     - CUR の S3バケット名
     - CUR のプレフィックス
   - 本画面の UI/UX（導線・配置）は現時点では暫定であり、今後変更される可能性がある。

6. **FinOps メニューから「コスト運用」画面を選択**
   - サイドバーから「コスト運用」を選択する。
   - バッチ処理が1度も成功していない場合は、「まだコストデータがありません」等の案内を表示する。

7. **コスト運用情報の表示**
   - 接続設定とバッチ処理が完了している場合、以下の情報を表示する。
     - コストサマリー（当月合計、前月合計、前月同時期、当月予測） ※MVP対象
     - サービスごとのコスト内訳グラフ
     - コスト履歴テーブル
   - コスト最適化施策に関する情報（削減額、施策数、提案数など）は将来フェーズの対象とし、MVPでは表示しないか 0 固定とする。



### 0.9 各サービスの実装概要（rinstack-app / rinstack-web / FinOpsコンテナ）

本MVPにおける Rinstack 全体の実装責務は以下の3コンポーネントに分割される。

#### ■ rinstack-app（バックエンド・BFF）
- Cognitoユーザー認証およびプロジェクト/組織単位の認可を担当する。
- FinOpsコンテナと通信する際に **S2S JWT を生成し、HTTPリクエストに付与する内部クライアント**を実装する。
- プロジェクトIDの妥当性（ユーザーがそのProjectにアクセス可能か）は rinstack-app 側で保証する。
- Nuxt（rinstack-web）からのAPI呼び出しを受けて FinOps コンテナを中継する“内部APIゲートウェイ”の役割を担う。

#### ■ rinstack-web（フロントエンド）
- Nuxt3ベースの SPA。FinOps画面は rinstack-app 経由で FinOps API を呼び出す。
- FinOps側に直接アクセスは行わず、**rinstack-app が提供する API のみ**を利用する。
- コスト運用画面は `/finops/projects/{projectId}/dashboard/*` 系APIへのアクセスを抽象化した composable / API クライアントを持つ。

#### ■ FinOps コンテナ（独立サービス）
- AWS接続設定、CUR取得、集計、可視化APIを提供する。
- **S2S JWT の検証 middleware を実装し、rinstack-app 以外の呼び出しを拒否**する。
- projectId は path parameter で受け取り、rinstack-app により正当性が保証される前提で処理する。


## 1. 前提条件・制約

## 1.X サービス間通信仕様（rinstack-app ↔ FinOps）

本MVPでは、フロントエンド（rinstack-web）からの FinOps API 呼び出しは、**必ず rinstack-app を経由して FinOps コンテナに中継される**。  
その際の通信は S2S JWT によって保護される。

### 1.X.1 rinstack-app → FinOps コンテナ：S2S JWT 生成と送信

rinstack-app は FinOps API を呼び出す内部クライアント層（例：`finopsClient`）を実装する。  
このクライアントは以下を行う。

1. **S2S JWT の生成**
   - 署名アルゴリズム: `RS256` または `ES256`
   - private key は rinstack-app 側に配置（env または secrets manager）
   - トークン例：

```json
{
  "iss": "rinstack-app",
  "aud": "finops-service",
  "client_id": "rinstack-app",
  "iat": 1732560000,
  "exp": 1732563600
}
```

2. **FinOps API 呼び出し時の Authorization ヘッダ付与**

```
Authorization: Bearer <generated-jwt>
```

3. **path の projectId は rinstack-app が正当性を保証した上でそのまま FinOps に伝播する。**

### 1.X.2 FinOps コンテナ側：S2S JWT 検証 middleware

FinOps コンテナは API 呼び出し時に以下を検証する middleware を実装する。

- `Authorization: Bearer` ヘッダの存在
- 署名の検証（rinstack-app が発行したJWTであること）
- `client_id === "rinstack-app"`
- `exp` / `iat` の妥当性
- `aud === "finops-service"`

この middleware は **FinOps の全 API（`/finops/projects/*`）に必須で適用**する。

### 1.X.3 projectId の信頼境界

- MVPでは、`projectId` は path parameter の値を FinOps 側がそのまま信頼する。
- “どのユーザーがどの projectId にアクセス可能か” の認可ロジックは rinstack-app が担う。
- 将来フェーズでは以下の検討が可能：
  - JWT に `projectId` をクレームとして付与し、path と一致することを FinOps 側で検証する
  - より強固な Zero-Trust モデルへの拡張




### 1.1 対象クラウド：AWS

- MVP では **AWS のみ** を対象とする。
- 将来的なマルチクラウド対応（GCP/Azure）は FinOps 機能全体の基本設計にのみ記述し、本書の実装対象外とする。

### 1.2 対象プロジェクト

- Rinstack の `projectId` を単位としてコストを管理する。
- 1つのプロジェクトに対して、1つ以上の AWS アカウント（CUR）を紐付ける拡張を将来的に許容するが、
  - MVP では **1プロジェクト : 1CUR（1S3バケット/プレフィックス）** とする。

### 1.3 データソース：AWS CUR

- AWS Billing の Cost and Usage Reports（以下 CUR）をデータソースとする。
- ユーザーは AWS マネジメントコンソール上で以下を事前に設定する。
  - Billing → コストと使用状況レポート (CUR)
  - CUR 2.0 を有効化
  - S3 バケットとプレフィックスを指定
- CUR のファイル形式は以下をサポートする。
  - CSV（標準）
  - Parquet（将来的対応対象、MVPでは CSV を必須サポート）

### 1.4 データ鮮度

- バッチ処理により **1日1回以上** CUR を取得し、集計を行う。
- ダッシュボードの表示値は **最大 24 時間前** のデータであることを許容する。
- UI には「最終更新日時」を表示し、ユーザーにデータ鮮度を明示する。

### 1.5 想定データ量と制約

- MVP では、中〜小規模な AWS 利用（1アカウント / 月次数十万行程度）を主な想定とする。
- 1 CUR ファイルのサイズは数十 MB〜数百 MB 程度を想定し、メモリに全読み込みできる単位で処理する。
- 大規模環境への最適化（水平スケール、分散処理等）は将来の課題とし、本書のパフォーマンス要件は「1日1回のバッチが現実的な時間で完了する」レベルとする。

### 1.6 今後の拡張（実装対象外）

- 任意タイミングでのオンデマンド解析実行（ユーザーが UI から FinOps 実行ボタンを押す）
- 複数アカウント / 複数CURの集約
- クロスアカウント / クロスプロジェクト集約
- 他クラウドのコスト集約

これらは FinOps 機能全体における将来構想として扱い、本書の詳細設計では考慮しない。



---

## 2. AWS接続設定

本章では、Rinstack プロジェクトごとに AWS 環境と CUR の所在を登録するための  
**「AWS接続設定」機能の詳細設計** を定義する。

### 2.1 画面概要（UIからの入力）

- 画面名（仮）：  
  - `プロジェクト設定 > コスト可視化（FinOps） > AWS接続設定`
- 想定パス：
  - `/project/[projectId]/finops/settings`
- 役割：
  - プロジェクト単位で AWS CUR 取得に必要な情報を入力・更新する
  - 設定が完了していない場合、ダッシュボード画面では「接続設定が必要です」という案内を表示する

#### 2.1.1 UI要素（MVP）

- 表示項目：
  - 説明文：  
    「このプロジェクトで利用している AWS アカウントと CUR 出力先を設定してください。」
- 入力フォーム：
  - AWSアカウントID（必須）
  - Role ARN（必須）
  - External ID（任意、空文字も許容）
  - CUR S3バケット名（必須）
  - CUR プレフィックス（必須）
- ボタン：
  - 「接続設定を保存」
  - （オプション）「接続確認テスト」ボタン（MVP では実装しない or 簡易実装）

### 2.2 入力項目一覧・バリデーション

| 項目名            | 型     | 必須 | バリデーション                                      |
|-------------------|--------|------|----------------------------------------------------|
| awsAccountId      | string | 必須 | 12桁の数字かどうか                                 |
| roleArn           | string | 必須 | `arn:aws:iam::[AccountId]:role/[RoleName]` 形式    |
| externalId        | string | 任意 | 255文字以内                                        |
| curBucketName     | string | 必須 | AWS S3 バケット名の命名規則に準拠                 |
| curPrefix         | string | 必須 | スラッシュ区切りのパス（例: `cur/reports/`）      |

- `curPrefix` は末尾スラッシュ有無を許容し、保存時に統一する（例：末尾に `/` を付加）。
- `awsAccountId` と `roleArn` の Account ID が一致しているかは、詳細設計としては任意とする（MVPではチェックしないか、WARNINGに留める）。

### 2.3 API定義

FinOps サービス（もしくは rinstack-app 内の FinOps モジュール）は、  
以下の REST API を提供する。

#### 2.3.1 GET /finops/projects/{projectId}/connection

- 概要：  
  指定したプロジェクトの AWS接続設定を取得する。

- リクエスト：
  - パスパラメータ：
    - `projectId`: string

- レスポンス（200 OK）例：

```json
{
  "projectId": "proj_123",
  "awsAccountId": "123456789012",
  "roleArn": "arn:aws:iam::123456789012:role/RinstackFinOpsRole",
  "externalId": "optional-external-id",
  "curBucketName": "my-aws-cur-bucket",
  "curPrefix": "cost-reports/proj-123/"
}
```

- レスポンス（404 Not Found）  
  - 当該プロジェクトに接続設定が存在しない場合。

#### 2.3.2 PUT /finops/projects/{projectId}/connection

- 概要：  
  指定したプロジェクトの AWS接続設定を新規登録または更新する。

- リクエスト：

```json
{
  "awsAccountId": "123456789012",
  "roleArn": "arn:aws:iam::123456789012:role/RinstackFinOpsRole",
  "externalId": "optional-external-id",
  "curBucketName": "my-aws-cur-bucket",
  "curPrefix": "cost-reports/proj-123/"
}
```

- バリデーションエラー時：400 Bad Request  
  - フロントエンドと同等のバリデーションをサーバ側でも実施する。

- 正常時：200 OK  
  - 保存された内容を返す。

### 2.4 保存データモデル（MVP版）

データストアは RDB / NoSQL のどちらでも構わないが、MVPとして以下の論理モデルを採用する。

- コレクション / テーブル名（例）：`finops_project_connections`

| フィールド名      | 型      | 説明                                |
|-------------------|---------|-------------------------------------|
| projectId         | string  | Rinstack プロジェクトID（PK相当）   |
| awsAccountId      | string  | AWSアカウントID                     |
| roleArn           | string  | AssumeRole 先 ARN                   |
| externalId        | string  | External ID（任意）                 |
| curBucketName     | string  | CUR 出力先 S3バケット名             |
| curPrefix         | string  | CUR ファイルのプレフィックス        |
| createdAt         | Date    | 作成日時                            |
| updatedAt         | Date    | 更新日時                            |

- `projectId` を主キーとする（1プロジェクト1接続設定）。
- 将来複数接続を許容する場合は `connectionId` を別途導入する。

### 2.5 エラーとUI挙動

- 接続設定未登録状態でダッシュボード画面にアクセスした場合：
  - ダッシュボード本体の代わりに「接続設定が必要です」というメッセージと、設定画面へのリンクを表示。
- 接続設定が存在するが、バッチ処理が1度も成功していない場合：
  - 「まだコストデータがありません」というメッセージと最終更新日時（null）を表示。

AssumeRole 実行時の失敗（認証エラー等）は、バッチ側のエラーとして扱い、本書では 3章で扱う。



---

## 3. CUR取得処理（Batch A）

本章では、S3 上の CUR ファイルを検出し、  
FinOps サービス内の「課金レポートファイル管理」テーブルに登録する処理を定義する。

### 3.1 全体フロー

1. バッチ起動（1日1回）
2. `finops_project_connections` から、FinOps が有効なプロジェクトを列挙
3. 各プロジェクトの接続設定を用いて AssumeRole
4. 指定された `curBucketName` + `curPrefix` 以下のオブジェクト一覧を取得
5. まだ処理対象となっていないファイルだけを、課金レポートファイル管理テーブルに登録
6. 状態を `PENDING` にしておき、後続の集計バッチ（Batch B）が処理する

### 3.2 AWS認証

- AssumeRole に使用する Role ARN / External ID は 2章の接続設定から取得。
- AWS SDK（node であれば `@aws-sdk/client-sts` / `@aws-sdk/client-s3`）を用いて以下を行う。
  - STS AssumeRole
  - 一時クレデンシャルで S3 ListObjects / GetObject

IAM 最小権限は以下を想定する。

- `sts:AssumeRole`
- `s3:ListBucket`（CUR バケット）
- `s3:GetObject`（CUR プレフィックス配下）

### 3.3 課金レポートファイル管理テーブル

論理モデル：

- コレクション / テーブル名（例）：`finops_billing_files`

| フィールド名        | 型      | 説明                                      |
|---------------------|---------|-------------------------------------------|
| id                  | string  | 内部ID（UUID）                            |
| projectId           | string  | 紐づくプロジェクトID                      |
| awsAccountId        | string  | 接続設定に対応するAWSアカウントID         |
| bucketName          | string  | CURバケット名                             |
| objectKey           | string  | S3オブジェクトキー                        |
| billingPeriod       | string  | 請求月（例：`2025-11`）                   |
| status              | string  | `PENDING` / `PROCESSING` / `DONE` / `ERROR` |
| errorMessage        | string  | エラー時メッセージ                        |
| createdAt           | Date    | 登録日時                                  |
| updatedAt           | Date    | 更新日時                                  |

- ユニーク制約：
  - `(projectId, bucketName, objectKey)` の組み合わせで一意とする。
- `billingPeriod` は CUR ファイル名から推定する（例：`...-2025-11.csv.gz` など）。

### 3.4 取得対象の決定ロジック

1. S3 ListObjectsV2 を利用し、`curPrefix` 配下のキー一覧を取得。
2. 各オブジェクトについて、`finops_billing_files` に既に存在しないか確認。
3. 存在しない場合のみ新規レコードとして `status = PENDING` で挿入。

- ファイル名のパターンが一定である事を期待しつつ、パースできなかった場合は `billingPeriod` を `null` にするが、それでも処理対象には含める。

### 3.5 ファイルDL処理

- Batch A では **実際の S3 GetObject は行わない**。
  - DL は Batch B 側で行う。
  - Batch A は「対象ファイルのリストアップと DB 登録」までを責務とする。

### 3.6 エラーハンドリング

- AssumeRole 失敗：
  - 対象プロジェクト単位でログ出力し、そのプロジェクトの処理をスキップ。
- S3 ListObjects 失敗：
  - 同様にログし、プロジェクト単位でスキップ。
- `finops_project_connections` 不備：
  - 2章の API 上では作られない前提だが、もし不整合が発生した場合はバッチエラーとして記録してスキップ。



---

## 4. CUR解析・集計処理（Batch B）

本章では、Batch A で `PENDING` として登録された CUR ファイルを対象に、  
実際のコスト集計処理を定義する。

### 4.1 処理フロー

1. `finops_billing_files` から `status = PENDING` のレコードを取得（一定件数まで）
2. 該当ファイルごとに:
   1. `status` を `PROCESSING` に更新
   2. S3 GetObject で CUR ファイルを取得
   3. CUR をパースしてレコード列挙
   4. 集計ロジックに基づき、月次合計 / サービス別集計を計算
   5. 集計結果を `finops_cost_summary` / `finops_cost_service_monthly` に upsert
   6. `status` を `DONE` に更新
3. 途中でエラーが発生した場合：
   - `status` を `ERROR` とし `errorMessage` に詳細を格納

### 4.2 CURファイル構造（概要）

- CUR ファイルは行指向のテーブル形式。
- 主に利用するカラム（代表例）：
  - `lineItem/UsageStartDate`
  - `lineItem/UnblendedCost`
  - `lineItem/UsageAmount`
  - `product/ProductName`（サービス名）
- MVP では「サービス別コスト」と「合計コスト」のみを利用し、  
  細かいディメンション（リージョン、タグなど）は無視する。

### 4.3 集計ロジック

#### 4.3.1 月次合計コスト

- 対象月を `billingPeriod` とする。
- `lineItem/UsageStartDate` がその月に属するレコードの `lineItem/UnblendedCost` を合計。

#### 4.3.2 前月同時期コスト

- 対象月の同じ日付範囲（例：1日〜29日）が前月に属するレコードの合計。
- 日付範囲は UI が期待する期間（1日〜作業日時）を採用。

#### 4.3.3 サービス別 × 月別コスト

- `product/ProductName` をキーとして、
- 各月ごとに `lineItem/UnblendedCost` を集計する。

#### 4.3.4 当月予測

- 当月の「本日までの平均日次コスト × 当月の日数」で概算する。
- 詳細な予測モデルは将来的な改善余地とし、MVPでは単純平均とする。

### 4.4 保存データモデル（MVP版）

#### 4.4.1 月次サマリテーブル：`finops_cost_summary`

| フィールド名           | 型      | 説明                                  |
|------------------------|---------|---------------------------------------|
| projectId              | string  | プロジェクトID                        |
| billingPeriod          | string  | 対象月（例：`2025-11`）              |
| totalCost              | number  | 当月コスト合計                        |
| forecastCost           | number  | 当月予測コスト                        |
| previousSamePeriodCost | number  | 前月同時期コスト                      |
| previousMonthTotalCost | number  | 前月総コスト                          |
| lastUpdatedAt          | Date    | 最終更新日時                          |

主キー例：`(projectId, billingPeriod)`

#### 4.4.2 サービス別月次テーブル：`finops_cost_service_monthly`

| フィールド名   | 型      | 説明                          |
|----------------|---------|-------------------------------|
| projectId      | string  | プロジェクトID                |
| billingPeriod  | string  | 対象月（例：`2025-11`）      |
| serviceName    | string  | サービス名                    |
| cost           | number  | 対象月の当該サービスのコスト |
| lastUpdatedAt  | Date    | 最終更新日時                  |

主キー例：`(projectId, billingPeriod, serviceName)`

### 4.5 パフォーマンス要件

- 1 CUR ファイルあたりの処理時間：数分以内を目標とする。
- 1日1回のバッチで、当日までのデータが更新される前提。
- 並列処理が必要になった場合は、`finops_billing_files` の `PENDING` をシャーディング or 分割して処理する設計とする（MVPでは単一プロセス前提でも可）。



---

## 5. API仕様（可視化用）

本章では、Figma 1枚目「コスト運用」画面を実現するための API を定義する。

### 5.1 API一覧

1. `GET /finops/projects/{projectId}/dashboard/summary`
2. `GET /finops/projects/{projectId}/dashboard/services-monthly`
3. `GET /finops/projects/{projectId}/dashboard/history`

### 5.2 GET /finops/projects/{projectId}/dashboard/summary

#### 5.2.1 概要

- プロジェクト単位で、以下の KPI を返す：
  - 当月コスト合計
  - 実行した施策数（MVPでは0固定または未実装）
  - 最適化提案数（MVPでは0固定）
  - 当月予測コスト
  - 前月同時期コスト
  - 前月総コスト
  - 削減コスト（MVPでは0固定）

#### 5.2.2 レスポンス例

```json
{
  "projectId": "proj_123",
  "billingPeriod": "2025-11",
  "totalCost": 154345,
  "executedActionsCount": 0,
  "optimizationProposalsCount": 0,
  "forecastCost": 172159,
  "previousSamePeriodCost": 158975,
  "previousMonthTotalCost": 203164,
  "costReducedByActions": 0,
  "lastUpdatedAt": "2025-11-29T12:34:56Z"
}
```

### 5.3 GET /finops/projects/{projectId}/dashboard/services-monthly

#### 5.3.1 概要

- サービス別×月別のコスト推移を返す。
- Figma 1枚目の棒グラフ部分に対応。

#### 5.3.2 レスポンス例

```json
{
  "projectId": "proj_123",
  "months": ["2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11"],
  "services": [
    {
      "serviceName": "Amazon Simple Storage Service",
      "costs": [52156, 57318, 48611, 63910, 52148, 66151, 48215, 37910]
    },
    {
      "serviceName": "Amazon Elastic Container Service",
      "costs": [66236, 77341, 58125, 80214, 88341, 73913, 148461, 92314]
    },
    {
      "serviceName": "Amazon Cloud Front",
      "costs": [21109, 22546, 22325, 21943, 22001, 22114, 22164, 21119]
    }
  ]
}
```

### 5.4 GET /finops/projects/{projectId}/dashboard/history

#### 5.4.1 概要

- 「コスト履歴」テーブル用の集計を返す。
- サービス名×月のテーブル形式。

#### 5.4.2 レスポンス例

```json
{
  "projectId": "proj_123",
  "months": ["2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11"],
  "rows": [
    {
      "serviceName": "Simple Storage Service",
      "monthlyCosts": [52156, 57318, 48611, 63910, 52148, 66151, 48215, 37910]
    },
    {
      "serviceName": "Elastic Container Service",
      "monthlyCosts": [66236, 77341, 58125, 80214, 88341, 73913, 148461, 92314]
    },
    {
      "serviceName": "Cloud Front",
      "monthlyCosts": [21109, 22546, 22325, 21943, 22001, 22114, 22164, 21119]
    }
  ]
}
```

### 5.5 エラーケース

- プロジェクト未存在：404 Not Found
- AWS接続設定未設定：409 Conflict（または 400）＋「接続設定が必要」のメッセージ
- バッチ未実行：200 OK だがデータ配列が空、かつ「データ未取得」フラグを返すなど、フロント側で表示分岐できるようにする。



---

## 6. フロントエンド仕様（Nuxt3）

### 6.1 対象画面：コスト運用

- 既存の Rinstack フロントエンド構造に従い、以下の構成を想定する。
  - ページ：`src/pages/project/[id]/finops/index.vue`（仮）
  - Store：`src/store/stateFinopsDashboard.ts`（新規）
  - Composable：`src/composables/finops/useFinopsDashboard.ts`（新規）
  - コンポーネント：
    - KPIカードコンポーネント
    - サービス別グラフコンポーネント
    - 履歴テーブルコンポーネント

### 6.2 データフロー

1. ページマウント時に `projectId` を取得。
2. `useFinopsDashboard` を通して以下APIを順次 or 並列に叩く。
   - `/finops/projects/{projectId}/dashboard/summary`
   - `/finops/projects/{projectId}/dashboard/services-monthly`
   - `/finops/projects/{projectId}/dashboard/history`
3. Store に結果を反映し、各コンポーネントに渡す。

### 6.3 型定義（例）

```ts
export interface FinopsSummary {
  projectId: string;
  billingPeriod: string;
  totalCost: number;
  executedActionsCount: number;
  optimizationProposalsCount: number;
  forecastCost: number;
  previousSamePeriodCost: number;
  previousMonthTotalCost: number;
  costReducedByActions: number;
  lastUpdatedAt: string;
}

export interface FinopsServiceMonthly {
  projectId: string;
  months: string[];
  services: {
    serviceName: string;
    costs: number[];
  }[];
}

export interface FinopsHistory {
  projectId: string;
  months: string[];
  rows: {
    serviceName: string;
    monthlyCosts: number[];
  }[];
}
```

### 6.4 UIエラー処理

- 接続未設定：
  - APIから特定のエラーコード or ステータスを受け取った場合、
    - 「AWS接続設定がされていません」メッセージと設定画面へのリンクを表示。
- データ未取得：
  - 空データの際は「まだコストデータが取得されていません」などの表示に切り替える。



---

## 7. 非機能要件（MVP準拠）

### 7.1 パフォーマンス

- バッチ処理：1日1回の実行で完了すること。
- ダッシュボードAPI：通常 1秒以内のレスポンスを目標とする。

### 7.2 運用

- バッチの実行状況（成功/失敗）はログおよびメトリクスとして監視し、アラート設定を行う前提とする（運用設計は別途）。
- 手動リトライは当面 DB 直接操作か運用スクリプトで対応する（専用UIはMVP外）。

### 7.3 セキュリティ

- AssumeRole 専用ロールは S3 読み取り専用権限のみを付与。
- 接続設定の保存時には、必要に応じて暗号化ストア（KMS 等）を利用することを検討（実装有無はインフラ方針に依存）。

### 7.4 ロギング

- バッチ処理の開始・終了・エラーをログに記録。
- プロジェクトID・ファイル名をキーとしてトレース可能とする。

---

## 8. 将来拡張（抜粋）

本詳細設計書のスコープ外だが、FinOps 機能全体の基本設計で示された将来拡張を簡単に整理する。

- LLM によるコスト最適化提案生成（改善案一覧・詳細）
- 改善施策の実行履歴と削減額トラッキング
- Terraform / GitHub 連携による IaC 修正提案と PR 作成
- オンデマンド FinOps 実行（UIボタンから即時解析）
- 他クラウド（GCP/Azure）の CUR 相当データ取り込み・集計

これらは本書の基盤（接続設定・CUR取得・集計）を前提として実装される。

---

## 9. 付録

### 9.1 用語

- CUR：Cost and Usage Report
- BillingPeriod：請求月単位の期間を表す文字列（例：`2025-11`）

