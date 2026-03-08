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

Grafana（http://localhost:3000）を開くと **"OTel Practice - Overview"** ダッシュボードが自動で表示されます。トレース・メトリクス・ログの3シグナルをまとめて確認できます。

詳細な操作手順は [はじめてみよう](docs/tutorials/getting-started.md) を参照してください。

## フェーズ構成

| Phase | コミット | 内容 |
|---|---|---|
| 1 | [c7d25a2](https://github.com/hidekingerz/otel-practice-env/commit/c7d25a2) | インフラ基盤 (LGTM + OTel Collector) |
| 2 | [0e9b41e](https://github.com/hidekingerz/otel-practice-env/commit/0e9b41e) | Go バックエンド（素） |
| 3 | [b254c17](https://github.com/hidekingerz/otel-practice-env/commit/b254c17) | Go バックエンド + OTel 計装 |
| 4 | [ab6d1f6](https://github.com/hidekingerz/otel-practice-env/commit/ab6d1f6) | React フロントエンド（素） |
| 5 | [8b3774b](https://github.com/hidekingerz/otel-practice-env/commit/8b3774b) | React + OTel JS SDK・分散トレーシング |
| 6 | [3e43b87](https://github.com/hidekingerz/otel-practice-env/commit/3e43b87) | 手動計装・メトリクス・ログ |
| 7 | [13d8e9a](https://github.com/hidekingerz/otel-practice-env/commit/13d8e9a) | Grafana ダッシュボード・仕上げ |

## ドキュメント

| 種別 | ドキュメント | 内容 |
|---|---|---|
| チュートリアル | [はじめてみよう](docs/tutorials/getting-started.md) | 環境起動から Grafana で3シグナル確認まで |
| ハウツー | [開発ガイド](docs/how-to/development.md) | ローカル開発・ログ確認・設定変更の手順 |
| リファレンス | [設定リファレンス](docs/reference/configuration.md) | ポート・環境変数・API・Collector 設定の一覧 |
| 解説 | [プロジェクト目的](docs/explanation/purpose.md) | 背景・学習ゴール・スコープ |
| 解説 | [アーキテクチャと設計思想](docs/explanation/architecture.md) | システム構成・技術選定理由・トレードオフ |
