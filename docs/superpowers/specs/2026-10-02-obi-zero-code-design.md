# Phase 9: OBI（OpenTelemetry eBPF Instrumentation）によるゼロコード計装 設計

- 作成日: 2026-10-02
- ステータス: 承認済み（2026-10-02 の実機検証を受けて改訂、改訂内容は 9 章）

## 1. 目的

既存の練習環境に [OBI](https://opentelemetry.io/ja/docs/zero-code/obi/) を追加し、**アプリケーションのコードや設定を一切変更せずに** eBPF でトレースと RED メトリクスを取得する体験を Phase 9 として提供する。

学習ゴール:

- SDK を入れられないプロセス（nginx）を OBI で可視化し、既存の分散トレースに nginx 区間が加わることを確認する
- SDK 計装済みのプロセス（Go backend）に対して OBI を重ね、SDK 計装と eBPF 自動計装の「取れるもの・取れないもの」を比較する
- OBI が privileged / `pid: host` を必要とする理由と、eBPF が環境に依存することを理解する

## 2. スコープ

### やること

- `docker-compose.yml` に `obi` サービスを追加する（Compose profile `obi` でオプトイン）
- `obi/config.yaml`（nginx のみ）と `obi/config-compare.yaml`（nginx + backend）を新設する
- Diataxis 構成のドキュメントを更新する（チュートリアル新規、解説・リファレンス・ハウツー・README 更新）
- Docker Desktop（macOS / arm64）上で実機検証する

### やらないこと

- backend / frontend / nginx.conf / Go コードの変更（ゼロコードであることが主張の核心）
- OTel Collector / Grafana の設定変更
- Grafana ダッシュボードの追加・変更（Explore で確認する。必要なら後続 PR で検討）
- 既存チュートリアル（`getting-started.md`、`hands-on-instrumentation.md`）の変更
- Kubernetes / Helm での OBI 導入

## 3. 対象の選定理由

| 候補 | 採否 | 理由 |
|---|---|---|
| nginx（frontend コンテナ） | 採用（主役） | SDK を入れられない C プロセス。新規サービス不要で、既存トレースとの対比が分かりやすい |
| Go backend | 採用（比較演習） | SDK/eBPF の差分を観察できる。Phase 8 の未計装 `stats` API も OBI なら自動で見える |
| 未計装の新サービス追加 | 不採用 | コードとコンテナが増える。YAGNI |
| Node.js サービス追加 | 不採用 | 現構成に実行時の Node プロセスが存在しない（React はビルド時のみ Node、実行はブラウザ）。追加するなら別 Phase |

## 4. 構成

### 4.1 データの流れ

```
Browser ──OTLP/HTTP──────────────────────────────┐
nginx  ◄─eBPF─┐                                  ▼
backend◄─eBPF─┴─ OBI ──OTLP/HTTP(4318)──► otel-collector ──► Tempo / Mimir
backend ──OTLP/gRPC(4317)（既存 SDK）──────────────┘
```

OBI は Collector に OTLP で送るだけで、Collector / Grafana 側の変更は不要。

### 4.2 docker-compose.yml への追加

```yaml
  obi:
    image: otel/ebpf-instrument:v0.13.0
    container_name: obi
    profiles: ["obi"]
    # 比較演習では OBI_CONFIG=config-compare.yaml を指定する
    command: ["--config=/config/${OBI_CONFIG:-config.yaml}"]
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

設計判断:

- **profile でオプトイン**: `privileged: true` + `pid: host` はホストの全プロセスを覗ける強い権限であるため、明示的に `--profile obi` を付けたときだけ起動する。既存 Phase 1〜8 の体験は変わらない。
- **イメージのピン止め**: v0.13.0（2026-09-04 リリースの最新安定版）。upstream の nginx 例と同じ。
- **設定は YAML ファイルを 2 つ**: 既存の `otel-collector/` と同じ流儀でディレクトリを切り、ディレクトリごとマウントして `OBI_CONFIG`（Compose が展開する）でファイルを選ぶ。
- **`stop_grace_period: 60s`**: Docker Desktop + `pid: host` では、SIGTERM 後に OBI プロセスが終了しても回収が遅れ、既定の 10 秒で SIGKILL に移行した時点で "PID is zombie and can not be killed" エラーになる。猶予を 60 秒にすると `stop` / `restart` / 再作成が正常終了する（実機検証済み）。`init: true` や `stop_signal: SIGKILL` では解消しない。
- **`pid: host` のため `depends_on` は起動順の目安に過ぎない**: OBI は起動後もプロセスをポーリングして検出するので、対象が後から起動しても問題ない。

### 4.3 obi/config.yaml（既定: nginx のみ）

```yaml
discovery:
  instrument:
    - name: nginx
      open_ports: 80
      exe_path: "*nginx*"

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

### 4.4 obi/config-compare.yaml（比較演習: nginx + backend）

`config.yaml` との差分は `discovery` だけ。

```yaml
discovery:
  instrument:
    - name: nginx
      open_ports: 80
      exe_path: "*nginx*"
    - name: backend-obi
      open_ports: 8080
      exe_path: "*/app/server*"
  # OBI には「OTLP を送信しているプロセスを自動で除外する」機能があるが（既定 true）、
  # この構成では検知が発火しない（9 章）。比較演習の挙動を環境に依らず固定するため明示的に無効化する
  exclude_otel_instrumented_services: false
```

設計判断:

- **`exe_path` を併用する**: Docker Desktop では公開ポート（80 / 8080）を VM 内の `dockerd` も開いているため、`open_ports` だけでは `dockerd` が計装対象に入り、containerd の gRPC がノイズとして混ざる。`containers_only: true` では除外できなかった（実機検証）。ポートと実行ファイルの両方で絞る。
- **service name を `backend-obi` と分ける**: 比較演習で Tempo 上の SDK 由来（`backend`）と OBI 由来（`backend-obi`）を並べて見分けられるようにする。
- **`context_propagation: all` は残す**: Docker Desktop のカーネルでは HTTP ヘッダ注入が無効化され、起動時に ERROR ログが出るが、OBI 同士の TCP レベル伝播は機能する。ヘッダ注入が効くカーネルでは backend が nginx の下にぶら下がる。設定を外すと全環境で兄弟になるので、残して環境差を解説する。
- **`routes.patterns`**: `/api/todos/123` のような ID 入りパスを `http.route=/api/todos/:id` に集約し、メトリクスのカーディナリティ爆発を防ぐ。

### 4.5 比較演習の操作

```bash
# backend も OBI で計装する設定に切り替えて再作成
OBI_CONFIG=config-compare.yaml docker compose --profile obi up -d obi

# 元に戻す
docker compose --profile obi up -d obi
```

### 4.6 トレースの形（実機で確認したもの）

ブラウザ起点（`traceparent` 付き）のリクエストでは、nginx の server span と backend（SDK）の server span は**どちらもブラウザの span の子**、つまり兄弟になる。

```
frontend   HTTP GET /api/todos               ← ブラウザ（OTel JS SDK）
├─ nginx   GET /api/todos (server)           ← OBI
│  ├─ nginx  processing (internal)
│  │  └─ nginx  GET /api/todos (client)      ← nginx → backend の送信
│  └─ nginx  in queue (internal)
└─ backend  backend (server)                  ← Go（OTel Go SDK, otelhttp）
   └─ backend  sql.conn.query / sql.rows      ← otelsql
```

比較演習（`config-compare.yaml`）では `backend-obi` の server span と SQL client span も同じトレースに兄弟として加わる。`traceparent` の無い直接リクエスト（curl 等）では `backend-obi` が nginx の client span の下にぶら下がる（TCP レベル伝播）。

観察させる差分:

| 観点 | SDK（`backend`） | OBI（`backend-obi`） |
|---|---|---|
| HTTP server span | `otelhttp` による | あり。加えて INTERNAL の `in queue` / `processing` |
| 名前付きの内部 span（`todo.List` 等） | あり | なし（コードの意図は見えない） |
| 手動属性（`todo.total` 等） | あり | なし |
| DB クエリ span | `otelsql` による | MySQL プロトコルを eBPF で解析した client span（`SELECT todos` 等） |
| Phase 8 の未計装 `GET /api/todos/stats` | HTTP span と otelsql の SQL span。名前付き span `todo.Stats` や属性はハンズオンで追加するまで無い | 何もしなくても HTTP span と SQL span が見える（名前付き span や属性は付かない） |
| ログ | OTLP ログあり | なし（OBI はトレース・メトリクスのみ） |

着地点: 「どちらか」ではなく、OBI で広くカバレッジを確保し、重要な箇所を SDK で深掘りする使い分け。

## 5. ドキュメント

| 種別 | ファイル | 変更内容 |
|---|---|---|
| チュートリアル | `docs/tutorials/zero-code-obi.md`（新規） | Phase 9 本編。前提 → OBI とは → `--profile obi` で起動 → Todo 操作 → Tempo で nginx span を確認 → Prometheus で nginx の RED メトリクスを確認 → 比較演習（`OBI_CONFIG=config-compare.yaml`）→ 片付け → トラブルシューティング |
| 解説 | `docs/explanation/architecture.md` | mermaid 構成図に OBI を追加。「SDK 計装と eBPF 自動計装」の節を追加（仕組み、取れるもの・取れないもの、privileged の意味、環境依存、自動除外の限界、置き換えではなく補完） |
| リファレンス | `docs/reference/configuration.md` | サービス一覧に `obi`（profile 付き）、`OBI_CONFIG`、2 つの設定ファイルのキー、OBI が出すメトリクス名（実機で確認済み） |
| ハウツー | `docs/how-to/development.md` | profile 付き起動/停止、設定切替、OBI ログの見方 |
| README | `README.md` | Phase 表に 8 と 9 を追加、ドキュメント表に追加、起動方法に `--profile obi` を追記、ASCII 構成図に OBI を追加 |

既存チュートリアルは変更しない。OBI は profile でオフなので、既存の体験は変わらないため。

## 6. 実機検証（受け入れ条件）

Docker Desktop（macOS / arm64）で以下をすべて確認してから完了とする。

1. `docker compose --profile obi up -d` で OBI が起動し、ログに nginx の検出が記録され、`dockerd` は検出されない
2. `traceparent` 付きリクエストで、Tempo の同一トレース内に `nginx` の server span と `backend`（SDK）の server span が並ぶ
3. Prometheus で `http_server_request_duration_seconds_*{service_name="nginx"}` が引ける
4. 既定（`config.yaml`）では `backend-obi` のテレメトリが出ない
5. `OBI_CONFIG=config-compare.yaml` で再作成すると `backend-obi` の HTTP span と SQL client span が現れ、`rpc_client_*`（dockerd 由来）は増えない
6. `docker compose up`（profile なし）では OBI が起動せず、既存の動作に影響がない
7. `docker compose --profile obi stop obi` / `restart obi` / 設定を変えた `up -d obi` が終了コード 0 で完了する
8. `docker compose --profile obi config` が通る

## 7. リスクと対応

| リスク | 対応 |
|---|---|
| eBPF の挙動がカーネルに依存する | 9 章の実機結果をドキュメントに明記し、「この環境では兄弟、ヘッダ注入が効く環境では親子」と書く |
| `exe_path` のグロブが OBI のバージョンで変わる | v0.13.0 にピン止め。検証で `instrumenting process` ログを確認する |
| `privileged` コンテナへの抵抗感 | profile でオプトインにし、解説で必要な capability と理由を説明する |

## 8. 参考

- OBI 公式ドキュメント: https://opentelemetry.io/ja/docs/zero-code/obi/
- Docker での実行: https://opentelemetry.io/docs/zero-code/obi/setup/docker/
- 分散トレースとコンテキスト伝播: https://opentelemetry.io/docs/zero-code/obi/distributed-traces/
- upstream の nginx 例: https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation/tree/main/examples/nginx
- 自動除外の仕組み（upstream devdocs）: https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation/blob/main/devdocs/exclude-otel-instrumented-services.md

## 9. 実機検証による改訂（2026-10-02）

初版の設計を Docker Desktop（macOS / arm64、linuxkit 6.x）で検証した結果、以下を改めた。

| 初版の前提 | 実機の結果 | 改訂 |
|---|---|---|
| `exclude_otel_instrumented_services` で SDK 計装済み backend が自動抑止される | 発火しない。backend は単一 gRPC エンドポイントに全シグナルを送っており、OBI のポートヒューリスティックが「どのシグナルか判別不能」として両フラグを立てない（upstream devdocs）。gRPC メソッド名も長命接続では取れない | 環境変数で除外を切り替える案を廃止。設定ファイル 2 つを `OBI_CONFIG` で選ぶ方式に変更。比較用では除外を明示的に false |
| `context_propagation: all` で backend が nginx の下にぶら下がる | HTTP ヘッダ注入がカーネルの FIONREAD 問題で無効化（起動時 ERROR）。ブラウザ起点では nginx と backend は兄弟。OBI 同士の TCP レベル伝播は `traceparent` 無しのときだけ効く | チュートリアルの図を兄弟に修正し、環境依存であることを解説 |
| `open_ports` だけで対象を特定できる | Docker Desktop の `dockerd` も公開ポートを開いており計装対象に入る。`containers_only: true` でも除外されない | `exe_path` を併用 |
| 設定変更は `restart` で反映 | `stop` / `restart` / 再作成が "PID is zombie" エラーで失敗（`init: true`、`stop_signal: SIGKILL` でも不可） | `stop_grace_period: 60s` を追加（効果を実機確認済み） |
