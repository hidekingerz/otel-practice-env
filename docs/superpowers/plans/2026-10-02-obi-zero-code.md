# Phase 9: OBI ゼロコード計装 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OBI（OpenTelemetry eBPF Instrumentation）を Compose profile `obi` で追加し、nginx をゼロコードで計装して既存の分散トレースに nginx 区間を加え、Go backend との比較演習と Diataxis ドキュメントを提供する。

**Architecture:** `obi` サービス（`otel/ebpf-instrument:v0.13.0`、`pid: host`、`privileged: true`）が `obi/config.yaml` を読み、ポート 80（nginx）と 8080（backend）のプロセスを eBPF で計装して OTLP/HTTP で既存の `otel-collector:4318` に送る。backend は OTLP 送信を OBI が検知して既定では抑止され、環境変数 `OBI_EXCLUDE_OTEL_INSTRUMENTED=false` で抑止を外して比較する。アプリケーションコード・nginx.conf・Collector・Grafana は変更しない。

**Tech Stack:** Docker Compose（profiles）、OBI v0.13.0、OTel Collector、Grafana LGTM（Tempo / Mimir）、Markdown（Diataxis）

**Spec:** `docs/superpowers/specs/2026-10-02-obi-zero-code-design.md`

## Global Constraints

- OBI イメージは `otel/ebpf-instrument:v0.13.0` にピン止めする
- `obi` サービスは `profiles: [obi]` でのみ起動する。`docker compose up`（profile なし）の挙動は変えない
- `backend/`、`frontend/`（`nginx.conf` 含む）、`otel-collector/`、`grafana/` は変更しない
- OBI の設定は `obi/config.yaml` に置き、環境変数は `OBI_EXCLUDE_OTEL_INSTRUMENTED`（既定 `true`）のみ
- discovery の service name は `nginx`（port 80）と `backend-obi`（port 8080）
- `ebpf.context_propagation: all`、`routes.unmatched: path`、`otel_metrics_export.interval: 15s`
- ドキュメントは日本語、既存の Diataxis 構成と文体に合わせる。既存チュートリアル 2 本は変更しない
- コミットメッセージは既存の流儀（`feat:` / `docs:` + 日本語）に従い、末尾に下記を付ける

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E8thMHFf395nhkZrph6uzy
```

- 作業ブランチは `phase/9-obi-zero-code`（作成済み）
- 検証コマンドは Docker Desktop（macOS / arm64）上で実行する。`docker` は PATH にある

---

## File Structure

| 操作 | ファイル | 責務 |
|---|---|---|
| Modify | `docker-compose.yml` | `obi` サービス定義（profile、権限、マウント） |
| Create | `obi/config.yaml` | OBI の discovery / 伝播 / routes / エクスポート設定 |
| Create | `docs/tutorials/zero-code-obi.md` | Phase 9 チュートリアル本編 |
| Modify | `docs/explanation/architecture.md` | 構成図への OBI 追加、SDK vs eBPF の解説節 |
| Modify | `docs/reference/configuration.md` | `obi` サービス、`obi/config.yaml` キー、環境変数、OBI メトリクス名 |
| Modify | `docs/how-to/development.md` | profile 付き起動/停止、OBI ログ、設定変更の反映 |
| Modify | `README.md` | 構成図、起動方法、Phase 表、ドキュメント表 |
| Modify | `docs/explanation/purpose.md` | スコープ「やること」に OBI を 1 行追加 |

---

### Task 1: `obi` サービスと `obi/config.yaml` を追加する

**Files:**
- Modify: `docker-compose.yml`（`frontend` サービスの直後、`volumes:` の前に追加）
- Create: `obi/config.yaml`

**Interfaces:**
- Consumes: 既存の `otel-collector` サービス（OTLP/HTTP 4318）、`otel-network`
- Produces: Compose profile `obi`、サービス名 `obi`、コンテナ名 `obi`、環境変数 `OBI_EXCLUDE_OTEL_INSTRUMENTED`。後続タスクのドキュメントはこれらの名前を参照する

- [ ] **Step 1: 変更前の状態を確認する（失敗する検証）**

Run:
```bash
docker compose --profile obi config --services | grep -x obi
```
Expected: 何も出力されず終了コード 1（`obi` サービスがまだ存在しない）

- [ ] **Step 2: `obi/config.yaml` を作成する**

```yaml
# OBI (OpenTelemetry eBPF Instrumentation) の設定
# 参考: https://opentelemetry.io/ja/docs/zero-code/obi/

discovery:
  instrument:
    # SDK を入れられない nginx（frontend コンテナ）。OBI だけで可視化する主役
    - name: nginx
      open_ports: 80
    # 比較演習用。backend は OTel SDK で OTLP を送信しているため、
    # 下の exclude_otel_instrumented_services が true の間は OBI が自動的に抑止する
    - name: backend-obi
      open_ports: 8080
  # OTLP を送信しているプロセス（= SDK 計装済み）を OBI の計装対象から外す（既定 true）。
  # OBI_EXCLUDE_OTEL_INSTRUMENTED=false にすると backend-obi のテレメトリが出る
  exclude_otel_instrumented_services: ${OBI_EXCLUDE_OTEL_INSTRUMENTED:-true}

