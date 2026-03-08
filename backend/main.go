package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/hidekingerz/otel-practice-env/backend/db"
	"github.com/hidekingerz/otel-practice-env/backend/handler"
	telemetry "github.com/hidekingerz/otel-practice-env/backend/otel"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// OTel SDK の初期化
	shutdown, err := telemetry.Setup(ctx)
	if err != nil {
		slog.Error("failed to setup telemetry", "error", err)
		os.Exit(1)
	}
	defer func() {
		if err := shutdown(context.Background()); err != nil {
			slog.Error("telemetry shutdown error", "error", err)
		}
	}()

	// slog をOTel ログブリッジに接続
	logger := otelslog.NewLogger("backend")
	slog.SetDefault(logger)

	// DB 接続
	dsn := os.Getenv("DB_DSN")
	if dsn == "" {
		dsn = "appuser:apppassword@tcp(db:3306)/app?parseTime=true"
	}
	database, err := db.New(dsn)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer database.Close()

	todoHandler := handler.NewTodoHandler(database)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/todos/stats", todoHandler.Stats)
	mux.HandleFunc("GET /api/todos", todoHandler.List)
	mux.HandleFunc("POST /api/todos", todoHandler.Create)
	mux.HandleFunc("PUT /api/todos/{id}", todoHandler.Update)
	mux.HandleFunc("DELETE /api/todos/{id}", todoHandler.Delete)

	// HTTP リクエストを otelhttp で自動計装
	httpHandler := otelhttp.NewHandler(mux, "backend",
		otelhttp.WithMessageEvents(otelhttp.ReadEvents, otelhttp.WriteEvents),
	)

	srv := &http.Server{
		Addr:    ":8080",
		Handler: httpHandler,
	}

	slog.Info("server starting", "addr", srv.Addr)
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down server")
	srv.Shutdown(context.Background())
}
