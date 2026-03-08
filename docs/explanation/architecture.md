# アーキテクチャと設計思想

## システム構成図

```mermaid
graph LR
    subgraph Browser
        React["React SPA<br/>(TypeScript)"]
    end

    subgraph Backend
        Go["Go Backend"]
        DB["MariaDB"]
    end

    subgraph "Telemetry Pipeline"
        Collector["OTel Collector"]
    end

    subgraph "Observability Backend"
        Tempo["Tempo<br/>(トレース)"]
        Loki["Loki<br/>(ログ)"]
        Mimir["Mimir<br/>(メトリクス)"]
        Grafana["Grafana<br/>(可視化)"]
    end

    React -- "HTTP API" --> Go
    Go -- "SQL" --> DB

    React -- "OTLP/HTTP<br/>(テレメトリ)" --> Collector
    Go -- "OTLP/gRPC<br/>(テレメトリ)" --> Collector

    Collector --> Tempo
    Collector --> Loki
    Collector --> Mimir

    Tempo --> Grafana
    Loki --> Grafana
    Mimir --> Grafana
```

## テレメトリデータの流れ

フロントエンドとバックエンドの両方から、3種類のテレメトリシグナルが OTel Collector を経由して Grafana LGTM スタックに流れる。

### トレース

```
React SPA  --[OTLP/HTTP]--> OTel Collector --> Tempo --> Grafana
Go Backend --[OTLP/gRPC]--> OTel Collector --> Tempo --> Grafana
```

フロントエンドでユーザー操作や HTTP リクエストのスパンを生成し、バックエンドで API ハンドラや DB クエリのスパンを生成する。W3C Trace Context ヘッダーにより、フロントエンドとバックエンドのスパンが同一トレースとして関連付けられる。

### メトリクス

```
React SPA  --[OTLP/HTTP]--> OTel Collector --> Mimir --> Grafana
Go Backend --[OTLP/gRPC]--> OTel Collector --> Mimir --> Grafana
```

### ログ

```
React SPA  --[OTLP/HTTP]--> OTel Collector --> Loki --> Grafana
Go Backend --[OTLP/gRPC]--> OTel Collector --> Loki --> Grafana
```

トレース ID との関連付けにより、ログから対応するトレースへのジャンプが可能。

## 技術選定の理由

### React + TypeScript

このプロジェクトの主要学習ゴールは**フロントエンド TypeScript での OTel SDK 利用**である。TypeScript を選んだのは、OTel API の型情報を活用した型安全な計装コードを書ける点が学習に適しているからだ。JavaScript より早期にミスを検出でき、SDK の使い方を IDE の補完で確認しながら進められる。

### Go（バックエンド）

OTel Go SDK はエコシステムが成熟しており、`otelhttp`（HTTP ハンドラの自動計装）や `otelsql`（SQL クエリの自動計装）など計装ライブラリが充実している。バックエンドの計装パターンを学ぶ対象として適切な選択だった。

### OTel Collector（別コンテナとして分離）

Grafana LGTM イメージには Collector が内包されているが、このプロジェクトでは意図的に別コンテナとして分離している。理由は、**Collector のパイプライン設定（レシーバー・プロセッサー・エクスポーター）を明示的に学ぶ**ことがゴールの一つだからだ。設定ファイルを直接編集して挙動を確認できる構成にしている。

OTel Collector を挟む構成には以下のメリットもある。

- アプリケーションからバックエンドを直接変更せずに転送先を変更できる
- バッチ処理やフィルタリングなどのデータ加工をアプリケーション側に持ち込まなくて済む
- ベンダー非依存のテレメトリパイプラインとして本番環境でも使えるパターンを学べる

### Grafana LGTM スタック

OSS で構築可能な Observability スタックとして、トレース・メトリクス・ログの3シグナルを単一の UI で確認できる。`grafana/otel-lgtm` イメージは Tempo、Loki、Mimir、Grafana を all-in-one で提供するため、学習環境の構築コストが低い。

### Docker Compose

複数コンテナで構成される Observability スタック全体を `docker compose up` 一つで起動できる。サービス間の依存関係（`depends_on`）や環境変数の注入もここで管理しており、学習環境の再現性が高い。

## 設計上のトレードオフ

### アプリケーションの単純さ

バックエンドは net/http を直接使ったシンプルな実装であり、フレームワークは使っていない。Todo CRUD という最小限のドメインを選んだのは、**アプリケーションのロジックでなく OTel の計装に集中できるようにする**ためだ。

### セキュリティの非対応

DB のパスワードや OTel エンドポイントを docker-compose.yml に平文で記述している。これは学習・ローカル環境専用の構成であり、本番環境に適用することは想定していない。

### フロントエンドの OTLP 送信

ブラウザから OTel Collector に直接 OTLP/HTTP で送信している。OTel Collector には CORS 設定を入れている。本番環境では CORS の扱いやブラウザから Collector を公開する是非を慎重に検討する必要があるが、学習目的では最もシンプルな経路として採用した。

### W3C Trace Context と nginx

nginx のリバースプロキシを経由する際、HTTP ヘッダーの転送設定を適切に行わないと `traceparent` ヘッダーが欠落する。`nginx.conf` でカスタムヘッダーの転送を明示的に設定することで分散トレーシングを維持している。
