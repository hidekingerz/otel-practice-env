# otel-practice-env

OpenTelemetry (OTel) の3シグナル（トレース・メトリクス・ログ）を、フルスタック構成で学習するための実践環境です。

## アーキテクチャ

```
Browser (React)
    │  OTLP/HTTP (traces, metrics, logs)
    │                    ┌──────────────────────────────────┐
    ▼                    │  grafana/otel-lgtm               │
 nginx:80 ──/api──► backend:8080 ──OTLP/gRPC──► OTel       │  Tempo  (traces)
                    │              Collector    Collector ──► Mimir  (metrics)
                    ▼                    │                  │  Loki   (logs)
                 MariaDB                 └──────────────────┘
```

## 起動方法

```bash
# 初回起動（全サービスをビルド）
docker compose up --build

# 2回目以降
docker compose up

# 停止
docker compose down
```

### アクセス先

| サービス | URL | 説明 |
|---|---|---|
| Todo アプリ | http://localhost | React フロントエンド |
| Grafana | http://localhost:3000 | 可観測性ダッシュボード |
| Backend API | http://localhost:8080/api/todos | Go バックエンド直接アクセス |

## Grafana での確認

### ダッシュボード（自動プロビジョニング）

Grafana を開くと **"OTel Practice - Overview"** ダッシュボードが自動で表示されます。

- **Frontend Metrics**: Todo 操作回数・API レスポンス時間
- **Recent Traces**: frontend/backend の最新トレース一覧
- **Logs**: frontend/backend のリアルタイムログ

### Explore で個別確認

| シグナル | データソース | クエリ例 |
|---|---|---|
| Traces | Tempo | `{service.name="frontend"}` または Search タブ |
| Metrics | Prometheus | `todo_created_total` |
| Logs | Loki | `{service_name="frontend"}` |

### 分散トレーシングの確認

1. http://localhost で Todo を作成・削除する
2. Grafana > Explore > Tempo > Search
3. `Service Name = frontend` でトレース一覧を表示
4. トレースをクリック → `frontend → backend → db` のウォーターフォールを確認

## フェーズ構成と学習ポイント

| Phase | 内容 | 学習ポイント |
|---|---|---|
| 1 | インフラ基盤 (LGTM + OTel Collector) | Grafana LGTM スタック、Collector のパイプライン設定 |
| 2 | Go バックエンド（素） | net/http + database/sql の基本実装 |
| 3 | Go バックエンド + OTel | TracerProvider / MeterProvider / LoggerProvider の初期化、otelhttp / otelsql 自動計装 |
| 4 | React フロントエンド（素） | Vite + React、nginx リバースプロキシ |
| 5 | React + OTel JS SDK | WebTracerProvider、FetchInstrumentation による **分散トレーシング** |
| 6 | 手動計装・3シグナル | 手動スパン・カスタムメトリクス・ログの実装 |
| 7 | ダッシュボード・仕上げ | Grafana プロビジョニング |

### 重要な技術ポイント

**分散トレーシングの仕組み（Phase 5）**

`FetchInstrumentation` がブラウザの fetch リクエストに自動的に `traceparent` ヘッダー（W3C Trace Context）を付与し、Go バックエンドの `otelhttp` がそれを受け取ることで、フロントエンドとバックエンドのスパンが同一 Trace ID でつながります。

```
Browser fetch("/api/todos")
  → traceparent: 00-{trace-id}-{span-id}-01  (自動付与)
    → backend otelhttp が trace-id を継続
      → 同一トレースとして Tempo に記録
```

**3シグナルの役割**

- **Traces**: 「どこで何が起きたか」を時系列で追跡（因果関係の可視化）
- **Metrics**: 「どのくらいの量・速さ」を数値で把握（アラート・SLO に活用）
- **Logs**: 「何が起きたか」の詳細テキスト（デバッグに活用）

## ドキュメント

- [プロジェクト目的](docs/purpose.md)
- [アーキテクチャと技術スタック](docs/architecture.md)
- [実装計画](docs/implementation-plan.md)
