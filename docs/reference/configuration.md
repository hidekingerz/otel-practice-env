# 設定リファレンス

## Docker Compose サービス一覧

| サービス名 | コンテナ名 | イメージ | 役割 |
|---|---|---|---|
| `grafana` | `grafana` | `grafana/otel-lgtm:latest` | Grafana + Tempo + Loki + Mimir の all-in-one |
| `otel-collector` | `otel-collector` | `otel/opentelemetry-collector-contrib:latest` | テレメトリデータの受信・転送 |
| `db` | `mariadb` | `mariadb:latest` | アプリケーションデータの永続化 |
| `backend` | `backend` | ローカルビルド（`./backend/Dockerfile`） | Go HTTP API サーバー |
| `frontend` | `frontend` | ローカルビルド（`./frontend/Dockerfile`） | React SPA + nginx |
| `obi` | `obi` | `otel/ebpf-instrument:v0.13.0` | eBPF 自動計装（Phase 9）。profile `obi` を指定したときのみ起動 |

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

### obi サービス

| 変数名 | 既定値 | 説明 |
|---|---|---|
| `OBI_CONFIG` | `config.yaml` | OBI が読む設定ファイル名（`obi/` ディレクトリ内）。`config-compare.yaml` にすると backend も OBI の計装対象になる |

ホスト側で `OBI_CONFIG=config-compare.yaml docker compose --profile obi up -d obi` のように指定する（Compose が `command` の `${OBI_CONFIG:-config.yaml}` を展開する）。

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
| Tempo | Tempo | トレース | `{resource.service.name="frontend"}`（OBI 有効時は `nginx` も可） |

## OTel Collector パイプライン構成

```yaml
# otel-collector/otel-collector-config.yaml より
receivers:
  otlp:
    protocols:
      grpc:  # ポート 4317
      http:  # ポート 4318
        cors:
          allowed_origins:
            - "http://localhost"
            - "http://localhost:5173"
          allowed_headers:
            - "*"

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

## OBI 設定（`obi/`）

| ファイル | 用途 |
|---|---|
| `obi/config.yaml` | 既定。nginx のみを計装する |
| `obi/config-compare.yaml` | 比較演習用。nginx に加えて Go backend も `backend-obi` として計装する。`config.yaml` との差分は `discovery` セクションのみ |

| キー | 値 | 説明 |
|---|---|---|
| `discovery.instrument[]` | `name: nginx`, `open_ports: 80`, `exe_path: "*nginx*"` | ポート 80 を開き、実行ファイル名に nginx を含むプロセスを `service.name=nginx` として計装。Docker Desktop では `dockerd` も公開ポートを開くため `exe_path` で絞る |
| `discovery.instrument[]`（compare のみ） | `name: backend-obi`, `open_ports: 8080`, `exe_path: "*/app/server*"` | Go backend を `service.name=backend-obi` として計装 |
| `discovery.exclude_otel_instrumented_services`（compare のみ） | `false` | OTLP を送信しているプロセスを自動除外する機能を無効化。この構成では検知が発火しないため、比較演習の挙動を固定する目的で明示 |
| `ebpf.context_propagation` | `all` | 送信パケットの `traceparent` を OBI の client span に書き換える。Docker Desktop では HTTP ヘッダー注入が無効化される（起動時 ERROR ログ） |
| `routes.patterns` | `/api/todos/stats`, `/api/todos/:id`, `/api/todos` | `http.route` 属性に使うパスパターン。`:id` はプレースホルダ |
| `routes.unmatched` | `path` | パターンに一致しないパスはそのまま `http.route` にする |
| `otel_traces_export.endpoint` | `http://otel-collector:4318` | トレースの OTLP/HTTP 送信先 |
| `otel_metrics_export.endpoint` | `http://otel-collector:4318` | メトリクスの OTLP/HTTP 送信先 |
| `otel_metrics_export.interval` | `15s` | メトリクスの送信間隔（既定 `60s`） |

Compose 側では `pid: host`、`privileged: true`、`stop_grace_period: 60s` を指定している。前 2 つは eBPF プログラムのロードと他コンテナのプロセス観測のため、最後は Docker Desktop で停止時に出る "PID is zombie" エラーの回避のため。

設定キーの全一覧は [OBI 公式ドキュメント](https://opentelemetry.io/docs/zero-code/obi/configure/) を参照。

## OBI が生成するメトリクス

OBI は OTel セマンティック規約に沿った名前でメトリクスを生成し、Prometheus（Mimir）では `.` が `_` に、単位が `_seconds` / `_bytes` に変換される。実機（v0.13.0）で確認した名前は次のとおり。

| Prometheus での名前 | 種別 | 出る service_name | 主なラベル |
|---|---|---|---|
| `http_server_request_duration_seconds_{bucket,count,sum}` | ヒストグラム | `nginx`, `backend-obi` | `http_route`, `http_request_method`, `http_response_status_code` |
| `http_server_request_body_size_bytes_{bucket,count,sum}` | ヒストグラム | `nginx`, `backend-obi` | 同上 |
| `http_server_response_body_size_bytes_{bucket,count,sum}` | ヒストグラム | `nginx`, `backend-obi` | 同上 |
| `http_client_request_duration_seconds_{bucket,count,sum}` | ヒストグラム | `nginx` | `http_request_method`, `http_response_status_code`, `server_address` |
| `http_client_request_body_size_bytes_{bucket,count,sum}` | ヒストグラム | `nginx` | 同上 |
| `http_client_response_body_size_bytes_{bucket,count,sum}` | ヒストグラム | `nginx` | 同上 |
| `db_client_operation_duration_seconds_{bucket,count,sum}` | ヒストグラム | `backend-obi` | `db_system_name`, `db_operation_name` |
| `rpc_client_call_duration_seconds_{bucket,count,sum}` | ヒストグラム | `backend-obi` | `rpc_method`, `server_address`（backend 自身の OTLP gRPC エクスポート呼び出し） |
| `target_info` | 情報 | すべて | リソース属性（`telemetry_distro_name` 等） |

Explore クエリ例: `rate(http_server_request_duration_seconds_count{service_name="nginx"}[5m])`

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
| `./obi` | `/config` | OBI 設定ディレクトリ（profile `obi` 有効時のみ） |

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

変換後のメトリクス名が Prometheus クエリおよび Grafana パネルで使われる名前となる。
