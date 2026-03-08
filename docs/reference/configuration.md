# 設定リファレンス

## Docker Compose サービス一覧

| サービス名 | コンテナ名 | イメージ | 役割 |
|---|---|---|---|
| `grafana` | `grafana` | `grafana/otel-lgtm:latest` | Grafana + Tempo + Loki + Mimir の all-in-one |
| `otel-collector` | `otel-collector` | `otel/opentelemetry-collector-contrib:latest` | テレメトリデータの受信・転送 |
| `db` | `mariadb` | `mariadb:latest` | アプリケーションデータの永続化 |
| `backend` | `backend` | ローカルビルド（`./backend/Dockerfile`） | Go HTTP API サーバー |
| `frontend` | `frontend` | ローカルビルド（`./frontend/Dockerfile`） | React SPA + nginx |

## ポート一覧

| ポート | サービス | 用途 |
|---|---|---|
| `80` | `frontend` | React アプリ（nginx） |
| `3000` | `grafana` | Grafana UI |
| `3306` | `db` | MariaDB |
| `4317` | `otel-collector` | OTLP gRPC レシーバー |
| `4318` | `otel-collector` | OTLP HTTP レシーバー |
| `8080` | `backend` | Go バックエンド API |
| `13133` | `otel-collector` | ヘルスチェックエンドポイント |

## アクセス先 URL

| サービス | URL |
|---|---|
| Todo アプリ | http://localhost |
| Grafana | http://localhost:3000 |
| バックエンド API（直接） | http://localhost:8080/api/todos |
| OTel Collector ヘルスチェック | http://localhost:13133 |

## 環境変数

### backend サービス

| 変数名 | 値（docker-compose.yml） | 説明 |
|---|---|---|
| `DB_DSN` | `appuser:apppassword@tcp(db:3306)/app?parseTime=true` | MariaDB 接続文字列 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `otel-collector:4317` | OTel Collector の gRPC エンドポイント |

### db サービス

| 変数名 | 値 | 説明 |
|---|---|---|
| `MYSQL_ROOT_PASSWORD` | `rootpassword` | MariaDB root パスワード |
| `MYSQL_DATABASE` | `app` | デフォルトデータベース名 |
| `MYSQL_USER` | `appuser` | アプリケーション用ユーザー |
| `MYSQL_PASSWORD` | `apppassword` | アプリケーション用パスワード |

## API エンドポイント

ベース URL: `http://localhost:8080`（バックエンド直接）または `http://localhost/api`（nginx 経由）

| メソッド | パス | 説明 | リクエストボディ | レスポンス |
|---|---|---|---|---|
| `GET` | `/api/todos` | Todo 一覧取得 | なし | `Todo[]` (200) |
| `POST` | `/api/todos` | Todo 新規作成 | `{"title": "string"}` | `Todo` (201) |
| `PUT` | `/api/todos/:id` | Todo 更新 | `{"title"?: "string", "completed"?: bool}` | `Todo` (200) |
| `DELETE` | `/api/todos/:id` | Todo 削除 | なし | 204 / 404 |

### Todo オブジェクトのスキーマ

```json
{
  "id": 1,
  "title": "サンプル Todo",
  "completed": false,
  "created_at": "2026-03-08T00:00:00Z",
  "updated_at": "2026-03-08T00:00:00Z"
}
```

### エラーレスポンス

```json
{
  "error": "エラーメッセージ"
}
```

| ステータス | 意味 |
|---|---|
| 400 | リクエストボディが不正（title が空など） |
| 404 | 指定した ID の Todo が存在しない |
| 500 | サーバー内部エラー |

## Grafana データソース

Grafana LGTM イメージには以下のデータソースが自動設定されています。

| データソース名 | 種別 | 用途 | Explore クエリ例 |
|---|---|---|---|
| Prometheus | Prometheus | メトリクス | `todo_created_total` |
| Loki | Loki | ログ | `{service_name="frontend"}` |
| Tempo | Tempo | トレース | Search タブで `service.name = frontend` |

## OTel Collector パイプライン構成

```yaml
# otel-collector/otel-collector-config.yaml より
receivers:
  otlp:
    protocols:
      grpc:  # ポート 4317
      http:  # ポート 4318（CORS 許可: localhost, localhost:5173）

processors:
  batch:
    timeout: 5s
    send_batch_size: 1024

exporters:
  otlphttp/traces:   → grafana:4318（Tempo）
  otlphttp/metrics:  → grafana:4318（Mimir）
  otlphttp/logs:     → grafana:4318（Loki）
  debug:             基本ログ出力

pipelines:
  traces:  [otlp] → [batch] → [otlphttp/traces, debug]
  metrics: [otlp] → [batch] → [otlphttp/metrics, debug]
  logs:    [otlp] → [batch] → [otlphttp/logs, debug]
```

## ボリューム・ネットワーク構成

### 名前付きボリューム

| ボリューム名 | マウント先（コンテナ） | 用途 |
|---|---|---|
| `grafana-data` | `grafana:/var/lib/grafana` | Grafana の設定・ダッシュボードデータ |
| `mariadb-data` | `db:/var/lib/mysql` | MariaDB のデータ |

### バインドマウント（主要なもの）

| ホストパス | コンテナパス | 用途 |
|---|---|---|
| `./otel-collector/otel-collector-config.yaml` | `/etc/otel-collector-config.yaml` | OTel Collector 設定 |
| `./grafana/provisioning/dashboards/dashboard.yaml` | `/otel-lgtm/grafana/conf/provisioning/dashboards/otel-practice.yaml` | Grafana ダッシュボードプロビジョニング設定 |
| `./grafana/dashboards` | `/otel-lgtm/dashboards` | Grafana ダッシュボード JSON |
| `./db/init.sql` | `/docker-entrypoint-initdb.d/init.sql` | MariaDB 初期化 SQL |

### ネットワーク

| ネットワーク名 | ドライバー | 説明 |
|---|---|---|
| `otel-network` | `bridge` | 全サービスが参加する共通ネットワーク |

## OTel メトリクス名の注意点

フロントエンド側で `createHistogram` に `unit: "ms"` を指定すると、Prometheus エクスポート時にサフィックスが付加されます。

| SDK 内での名前 | Prometheus での名前 |
|---|---|
| `todo.api.duration` | `todo_api_duration_milliseconds_bucket` |
| `todo.api.duration` | `todo_api_duration_milliseconds_count` |
| `todo.api.duration` | `todo_api_duration_milliseconds_sum` |

Grafana の Prometheus クエリを書く際は変換後のメトリクス名を使用してください。
