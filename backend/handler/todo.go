package handler

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	"github.com/hidekingerz/otel-practice-env/backend/db"
)

var tracer = otel.Tracer("backend/handler")

type Todo struct {
	ID        int64     `json:"id"`
	Title     string    `json:"title"`
	Completed bool      `json:"completed"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type TodoHandler struct {
	db *db.DB
}

func NewTodoHandler(database *db.DB) *TodoHandler {
	return &TodoHandler{db: database}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("writeJSON", "error", err)
	}
}

func (h *TodoHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "todo.List")
	defer span.End()

	rows, err := h.db.QueryContext(ctx, "SELECT id, title, completed, created_at, updated_at FROM todos ORDER BY id DESC")
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		slog.ErrorContext(ctx, "List query failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
		return
	}
	defer rows.Close()

	todos := []Todo{}
	for rows.Next() {
		var t Todo
		if err := rows.Scan(&t.ID, &t.Title, &t.Completed, &t.CreatedAt, &t.UpdatedAt); err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			slog.ErrorContext(ctx, "List scan failed", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
			return
		}
		todos = append(todos, t)
	}

	span.SetAttributes(attribute.Int("todo.count", len(todos)))
	slog.InfoContext(ctx, "listed todos", "count", len(todos))
	writeJSON(w, http.StatusOK, todos)
}

func (h *TodoHandler) Create(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "todo.Create")
	defer span.End()

	var req struct {
		Title string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Title == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title is required"})
		return
	}

	span.SetAttributes(attribute.String("todo.title", req.Title))

	result, err := h.db.ExecContext(ctx, "INSERT INTO todos (title) VALUES (?)", req.Title)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		slog.ErrorContext(ctx, "Create exec failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
		return
	}

	id, _ := result.LastInsertId()
	span.SetAttributes(attribute.Int64("todo.id", id))

	var t Todo
	if err := h.db.QueryRowContext(ctx, "SELECT id, title, completed, created_at, updated_at FROM todos WHERE id = ?", id).
		Scan(&t.ID, &t.Title, &t.Completed, &t.CreatedAt, &t.UpdatedAt); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		slog.ErrorContext(ctx, "Create fetch failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
		return
	}

	slog.InfoContext(ctx, "created todo", "id", t.ID, "title", t.Title)
	writeJSON(w, http.StatusCreated, t)
}

func (h *TodoHandler) Update(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "todo.Update")
	defer span.End()

	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}
	span.SetAttributes(attribute.Int64("todo.id", id))

	var req struct {
		Title     *string `json:"title"`
		Completed *bool   `json:"completed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	var t Todo
	err = h.db.QueryRowContext(ctx, "SELECT id, title, completed, created_at, updated_at FROM todos WHERE id = ?", id).
		Scan(&t.ID, &t.Title, &t.Completed, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	} else if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		slog.ErrorContext(ctx, "Update fetch failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
		return
	}

	if req.Title != nil {
		t.Title = *req.Title
	}
	if req.Completed != nil {
		t.Completed = *req.Completed
	}

	_, err = h.db.ExecContext(ctx, "UPDATE todos SET title = ?, completed = ? WHERE id = ?", t.Title, t.Completed, t.ID)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		slog.ErrorContext(ctx, "Update exec failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
		return
	}

	if err := h.db.QueryRowContext(ctx, "SELECT id, title, completed, created_at, updated_at FROM todos WHERE id = ?", id).
		Scan(&t.ID, &t.Title, &t.Completed, &t.CreatedAt, &t.UpdatedAt); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		slog.ErrorContext(ctx, "Update re-fetch failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
		return
	}

	slog.InfoContext(ctx, "updated todo", "id", t.ID, "completed", t.Completed)
	writeJSON(w, http.StatusOK, t)
}

func (h *TodoHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracer.Start(r.Context(), "todo.Delete")
	defer span.End()

	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}
	span.SetAttributes(attribute.Int64("todo.id", id))

	result, err := h.db.ExecContext(ctx, "DELETE FROM todos WHERE id = ?", id)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		slog.ErrorContext(ctx, "Delete exec failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
		return
	}

	n, _ := result.RowsAffected()
	if n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}

	slog.InfoContext(ctx, "deleted todo", "id", id)
	w.WriteHeader(http.StatusNoContent)
}