ebpf:
  # 送信パケットの traceparent を OBI が書き換え、nginx の client span を
  # backend の親にする。既定は無効（その場合 nginx と backend は兄弟になる）
  context_propagation: all

routes:
  # http.route を低カーディナリティに保つためのパターン
  patterns:
    - /api/todos/stats
    - /api/todos/:id
    - /api/todos
  # パターンに一致しないパスはそのまま http.route にする
  unmatched: path

otel_traces_export:
  endpoint: http://otel-collector:4318

otel_metrics_export:
  endpoint: http://otel-collector:4318
  # 既定 60s だと確認に待たされるため短縮
  interval: 15s
```

- [ ] **Step 3: `docker-compose.yml` に `obi` サービスを追加する**

`frontend` サービス定義の直後（`volumes:` のトップレベルキーの前）に追加する。

```yaml
  # Phase 9: OBI (eBPF 自動計装)。`docker compose --profile obi up` でのみ起動する
  obi:
    image: otel/ebpf-instrument:v0.13.0
    container_name: obi
    profiles: ["obi"]
    command: ["--config=/config/config.yaml"]
    # eBPF でホスト上の他コンテナのプロセスを観測するために必須
    pid: host
    privileged: true
    environment:
      # false にすると SDK 計装済みの backend も OBI の計装対象になる（比較演習用）
      OBI_EXCLUDE_OTEL_INSTRUMENTED: ${OBI_EXCLUDE_OTEL_INSTRUMENTED:-true}
    volumes:
      - ./obi/config.yaml:/config/config.yaml:ro
    depends_on:
      - otel-collector
      - frontend
      - backend
    networks:
      - otel-network
```

- [ ] **Step 4: Compose 定義を検証する**

Run:
```bash
docker compose --profile obi config --services | grep -x obi \
  && docker compose config --services | grep -x obi; echo "exit=$?"
```
Expected: 1 行目で `obi` が出力され、2 行目（profile なし）では出力されず `exit=1`

Run:
```bash
docker compose --profile obi config | sed -n '/^  obi:/,/^  [a-z]/p' | grep -E 'privileged: true|pid: host|v0.13.0|OBI_EXCLUDE_OTEL_INSTRUMENTED: "true"'
```
Expected: 4 行すべてが出力される

- [ ] **Step 5: コミット**

```bash
git add docker-compose.yml obi/config.yaml
git commit -m "$(cat <<'EOF'
feat: Phase 9 - OBI サービスと設定を Compose profile で追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E8thMHFf395nhkZrph6uzy
EOF
)"
```

---

### Task 2: Docker Desktop で実機検証し、ドキュメントに書く事実を確定する

このタスクはコードを変更しない。spec 6 章の受け入れ条件 1〜6 を確認し、観測結果（メトリクス名、span 名、親子関係）を後続タスクの入力として `/private/tmp/claude-501/-Users-hidekingerz-ghq-github-com-hidekingerz-otel-practice-env/ddaee3ba-4d26-45b2-91cd-7667ac0b971c/scratchpad/obi-verification.md` に記録する。

**Files:**
- Create（scratchpad、リポジトリ外）: `obi-verification.md`

**Interfaces:**
- Consumes: Task 1 の `obi` サービス
- Produces: 以下の事実。Task 3〜5 はこれを参照する
  - OBI が Mimir に出すメトリクス名の一覧（例として想定: `http_server_request_duration_seconds_bucket`、`http_client_request_duration_seconds_bucket`、`db_client_operation_duration_seconds_bucket`）
  - nginx の span 名（想定: `GET /api/todos` など `METHOD http.route` 形式）
  - 親子関係が frontend → nginx(server) → nginx(client) → backend → db になるか
  - `backend-obi` 有効時に SQL client span が見えるか

- [ ] **Step 1: 既存スタックを起動し、profile なしで OBI が起動しないことを確認する（条件 6）**

Run:
```bash
docker compose up -d --build && sleep 20 && docker compose ps --format '{{.Name}}\t{{.Status}}'
```
Expected: `grafana` `otel-collector` `mariadb` `backend` `frontend` の 5 つが `Up`。`obi` は存在しない

- [ ] **Step 2: OBI を起動し、nginx の検出をログで確認する（条件 1）**

Run:
```bash
docker compose --profile obi up -d obi && sleep 15 && docker compose logs obi | tail -40
```
Expected: エラーなく起動し、`nginx` に関する "instrumenting" / "found process" 系のログ行が出る。`permission denied` や `BTF` に関するエラーがあれば **ここで止めて報告する**（spec 7 章のリスク）

- [ ] **Step 3: トラフィックを発生させる**

Run:
```bash
for i in 1 2 3; do
  curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -d '{"title":"obi test '"$i"'"}' http://localhost/api/todos
  curl -s -o /dev/null http://localhost/api/todos
  curl -s -o /dev/null http://localhost/api/todos/stats
  curl -s -o /dev/null http://localhost/
