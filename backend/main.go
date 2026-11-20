package main

import (
	"log/slog"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	cfg := LoadConfig()
	sb := NewSupabaseClient(cfg)
	hub := NewHub(sb, cfg)
	jwks := NewJWKSCache(cfg.SupabaseURL)

	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(structuredLogger)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{cfg.CORSOrigin},
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Content-Type", "Authorization"},
		AllowCredentials: true,
	}))

	r.Get("/health", healthHandler)
	r.Get("/ws", wsHandler(hub, cfg, jwks))

	// Authenticated REST.
	r.Group(func(pr chi.Router) {
		pr.Use(authMiddleware(cfg, jwks))
		pr.Get("/api/rooms", roomsHandler(sb))
		pr.Post("/api/keys", createKeyHandler(sb, cfg))
		pr.Get("/api/keys", listKeysHandler(sb))
		pr.Delete("/api/keys/{id}", deleteKeyHandler(sb))
	})

	slog.Info("Mosaic backend starting", "port", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, r); err != nil {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
