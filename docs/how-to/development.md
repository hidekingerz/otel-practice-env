# 開発ガイド

このガイドでは、コードを変更してローカルで動作確認するための手順を説明します。

## フロントエンドをローカルで起動する

Docker を使わずにフロントエンドの開発サーバーを起動すると、コード変更が即時反映されます。

バックエンドと Grafana LGTM スタックは Docker で起動したままにしておきます。

```bash
# バックエンド・インフラのみ起動（フロントエンドは除く）
docker compose up grafana otel-collector db backend

# 別のターミナルでフロントエンドをローカル起動
cd frontend
npm install   # 初回のみ
npm run dev
```

`http://localhost:5173` でフロントエンドが起動します。OTel Collector への OTLP 送信もそのまま動作します（`http://localhost:4318` が許可済みです）。

> **IDE の型補完を有効にする**
>
> Docker のみで動かしている場合も、IDE の型補完のためにローカルへの依存インストールが必要です。
>
> ```bash
> cd frontend && npm install
> ```
>
> Docker 上の動作には影響しません。

## コンテナのログを確認する

各コンテナのログは `docker compose logs` で確認できます。

```bash
# 全サービスのログをリアルタイムで表示
docker compose logs -f

# 特定サービスのみ
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f otel-collector
docker compose logs -f grafana
docker compose logs -f obi          # OBI（profile obi で起動している場合）
```

エラーが発生した場合はまずここを確認してください。

## OBI（eBPF 自動計装）を起動・停止する

OBI は特権コンテナのため Compose の profile `obi` でオプトインになっています。詳しい手順は [ゼロコード計装チュートリアル](../tutorials/zero-code-obi.md) を参照してください。

```bash
# スタック全体 + OBI を起動
docker compose --profile obi up -d

# すでにスタックが起動している状態で OBI だけ追加起動
docker compose --profile obi up -d obi

# OBI だけ停止
docker compose --profile obi stop obi

# OBI を含めてすべて停止（--profile を付けないと obi コンテナが残る）
docker compose --profile obi down
```

### 設定ファイルを切り替える（backend も OBI で計装する）

```bash
# 比較用の設定で再作成
OBI_CONFIG=config-compare.yaml docker compose --profile obi up -d obi

# 既定（nginx のみ）に戻す
docker compose --profile obi up -d obi
```

### `obi/config.yaml` を変更したとき

設定ディレクトリはバインドマウントしているため、再起動で反映されます。

```bash
docker compose --profile obi restart obi
```

> **`stop` / `restart` が "PID ... is zombie" で失敗する場合**
>
> Docker Desktop と `pid: host` の組み合わせで起きる既知の現象で、`docker-compose.yml` では `stop_grace_period: 60s` で回避しています。それでも失敗したら数秒待って同じコマンドを再実行してください。残骸のコンテナは `docker rm -f $(docker ps -aq --filter name=obi)` で削除できます。

## OTel Collector の設定を変更・検証する

`otel-collector/otel-collector-config.yaml` を変更した場合は、コンテナを再起動する必要があります。

```bash
docker compose restart otel-collector
```

> **ボリュームマウントを新しく追加した場合**
>
> `docker compose restart` では新しいボリュームマウントが反映されません。この場合は以下を実行してください。
>
> ```bash
> docker compose down && docker compose up -d
> ```

### 設定ファイルの構文を事前に検証する

コンテナを起動する前に設定ファイルの構文を確認できます。

```bash
docker run --rm \
  -v $(pwd)/otel-collector:/etc \
  otel/opentelemetry-collector-contrib validate \
  --config /etc/otel-collector-config.yaml
```

> IDE 上でのスキーマ検証はできません。設定変更後はこのコマンドか `docker compose logs otel-collector` でエラーを確認してください。Collector のパイプライン設計については [アーキテクチャと設計思想](../explanation/architecture.md) を参照してください。

## バックエンドを変更してリビルドする

Go のコードを変更した場合は、バックエンドコンテナを再ビルドします。

```bash
docker compose up --build backend
```

## 環境を完全にリセットする

データをすべて削除して最初からやり直すには以下を実行します。

```bash
docker compose --profile obi down -v
docker compose up --build
```

`-v` フラグを付けると名前付きボリューム（MariaDB データ、Grafana データ）も削除されます。`--profile obi` を付けているのは、OBI を起動していた場合にそのコンテナも確実に削除するためです（起動していなくても害はありません）。
