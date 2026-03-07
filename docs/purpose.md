# プロジェクト目的

## 背景

Observability（o11y）は、分散システムの動作を外部から観測・理解するための考え方であり、現代のソフトウェア開発において不可欠な要素となっている。OpenTelemetry（OTel）はその標準的なフレームワークとして、トレース・メトリクス・ログの3つのテレメトリシグナルを統一的に扱う手段を提供している。

しかし、OTel の概念やSDKの利用方法は多岐にわたり、特にフロントエンド（ブラウザ環境）での計装はバックエンドと比べて事例や情報が少ない。本プロジェクトは、OTel を実際に動かしながら学ぶための検証環境として構築する。

## 目的

本プロジェクト `otel-practice-env` は、OpenTelemetry を用いた Observability の学習・検証環境を提供する。

具体的には以下を目的とする：

- OpenTelemetry の基本概念（トレース、メトリクス、ログ）を実動作で理解する
- **フロントエンド（TypeScript / React）での OTel JS SDK の利用方法を習得する**
- バックエンド（Go）での OTel Go SDK の利用方法を理解する
- OTel Collector を介したテレメトリデータの収集・転送の仕組みを把握する
- Grafana LGTM スタックでのテレメトリデータの可視化・分析を体験する

## 学習ゴール

### 主要ゴール：フロントエンド TypeScript での OTel SDK 利用

- OTel JS SDK のセットアップと初期化
- ブラウザ環境でのトレース計装（自動計装・手動計装）
- フロントエンドからバックエンドへのコンテキスト伝播（W3C Trace Context）
- OTLP エクスポーターの設定と OTel Collector への送信

### 副次ゴール：OTel 全般の理解

- OTel のアーキテクチャ（SDK、API、Collector）の全体像
- バックエンド（Go）での OTel 計装パターン
- トレース・メトリクス・ログの関連付け
- Grafana（Tempo / Loki / Mimir）でのテレメトリデータの閲覧方法

## スコープ

### やること

- Docker Compose による学習環境一式の構築
- React SPA での OTel JS SDK の導入と計装
- Go バックエンドでの OTel Go SDK の導入と計装
- OTel Collector の設定（レシーバー、プロセッサー、エクスポーター）
- Grafana LGTM スタックによるテレメトリデータの可視化
- フロントエンドとバックエンド間の分散トレーシング

### やらないこと

- 本番環境を想定したインフラ設計・運用設計
- パフォーマンスチューニングや負荷テスト
- セキュリティ要件の実装（認証・認可・TLS等）
- Kubernetes や Helm を使ったデプロイ
- OTel 以外の Observability ツール（Datadog, New Relic 等）との比較検証
