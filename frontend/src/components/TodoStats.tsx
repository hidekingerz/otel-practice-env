import { useEffect, useState } from "react";
import { trace, context } from "@opentelemetry/api"; // Exercise 4
import { SeverityNumber } from "@opentelemetry/api-logs"; // Exercise 5
import { TodoStats as TodoStatsType, fetchTodoStats } from "../api/client";
import { logger } from "../otel/tracing"; // Exercise 5

const tracer = trace.getTracer("frontend/TodoStats"); // Exercise 4

export function TodoStats() {
  const [stats, setStats] = useState<TodoStatsType | null>(null);

  useEffect(() => {
    // Exercise 4: 手動スパン
    const span = tracer.startSpan("TodoStats.load");
    const ctx = trace.setSpan(context.active(), span);
    context.with(ctx, () => fetchTodoStats())
      .then((s) => {
        span.setAttribute("todo.total", s.total);
        setStats(s);
        // Exercise 5: ログ
        logger.emit({
          severityNumber: SeverityNumber.INFO,
          body: "Loaded todo stats",
          attributes: { "todo.total": s.total, "todo.completed": s.completed },
        });
      })
      .catch((e) => span.recordException(e))
      .finally(() => span.end());
  }, []);

  if (!stats) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: 24,
        padding: "12px 16px",
        background: "#f7f7f7",
        borderRadius: 8,
        marginBottom: 24,
        fontSize: 14,
        color: "#555",
      }}
    >
      <span>Total: <strong>{stats.total}</strong></span>
      <span>Completed: <strong style={{ color: "#38a169" }}>{stats.completed}</strong></span>
      <span>Pending: <strong style={{ color: "#d69e2e" }}>{stats.pending}</strong></span>
    </div>
  );
}
