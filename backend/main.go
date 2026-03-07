package main

import (
	"log"
	"net/http"
	"os"

	"github.com/hidekingerz/otel-practice-env/backend/db"
	"github.com/hidekingerz/otel-practice-env/backend/handler"
)

func main() {
	dsn := os.Getenv("DB_DSN")
	if dsn == "" {
		dsn = "appuser:apppassword@tcp(db:3306)/app?parseTime=true"
	}

	database, err := db.New(dsn)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer database.Close()

	todoHandler := handler.NewTodoHandler(database)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/todos", todoHandler.List)
	mux.HandleFunc("POST /api/todos", todoHandler.Create)
	mux.HandleFunc("PUT /api/todos/{id}", todoHandler.Update)
	mux.HandleFunc("DELETE /api/todos/{id}", todoHandler.Delete)

	addr := ":8080"
	log.Printf("server starting on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