done; sleep 20; echo done
```
Expected: `done`

- [ ] **Step 4: Grafana データソースの UID を調べる**

Run:
```bash
curl -s http://localhost:3000/api/datasources | jq -r '.[] | "\(.name)\t\(.uid)"'
```
Expected: `Tempo` と `Prometheus` の行が出る。以降 `$TEMPO_UID`、`$PROM_UID` として使う

- [ ] **Step 5: Tempo に `service.name=nginx` の span があることを確認する（条件 2 前半）**

Run:
```bash
curl -s "http://localhost:3000/api/datasources/proxy/uid/$TEMPO_UID/api/search?tags=service.name%3Dnginx&limit=5" \
  | jq '.traces[] | {traceID, rootServiceName, rootTraceName}'
```
Expected: 1 件以上。`rootServiceName` は `frontend`（ブラウザ起点）または `nginx`（curl 起点）

- [ ] **Step 6: 親子関係を確認する（条件 2 後半）**

Step 5 で得た traceID を 1 つ選び、

Run:
```bash
curl -s "http://localhost:3000/api/datasources/proxy/uid/$TEMPO_UID/api/traces/$TRACE_ID" \
  | jq -r '.batches[] | .resource.attributes[] as $a | select($a.key=="service.name") | $a.value.stringValue as $svc
          | .scopeSpans[].spans[] | "\($svc)\t\(.kind)\t\(.name)\tspan=\(.spanId)\tparent=\(.parentSpanId // "-")"'
```
Expected: `nginx` の SERVER span と CLIENT span があり、`backend` の SERVER span の `parent` が nginx の CLIENT span の `span` に一致する。一致せず backend の parent が nginx の SERVER span の親と同じ（兄弟）なら、`context_propagation` が効いていない。その場合は **止めて報告する**

- [ ] **Step 7: OBI のメトリクス名を列挙する（条件 3）**

Run:
```bash
curl -s "http://localhost:3000/api/datasources/proxy/uid/$PROM_UID/api/v1/label/__name__/values?match[]=%7Bservice_name%3D%22nginx%22%7D" | jq -r '.data[]'
```
Expected: `http_server_request_duration_seconds_*`、`http_client_request_duration_seconds_*` を含む一覧。出力をそのまま `obi-verification.md` に貼る

- [ ] **Step 8: 既定では `backend-obi` が出ないことを確認する（条件 4）**

Run:
```bash
curl -s "http://localhost:3000/api/datasources/proxy/uid/$TEMPO_UID/api/search?tags=service.name%3Dbackend-obi&limit=5" | jq '.traces | length'
```
Expected: `0`（起動直後の数秒間に数件混ざる可能性はある。その場合はトレースの時刻が起動直後であることを確認し、`obi-verification.md` に記録する）

- [ ] **Step 9: 抑止を外して `backend-obi` の span と SQL span を確認する（条件 5）**

Run:
```bash
OBI_EXCLUDE_OTEL_INSTRUMENTED=false docker compose --profile obi up -d obi && sleep 10
for i in 1 2 3; do curl -s -o /dev/null http://localhost/api/todos; curl -s -o /dev/null http://localhost/api/todos/stats; done; sleep 20
curl -s "http://localhost:3000/api/datasources/proxy/uid/$TEMPO_UID/api/search?tags=service.name%3Dbackend-obi&limit=5" | jq '.traces | length'
```
Expected: `1` 以上。続けて 1 件の traceID で Step 6 のコマンドを再実行し、`backend-obi` に SERVER span（`GET /api/todos/stats` 等）と CLIENT span（SQL。名前に `SELECT` や `todos` を含む）があることを確認する

- [ ] **Step 10: 既定に戻し、結果を記録する**

Run:
```bash
docker compose --profile obi up -d obi
```

`obi-verification.md` に以下を書く: 検出ログの要点、nginx の span 名、親子関係の結果、メトリクス名一覧、backend-obi 有効時の span 名（SQL 含む）、気づいたトラブル。コミットはしない（リポジトリ外）

---

### Task 3: チュートリアル `docs/tutorials/zero-code-obi.md` を書く

**Files:**
- Create: `docs/tutorials/zero-code-obi.md`

**Interfaces:**
- Consumes: Task 1 の名前（`obi`、`nginx`、`backend-obi`、`OBI_EXCLUDE_OTEL_INSTRUMENTED`）、Task 2 の観測結果（span 名・メトリクス名）
- Produces: README とハウツーからリンクされるファイル名 `docs/tutorials/zero-code-obi.md`

- [ ] **Step 1: 以下の内容でファイルを作成する**

Task 2 の `obi-verification.md` と食い違う span 名・メトリクス名があれば、観測結果に合わせて置き換える。

````markdown
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
docker compose logs obi
```

`nginx` を含む検出ログが出ていれば成功です。`permission denied` などのエラーが出た場合は、末尾のトラブルシューティングを参照してください。

## Step 2: Todo アプリを操作する

ブラウザで http://localhost を開き、Todo をいくつか追加・完了・削除します。OBI はこれらのリクエストが nginx を通過するところを観測しています。

## Step 3: Tempo で nginx のスパンを確認する

