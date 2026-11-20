package main

import (
	"log/slog"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Port           string
	SupabaseURL    string
	ServiceRoleKey string
	JWTSecret      string
	CORSOrigin     string
	OpenAIKey      string
	EncryptionKey  string // base64, 32 bytes; encrypts user BYO API keys at rest
}

func LoadConfig() Config {
	if err := godotenv.Load(); err != nil {
		slog.Warn("no .env file found, relying on process environment")
	}

	cfg := Config{
		Port:           getenv("PORT", "8080"),
		SupabaseURL:    os.Getenv("SUPABASE_URL"),
		ServiceRoleKey: os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		JWTSecret:      os.Getenv("SUPABASE_JWT_SECRET"),
		CORSOrigin:     getenv("CORS_ORIGIN", "http://localhost:3000"),
		OpenAIKey:      os.Getenv("OPENAI_API_KEY"),
		EncryptionKey:  os.Getenv("ENCRYPTION_KEY"),
	}

	if cfg.SupabaseURL == "" || cfg.ServiceRoleKey == "" {
		slog.Error("missing required Supabase env vars",
			"SUPABASE_URL_set", cfg.SupabaseURL != "",
			"SUPABASE_SERVICE_ROLE_KEY_set", cfg.ServiceRoleKey != "")
		os.Exit(1)
	}

	if cfg.OpenAIKey == "" {
		slog.Warn("OPENAI_API_KEY not set; @AI mentions will reply with a SYSTEM notice instead of a real response")
	}

	if cfg.EncryptionKey == "" {
		slog.Warn("ENCRYPTION_KEY not set; bring-your-own API key storage is disabled (platform agents still work)")
	} else if _, err := masterKey(cfg.EncryptionKey); err != nil {
		slog.Error("ENCRYPTION_KEY is invalid; BYO key storage will fail", "error", err)
	}

	return cfg
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
