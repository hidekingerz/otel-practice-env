# ハンズオン：自分でテレメトリを追加してみよう

このチュートリアルでは、**計装が入っていない新しいエンドポイント** に対して、自分でスパン・メトリクス・ログを追加する練習をします。

業務で「新しい API を実装したら計装も追加する」という作業を想定しています。

## 前提条件

- [はじめてみよう](getting-started.md) を完了していること
- `docker compose up --build` でスタックが起動していること
- お好みのエディタで `backend/handler/todo.go` と `frontend/src/` を編集できること

## 題材：Todo 統計 API

Phase 8 で以下を追加しました。これらには **意図的に OTel 計装が入っていません**。

| ファイル | 内容 |
|---|---|
| `backend/handler/todo.go` | `Stats()` ハンドラ（`GET /api/todos/stats`） |
| `frontend/src/api/client.ts` | `fetchTodoStats()` 関数 |
| `frontend/src/components/TodoStats.tsx` | Stats 表示コンポーネント |

レスポンス例：
```json
{ "total": 10, "completed": 3, "pending": 7 }
```

---

## Exercise 1：バックエンドに手動スパンを追加する

### 目的

`Stats()` ハンドラの処理に名前付きスパンを追加し、Tempo でトレースとして確認します。

### ヒント

既存の `List()` ハンドラが参考になります。

```go
// tracer はファイル先頭で定義済み
ctx, span := tracer.Start(r.Context(), "todo.Stats")
defer span.End()
```

スパンに属性を追加するとより有用です：

```go
span.SetAttributes(
    attribute.Int("todo.total", stats.Total),
    attribute.Int("todo.completed", stats.Completed),
)
```

### やってみよう

1. `backend/handler/todo.go` の `Stats()` を開く
2. `ctx := r.Context()` の行を `ctx, span := tracer.Start(r.Context(), "todo.Stats")` に変更する
3. `defer span.End()` を追加する
4. DB クエリ後に `span.SetAttributes(...)` で統計値を属性として記録する
5. エラー時に `span.RecordError(err)` と `span.SetStatus(codes.Error, err.Error())` を追加する
6. バックエンドをリビルドする（[開発ガイド](../how-to/development.md) 参照）

### 確認方法

- Grafana > Explore > Tempo > Search
- `Service Name = backend` でトレースを検索
- `todo.Stats` という名前のスパンが表示されることを確認

<details>
<summary>解答例を見る</summary>

```go
func (h *TodoHandler) Stats(w http.ResponseWriter, r *http.Request) {
    ctx, span := tracer.Start(r.Context(), "todo.Stats")
    defer span.End()

    var stats TodoStats
    err := h.db.QueryRowContext(ctx, `
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) AS pending
        FROM todos
    `).Scan(&stats.Total, &stats.Completed, &stats.Pending)
    if err != nil {
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
        writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
        return
    }

    span.SetAttributes(
        attribute.Int("todo.total", stats.Total),
        attribute.Int("todo.completed", stats.Completed),
        attribute.Int("todo.pending", stats.Pending),
    )
    writeJSON(w, http.StatusOK, stats)
}
```

必要な import：`go.opentelemetry.io/otel/attribute`、`go.opentelemetry.io/otel/codes`
</details>

---

## Exercise 2：リクエスト数をカウンターで計測する

### 目的

`GET /api/todos/stats` が呼ばれた回数をカウンターとして記録し、Grafana のメトリクスとして確認します。

### ヒント

カウンターはファイル先頭でグローバルに定義するのが一般的です（`TodoList.tsx` の `todoCreatedCounter` が参考になります）。

バックエンドでは `go.opentelemetry.io/otel/metric` パッケージを使います。

```go
import "go.opentelemetry.io/otel"

var meter = otel.Meter("backend/handler")

var statsRequestCounter, _ = meter.Int64Counter(
    "todo.stats.requests",
    metric.WithDescription("Number of requests to the stats endpoint"),
)
```

### やってみよう

1. `backend/handler/todo.go` に `meter` 変数と `statsRequestCounter` を定義する
2. `Stats()` ハンドラの先頭で `statsRequestCounter.Add(ctx, 1)` を呼ぶ
3. リビルド後、ブラウザで Todo アプリを何度か表示する（Stats は初回ロード時に呼ばれる）
4. Grafana > Explore > Prometheus で `todo_stats_requests_total` を確認する

