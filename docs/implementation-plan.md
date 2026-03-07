# 実装計画

## ディレクトリ構成

```
otel-practice-env/
├── README.md
├── docs/
│   ├── purpose.md
│   ├── architecture.md
│   └── implementation-plan.md
├── docker-compose.yml
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── otel/
│       │   └── tracing.ts
│       ├── components/
│       │   └── TodoList.tsx
│       └── api/
│           └── client.ts
├── backend/
│   ├── Dockerfile
│   ├── go.mod
│   ├── go.sum
│   ├── main.go
│   ├── handler/
│   │   └── todo.go
│   ├── db/
│   │   └── db.go
│   └── otel/
│       └── otel.go
├── db/
│   └── init.sql
└── otel-collector/
    └── otel-collector-config.yaml
```

## フェーズ一覧

| Phase | ブランチ名 | 内容 | 状態 |
|-------|-----------|------|------|
| 1 | `phase/1-infrastructure` | インフラ基盤 | 未着手 |
| 2 | `phase/2-go-backend` | Go Backend（素） | 未着手 |
| 3 | `phase/3-go-backend-otel` | Go Backend + OTel 計装 | 未着手 |
| 4 | `phase/4-react-frontend` | React フロントエンド（素） | 未着手 |
| 5 | `phase/5-react-frontend-otel` | React + OTel JS SDK | 未着手 |
| 6 | `phase/6-manual-instrumentation` | 手動計装・メトリクス・ログ | 未着手 |
| 7 | `phase/7-dashboard-finalize` | ダッシュボード・仕上げ | 未着手 |

## フェーズ間の依存関係

```
Phase 1 (インフラ基盤)
    │
    ├──→ Phase 2 (Go Backend 素)
    │        │
    │        └──→ Phase 3 (Go Backend + OTel)
    │                 │
    └──→ Phase 4 (React 素) ─── Phase 2 の API が必要
             │
             └──→ Phase 5 (React + OTel) ─── Phase 3 が前提
                      │
                      └──→ Phase 6 (手動計装・3シグナル)
                               │
                               └──→ Phase 7 (ダッシュボード・仕上げ)
```

---

## Phase 1: インフラ基盤 -- Docker Compose + Grafana LGTM + OTel Collector

### 目的

Observability バックエンドを先に立ち上げ、テレメトリ受信の基盤を整える。

### 作成するもの

- `docker-compose.yml` -- 以下のサービスを定義
  - `grafana` : `grafana/otel-lgtm` イメージ (Loki, Grafana, Tempo, Mimir が all-in-one)
  - `otel-collector` : `otel/opentelemetry-collector-contrib` イメージ
  - `db` : `mariadb` イメージ
- `otel-collector/otel-collector-config.yaml`
  - receivers: `otlp` (grpc:4317, http:4318)
  - processors: `batch`
  - exporters: `otlphttp` (Tempo), `loki` (Loki), `prometheusremotewrite` (Mimir)
  - service pipelines: traces, metrics, logs
- `db/init.sql` -- サンプルアプリ用の `todos` テーブル定義

### 動作確認