1. Grafana（http://localhost:3000）の左サイドバーで「Explore」を開く
2. データソースに「Tempo」を選ぶ
3. 「Search」タブで「Service Name」に `nginx` を入力して「Run query」を押す

`GET /api/todos` のようなトレースが一覧に出てきましたか？ 1 つ開いてウォーターフォールを見てください。

```
frontend   HTTP GET /api/todos            ← ブラウザ（OTel JS SDK）
└─ nginx   GET /api/todos  (server)       ← OBI が nginx で観測
   └─ nginx   GET /api/todos  (client)    ← nginx → backend の送信を OBI が観測
      └─ backend   GET /api/todos         ← Go（OTel Go SDK）
         └─ backend   SELECT ...          ← otelsql
```

これまで `frontend` の直下にあった `backend` のスパンが、nginx の 2 つのスパンの下にぶら下がっています。nginx のコードも設定も触っていないのに、分散トレースの一部になりました。

> **なぜ親子関係がつながるのか**
>
> nginx は受け取った `traceparent` ヘッダーをそのまま backend に転送します。OBI はそれだけでなく、`ebpf.context_propagation: all` の設定により、nginx が送信するパケットの `traceparent` を **自分が作った client span の ID に書き換えて** います。これにより backend のスパンの親が nginx の client span になります。この設定を外すと、nginx のスパンと backend のスパンは「同じ親を持つ兄弟」として表示されます。

## Step 4: Prometheus で nginx の RED メトリクスを確認する

OBI はスパンと同時に、HTTP サーバー / クライアントの所要時間ヒストグラムを生成します。

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

ここまで、OBI は backend を計装していませんでした。backend が OTLP を送信している（= すでに SDK で計装されている）ことを OBI が検知し、自動的に対象から外していたからです（`discovery.exclude_otel_instrumented_services`、既定 `true`）。

この抑止を外して、同じ backend を SDK と OBI の両方で計装してみます。

```bash
OBI_EXCLUDE_OTEL_INSTRUMENTED=false docker compose --profile obi up -d obi
```

Todo アプリを操作してから、Tempo の Search で「Service Name」に `backend-obi` を入力して検索します。

同じリクエストについて、`backend`（SDK）のトレースと `backend-obi`（OBI）のトレースを見比べてください。

| 観点 | `backend`（OTel Go SDK） | `backend-obi`（OBI） |
|---|---|---|
| HTTP サーバーのスパン | あり（`otelhttp`） | あり |
| `todo.List` のような名前付きの内部スパン | あり | **なし** |
| `todo.total` のような手動で付けた属性 | あり | **なし** |
| DB クエリのスパン | あり（`otelsql`） | あり（MySQL プロトコルを eBPF で解析） |
| `GET /api/todos/stats`（[ハンズオン](hands-on-instrumentation.md) の未計装 API） | HTTP スパンのみ | HTTP スパンと SQL スパンが**何もしなくても**見える |
| ログ | あり | なし（OBI はトレースとメトリクスのみ） |

OBI は「何も書かなくてもプロトコル境界は全部見える」代わりに、「コードの意図（この処理は何をしているのか）」は見えません。SDK はその逆です。実務では、OBI でカバレッジを確保しつつ、重要な処理は SDK で深掘りする、という組み合わせが現実的です。

確認が終わったら既定の状態に戻します。

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

OBI は `privileged: true` と `pid: host` を必要とします。Docker Desktop の設定で特権コンテナが制限されていないか確認してください。Linux の場合はカーネル 5.17 以降で BTF（`/sys/kernel/btf/vmlinux`）が有効である必要があります。

### Tempo に nginx のスパンが出ない

- `docker compose logs obi` で nginx の検出ログが出ているか確認する
- `docker compose logs otel-collector` で OBI からの OTLP 受信エラーがないか確認する
- OBI の起動後に Todo アプリを操作したか確認する（起動前のリクエストは観測されない）

### nginx と backend のスパンが親子ではなく兄弟になる

`obi/config.yaml` の `ebpf.context_propagation` が `all` になっているか確認してください。変更した場合は `docker compose --profile obi restart obi` で反映されます。

### 既定の状態なのに `backend-obi` のスパンが少しだけ出る

OBI は backend が OTLP を送信するのを観測してから抑止を始めるため、OBI 起動直後の数秒間は `backend-obi` のスパンが混ざることがあります。時間が経っても出続ける場合は `OBI_EXCLUDE_OTEL_INSTRUMENTED` が `false` になっていないか確認してください。

## チュートリアル完了

お疲れさまでした。これで以下を体験できました。

- コードも設定も変えずに nginx のスパンとメトリクスを取得する
- eBPF によるコンテキスト伝播で、nginx の区間が既存の分散トレースに組み込まれる
- `routes.patterns` によるメトリクスのカーディナリティ制御
- SDK 計装と eBPF 自動計装の「取れるもの・取れないもの」の違い

---

仕組みやトレードオフの詳しい解説は [アーキテクチャと設計思想](../explanation/architecture.md) の「SDK 計装と eBPF 自動計装」を、設定項目の一覧は [設定リファレンス](../reference/configuration.md) を参照してください。
````

- [ ] **Step 2: リンク先が存在することを確認する**

