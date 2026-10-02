# Phase 9: OBI ゼロコード計装 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OBI（OpenTelemetry eBPF Instrumentation）を Compose profile `obi` で追加し、nginx をゼロコードで計装して既存の分散トレースに nginx 区間を加え、Go backend との比較演習と Diataxis ドキュメントを提供する。

**Architecture:** `obi` サービス（`otel/ebpf-instrument:v0.13.0`、`pid: host`、`privileged: true`、`stop_grace_period: 60s`）が `obi/` 配下の設定を読み、既定の `config.yaml` では nginx（ポート 80 かつ実行ファイル名 nginx）だけを eBPF で計装して OTLP/HTTP で既存の `otel-collector:4318` に送る。比較演習は `OBI_CONFIG=config-compare.yaml` で backend（`backend-obi`）も対象にする。アプリケーションコード・nginx.conf・Collector・Grafana は変更しない。

**Tech Stack:** Docker Compose（profiles）、OBI v0.13.0、OTel Collector、Grafana LGTM（Tempo / Mimir）、Markdown（Diataxis）

**Spec:** `docs/superpowers/specs/2026-10-02-obi-zero-code-design.md`

## Global Constraints

- OBI イメージは `otel/ebpf-instrument:v0.13.0` にピン止めする
- `obi` サービスは `profiles: [obi]` でのみ起動する。`docker compose up`（profile なし）の挙動は変えない
- `backend/`、`frontend/`（`nginx.conf` 含む）、`otel-collector/`、`grafana/` は変更しない
- OBI の設定は `obi/config.yaml`（nginx のみ）と `obi/config-compare.yaml`（nginx + backend）に置き、ホスト側の環境変数は `OBI_CONFIG`（既定 `config.yaml`）のみ。`OBI_EXCLUDE_OTEL_INSTRUMENTED` は使わない
- discovery の service name は `nginx`（port 80、`exe_path: "*nginx*"`）と `backend-obi`（port 8080、`exe_path: "*/app/server*"`、compare のみ）
- `ebpf.context_propagation: all`、`routes.unmatched: path`、`otel_metrics_export.interval: 15s`、compare では `exclude_otel_instrumented_services: false`
- トレースの形はブラウザ起点で nginx と backend が兄弟（spec 4.6）。ドキュメントは「ぶら下がる」と書かない
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
| Create | `obi/config.yaml` | OBI の既定設定（nginx のみ） |
| Create | `obi/config-compare.yaml` | 比較演習用設定（nginx + backend-obi） |
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

### Task 3: 実機検証の結果を反映して compose と OBI 設定を改訂する

**背景**: Task 2 の検証で、(a) `exclude_otel_instrumented_services` がこの構成では発火しない、(b) `open_ports` だけだと Docker Desktop の `dockerd` も計装される、(c) OBI コンテナの `stop` / `restart` が "PID is zombie" エラーで失敗する、ことが分かった。spec 9 章に従い、設定ファイルを 2 つに分けて `OBI_CONFIG` で切り替え、`exe_path` で対象を絞り、`stop_grace_period: 60s` を追加する。

**Files:**
- Modify: `docker-compose.yml`（`obi` サービスのみ）
- Modify: `obi/config.yaml`
- Create: `obi/config-compare.yaml`

**Interfaces:**
- Consumes: Task 1 の `obi` サービス
- Produces: 環境変数 `OBI_CONFIG`（既定 `config.yaml`、比較演習は `config-compare.yaml`）、マウント `./obi:/config:ro`、discovery 名 `nginx` / `backend-obi`。環境変数 `OBI_EXCLUDE_OTEL_INSTRUMENTED` は**廃止**。後続のドキュメントはこれらを参照する

- [ ] **Step 1: `docker-compose.yml` の `obi` サービスを次に置き換える**