### 確認方法

```
todo_stats_requests_total{service_name="backend"}
```

<details>
<summary>解答例を見る</summary>

```go
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/metric"
)

var meter = otel.Meter("backend/handler")

var statsRequestCounter, _ = meter.Int64Counter(
    "todo.stats.requests",
    metric.WithDescription("Number of requests to the stats endpoint"),
)

func (h *TodoHandler) Stats(w http.ResponseWriter, r *http.Request) {
    ctx, span := tracer.Start(r.Context(), "todo.Stats")
    defer span.End()

    statsRequestCounter.Add(ctx, 1)
    // ...以下省略
}
```
</details>

---

## Exercise 3：現在の Todo 件数をゲージで計測する

### 目的

「現在の Todo 総数」のような **時点の値** はゲージ（ObservableGauge）で計測します。プッシュ型のカウンターとの違いを体験しましょう。

### ヒント

ゲージは値をプル（収集時に計算）するため、コールバック関数で登録します。

```go
meter.Int64ObservableGauge(
    "todo.count",
    metric.WithDescription("Current number of todos"),
    metric.WithInt64Callback(func(ctx context.Context, o metric.Int64Observer) error {
        // ここで DB から件数を取得して観測値を記録する
        o.Observe(int64(count), metric.WithAttributes(attribute.String("status", "total")))
        return nil
    }),
)
```

ただし、コールバック内でどうやって DB にアクセスするか工夫が必要です（`TodoHandler` のメソッドとして登録するか、クロージャで `h.db` をキャプチャするか）。

### やってみよう

1. `NewTodoHandler()` の中でゲージを登録する
2. コールバック内で `SELECT COUNT(*) FROM todos` を実行して総数を取得する
3. 完了済み・未完了に分けて `attribute.String("status", "completed")` / `"pending"` で記録する
4. Grafana で `todo_count` を確認する

### 確認方法

```
todo_count{service_name="backend", status="completed"}
todo_count{service_name="backend", status="pending"}
```

<details>
<summary>解答例を見る</summary>

```go
func NewTodoHandler(database *db.DB) *TodoHandler {
    h := &TodoHandler{db: database}

    meter.Int64ObservableGauge(
        "todo.count",
        metric.WithDescription("Current number of todos by status"),
        metric.WithInt64Callback(func(ctx context.Context, o metric.Int64Observer) error {
            var stats TodoStats
            err := h.db.QueryRowContext(ctx, `
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed,
                    SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) AS pending
                FROM todos
            `).Scan(&stats.Total, &stats.Completed, &stats.Pending)
            if err != nil {
                return err
            }
            o.Observe(int64(stats.Total), metric.WithAttributes(attribute.String("status", "total")))
            o.Observe(int64(stats.Completed), metric.WithAttributes(attribute.String("status", "completed")))
            o.Observe(int64(stats.Pending), metric.WithAttributes(attribute.String("status", "pending")))
            return nil
        }),
    )

    return h
}
```
</details>

---

## Exercise 4：フロントエンドに手動スパンを追加する

### 目的

`fetchTodoStats()` の呼び出しに手動スパンを追加し、フロントエンドのトレースに Stats の取得処理を含めます。

### ヒント

`TodoList.tsx` の `load()` 関数が参考になります。フロントエンドでは `@opentelemetry/api` の `trace` と `context` を使います。

```typescript
import { trace, context } from "@opentelemetry/api";

const tracer = trace.getTracer("frontend/TodoStats");

// スパンを開始してコンテキストに設定
const span = tracer.startSpan("TodoStats.load");
const ctx = trace.setSpan(context.active(), span);
try {
    const stats = await context.with(ctx, () => fetchTodoStats());
    // ...
} finally {
    span.end();
}
```

### やってみよう

1. `frontend/src/components/TodoStats.tsx` を開く
2. `@opentelemetry/api` から `trace` と `context` をインポートする
3. `useEffect` 内の `fetchTodoStats()` 呼び出しを手動スパンで囲む
4. ブラウザで Todo アプリを開き、Tempo で `frontend/TodoStats` サービスのトレースを確認する

### 確認方法

- Grafana > Explore > Tempo > Search
- `Service Name = frontend` でトレースを確認
- `TodoStats.load` スパンが表示されることを確認