Run:
```bash
grep -o '](\.\./[^)]*\.md\|]([a-z-]*\.md' docs/tutorials/zero-code-obi.md | sed 's/](//' | sort -u | while read p; do test -f "docs/tutorials/$p" && echo "ok $p" || echo "MISSING $p"; done
```
Expected: すべて `ok`

- [ ] **Step 3: コミット**

```bash
git add docs/tutorials/zero-code-obi.md
git commit -m "$(cat <<'EOF'
docs: Phase 9 - OBI ゼロコード計装チュートリアルを追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E8thMHFf395nhkZrph6uzy
EOF
)"
```

---

### Task 4: 解説 `docs/explanation/architecture.md` を更新する

**Files:**
- Modify: `docs/explanation/architecture.md`（構成図 5〜45 行目、「設計上のトレードオフ」110 行目以降）

**Interfaces:**
- Consumes: Task 1 の名前
- Produces: 見出し「SDK 計装と eBPF 自動計装（OBI）」。Task 3 のチュートリアル末尾がこの見出し名で参照している

- [ ] **Step 1: mermaid 構成図に OBI を追加する**

`subgraph "Telemetry Pipeline"` ブロックを次に置き換える。

```mermaid
    subgraph "Telemetry Pipeline"
        Collector["OTel Collector"]
        OBI["OBI<br/>(eBPF 自動計装)<br/>profile: obi"]
    end
```

既存の `Go -- "OTLP/gRPC<br/>(テレメトリ)" --> Collector` の直後に次の 3 行を追加する。

```mermaid
    OBI -. "eBPF で観測" .-> nginx
    OBI -. "eBPF で観測<br/>(比較演習時のみ)" .-> Go
    OBI -- "OTLP/HTTP<br/>(トレース・メトリクス)" --> Collector
```

- [ ] **Step 2: 「テレメトリデータの流れ」の「トレース」と「メトリクス」に OBI の経路を 1 行ずつ追加する**

「トレース」のコードブロックを次に置き換える。

```
React SPA  --[OTLP/HTTP]--> OTel Collector --> Tempo --> Grafana
Go Backend --[OTLP/gRPC]--> OTel Collector --> Tempo --> Grafana
OBI (nginx を eBPF で観測) --[OTLP/HTTP]--> OTel Collector --> Tempo --> Grafana   ※ profile obi 有効時
```

「メトリクス」のコードブロックを次に置き換える。

```
React SPA  --[OTLP/HTTP]--> OTel Collector --> Mimir --> Grafana
Go Backend --[OTLP/gRPC]--> OTel Collector --> Mimir --> Grafana
OBI (nginx を eBPF で観測) --[OTLP/HTTP]--> OTel Collector --> Mimir --> Grafana   ※ profile obi 有効時
```

- [ ] **Step 3: 「技術選定の理由」の末尾（「### Docker Compose」節の直後、「## 設計上のトレードオフ」の前）に節を追加する**

```markdown
### SDK 計装と eBPF 自動計装（OBI）

Phase 9 で追加した [OBI（OpenTelemetry eBPF Instrumentation）](https://opentelemetry.io/ja/docs/zero-code/obi/) は、Linux カーネルの eBPF 機能でプロセスのシステムコールやネットワーク通信を外側から観測し、HTTP / gRPC / SQL などのプロトコル境界でスパンと RED メトリクスを生成する。アプリケーションのコード・設定・再ビルドは不要で、OBI コンテナを横に置くだけで動く。

このプロジェクトでは、SDK を組み込めない **nginx** を OBI の主な対象にしている。nginx は `traceparent` ヘッダーを転送するだけで自身のスパンは出せなかったが、OBI により nginx の server span と backend への client span がトレースに加わる。さらに `ebpf.context_propagation: all` を有効にすると、OBI が nginx の送信パケットの `traceparent` を自身の client span の ID に書き換えるため、backend のスパンが nginx の下に正しくぶら下がる。

**SDK と OBI は置き換えではなく補完の関係にある。**

| 観点 | SDK 計装 | OBI（eBPF） |
|---|---|---|
| 得意なこと | コードの意図を表す内部スパン、ビジネス属性、ログとの紐付け | コード変更なしでプロトコル境界を網羅的に観測 |
| 苦手なこと | SDK のない言語・改修できないコード・サードパーティのバイナリ | 内部処理の意味、任意の属性、ログ |
| 導入コスト | 言語ごとの SDK 導入とコード変更 | privileged コンテナ 1 つ |
| 必要な権限 | なし | `pid: host` と特権（eBPF プログラムのロード、他プロセスのメモリ・ネットワーク観測） |

OBI は既定で、OTLP を送信しているプロセス（= すでに SDK で計装されている）を計装対象から外す（`discovery.exclude_otel_instrumented_services`）。これにより SDK 計装済みの backend と OBI を同居させてもスパンが二重にならない。チュートリアルの比較演習ではこの抑止を意図的に外し、同じリクエストを SDK と OBI の両方で観測して差分を体験する。

#### Compose profile でオプトインにしている理由

`privileged: true` と `pid: host` を持つコンテナはホスト上の全プロセスを観測できる。学習環境とはいえ常時起動させる必然性はなく、Phase 1〜8 の体験を変えないためにも、`docker compose --profile obi up` と明示したときだけ起動する構成にした。
```