```yaml
  # Phase 9: OBI (eBPF 自動計装)。`docker compose --profile obi up` でのみ起動する
  obi:
    image: otel/ebpf-instrument:v0.13.0
    container_name: obi
    profiles: ["obi"]
    # 比較演習では OBI_CONFIG=config-compare.yaml を指定する
    command: ["--config=/config/${OBI_CONFIG:-config.yaml}"]
    # eBPF でホスト上の他コンテナのプロセスを観測するために必須
    pid: host
    privileged: true
    # Docker Desktop では停止時に "PID is zombie" エラーが出るため、終了を待つ猶予を長めに取る
    stop_grace_period: 60s
    volumes:
      - ./obi:/config:ro
    depends_on:
      - otel-collector
      - frontend
      - backend
    networks:
      - otel-network
```

`environment:` ブロックは削除する。

- [ ] **Step 2: `obi/config.yaml` を次の内容に置き換える**

```yaml
# OBI (OpenTelemetry eBPF Instrumentation) の設定（既定: nginx のみを計装）
# 参考: https://opentelemetry.io/ja/docs/zero-code/obi/
# backend も OBI で計装して比較するときは config-compare.yaml を使う

discovery:
  instrument:
    # SDK を入れられない nginx（frontend コンテナ）。OBI だけで可視化する主役。
    # Docker Desktop では公開ポートを VM 内の dockerd も開いているため、
    # ポートだけでなく実行ファイル名でも絞る
    - name: nginx
      open_ports: 80
      exe_path: "*nginx*"

ebpf:
  # 送信パケットの traceparent を OBI が書き換え、下流の span を親子にする（既定は無効）。
  # Docker Desktop のカーネルでは HTTP ヘッダ注入が無効化され起動時に ERROR ログが出るが、
  # OBI 同士の TCP レベル伝播は機能する
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

- [ ] **Step 3: `obi/config-compare.yaml` を作成する**

```yaml
# OBI の設定（比較演習: nginx に加えて Go backend も OBI で計装する）
# config.yaml との差分は discovery セクションだけ

discovery:
  instrument:
    - name: nginx
      open_ports: 80
      exe_path: "*nginx*"
    # OTel SDK で計装済みの backend を、あえて OBI でも計装する。
    # service.name を backend-obi にして SDK 由来（backend）と見分ける
    - name: backend-obi
      open_ports: 8080
      exe_path: "*/app/server*"
  # OBI には「OTLP を送信しているプロセスを自動で除外する」機能がある（既定 true）が、
  # backend のように単一の gRPC エンドポイントへ全シグナルを送る構成では検知が発火しない。
  # 比較演習の挙動を環境に依らず固定するため明示的に無効化する
  exclude_otel_instrumented_services: false

ebpf:
  context_propagation: all

routes:
  patterns:
    - /api/todos/stats
    - /api/todos/:id
    - /api/todos
  unmatched: path

otel_traces_export:
  endpoint: http://otel-collector:4318

otel_metrics_export:
  endpoint: http://otel-collector:4318
  interval: 15s
```

- [ ] **Step 4: Compose 定義を検証する**

Run:
```bash
docker compose --profile obi config | sed -n '/^  obi:/,/^  [a-z]/p' | grep -E 'config.yaml|stop_grace_period|/config:ro' \
  && OBI_CONFIG=config-compare.yaml docker compose --profile obi config | grep -- '--config=/config/config-compare.yaml' \
  && docker compose --profile obi config | sed -n '/^  obi:/,/^  [a-z]/p' | grep -c OBI_EXCLUDE; echo "exit=$?"
