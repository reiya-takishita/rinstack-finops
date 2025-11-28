# Rinstack App - アーキテクチャポリシー

## 設計原則

このプロジェクトは以下の設計思想に基づき構成されています。

先に3行でまとめます。
1. 「/src/shared/」はアプリケーション横断機能
2. 「/src/features/」直下はエンドポイント横断機能
3. 「/src/features/endpoint/[domain]」はエンドポイント固有機能
---

## 構成 = 設計

ファイル名とディレクトリパスだけで中身の責務が即座に分かること。

`utils` / `common` / `core` のような曖昧な構成は一切禁止。

処理対象と責務をパス全体で表現する。責務を抽象名に逃がさない。

---

## ドメイン駆動構成（DDD志向 + LLM対応）

各機能は `features/` 以下に集約し、次の構成単位で責務を明示：

- `routes.ts`：ルーティング（唯一の外部エントリポイント）
- `service.ts`：アプリケーションサービス層（ビジネスルールとユースケース処理）
- `schema.ts`：Zodによる入力バリデーション（`.infer<>` によって型生成を一体化）
- `repository.ts`：DBアクセスの責務分離（`models`直アクセスは禁止）
- `worker.ts` / `queue.ts`：非同期/LLMタスク処理（必要に応じて）

永続化層のモデルは `models/` に配置。Sequelize CLIにより自動生成され、直接importは許可しない。`repository`層を通じてのみ操作する。

複雑なユースケースでは、`service.ts` をディレクトリ化し、`create.ts` / `update.ts` などで分割。  
`repository` も同様に `crud.ts` / `query.ts` / `aggregate.ts` 等に分割し、`index.ts` で再統合する構成とする。

`interface` / `adapter` の抽象分離は、将来的に実装切替が想定される箇所（DB, 外部API 等）に限定する。  
原則として、`interface` と実装は**同一ファイルに配置すること**。LLMの文脈保持を妨げないため。DIの導入も最小限に抑える。

エンドポイント実装はすべて `routes.ts` から開始し、`service → repository` の方向で処理が流れる。逆依存は禁止する。

---

## AI開発支援最適化

Cursor / Devin 等の AI 開発支援ツールが「機能単位」でコード探索できる構成を徹底。

同一ディレクトリ内に責務が揃っていることで、LLMが文脈を見失わずに修正・提案可能。

ファイル名から用途が明示され、LLMの1-hop探索で処理全体がトレース可能であること。

---

## CRUDの扱い

基本的なCRUD/一覧取得は `service.ts` に集約。  
ただし責務が増えた場合はファイル分割を行い、`create.ts` / `detail.ts` / `list.ts` / `update.ts` / `delete.ts` に分離。  
ドメインロジックを含む場合は `usecase.ts` や `logic.ts` 等に明確に責務分離する。  
（ただし、可能な限り `create.ts`, `detail.ts`, `list.ts`, `update.ts`, `delete.ts` に収めること）

---

## shared/ の扱い

`shared/` は「アプリケーション全体に関わる横断的責務」を明示するためのレイヤー。

`logger` / `database` / `aws` / `security` / `config` など、スコープが全機能にまたがるもののみ配置可能。

`utils.ts`, `helpers/`, `core/` のような責務不明構成は禁止。共通ロジックは明示的に責務名でディレクトリを切ること。

---

## 認証・認可の扱い

### 権限管理システムの設計原則

権限管理は**APIエンドポイント単位**で細かく制御する。粗い権限（`manage`/`view`）ではなく、具体的な操作権限（`create`, `update`, `delete`等）を定義する。

権限チェックは各`service.ts`の冒頭で実行し、認可失敗時は即座に403エラーを返す。権限ロジックをビジネスロジックと混在させない。

### 権限定義の配置

権限定義やロール、JWT 認証ロジックは、各 `rinstack-*` プロジェクトで `shared/auth/` や `shared/types/` など適切な場所に実装する。  
このベースリポジトリには具体的な認証・認可実装は含まれていない。

### 権限フロー

1. **JWT認証**でユーザー情報と権限を`req.user`・`req.authorityStatusCode`に設定
2. **Service層**で`AuthPermissionManager.hasPermission()`により権限チェック
3. **権限不足時**は403エラーで即座に処理中断
4. **権限充足時**のみビジネスロジックを実行

---

## Swagger連携

`features/endpoint/` は、HTTPルーティングに対応するエントリポイントのみを配置する専用レイヤー。

Swagger（`rinstack.yaml`）に定義されたエンドポイント群は、すべて `features/endpoint/<path>/routes.ts` に個別に対応する構成を取る。

`/auth`, `/projects`, `/organizations`, `/infrastructure`, `/config`, `/attachmentFiles` などは path単位でディレクトリ分割される。

`routes.ts` は `schema.ts`, `service.ts` をimportして責務を統合する唯一のポイントであり、他ファイルから逆に依存されることはない。

アプリ全体のルーティングは `src/app.ts` にて、全ての `features/endpoint/<path>/routes.ts` をルートごとにマウントする。

API仕様は Swagger によって一元管理され、コード構成はこれに完全準拠する（Cursor等のLLM支援ツールが破綻なく参照可能な構成）

---

## ディレクトリ構成概要

```
.
├── src/
│   ├── app.ts                                # アプリケーション初期化・ミドルウェア定義
│   ├── routes/
│   │   └── index.ts                          # 最小ルーター（/health など）
│   ├── models/
│   │   └── init-models.ts                    # Sequelize モデル初期化用プレースホルダ
│   ├── shared/
│   │   ├── aws/
│   │   ├── config/
│   │   ├── database/
│   │   ├── logger/
│   │   ├── security/
│   │   └── abort/
│   └── @types/
│       └── express/
```

※ 各 `rinstack-*` プロジェクトでは、この構成を土台に `features/` や `shared/auth/` などのドメイン固有コードを追加していく。

---

この構成を維持することで、人間とAIの両者が「正確に」「速く」「安全に」コードを追える環境を実現します。