- [ ] **Step 4: 「設計上のトレードオフ」の末尾に節を追加する**

```markdown
### eBPF の環境依存

OBI は Linux カーネル 5.8 以降（コンテキスト伝播には 5.17 以降）と BTF を必要とし、Docker Desktop では内部の Linux VM 上で動作する。eBPF の挙動はカーネルや Docker のバージョンに依存するため、SDK 計装に比べて「どの環境でも同じように動く」保証は弱い。本プロジェクトは Docker Desktop（macOS / arm64）で検証している。
```

- [ ] **Step 5: 変更を確認する**

Run:
```bash
grep -n "OBI" docs/explanation/architecture.md | wc -l && grep -n "^### SDK 計装と eBPF 自動計装（OBI）\|^### eBPF の環境依存" docs/explanation/architecture.md
```
Expected: OBI が 10 行以上に登場し、2 つの見出しが出力される

- [ ] **Step 6: コミット**

```bash
git add docs/explanation/architecture.md
git commit -m "$(cat <<'EOF'
docs: Phase 9 - アーキテクチャ解説に OBI と SDK/eBPF の比較を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E8thMHFf395nhkZrph6uzy
EOF
)"
```

---

### Task 5: リファレンス `docs/reference/configuration.md` を更新する

**Files:**
- Modify: `docs/reference/configuration.md`

**Interfaces:**
- Consumes: Task 1 の名前と `obi/config.yaml` の内容、Task 2 で確定したメトリクス名
- Produces: 見出し「OBI 設定（`obi/config.yaml`）」「OBI が生成するメトリクス」

- [ ] **Step 1: 「Docker Compose サービス一覧」の表の末尾に行を追加する**

```markdown
| `obi` | `obi` | `otel/ebpf-instrument:v0.13.0` | eBPF 自動計装（Phase 9）。profile `obi` を指定したときのみ起動 |
```

- [ ] **Step 2: 「環境変数」に節を追加する（「### db サービス」の直後）**

```markdown
### obi サービス

| 変数名 | 既定値 | 説明 |
|---|---|---|
| `OBI_EXCLUDE_OTEL_INSTRUMENTED` | `true` | `true` のとき、OTLP を送信しているプロセス（SDK 計装済みの backend）を OBI の計装対象から外す。`false` にすると `backend-obi` のテレメトリが生成される |

ホスト側で `OBI_EXCLUDE_OTEL_INSTRUMENTED=false docker compose --profile obi up -d obi` のように指定する。
```

- [ ] **Step 3: 「OTel Collector パイプライン構成」の直後に節を追加する**

```markdown
## OBI 設定（`obi/config.yaml`）

| キー | 値 | 説明 |
|---|---|---|
| `discovery.instrument[0]` | `name: nginx`, `open_ports: 80` | ポート 80 を開いているプロセス（frontend コンテナの nginx）を `service.name=nginx` として計装 |
| `discovery.instrument[1]` | `name: backend-obi`, `open_ports: 8080` | ポート 8080 のプロセス（Go backend）を `service.name=backend-obi` として計装。既定では下の除外設定で抑止される |
| `discovery.exclude_otel_instrumented_services` | `${OBI_EXCLUDE_OTEL_INSTRUMENTED:-true}` | OTLP を送信しているプロセスを計装対象から外す。OBI が設定ファイル内の `${VAR:-default}` を展開する |
| `ebpf.context_propagation` | `all` | 送信パケットの `traceparent` を OBI の client span に書き換え、下流サービスのスパンを親子関係にする。既定は無効 |
| `routes.patterns` | `/api/todos/stats`, `/api/todos/:id`, `/api/todos` | `http.route` 属性に使うパスパターン。`:id` はプレースホルダ |
| `routes.unmatched` | `path` | パターンに一致しないパスはそのまま `http.route` にする |
| `otel_traces_export.endpoint` | `http://otel-collector:4318` | トレースの OTLP/HTTP 送信先 |
| `otel_metrics_export.endpoint` | `http://otel-collector:4318` | メトリクスの OTLP/HTTP 送信先 |
| `otel_metrics_export.interval` | `15s` | メトリクスの送信間隔（既定 `60s`） |

Compose 側では `pid: host` と `privileged: true` を指定している。OBI は eBPF プログラムのロードと他コンテナのプロセス観測のためにこれらを必要とする。

