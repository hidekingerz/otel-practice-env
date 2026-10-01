# Phase 9: OBI（OpenTelemetry eBPF Instrumentation）によるゼロコード計装 設計

- 作成日: 2026-10-02
- ステータス: 承認済み（実装前）

## 1. 目的

既存の練習環境に [OBI](https://opentelemetry.io/ja/docs/zero-code/obi/) を追加し、**アプリケーションのコードや設定を一切変更せずに** eBPF でトレースと RED メトリクスを取得する体験を Phase 9 として提供する。

学習ゴール:

- SDK を入れられないプロセス（nginx）を OBI で可視化し、既存の分散トレースに nginx 区間が加わることを確認する
- SDK 計装済みのプロセス（Go backend）に対して OBI を重ね、SDK 計装と eBPF 自動計装の「取れるもの・取れないもの」を比較する
- OBI が privileged / `pid: host` を必要とする理由と、そのトレードオフを理解する

## 2. スコープ

### やること

- `docker-compose.yml` に `obi` サービスを追加する（Compose profile `obi` でオプトイン）
- `obi/config.yaml` を新設する
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
| Go backend | 採用（比較演習） | OBI の「SDK 入りサービス除外」機能の挙動と、SDK/eBPF の差分を観察できる。Phase 8 の未計装 `stats` API も OBI なら自動で見える |
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
    profiles: [obi]
    command: ["--config=/config/config.yaml"]
    pid: host
    privileged: true
    environment:
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

設計判断:

- **profile でオプトイン**: `privileged: true` + `pid: host` はホストの全プロセスを覗ける強い権限であるため、明示的に `--profile obi` を付けたときだけ起動する。既存 Phase 1〜8 の体験は変わらない。
- **イメージのピン止め**: v0.13.0（2026-09-04 リリースの最新安定版）。upstream の nginx 例と同じ。
- **設定は YAML ファイル**: 既存の `otel-collector/` と同じ流儀でディレクトリを切る。環境変数の羅列より読みやすく、リファレンスにも書きやすい。
- **`pid: host` のため `depends_on` は起動順の目安に過ぎない**: OBI は起動後もプロセスをポーリングして検出するので、対象が後から起動しても問題ない。

### 4.3 obi/config.yaml

```yaml
discovery:
  instrument:
    - name: nginx          # SDK なしの C プロセス。OBI だけで可視化する主役
      open_ports: 80
    - name: backend-obi    # 比較演習用。デフォルトでは下の除外設定で抑止される
      open_ports: 8080
  # backend は OTLP を送信している → OBI が挙動から検知して自動的に抑止（既定 true）
  exclude_otel_instrumented_services: ${OBI_EXCLUDE_OTEL_INSTRUMENTED:-true}

ebpf:
  context_propagation: all   # nginx→backend の client span を backend の親にする（既定は無効）

routes:
  patterns:
    - /api/todos/stats
    - /api/todos/:id
    - /api/todos
  unmatched: path            # http.route の低カーディナリティ化

otel_traces_export:
  endpoint: http://otel-collector:4318
otel_metrics_export:
  endpoint: http://otel-collector:4318
  interval: 15s              # 既定 60s だと確認に待たされるため短縮
```

設計判断:

- **backend のエントリを最初から入れておく**: 比較演習のたびに YAML を編集させず、環境変数 `OBI_EXCLUDE_OTEL_INSTRUMENTED` ひとつで切り替える。既定 `true` では OBI が backend の OTLP 送信を検知して抑止するため、通常は `backend-obi` のテレメトリは出ない。
- **service name を `backend-obi` と分ける**: 比較演習で Tempo 上の SDK 由来（`backend`）と OBI 由来（`backend-obi`）を並べて見分けられるようにする。
- **`context_propagation: all`**: 無効のままだと nginx は受信した `traceparent` をそのまま backend に転送するため、nginx の server span と backend の span が兄弟関係になる。有効にすると OBI が送信パケットの `traceparent` を書き換え、nginx の client span が backend の親になり、frontend → nginx → backend → db のウォーターフォールが成立する。カーネル 5.17+ が必要（Docker Desktop の linuxkit 7.0 は満たす）。
- **`routes.patterns`**: `/api/todos/123` のような ID 入りパスを `http.route=/api/todos/:id` に集約し、メトリクスのカーディナリティ爆発を防ぐ。SDK 側では `otelhttp` と Go 1.22 のパターンルーティングが同じ役割を果たしていることを解説で対比する。
- **環境変数の YAML 内展開**: OBI は設定ファイル中の `${VAR:-default}` を展開する（upstream の standalone 例で使用）。

### 4.4 比較演習の操作

```bash
# OBI 由来の backend テレメトリを有効化して再起動
OBI_EXCLUDE_OTEL_INSTRUMENTED=false docker compose --profile obi up -d obi

# 元に戻す
docker compose --profile obi up -d obi
```

観察させる差分:

| 観点 | SDK（`backend`） | OBI（`backend-obi`） |
|---|---|---|
| HTTP server span | `otelhttp` による。名前はルートパターン | `GET /api/todos` など HTTP 粒度 |
| 名前付きの内部 span（`todo.List` 等） | あり | なし（コードの意図は見えない） |
| 手動属性（`todo.total` 等） | あり | なし |
| DB クエリ span | `otelsql` による | MySQL プロトコルを eBPF で解析した client span |
| Phase 8 の未計装 `GET /api/todos/stats` | HTTP span のみ（演習で追加するまで内部 span なし） | 何もしなくても HTTP span と SQL span が見える |
| ログ | OTLP ログあり | なし（OBI はトレース・メトリクスのみ） |

着地点: 「どちらか」ではなく、OBI で広くカバレッジを確保し、重要な箇所を SDK で深掘りする使い分け。

## 5. ドキュメント

| 種別 | ファイル | 変更内容 |
|---|---|---|
| チュートリアル | `docs/tutorials/zero-code-obi.md`（新規） | Phase 9 本編。前提 → OBI とは → `--profile obi` で起動 → Todo 操作 → Tempo で nginx span とウォーターフォールを確認 → Prometheus で nginx の RED メトリクスを確認 → 比較演習（backend の除外を外す）→ 片付け → トラブルシューティング |
| 解説 | `docs/explanation/architecture.md` | mermaid 構成図に OBI を追加。「SDK 計装と eBPF 自動計装」の節を追加（仕組み、取れるもの・取れないもの、privileged の意味、置き換えではなく補完） |
| リファレンス | `docs/reference/configuration.md` | サービス一覧に `obi`（profile 付き）、`obi/config.yaml` の各キー、`OBI_EXCLUDE_OTEL_INSTRUMENTED`、OBI が出すメトリクス名（実機で確認した名前を記載） |
| ハウツー | `docs/how-to/development.md` | profile 付き起動/停止、OBI ログの見方、`obi/config.yaml` 変更後の再起動手順 |
| README | `README.md` | Phase 表に 9 を追加、ドキュメント表に追加、起動方法に `--profile obi` を追記、ASCII 構成図に OBI を追加 |

既存チュートリアルは変更しない。OBI は profile でオフなので、既存の体験は変わらないため。

文体・構成は既存ドキュメントに合わせる（日本語、Diataxis、チュートリアルは Step 形式 + 確認ポイント + トラブルシューティング）。

## 6. 実機検証（受け入れ条件）

Docker Desktop（macOS / arm64 / linuxkit 7.0）で以下をすべて確認してから完了とする。

1. `docker compose --profile obi up -d` で OBI が起動し、ログに nginx プロセスの検出が記録される
2. Todo アプリを操作すると Tempo に `service.name=nginx` の span が現れ、同一トレース内で frontend → nginx → backend → db が親子関係でつながる
3. Prometheus で nginx の RED メトリクスが引ける（メトリクス名を確定してリファレンスに記載する）
4. 既定状態では `backend-obi` の span が**出ない**（除外が効いている）
5. `OBI_EXCLUDE_OTEL_INSTRUMENTED=false` で再起動すると `backend-obi` の HTTP span と SQL client span が現れる
6. `docker compose up`（profile なし）では OBI が起動せず、既存の動作に影響がない
7. `docker compose config --profile obi` が通る（YAML の妥当性）

## 7. リスクと対応

| リスク | 対応 |
|---|---|
| Docker Desktop の linuxkit カーネルで eBPF 機能の一部（TC によるヘッダ注入、BTF）が動かない | 検証で判明した時点で止めて報告する。代替として `context_propagation` を無効にし、nginx span を兄弟関係として見せる設計に落とすかをユーザーが判断する |
| 除外検知は「挙動ベース」のため、起動直後の短時間は backend-obi の span が混ざる可能性 | チュートリアルのトラブルシューティングに明記する |
| OBI がホスト上の無関係なプロセス（Docker Desktop 内部等）を拾う | `open_ports` で 80 / 8080 に限定しているため基本は拾わない。拾った場合は `exclude_instrument` を追加する |
| `privileged` コンテナへの抵抗感 | profile でオプトインにし、解説で必要な capability と理由を説明する |

## 8. 参考

- OBI 公式ドキュメント: https://opentelemetry.io/ja/docs/zero-code/obi/
- Docker での実行: https://opentelemetry.io/docs/zero-code/obi/setup/docker/
- 分散トレースとコンテキスト伝播: https://opentelemetry.io/docs/zero-code/obi/distributed-traces/
- upstream の nginx 例: https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation/tree/main/examples/nginx