```
Expected: 1 行目で `--config=/config/config.yaml`、`stop_grace_period`、`/config:ro` を含む行、2 行目で compare のコマンド行が出て、最後の grep -c は `0` を出し `exit=1`（`OBI_EXCLUDE` が残っていない）

- [ ] **Step 5: 実機で検出対象を確認する（既定設定）**

既存の obi コンテナが残っていれば先に消す。

Run:
```bash
docker rm -f $(docker ps -aq --filter name=obi) 2>/dev/null; docker compose --profile obi up -d obi && sleep 20 && docker compose logs obi | grep 'instrumenting process'
```
Expected: `cmd=/usr/sbin/nginx ... service=nginx` の行のみ。`dockerd` と `/app/server` の行が**無い**

- [ ] **Step 6: stop / restart / 再作成が成功することを確認する**

OBI の起動から 30 秒以上経ってから実行する（短時間ならエラーが再現しないため）。

Run:
```bash
docker compose --profile obi stop obi; echo "stop=$?"; docker compose --profile obi up -d obi && sleep 35 && docker compose --profile obi restart obi; echo "restart=$?"; sleep 35; OBI_CONFIG=config-compare.yaml docker compose --profile obi up -d obi; echo "recreate=$?"; docker ps -a --filter name=obi --format '{{.Names}} {{.Status}}'
```
Expected: `stop=0`、`restart=0`、`recreate=0`。最後の一覧に `obi` が 1 つだけ（`<hash>_obi` のような残骸が無い）

- [ ] **Step 7: 比較設定の検出対象とメトリクスを確認する**

Run:
```bash
sleep 20; docker compose logs obi | grep 'instrumenting process'
for i in 1 2 3; do curl -s -o /dev/null http://localhost/api/todos; curl -s -o /dev/null http://localhost/api/todos/stats; done; sleep 40
PROM_UID=$(curl -s http://localhost:3000/api/datasources | jq -r '.[]|select(.name=="Prometheus")|.uid')
curl -s "http://localhost:3000/api/datasources/proxy/uid/$PROM_UID/api/v1/query?query=sum(rate(rpc_client_call_duration_seconds_count%7Bservice_name%3D%22backend-obi%22%7D%5B2m%5D))" | jq -c '.data.result'
curl -s "http://localhost:3000/api/datasources/proxy/uid/$PROM_UID/api/v1/query?query=sum(rate(db_client_operation_duration_seconds_count%7Bservice_name%3D%22backend-obi%22%7D%5B2m%5D))" | jq -c '.data.result'
```
Expected: ログは nginx と `/app/server` の 2 種類のみ（`dockerd` 無し）。`rpc_client_*` のクエリは `[]` または値 `"0"`。`db_client_*` のクエリは正の値

- [ ] **Step 8: ブラウザ相当のトレース形状を確認する（既定設定に戻して）**

Run:
```bash
docker compose --profile obi up -d obi && sleep 20
TEMPO_UID=$(curl -s http://localhost:3000/api/datasources | jq -r '.[]|select(.name=="Tempo")|.uid')
TID=$(openssl rand -hex 16); SID=$(openssl rand -hex 8)
curl -s -o /dev/null -H "traceparent: 00-$TID-$SID-01" http://localhost/api/todos/stats; sleep 25
curl -s "http://localhost:3000/api/datasources/proxy/uid/$TEMPO_UID/api/traces/$TID" \
 | jq -r --arg sid "$SID" '.batches[] | (.resource.attributes[] | select(.key=="service.name") | .value.stringValue) as $svc
   | .scopeSpans[].spans[] | "\($svc)\t\(.kind)\t\(.name)\tparent=\(.parentSpanId // "-" | @base64d | explode | map(. as $b | "0123456789abcdef"[$b/16|floor:$b/16|floor+1] + "0123456789abcdef"[$b%16:$b%16+1]) | join(""))"'
echo "SID=$SID"
```
Expected: `nginx` の SERVER span と `backend` の SERVER span の `parent` がどちらも `SID` に一致する（兄弟）。`backend-obi` は出ない

- [ ] **Step 9: 検証結果を記録する**

`/private/tmp/claude-501/-Users-hidekingerz-ghq-github-com-hidekingerz-otel-practice-env/ddaee3ba-4d26-45b2-91cd-7667ac0b971c/scratchpad/obi-verification.md` の末尾に「## Task 3 再検証」節を追記し、Step 5〜8 の要点（検出ログの行、各コマンドの終了コード、親子関係の結果）を書く。

- [ ] **Step 10: コミット**

```bash
git add docker-compose.yml obi/config.yaml obi/config-compare.yaml
git commit -m "$(cat <<'EOF'
feat: Phase 9 - OBI 設定を nginx 用と比較用に分離し Docker Desktop の制約に対応

- exclude_otel_instrumented_services が発火しないため OBI_CONFIG で設定ファイルを切り替える方式に変更
- exe_path で dockerd を計装対象から外す
- stop_grace_period: 60s で停止時の zombie エラーを回避

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E8thMHFf395nhkZrph6uzy
EOF
)"
```

---

### Task 4: チュートリアル `docs/tutorials/zero-code-obi.md` を書く

**Files:**
- Create: `docs/tutorials/zero-code-obi.md`

**Interfaces:**
- Consumes: Task 3 の名前（`obi`、`nginx`、`backend-obi`、`OBI_CONFIG`、`config-compare.yaml`）、Task 2 / 3 の観測結果（`obi-verification.md`）
- Produces: README とハウツーからリンクされるファイル名 `docs/tutorials/zero-code-obi.md`

- [ ] **Step 1: 以下の内容でファイルを作成する**

`obi-verification.md` と食い違う span 名・メトリクス名があれば、観測結果に合わせて置き換える。

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
docker compose logs obi | grep "instrumenting process"
```

`cmd=/usr/sbin/nginx ... service=nginx` という行が出ていれば成功です。

> **起動時に `ERROR ... context propagation is disabled` と出る**
>
> Docker Desktop のカーネルでは、OBI が HTTP ヘッダーに `traceparent` を書き込む機能が無効化されます。このエラーが出ても nginx のスパンとメトリクスは問題なく取得できます。影響は Step 3 で説明します。

## Step 2: Todo アプリを操作する

ブラウザで http://localhost を開き、Todo をいくつか追加・完了・削除します。OBI はこれらのリクエストが nginx を通過するところを観測しています。

## Step 3: Tempo で nginx のスパンを確認する

1. Grafana（http://localhost:3000）の左サイドバーで「Explore」を開く
2. データソースに「Tempo」を選ぶ
3. 「TraceQL」タブで `{ resource.service.name = "nginx" }` を入力して「Run query」を押す

`GET /api/todos` のようなトレースが一覧に出てきましたか？ 1 つ開いてウォーターフォールを見てください。

```
frontend   HTTP GET /api/todos               ← ブラウザ（OTel JS SDK）
├─ nginx   GET /api/todos  (server)          ← OBI が nginx で観測
│  ├─ nginx  in queue / processing           ← nginx 内部の待ち時間と処理時間
│  └─ nginx  GET /api/todos  (client)        ← nginx → backend の送信を OBI が観測
└─ backend GET /api/todos                    ← Go（OTel Go SDK）
   └─ backend SELECT ...                     ← otelsql
```

これまで `frontend` の直下に `backend` だけがあったトレースに、nginx のスパンが加わりました。nginx のコードも設定も触っていないのに、分散トレースの一部になっています。

> **nginx と backend が親子ではなく兄弟に並ぶ理由**
>
> nginx はブラウザから受け取った `traceparent` ヘッダーをそのまま backend に転送します。OBI は nginx のスパンをこの `traceparent` の子として作り、backend の SDK も同じ `traceparent` の子としてスパンを作るため、両者は兄弟になります。
>
> `obi/config.yaml` の `ebpf.context_propagation: all` が効く環境（ヘッダー注入が有効なカーネル）では、OBI が nginx の送信パケットの `traceparent` を自分の client span の ID に書き換えるため、backend が nginx の下にぶら下がります。Docker Desktop では Step 1 のエラーのとおりこの機能が無効なので、兄弟として表示されます。

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

Tempo の TraceQL で `{ resource.service.name = "backend-obi" }` を検索し、トレースを 1 つ開いてください。同じリクエストについて、`backend`（SDK）のスパンと `backend-obi`（OBI）のスパンが同じトレース内に並んでいます。

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
> OBI には、OTLP を送信しているプロセスを検知して自分の計装を抑止する機能（`discovery.exclude_otel_instrumented_services`、既定で有効）があります。ただし検知は「OTLP のエクスポート通信を観測できたか」に依存し、この環境の backend（単一の gRPC エンドポイントに全シグナルを送信）では発火しません。そのため本プロジェクトでは、OBI の対象を設定ファイルで明示的に分けています。

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

### Task 5: 解説 `docs/explanation/architecture.md` を更新する

**Files:**
- Modify: `docs/explanation/architecture.md`（構成図 5〜45 行目、「技術選定の理由」末尾、「設計上のトレードオフ」末尾）

**Interfaces:**
- Consumes: Task 3 の名前
- Produces: 見出し「SDK 計装と eBPF 自動計装（OBI）」。Task 4 のチュートリアル末尾がこの見出し名で参照している

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

このプロジェクトでは、SDK を組み込めない **nginx** を OBI の主な対象にしている。nginx は `traceparent` ヘッダーを転送するだけで自身のスパンは出せなかったが、OBI により nginx の server span（と内部の `in queue` / `processing`）、backend への client span がトレースに加わる。

**SDK と OBI は置き換えではなく補完の関係にある。**

| 観点 | SDK 計装 | OBI（eBPF） |
|---|---|---|
| 得意なこと | コードの意図を表す内部スパン、ビジネス属性、ログとの紐付け | コード変更なしでプロトコル境界を網羅的に観測 |
| 苦手なこと | SDK のない言語・改修できないコード・サードパーティのバイナリ | 内部処理の意味、任意の属性、ログ |
| 導入コスト | 言語ごとの SDK 導入とコード変更 | privileged コンテナ 1 つ |
| 必要な権限 | なし | `pid: host` と特権（eBPF プログラムのロード、他プロセスのメモリ・ネットワーク観測） |

#### 設定ファイルを 2 つに分けている理由

OBI には、OTLP を送信しているプロセス（= すでに SDK で計装されている）を自動的に計装対象から外す機能（`discovery.exclude_otel_instrumented_services`、既定で有効）がある。ただしこの検知は挙動ベースで、「OBI 自身が観測した client span が OTLP のエクスポートに見えるか」で判定する。backend のように単一の gRPC エンドポイントへ全シグナルを送る構成では、ポートからシグナル種別を特定できず検知が発火しない（upstream の [devdocs](https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation/blob/main/devdocs/exclude-otel-instrumented-services.md) に明記されている制約）。

そのため本プロジェクトでは自動除外に頼らず、`obi/config.yaml`（nginx のみ）と `obi/config-compare.yaml`（nginx + backend）を `OBI_CONFIG` 環境変数で明示的に切り替える。比較用の設定では、環境差で挙動が変わらないよう自動除外を明示的に無効にしている。

#### Compose profile でオプトインにしている理由

`privileged: true` と `pid: host` を持つコンテナはホスト上の全プロセスを観測できる。学習環境とはいえ常時起動させる必然性はなく、Phase 1〜8 の体験を変えないためにも、`docker compose --profile obi up` と明示したときだけ起動する構成にした。
```

- [ ] **Step 4: 「設計上のトレードオフ」の末尾に節を追加する**

```markdown
### eBPF の環境依存

OBI は Linux カーネル 5.8 以降と BTF を必要とし、Docker Desktop では内部の Linux VM 上で動作する。eBPF の挙動はカーネルや Docker のバージョンに依存するため、SDK 計装に比べて「どの環境でも同じように動く」保証は弱い。本プロジェクトは Docker Desktop（macOS / arm64）で検証しており、そこで観測した環境依存の挙動は次のとおり。

| 挙動 | Docker Desktop での結果 | 対応 |
|---|---|---|
| `ebpf.context_propagation: all` による HTTP ヘッダー注入 | カーネルの `FIONREAD` 問題で無効化され、起動時に ERROR ログが出る。ブラウザ起点のトレースでは nginx と backend が兄弟として並ぶ（ヘッダー注入が有効なカーネルでは backend が nginx の下にぶら下がる） | 設定は残し、チュートリアルで環境差を説明 |
| `open_ports` による対象の選択 | 公開ポートを VM 内の `dockerd` も開いているため、`dockerd` まで計装対象に入る。`containers_only: true` でも除外されない | `exe_path` を併用して実行ファイル名でも絞る |
| OBI コンテナの停止 | `pid: host` のため、SIGTERM 後にプロセスが終了しても回収が遅れ、既定の 10 秒で "PID is zombie" エラーになる | `stop_grace_period: 60s` を設定 |
```

- [ ] **Step 5: 変更を確認する**

Run:
```bash
grep -c "OBI" docs/explanation/architecture.md && grep -n "^### SDK 計装と eBPF 自動計装（OBI）\|^### eBPF の環境依存\|^#### 設定ファイルを 2 つに分けている理由" docs/explanation/architecture.md
```
Expected: OBI が 10 回以上、3 つの見出しが出力される

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

### Task 6: リファレンス `docs/reference/configuration.md` を更新する

**Files:**
- Modify: `docs/reference/configuration.md`

**Interfaces:**
- Consumes: Task 3 の名前と設定ファイルの内容、Task 2 で確定したメトリクス名（`obi-verification.md`）
- Produces: 見出し「OBI 設定（`obi/`）」「OBI が生成するメトリクス」

- [ ] **Step 1: 「Docker Compose サービス一覧」の表の末尾に行を追加する**

```markdown
| `obi` | `obi` | `otel/ebpf-instrument:v0.13.0` | eBPF 自動計装（Phase 9）。profile `obi` を指定したときのみ起動 |
```

- [ ] **Step 2: 「環境変数」に節を追加する（「### db サービス」の直後）**

```markdown
### obi サービス

| 変数名 | 既定値 | 説明 |
|---|---|---|
| `OBI_CONFIG` | `config.yaml` | OBI が読む設定ファイル名（`obi/` ディレクトリ内）。`config-compare.yaml` にすると backend も OBI の計装対象になる |

ホスト側で `OBI_CONFIG=config-compare.yaml docker compose --profile obi up -d obi` のように指定する（Compose が `command` の `${OBI_CONFIG:-config.yaml}` を展開する）。
```

- [ ] **Step 3: 「OTel Collector パイプライン構成」の直後に節を追加する**

```markdown
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
| `db_client_operation_duration_seconds_{bucket,count,sum}` | ヒストグラム | `backend-obi` | `db_system_name`, `db_operation_name`, `db_collection_name` |
| `target_info` | 情報 | すべて | リソース属性（`telemetry_distro_name` 等） |

Explore クエリ例: `rate(http_server_request_duration_seconds_count{service_name="nginx"}[5m])`
```

- [ ] **Step 4: 「バインドマウント」の表に行を追加する**

```markdown
| `./obi` | `/config` | OBI 設定ディレクトリ（profile `obi` 有効時のみ） |
```

- [ ] **Step 5: 「Grafana データソース」の表の Tempo 行の Explore クエリ例を補足する**

Tempo 行の末尾セルを `{resource.service.name="frontend"}`（OBI 有効時は `nginx` も可） に変更する。

- [ ] **Step 6: 変更を確認する**

Run:
```bash
grep -n "^## OBI 設定\|^## OBI が生成するメトリクス\|^### obi サービス\|ebpf-instrument:v0.13.0\|^| \`./obi\` |" docs/reference/configuration.md && grep -c "OBI_EXCLUDE" docs/reference/configuration.md
```
Expected: 5 行が出力され、最後の数は `0`

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

### Task 7: ハウツー `docs/how-to/development.md` を更新する

**Files:**
- Modify: `docs/how-to/development.md`

**Interfaces:**
- Consumes: Task 3 の名前（`OBI_CONFIG`、`config-compare.yaml`）
- Produces: 見出し「OBI（eBPF 自動計装）を起動・停止する」

- [ ] **Step 1: 「コンテナのログを確認する」の `docker compose logs -f grafana` の次の行に追加する**

```bash
docker compose logs -f obi          # OBI（profile obi で起動している場合）
```

- [ ] **Step 2: 「OTel Collector の設定を変更・検証する」節の直前に節を追加する**

````markdown
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
````

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
grep -n "^## OBI\|logs -f obi\|--profile obi down -v\|OBI_CONFIG=config-compare.yaml" docs/how-to/development.md && test -f docs/tutorials/zero-code-obi.md && echo link-ok
```
Expected: 4 行と `link-ok`

- [ ] **Step 5: コミット**

```bash
git add docs/how-to/development.md
git commit -m "$(cat <<'EOF'
docs: Phase 9 - 開発ガイドに OBI の起動・停止・設定切替手順を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E8thMHFf395nhkZrph6uzy
EOF
)"
```

---

### Task 8: README と purpose.md を更新する

**Files:**
- Modify: `README.md`
- Modify: `docs/explanation/purpose.md`（「### やること」リスト）

**Interfaces:**
- Consumes: Task 4 のファイル名、Task 3 の profile 名。Phase 9 のコミットハッシュは Task 1 のコミット `90a9e82`

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

Phase 8 の行がまだ無いので、8 と 9 を追加する。

```markdown
| 8 | [bb96283](https://github.com/hidekingerz/otel-practice-env/commit/bb96283) | ハンズオン計装練習 |
| 9 | [90a9e82](https://github.com/hidekingerz/otel-practice-env/commit/90a9e82) | OBI による eBPF ゼロコード計装（nginx） |
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

### Task 9: 最終確認と PR 作成

**Files:** なし（検証のみ）

- [ ] **Step 1: クリーン起動で通しで確認する（spec 6 章の条件 1, 2, 4, 6, 8）**

Run:
```bash
docker compose --profile obi config >/dev/null && echo config-ok
docker compose --profile obi down && docker compose --profile obi up -d --build && sleep 40
docker compose ps --format '{{.Name}}\t{{.Status}}'
docker compose logs obi | grep 'instrumenting process'
TEMPO_UID=$(curl -s http://localhost:3000/api/datasources | jq -r '.[]|select(.name=="Tempo")|.uid')
TID=$(openssl rand -hex 16); SID=$(openssl rand -hex 8)
curl -s -o /dev/null -H "traceparent: 00-$TID-$SID-01" http://localhost/api/todos; sleep 25
curl -s "http://localhost:3000/api/datasources/proxy/uid/$TEMPO_UID/api/traces/$TID" | jq -r '.batches[] | (.resource.attributes[] | select(.key=="service.name") | .value.stringValue) as $svc | .scopeSpans[].spans[] | "\($svc)\t\(.kind)\t\(.name)"'
```
Expected: `config-ok`、6 コンテナが `Up`、検出ログは nginx のみ、トレースに `nginx` と `backend` の span があり `backend-obi` は無い

- [ ] **Step 2: profile なしの起動に影響がないことを確認する（条件 6）**

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
Expected: 未コミット変更なし。spec、plan、Task 1、Task 3〜8 のコミットが並ぶ

- [ ] **Step 4: ユーザーに確認のうえ push して PR を作成する**

PR タイトル: `feat: Phase 9 - OBI による eBPF ゼロコード計装（nginx）`

```bash
git push -u origin phase/9-obi-zero-code
gh pr create --title "feat: Phase 9 - OBI による eBPF ゼロコード計装（nginx）" --body-file <(cat <<'EOF'
## 概要
OBI（OpenTelemetry eBPF Instrumentation）を Compose profile `obi` で追加し、コード変更なしに nginx をトレースできるようにしました。

## 変更点
- `docker-compose.yml`: `obi` サービス（`otel/ebpf-instrument:v0.13.0`、`pid: host`、`privileged`、profile `obi`、`stop_grace_period: 60s`）
- `obi/config.yaml`（nginx のみ）と `obi/config-compare.yaml`（nginx + backend）。`OBI_CONFIG` で切替
- ドキュメント: チュートリアル新規（`docs/tutorials/zero-code-obi.md`）、解説・リファレンス・ハウツー・README・purpose を更新
- 設計 spec と実装計画（`docs/superpowers/`）
- アプリケーションコード、nginx.conf、Collector、Grafana は未変更

## 確認方法
```bash
docker compose --profile obi up -d
# Todo アプリを操作 → Grafana Explore > Tempo > TraceQL: { resource.service.name = "nginx" }
```

## 検証環境と既知の制約
Docker Desktop（macOS / arm64）。このカーネルでは OBI の HTTP ヘッダー注入が無効化されるため、nginx と backend のスパンは兄弟として並びます。詳細は spec の 9 章を参照。

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01E8thMHFf395nhkZrph6uzy
EOF
)
```
