import { useEffect, useState } from "react";
import { trace, context } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import {
  Todo,
  fetchTodos,
  createTodo,
  updateTodo,
  deleteTodo,
} from "../api/client";
import { meter, logger } from "../otel/tracing";
import { TodoStats } from "./TodoStats";

// カスタムメトリクス
const todoCreatedCounter = meter.createCounter("todo.created", {
  description: "Number of todos created",
});
const todoDeletedCounter = meter.createCounter("todo.deleted", {
  description: "Number of todos deleted",
});
const todoToggleCounter = meter.createCounter("todo.toggled", {
  description: "Number of todo completion toggles",
});
const apiDurationHistogram = meter.createHistogram("todo.api.duration", {
  description: "API call duration in milliseconds",
  unit: "ms",
});

const tracer = trace.getTracer("frontend/TodoList");

export function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const span = tracer.startSpan("TodoList.load");
    const ctx = trace.setSpan(context.active(), span);
    const start = Date.now();
    try {
      setLoading(true);
      const todos = await context.with(ctx, () => fetchTodos());
      setTodos(todos);
      span.setAttribute("todo.count", todos.length);
      apiDurationHistogram.record(Date.now() - start, { operation: "list" });
      logger.emit({
        severityNumber: SeverityNumber.INFO,
        body: "Loaded todos",
        attributes: { "todo.count": todos.length },
      });
      setError(null);
    } catch (e) {
      span.recordException(e as Error);
      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        body: "Failed to load todos",
        attributes: { error: String(e) },
      });
      setError(String(e));
    } finally {
      span.end();
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    const span = tracer.startSpan("TodoList.create");
    const ctx = trace.setSpan(context.active(), span);
    const start = Date.now();
    try {
      span.setAttribute("todo.title", input.trim());
      const todo = await context.with(ctx, () => createTodo(input.trim()));
      setTodos((prev) => [todo, ...prev]);
      setInput("");
      todoCreatedCounter.add(1);
      apiDurationHistogram.record(Date.now() - start, { operation: "create" });
      logger.emit({
        severityNumber: SeverityNumber.INFO,
        body: "Created todo",
        attributes: { "todo.id": todo.id, "todo.title": todo.title },
      });
      setError(null);
    } catch (e) {
      span.recordException(e as Error);
      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        body: "Failed to create todo",
        attributes: { error: String(e) },
      });
      setError(String(e));
    } finally {
      span.end();
    }
  }

  async function handleToggle(todo: Todo) {
    const span = tracer.startSpan("TodoList.toggle");
    const ctx = trace.setSpan(context.active(), span);
    const start = Date.now();
    try {
      span.setAttribute("todo.id", todo.id);
      span.setAttribute("todo.completed.before", todo.completed);
      const updated = await context.with(ctx, () =>
        updateTodo(todo.id, { completed: !todo.completed })
      );
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? updated : t)));
      todoToggleCounter.add(1, { completed: String(!todo.completed) });
      apiDurationHistogram.record(Date.now() - start, { operation: "update" });
      logger.emit({
        severityNumber: SeverityNumber.INFO,
        body: "Toggled todo",
        attributes: { "todo.id": todo.id, "todo.completed": !todo.completed },
      });
      setError(null);
    } catch (e) {
      span.recordException(e as Error);
      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        body: "Failed to toggle todo",
        attributes: { error: String(e) },
      });
      setError(String(e));
    } finally {
      span.end();
    }
  }

  async function handleDelete(id: number) {
    const span = tracer.startSpan("TodoList.delete");
    const ctx = trace.setSpan(context.active(), span);
    const start = Date.now();
    try {
      span.setAttribute("todo.id", id);
      await context.with(ctx, () => deleteTodo(id));
      setTodos((prev) => prev.filter((t) => t.id !== id));
      todoDeletedCounter.add(1);
      apiDurationHistogram.record(Date.now() - start, { operation: "delete" });
      logger.emit({
        severityNumber: SeverityNumber.INFO,
        body: "Deleted todo",
        attributes: { "todo.id": id },
      });
      setError(null);
    } catch (e) {
      span.recordException(e as Error);
      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        body: "Failed to delete todo",
        attributes: { error: String(e) },
      });
      setError(String(e));
    } finally {
      span.end();
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h1>Todo App</h1>

      <TodoStats />

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="New todo..."
          style={{ flex: 1, padding: "8px 12px", fontSize: 16 }}
        />
        <button type="submit" style={{ padding: "8px 16px", fontSize: 16 }}>
          Add
        </button>
      </form>

      {error && (
        <p style={{ color: "red" }}>{error}</p>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {todos.map((todo) => (
            <li
              key={todo.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 0",
                borderBottom: "1px solid #eee",
              }}
            >
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => handleToggle(todo)}
                style={{ width: 18, height: 18, cursor: "pointer" }}
              />
              <span
                style={{
                  flex: 1,
                  fontSize: 16,
                  textDecoration: todo.completed ? "line-through" : "none",
                  color: todo.completed ? "#999" : "#000",
                }}
              >
                {todo.title}
              </span>
              <button
                onClick={() => handleDelete(todo.id)}
                style={{
                  padding: "4px 10px",
                  background: "#e53e3e",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Delete
              </button>
            </li>
          ))}
          {todos.length === 0 && <p style={{ color: "#999" }}>No todos yet.</p>}
        </ul>
      )}
    </div>
  );
}
