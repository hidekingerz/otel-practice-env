# ゼロコード計装：OBI で nginx をトレースする

このチュートリアルでは、**アプリケーションのコードや設定を一切変更せずに**、eBPF ベースの自動計装ツール [OBI（OpenTelemetry eBPF Instrumentation）](https://opentelemetry.io/ja/docs/zero-code/obi/) でテレメトリを取得します。

題材は、これまでトレースに現れていなかった **nginx**（フロントエンドの配信とリバースプロキシを担うコンテナ）です。

## 前提条件

- [はじめてみよう](getting-started.md) を完了していること
- Docker Desktop（macOS / Windows）または Linux カーネル 5.17 以降の Docker 環境
- `docker compose up` でスタックが起動していること

## OBI とは

OBI は Linux カーネルの eBPF 機能を使い、プロセスのシステムコールやネットワーク通信を外側から観測して、HTTP / gRPC / SQL などのスパンと RED メトリクス（Rate / Errors / Duration）を生成します。

Phase 3〜6 で行った SDK による計装と比べると、次のような特徴があります。

| 観点 | SDK 計装（これまで） | OBI（eBPF 自動計装） |
|---|---|---|
| コード変更 | 必要 | 不要 |
| 対象 | SDK がある言語・自分で書けるコード | Linux 上で動く多くのプロセス（C / Go / Java / Node.js / Python など） |
| 取れる情報 | HTTP / DB に加えて、任意の内部スパン・属性・ログ | HTTP / gRPC / SQL などプロトコル境界のスパンとメトリクス |
| 必要な権限 | なし | ホストの `pid` 名前空間と特権（`privileged`） |

nginx には OTel SDK を組み込めないため、これまでのトレースでは `frontend`（ブラウザ）の次がいきなり `backend` でした。OBI を使うと、その間にある nginx の区間が見えるようになります。

## Step 1: OBI を起動する

OBI はホストの全プロセスを覗ける強い権限を必要とするため、通常の `docker compose up` では起動しません。Compose の profile を指定して起動します。

```bash
docker compose --profile obi up -d
```

起動したら、OBI が nginx を検出したことをログで確認します。

```bash
docker compose logs obi | grep "instrumenting process"
```

`cmd=/usr/sbin/nginx ... service=nginx` という行が出ていれば成功です。

> **起動時に `ERROR ... context propagation is disabled` と出る**
>
> ヘッダー注入が無効なため、nginx は backend へ OBI の traceparent を書き込めません。ブラウザ起点では nginx と backend は兄弟になります（Step 3）。この ERROR は機能が実際に無効であることを示しています。nginx のスパンとメトリクスは問題なく取得できます。

## Step 2: Todo アプリを操作する

ブラウザで http://localhost を開き、Todo をいくつか追加・完了・削除します。OBI はこれらのリクエストが nginx を通過するところを観測しています。

## Step 3: Tempo で nginx のスパンを確認する

1. Grafana（http://localhost:3000）の左サイドバーで「Explore」を開く
2. データソースに「Tempo」を選ぶ
3. 「TraceQL」タブで `{ resource.service.name = "nginx" }` を入力して「Run query」を押す

`GET /api/todos` のようなトレースが一覧に出てきましたか？ 1 つ開いてウォーターフォールを見てください。OBI のスパン名は `メソッド ルート`（例: `GET /api/todos`）の形式です。

```
frontend   HTTP GET /api/todos               ← ブラウザ（OTel JS SDK）
├─ nginx   GET /api/todos  (SERVER)          ← OBI が nginx で観測
│  ├─ nginx  processing    (INTERNAL)        ← nginx 内部の処理時間
│  │  └─ nginx  GET /api/todos  (CLIENT)     ← nginx → backend の送信を OBI が観測
│  └─ nginx  in queue      (INTERNAL)        ← nginx 内部の待ち時間
└─ backend GET /api/todos                    ← Go（OTel Go SDK）
   └─ backend SELECT ...                     ← otelsql
```

これまで `frontend` の直下に `backend` だけがあったトレースに、nginx のスパンが加わりました。nginx のコードも設定も触っていないのに、分散トレースの一部になっています。

> **nginx と backend が親子ではなく兄弟に並ぶ理由**
>
> この環境ではカーネルの問題で OBI の HTTP ヘッダー注入が無効（Step 1 の ERROR）なため、nginx は backend に自分の span ID を伝えられません。backend には常にブラウザの traceparent が届くので、SDK の backend も Step 5 の backend-obi も兄弟になります。traceparent の無い curl などの直接リクエストでは OBI 同士の TCP レベル伝播が効き、backend-obi が nginx の client span の下にぶら下がります。ヘッダー注入が効くカーネルでは backend が nginx の下にぶら下がります。

## Step 4: Prometheus で nginx の RED メトリクスを確認する

OBI はスパンと同時に、HTTP サーバー / クライアントの所要時間とボディサイズのヒストグラムを生成します。

1. Explore でデータソースに「Prometheus」を選ぶ
2. クエリに次を入力して「Run query」を押す

```promql
histogram_quantile(0.95, sum by (le, http_route) (rate(http_server_request_duration_seconds_bucket{service_name="nginx"}[5m])))
```

`http_route` ラベルが `/api/todos`、`/api/todos/:id`、`/api/todos/stats` のように集約されていることを確認してください。これは `obi/config.yaml` の `routes.patterns` の効果で、`/api/todos/123` のような ID 入りパスがそのままラベルになってメトリクスのカーディナリティが膨らむのを防いでいます。

リクエスト数（Rate）は次のクエリで確認できます。

```promql
sum by (http_route, http_response_status_code) (rate(http_server_request_duration_seconds_count{service_name="nginx"}[5m]))
```

## Step 5: SDK 計装と OBI を比較する（backend を二重計装する）

ここまで OBI は nginx だけを計装していました。次に、すでに OTel Go SDK で計装されている backend を **OBI でも** 計装して、同じリクエストを 2 つの方法で観測してみます。

設定ファイルを比較用（`obi/config-compare.yaml`）に切り替えて OBI を再作成します。

```bash
OBI_CONFIG=config-compare.yaml docker compose --profile obi up -d obi
```

ログに `cmd=/app/server ... service=backend-obi` が加わったことを確認してから、Todo アプリを操作します。

```bash
docker compose logs obi | grep "instrumenting process"
```

Tempo の TraceQL で `{ resource.service.name = "backend-obi" }` を検索し、トレースを 1 つ開いてください。ブラウザのスパンの下に、nginx の server span、backend（SDK）の server span、backend-obi（OBI）の server span が兄弟として並び、backend-obi の下には `processing` / `in queue` と DB クエリのスパン（`SELECT todos` など）が続いています。

同じリクエストが SDK と OBI で二重に計装され、同じトレース内に `backend` と `backend-obi` が並んで見えます。（curl のように `traceparent` が無い場合は、`backend-obi` が nginx の client span の下に入り、SDK の `backend` は別トレースになります。）

| 観点 | `backend`（OTel Go SDK） | `backend-obi`（OBI） |
|---|---|---|
| HTTP サーバーのスパン | あり（`otelhttp`） | あり。加えて `in queue` / `processing` の内部スパン |
| `todo.List` のような名前付きの内部スパン | あり | **なし** |
| `todo.total` のような手動で付けた属性 | あり | **なし** |
| DB クエリのスパン | あり（`otelsql`） | あり（`SELECT todos` など。MySQL プロトコルを eBPF で解析） |
| `GET /api/todos/stats`（[ハンズオン](hands-on-instrumentation.md) の未計装 API） | HTTP スパンのみ | HTTP スパンと SQL スパンが**何もしなくても**見える |
| ログ | あり | なし（OBI はトレースとメトリクスのみ） |

OBI は「何も書かなくてもプロトコル境界は全部見える」代わりに、「コードの意図（この処理は何をしているのか）」は見えません。SDK はその逆です。実務では、OBI でカバレッジを確保しつつ、重要な処理は SDK で深掘りする、という組み合わせが現実的です。

> **OBI の「SDK 計装済みサービスの自動除外」について**
>
> OBI には、OTLP を送信しているプロセスを検知して自分の計装を抑止する機能（`discovery.exclude_otel_instrumented_services`、既定で有効）があります。ただしこの環境の backend は全シグナルを単一の gRPC エンドポイントへ送信するため、検知が発火せず `backend-obi` のスパンとメトリクスが出ます。そのため `obi/config-compare.yaml` では `exclude_otel_instrumented_services: false` を明示し、OBI の対象を設定ファイルで分けています。

確認が終わったら既定の設定に戻します。

```bash
docker compose --profile obi up -d obi
```

## Step 6: 片付け

OBI だけを止めるには次を実行します。

```bash
docker compose --profile obi stop obi
```

スタック全体を止める場合も `--profile obi` を付けないと `obi` コンテナが残るので注意してください。

```bash
docker compose --profile obi down
```

## トラブルシューティング

### `docker compose logs obi` に permission denied や BTF 関連のエラーが出る

OBI は `privileged: true` と `pid: host` を必要とします。Docker Desktop の設定で特権コンテナが制限されていないか確認してください。Linux の場合はカーネル 5.8 以降で BTF（`/sys/kernel/btf/vmlinux`）が有効である必要があります。

### Tempo に nginx のスパンが出ない

- `docker compose logs obi | grep "instrumenting process"` で nginx が検出されているか確認する
- `docker compose logs otel-collector` で OBI からの OTLP 受信エラーがないか確認する
- OBI の起動後に Todo アプリを操作したか確認する（起動前のリクエストは観測されない）

### `stop` や `restart` が "PID ... is zombie and can not be killed" で失敗する

Docker Desktop と `pid: host` の組み合わせで起きる既知の現象です。`docker-compose.yml` の `obi` サービスには回避のため `stop_grace_period: 60s` を設定しています。それでも失敗した場合は、数秒待ってから同じコマンドをもう一度実行してください。`<ハッシュ>_obi` という名前のコンテナが残った場合は `docker rm -f` で削除できます。

### `backend-obi` のスパンに `/containerd.services...` のようなものが混ざる

Docker Desktop では公開ポートを VM 内の `dockerd` も開いているため、`open_ports` だけで対象を指定すると `dockerd` まで計装されます。本プロジェクトの設定では `exe_path` を併用して除外しています。`obi/config.yaml` を変更した場合は `exe_path` が残っているか確認してください。

## チュートリアル完了

お疲れさまでした。これで以下を体験できました。

- コードも設定も変えずに nginx のスパンとメトリクスを取得する
- nginx の区間が既存の分散トレースに組み込まれる
- `routes.patterns` によるメトリクスのカーディナリティ制御
- SDK 計装と eBPF 自動計装の「取れるもの・取れないもの」の違い

---

仕組みやトレードオフの詳しい解説は [アーキテクチャと設計思想](../explanation/architecture.md) の「SDK 計装と eBPF 自動計装」を、設定項目の一覧は [設定リファレンス](../reference/configuration.md) を参照してください。
