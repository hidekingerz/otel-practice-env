export interface Todo {
  id: number;
  title: string;
  completed: boolean;
  created_at: string;
  updated_at: string;
}

const BASE = "/api";

export async function fetchTodos(): Promise<Todo[]> {
  const res = await fetch(`${BASE}/todos`);
  if (!res.ok) throw new Error(`fetchTodos: ${res.status}`);
  return res.json();
}

export async function createTodo(title: string): Promise<Todo> {
  const res = await fetch(`${BASE}/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`createTodo: ${res.status}`);
  return res.json();
}

export async function updateTodo(
  id: number,
  patch: { title?: string; completed?: boolean }
): Promise<Todo> {
  const res = await fetch(`${BASE}/todos/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`updateTodo: ${res.status}`);
  return res.json();
}

export async function deleteTodo(id: number): Promise<void> {
  const res = await fetch(`${BASE}/todos/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`deleteTodo: ${res.status}`);
}