設定キーの全一覧は [OBI 公式ドキュメント](https://opentelemetry.io/docs/zero-code/obi/configure/) を参照。

## OBI が生成するメトリクス

OBI は OTel セマンティック規約に沿った名前でメトリクスを生成し、Prometheus（Mimir）では `.` が `_` に、単位 `s` が `_seconds` に変換される。

| OTel での名前 | Prometheus での名前 | 種別 | 主なラベル |
|---|---|---|---|
| `http.server.request.duration` | `http_server_request_duration_seconds_{bucket,count,sum}` | ヒストグラム | `service_name`, `http_route`, `http_request_method`, `http_response_status_code` |
| `http.client.request.duration` | `http_client_request_duration_seconds_{bucket,count,sum}` | ヒストグラム | `service_name`, `http_request_method`, `http_response_status_code`, `server_address` |
| `db.client.operation.duration` | `db_client_operation_duration_seconds_{bucket,count,sum}` | ヒストグラム | `service_name`, `db_operation_name`, `db_collection_name`（`backend-obi` 有効時のみ） |

Explore クエリ例: `rate(http_server_request_duration_seconds_count{service_name="nginx"}[5m])`
```

Task 2 の `obi-verification.md` に記録した実際の名前と異なる場合は、観測された名前に合わせて表を修正する。

- [ ] **Step 4: 「バインドマウント」の表に行を追加する**

```markdown
| `./obi/config.yaml` | `/config/config.yaml` | OBI 設定（profile `obi` 有効時のみ） |
```

- [ ] **Step 5: 「Grafana データソース」の表の Tempo 行の Explore クエリ例を補足する**

Tempo 行の末尾セルを `{resource.service.name="frontend"}`（OBI 有効時は `nginx` も可） に変更する。

- [ ] **Step 6: 変更を確認する**

Run:
```bash
grep -n "^## OBI 設定\|^## OBI が生成するメトリクス\|^### obi サービス\|ebpf-instrument:v0.13.0\|./obi/config.yaml" docs/reference/configuration.md
```
Expected: 5 行すべてが出力される

- [ ] **Step 7: コミット**

```bash
git add docs/reference/configuration.md
git commit -m "$(cat <<'EOF'
docs: Phase 9 - 設定リファレンスに OBI の設定とメトリクスを追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E8thMHFf395nhkZrph6uzy
EOF
)"
```

---

### Task 6: ハウツー `docs/how-to/development.md` を更新する

**Files:**
- Modify: `docs/how-to/development.md`

**Interfaces:**
- Consumes: Task 1 の名前
- Produces: 見出し「OBI（eBPF 自動計装）を起動・停止する」

- [ ] **Step 1: 「コンテナのログを確認する」の `docker compose logs -f grafana` の次の行に追加する**

```bash
docker compose logs -f obi          # OBI（profile obi で起動している場合）
```

- [ ] **Step 2: 「OTel Collector の設定を変更・検証する」節の直前に節を追加する**

```markdown
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

### `obi/config.yaml` を変更したとき

設定ファイルはバインドマウントしているため、再起動で反映されます。

```bash
docker compose --profile obi restart obi
```

### SDK 計装済みの backend も OBI で計装する（比較用）

```bash
OBI_EXCLUDE_OTEL_INSTRUMENTED=false docker compose --profile obi up -d obi

# 元に戻す
docker compose --profile obi up -d obi
```
```

- [ ] **Step 3: 「環境を完全にリセットする」のコマンドを profile 対応にする**

```bash
docker compose --profile obi down -v
docker compose up --build
```

直後の説明文を次に置き換える。

```markdown
`-v` フラグを付けると名前付きボリューム（MariaDB データ、Grafana データ）も削除されます。`--profile obi` を付けているのは、OBI を起動していた場合にそのコンテナも確実に削除するためです（起動していなくても害はありません）。
```

- [ ] **Step 4: 変更を確認する**

Run:
```bash
grep -n "^## OBI\|logs -f obi\|--profile obi down -v" docs/how-to/development.md && test -f docs/tutorials/zero-code-obi.md && echo link-ok
```
Expected: 3 行と `link-ok`

- [ ] **Step 5: コミット**

```bash
git add docs/how-to/development.md
git commit -m "$(cat <<'EOF'
docs: Phase 9 - 開発ガイドに OBI の起動・停止手順を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E8thMHFf395nhkZrph6uzy
EOF
)"
```

---

### Task 7: README と purpose.md を更新する

**Files:**
- Modify: `README.md`
- Modify: `docs/explanation/purpose.md`（「### やること」リスト）

**Interfaces:**
- Consumes: Task 3 のファイル名、Task 1 の profile 名

- [ ] **Step 1: README の ASCII 構成図を置き換える**

```
Browser (React)
    │  OTLP/HTTP (traces, metrics, logs)
    │                    ┌──────────────────────────────────┐
    ▼                    │  grafana/otel-lgtm               │
 nginx:80 ──/api──► backend:8080 ──OTLP/gRPC──► OTel       │  Tempo  (traces)
    ▲                │              Collector    Collector ──► Mimir  (metrics)
    │ eBPF           ▼                 ▲         │                  │  Loki   (logs)
    │             MariaDB              │         └──────────────────┘
 OBI (profile: obi) ──OTLP/HTTP────────┘
```

- [ ] **Step 2: 「起動方法」のコードブロックに OBI の行を追加する**

`# 停止` の前に追加する。

```bash
# Phase 9: OBI（eBPF 自動計装）も起動する場合
docker compose --profile obi up
```

- [ ] **Step 3: 「フェーズ構成」の表に行を追加する**

Phase 8 の行がまだ無いので、8 と 9 を追加する。9 のコミットハッシュはこの Phase の最初のコミット（Task 1 のコミット）の短縮ハッシュを `git log --oneline` で確認して入れる。