<details>
<summary>解答例を見る</summary>

```typescript
import { useEffect, useState } from "react";
import { trace, context } from "@opentelemetry/api";
import { TodoStats as TodoStatsType, fetchTodoStats } from "../api/client";

const tracer = trace.getTracer("frontend/TodoStats");

export function TodoStats() {
  const [stats, setStats] = useState<TodoStatsType | null>(null);

  useEffect(() => {
    const span = tracer.startSpan("TodoStats.load");
    const ctx = trace.setSpan(context.active(), span);
    context.with(ctx, () => fetchTodoStats())
      .then((s) => {
        span.setAttribute("todo.total", s.total);
        setStats(s);
      })
      .catch((e) => span.recordException(e))
      .finally(() => span.end());
  }, []);

  // ...以下省略（表示部分は変更なし）
}
```
</details>

---

## Exercise 5：ログを追加してトレースと紐付ける

### 目的

ログにコンテキストを渡すことで、ログとトレースを紐付けます。Grafana で「ログ → トレースへジャンプ」ができる状態を体験しましょう。

### ヒント

**バックエンド（Go）：**

`slog.InfoContext(ctx, ...)` のように `ctx` を渡すと、OTel ログブリッジがトレース ID を自動付与します。

```go
slog.InfoContext(ctx, "stats requested",
    "total", stats.Total,
    "completed", stats.Completed,
)
```

**フロントエンド（TypeScript）：**

`logger.emit()` でログを送信します。`meter` と同様に `tracing.ts` からインポート済みです。

```typescript
import { logger } from "../otel/tracing";
import { SeverityNumber } from "@opentelemetry/api-logs";

logger.emit({
    severityNumber: SeverityNumber.INFO,
    body: "Loaded todo stats",
    attributes: { "todo.total": stats.total },
});
```

### やってみよう

1. **バックエンド**: `Stats()` ハンドラの成功時に `slog.InfoContext(ctx, "stats requested", ...)` を追加する
2. **フロントエンド**: `TodoStats.tsx` の `fetchTodoStats()` 成功時に `logger.emit(...)` を追加する
3. ブラウザで操作後、Grafana > Explore > Loki で `{service_name="backend"}` または `{service_name="frontend"}` を検索する
4. ログの行をクリックし、「Tempo」ボタンでトレースへジャンプできることを確認する

### 確認方法

Loki のログ行に `traceID` フィールドが含まれており、クリックすると対応するトレースに遷移できます。

<details>
<summary>解答例を見る（バックエンド）</summary>

```go
func (h *TodoHandler) Stats(w http.ResponseWriter, r *http.Request) {
    ctx, span := tracer.Start(r.Context(), "todo.Stats")
    defer span.End()

    statsRequestCounter.Add(ctx, 1)

    var stats TodoStats
    err := h.db.QueryRowContext(ctx, `...`).Scan(...)
    if err != nil {
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
        slog.ErrorContext(ctx, "stats query failed", "error", err)
        writeJSON(w, http.StatusInternalServerError, ...)
        return
    }

    span.SetAttributes(
        attribute.Int("todo.total", stats.Total),
        attribute.Int("todo.completed", stats.Completed),
        attribute.Int("todo.pending", stats.Pending),
    )
    slog.InfoContext(ctx, "stats requested",
        "total", stats.Total,
        "completed", stats.Completed,
        "pending", stats.Pending,
    )
    writeJSON(w, http.StatusOK, stats)
}
```
</details>

---

## まとめ

5つの Exercise を通じて、以下を体験しました：

| Exercise | 学んだこと |
|---|---|
| 1 | 手動スパンの追加・属性・エラー記録 |
| 2 | カウンター（イベント数の計測） |
| 3 | ゲージ（時点の値の計測）とコールバック登録 |
| 4 | フロントエンドでの手動スパンとコンテキスト伝播 |
| 5 | ログとトレースの紐付け |

業務では「新しい機能を追加するたびにこれを行う」のが理想です。最初から計装を意識して設計すると、後から追加するよりも自然に組み込めます。

## 次のステップ

- 解答例を参考に全 Exercise を完成させた後、Grafana ダッシュボードに Stats パネルを追加してみましょう
- `todo.count` ゲージを使ったパネルは、リアルタイムの Todo 件数を可視化するのに適しています