- `docker compose up` で全インフラサービスが起動する
- Grafana (http://localhost:3000) にブラウザからアクセスできる
- Tempo, Loki, Mimir のデータソースが Grafana で接続済みになっている
- OTel Collector のヘルスチェック (http://localhost:13133) が応答する

---

## Phase 2: Go バックエンド -- 素の HTTP API + MariaDB 接続

### 目的

OTel 計装なしの素のバックエンドを動かし、アプリケーションの基本動作を確認する。

### 作成するもの

- `backend/go.mod`, `backend/main.go` -- net/http ベースの HTTP サーバー
- `backend/handler/todo.go` -- CRUD エンドポイント
  - `GET /api/todos` -- 一覧取得
  - `POST /api/todos` -- 新規作成
  - `PUT /api/todos/:id` -- 更新
  - `DELETE /api/todos/:id` -- 削除
- `backend/db/db.go` -- `database/sql` + `go-sql-driver/mysql` による MariaDB 接続
- `backend/Dockerfile` -- マルチステージビルド
- `docker-compose.yml` に `backend` サービスを追加

### 動作確認

- `curl http://localhost:8080/api/todos` で JSON 応答が返る
- POST/PUT/DELETE で MariaDB のデータが更新される
- `docker compose logs backend` でアプリケーションログが出力される

---

## Phase 3: Go バックエンドに OTel 計装を追加

### 目的

バックエンド側で OTel Go SDK を導入し、トレース/メトリクス/ログを Collector 経由で Grafana に送信する。

### 作成するもの

- `backend/otel/otel.go` -- OTel SDK の初期化
  - TracerProvider (OTLP gRPC Exporter -> Collector:4317)
  - MeterProvider
  - Resource 属性 (service.name = "backend")
- `backend/handler/todo.go` の更新
  - `otelhttp.NewHandler()` による自動計装
  - 手動スパン追加（ビジネスロジック部分）
- `backend/db/db.go` の更新
  - `otelsql` による DB クエリの自動計装
- OTel 関連の依存追加
  - `go.opentelemetry.io/otel`
  - `go.opentelemetry.io/otel/sdk`
  - `go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc`
  - `go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp`

### 動作確認

- curl でバックエンド API を叩くと、Grafana の Tempo でトレースが表示される
- 1つのリクエストが複数のスパン (HTTP -> Handler -> DB) としてウォーターフォール表示される
- Grafana の Explore で Loki にバックエンドのログが流れている

---

## Phase 4: React フロントエンド -- 素の SPA

### 目的

OTel 計装なしのフロントエンドを構築し、バックエンド API と通信できる状態にする。

### 作成するもの

- `frontend/package.json` -- React, TypeScript, Vite の依存
- `frontend/vite.config.ts` -- 開発サーバー設定 (API プロキシ)
- `frontend/src/main.tsx` -- エントリポイント
- `frontend/src/App.tsx` -- メインコンポーネント
- `frontend/src/components/TodoList.tsx` -- Todo の CRUD UI
- `frontend/src/api/client.ts` -- fetch ベースの API クライアント
- `frontend/Dockerfile` -- マルチステージビルド (node + nginx)
- `frontend/nginx.conf` -- SPA 配信 + `/api` リバースプロキシ
- `docker-compose.yml` に `frontend` サービスを追加

### 動作確認

- ブラウザで http://localhost にアクセスし、Todo 画面が表示される
- Todo の作成、一覧表示、更新、削除が UI から操作できる
- DevTools Network タブで `/api/todos` へのリクエスト/レスポンスが確認できる

---

## Phase 5: React フロントエンドに OTel JS SDK を導入

### 目的

プロジェクトの主要学習ゴール。フロントエンドで OTel 計装を実装し、分散トレーシングを実現する。

### 作成するもの

- `frontend/src/otel/tracing.ts` -- OTel JS SDK の初期化
  - `WebTracerProvider`
  - `OTLPTraceExporter` (OTLP/HTTP -> Collector:4318)
  - `Resource` 属性 (service.name = "frontend")
  - `BatchSpanProcessor`
- 自動計装の導入
  - `@opentelemetry/instrumentation-document-load` -- ページロードのトレース
  - `@opentelemetry/instrumentation-fetch` -- fetch API の自動計装
- OTel Collector の CORS 設定追加
- OTel 関連の依存追加
  - `@opentelemetry/api`
  - `@opentelemetry/sdk-trace-web`
  - `@opentelemetry/sdk-trace-base`
  - `@opentelemetry/resources`
  - `@opentelemetry/semantic-conventions`
  - `@opentelemetry/exporter-trace-otlp-http`
  - `@opentelemetry/context-zone`
  - `@opentelemetry/instrumentation-fetch`
  - `@opentelemetry/instrumentation-document-load`

### 動作確認

- ブラウザで Todo アプリを操作すると、Grafana の Tempo にフロントエンドのトレースが表示される
- **フロントエンドとバックエンドのスパンが同一 Trace ID で関連付けられる（分散トレーシング）**
- Grafana で `frontend -> backend -> db` のウォーターフォールが確認できる

### 技術ポイント

`instrumentation-fetch` が自動的に `traceparent` ヘッダー (W3C Trace Context) を付与し、Go バックエンドの `otelhttp` がそれを受け取ることで、フロントエンドとバックエンドのスパンが1つのトレースとして繋がる。

---

## Phase 6: フロントエンドの手動計装とメトリクス・ログ

### 目的

自動計装だけでは取れないユーザー操作のトレースを手動で追加し、3シグナル（トレース・メトリクス・ログ）すべてを送信する。

### 作成するもの

- `frontend/src/otel/tracing.ts` の拡張
  - `MeterProvider` の追加
  - カスタムメトリクス（ボタンクリック数、API レスポンス時間など）
- `frontend/src/components/TodoList.tsx` の更新
  - 手動スパンの追加
  - スパンへのカスタム属性追加
- ログの送信設定
  - `@opentelemetry/sdk-logs` の導入
  - ログレコードに Trace ID を関連付け

### 動作確認

- Grafana の Tempo で手動計装のスパンが自動計装と一緒に表示される
- Grafana の Mimir でフロントエンドのカスタムメトリクスが確認できる
- Grafana の Loki でフロントエンドのログが確認でき、ログからトレースにジャンプできる
- トレース/メトリクス/ログの3シグナルがすべて Grafana に集約されている

---

## Phase 7: Grafana ダッシュボードとまとめ

### 目的

学習成果を可視化するダッシュボードを作成し、環境を完成させる。

### 作成するもの

- Grafana ダッシュボードの JSON 定義（プロビジョニング用）
- `docker-compose.yml` にダッシュボードのボリュームマウントを追加
- `README.md` の更新 -- 起動手順、各フェーズの説明、学習ポイント

### 動作確認

- `docker compose up` で環境が起動し、Grafana に事前定義のダッシュボードが表示される
- ダッシュボードでフロントエンド/バックエンドのリクエスト状況が一目で把握できる
- README の手順に従って、初めての利用者が環境を立ち上げて学習を開始できる

---

## 設計上の注意点

1. **Collector の CORS 設定**: Phase 5 でブラウザから OTel Collector に OTLP/HTTP を送信するため、HTTP レシーバーに CORS 許可設定が必須
2. **grafana/otel-lgtm**: all-in-one イメージだが、Collector は学習目的で別コンテナとして分離
3. **環境変数の管理**: OTel エンドポイントは `OTEL_EXPORTER_OTLP_ENDPOINT` 環境変数で docker-compose.yml から注入し、コードにハードコーディングしない
4. **W3C Trace Context**: nginx のリバースプロキシで `traceparent` ヘッダーが欠落しないよう注意
5. **開発時のホットリロード**: フロントエンドはローカル `npm run dev` と Docker ビルドの両方で動作する構成にする