```markdown
| 8 | [bb96283](https://github.com/hidekingerz/otel-practice-env/commit/bb96283) | ハンズオン計装練習 |
| 9 | [<Task1のハッシュ>](https://github.com/hidekingerz/otel-practice-env/commit/<Task1のハッシュ>) | OBI による eBPF ゼロコード計装（nginx） |
```

- [ ] **Step 4: 「ドキュメント」の表にチュートリアル行を追加する**

「ハンズオン：計装を追加する」の行の直後に追加する。

```markdown
| チュートリアル | [ゼロコード計装：OBI で nginx をトレースする](docs/tutorials/zero-code-obi.md) | eBPF 自動計装でコード変更なしに nginx をトレースし、SDK 計装と比較する |
```

- [ ] **Step 5: purpose.md の「### やること」リストの末尾に 1 行追加する**

```markdown
- OBI（eBPF）によるゼロコード自動計装と、SDK 計装との比較
```

- [ ] **Step 6: 変更を確認する**

Run:
```bash
grep -n "profile obi\|zero-code-obi.md\|^| 9 |" README.md && grep -n "OBI" docs/explanation/purpose.md && grep -o '](docs/[^)]*\.md)' README.md | sed 's/](\(.*\))/\1/' | while read p; do test -f "$p" && echo "ok $p" || echo "MISSING $p"; done
```
Expected: README に 3 種類の一致、purpose.md に 1 行、リンクはすべて `ok`

- [ ] **Step 7: コミット**

```bash
git add README.md docs/explanation/purpose.md
git commit -m "$(cat <<'EOF'
docs: Phase 9 - README とプロジェクト目的に OBI を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E8thMHFf395nhkZrph6uzy
EOF
)"
```

---

### Task 8: 最終確認と PR 作成

**Files:** なし（検証のみ）

- [ ] **Step 1: チュートリアルの手順どおりにクリーン起動で通しで確認する**

Run:
```bash
docker compose --profile obi down && docker compose --profile obi up -d --build && sleep 30
docker compose ps --format '{{.Name}}\t{{.Status}}'
for i in 1 2 3; do curl -s -o /dev/null http://localhost/api/todos; curl -s -o /dev/null http://localhost/api/todos/stats; done; sleep 20
TEMPO_UID=$(curl -s http://localhost:3000/api/datasources | jq -r '.[] | select(.name=="Tempo") | .uid')
curl -s "http://localhost:3000/api/datasources/proxy/uid/$TEMPO_UID/api/search?tags=service.name%3Dnginx&limit=3" | jq '.traces | length'
```
Expected: 6 コンテナが `Up`、最後の出力が `1` 以上

- [ ] **Step 2: profile なしの起動に影響がないことを確認する**

Run:
```bash
docker compose --profile obi down && docker compose up -d && sleep 10 && docker compose ps --format '{{.Name}}' | grep -c . && docker compose ps --format '{{.Name}}' | grep -x obi; echo "obi-present-exit=$?"
```
Expected: `5` と `obi-present-exit=1`

- [ ] **Step 3: 作業ツリーがクリーンでコミットが揃っていることを確認する**

Run:
```bash
git status --short && git log --oneline main..HEAD
```
Expected: 未コミット変更なし。spec、Task 1、Task 3〜7 のコミットが並ぶ

- [ ] **Step 4: ユーザーに確認のうえ push して PR を作成する**

PR タイトル: `feat: Phase 9 - OBI による eBPF ゼロコード計装（nginx）`

PR 本文の要点: 目的（OBI でコード変更なしに nginx をトレース）、変更点（`obi` サービスを profile で追加、`obi/config.yaml`、ドキュメント 6 ファイル）、確認方法（`docker compose --profile obi up` → Tempo で `nginx` を検索）、検証環境（Docker Desktop macOS / arm64）、末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)` と `https://claude.ai/code/session_01E8thMHFf395nhkZrph6uzy`。

```bash
git push -u origin phase/9-obi-zero-code
gh pr create --title "feat: Phase 9 - OBI による eBPF ゼロコード計装（nginx）" --body-file <(cat <<'EOF'
## 概要
OBI（OpenTelemetry eBPF Instrumentation）を Compose profile `obi` で追加し、コード変更なしに nginx をトレースできるようにしました。

## 変更点
- `docker-compose.yml`: `obi` サービス（`otel/ebpf-instrument:v0.13.0`、`pid: host`、`privileged`、profile `obi`）
- `obi/config.yaml`: nginx(80) / backend(8080) の discovery、コンテキスト伝播、routes、OTLP エクスポート
- ドキュメント: チュートリアル新規（`docs/tutorials/zero-code-obi.md`）、解説・リファレンス・ハウツー・README・purpose を更新
- アプリケーションコード、nginx.conf、Collector、Grafana は未変更

## 確認方法
```bash
docker compose --profile obi up -d
# Todo アプリを操作 → Grafana Explore > Tempo > Service Name = nginx
```

## 検証環境
Docker Desktop（macOS / arm64）

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01E8thMHFf395nhkZrph6uzy
EOF
)
```
