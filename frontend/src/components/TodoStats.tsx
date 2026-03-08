import { useEffect, useState } from "react";
import { TodoStats as TodoStatsType, fetchTodoStats } from "../api/client";

// NOTE: このコンポーネントには意図的に OTel 計装を入れていません。
// ハンズオン練習 (docs/tutorials/hands-on-instrumentation.md) で自分で追加してみましょう。
export function TodoStats() {
  const [stats, setStats] = useState<TodoStatsType | null>(null);

  useEffect(() => {
    fetchTodoStats().then(setStats).catch(console.error);
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
