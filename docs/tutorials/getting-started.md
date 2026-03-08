# はじめてみよう：OTel Practice 環境のセットアップ

このチュートリアルでは、`otel-practice-env` を起動し、Grafana で OpenTelemetry の3シグナル（トレース・メトリクス・ログ）を実際に確認するところまでを一緒に進めます。

所要時間：約15〜20分

## 前提条件

以下がインストール済みであることを確認してください。

- Docker Desktop（または Docker Engine + Docker Compose v2）
- Git

## Step 1: リポジトリをクローンする

```bash
git clone https://github.com/hidekingerz/otel-practice-env.git
cd otel-practice-env
```

## Step 2: 環境を起動する

初回はすべてのイメージをビルドするため、少し時間がかかります。

```bash
docker compose up --build
```

以下のようなログが流れ始めたら起動完了です。

```
grafana       | INFO  Grafana server started
otel-collector | ... Everything is ready. Begin running and processing data.
backend       | Server listening on :8080
frontend      | nginx: the configuration file ... syntax is ok
```

> **2回目以降の起動**
>
> `--build` は不要です。`docker compose up` だけで起動できます。

## Step 3: Todo アプリを操作する

ブラウザで http://localhost を開いてください。Todo アプリが表示されます。

いくつか操作してみましょう。これがテレメトリデータの発生源になります。

1. テキストボックスに「テスト Todo 1」と入力して、追加ボタンを押す
2. 「テスト Todo 2」「テスト Todo 3」も同様に追加する
3. 追加した Todo のチェックボックスをいくつかクリックして、完了状態にする
4. Todo を1件削除する

操作のたびにフロントエンドとバックエンドでトレース・メトリクス・ログが生成されています。

## Step 4: Grafana ダッシュボードを確認する

ブラウザで http://localhost:3000 を開きます。

> **ログイン画面が表示された場合**
>
> `grafana/otel-lgtm` イメージはデフォルトで匿名アクセス（Admin 権限）が有効なため、通常はログイン不要です。ログイン画面が表示された場合は `admin` / `admin` でサインインしてください。

左サイドバーの「Dashboards」をクリックすると、**"OTel Practice - Overview"** ダッシュボードが表示されます。

ダッシュボードには以下のパネルが含まれています。

- **Frontend Metrics**: Todo 操作回数・API レスポンス時間のグラフ
- **Recent Traces**: フロントエンド・バックエンドの最新トレース一覧
- **Logs**: フロントエンド・バックエンドのリアルタイムログ

Step 3 で操作した内容が反映されているのを確認できましたか？

## Step 5: 分散トレースをウォーターフォールで見る

ここが今回の核心です。フロントエンドからバックエンド、データベースまでの処理が1つのトレースとしてつながっていることを確認しましょう。

1. Grafana の左サイドバーで「Explore」を開く
2. 画面上部のデータソースセレクターで「Tempo」を選ぶ
3. 「Search」タブを選択し、「Service Name」に `frontend` を入力して「Run query」を押す
4. トレース一覧が表示されます。任意のトレースをクリックしてください

ウォーターフォール表示で `frontend → backend → db` とスパンがつながっているのが確認できましたか？

これが W3C Trace Context による**分散トレーシング**です。ブラウザの `fetch` リクエストに自動付与された `traceparent` ヘッダーを Go バックエンドが受け取り、同一の Trace ID でスパンを継続しています。

## Step 6: Explore で各シグナルを個別に確認する

### トレース（Tempo）

```
データソース: Tempo
クエリ: {service.name="backend"}
```

バックエンドのスパンのみを絞り込めます。

### メトリクス（Prometheus）

```
データソース: Prometheus
クエリ: todo_created_total
```

Todo 作成の累計回数が表示されます。`rate(todo_created_total[5m])` に変えると単位時間あたりの作成数を確認できます。

### ログ（Loki）

```
データソース: Loki
クエリ: {service_name="frontend"}
```

フロントエンドのログが時系列で表示されます。ログ行をクリックすると「Tempo でトレースを表示」リンクが表示され、ログから対応するトレースに直接ジャンプできます。

## トラブルシューティング

### ダッシュボードにデータが表示されない

OTel Collector がテレメトリを受信できていない可能性があります。

```bash
docker compose logs otel-collector
```

エラーがなければ、Step 3 の Todo 操作を再度行い、数秒待ってからダッシュボードを更新してください。

### コンテナが起動しない / すぐ終了する

問題のあるサービスのログを確認してください。

```bash
docker compose logs <サービス名>
# 例: docker compose logs backend
```

### Grafana に `http://localhost:3000` でアクセスできない

Grafana は起動完了まで数分かかることがあります。ログに `Grafana server started` が出るまで待ってから再アクセスしてください。

```bash
docker compose logs grafana
```

## チュートリアル完了

お疲れさまでした。これで以下を体験できました。

- Docker Compose による LGTM スタックとアプリケーションの一括起動
- フロントエンドとバックエンドにまたがる分散トレーシングの確認
- Grafana Explore での3シグナルの個別確認
- ログからトレースへのジャンプ

---

次のステップとして、以下のドキュメントも参照してみてください。

- [アーキテクチャと設計思想](../explanation/architecture.md) — なぜこの構成になっているのかを解説します
- [設定リファレンス](../reference/configuration.md) — ポート番号・環境変数・API エンドポイントの一覧
- [開発ガイド](../how-to/development.md) — コードを変更して動作を試したい場合
