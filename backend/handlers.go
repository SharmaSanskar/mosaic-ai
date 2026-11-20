package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

type ctxKey string

const userIDCtxKey ctxKey = "userID"

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// authMiddleware validates the Supabase access token from the Authorization
// header (Bearer) and puts the user id on the request context. Mirrors the WS
// handshake's verifyJWT, but over a normal HTTP header.
func authMiddleware(cfg Config, jwks *JWKSCache) func(http.Handler) http.Handler {
	const prefix = "Bearer "
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authz := r.Header.Get("Authorization")
			if !strings.HasPrefix(authz, prefix) {
				writeError(w, http.StatusUnauthorized, "missing bearer token")
				return
			}
			userID, err := verifyJWT(strings.TrimPrefix(authz, prefix), cfg.JWTSecret, jwks)
			if err != nil {
				slog.Warn("api auth rejected", "error", err)
				writeError(w, http.StatusUnauthorized, "invalid token")
				return
			}
			ctx := context.WithValue(r.Context(), userIDCtxKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func userIDFrom(r *http.Request) string {
	if v, ok := r.Context().Value(userIDCtxKey).(string); ok {
		return v
	}
	return ""
}

func validProvider(p string) bool {
	switch p {
	case "openai", "anthropic", "google":
		return true
	default:
		return false
	}
}

// createKeyHandler encrypts and stores a user's BYO provider API key. The raw key
// is used only to encrypt + derive last4, then discarded; it is never persisted
// in the clear nor echoed back.
func createKeyHandler(sb *SupabaseClient, cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := userIDFrom(r)
		var in struct {
			Provider string `json:"provider"`
			Label    string `json:"label"`
			Key      string `json:"key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		in.Provider = strings.ToLower(strings.TrimSpace(in.Provider))
		in.Key = strings.TrimSpace(in.Key)
		if in.Key == "" || !validProvider(in.Provider) {
			writeError(w, http.StatusBadRequest, "provider and key are required")
			return
		}
		if cfg.EncryptionKey == "" {
			writeError(w, http.StatusServiceUnavailable, "key storage is not configured on the server")
			return
		}

		ciphertext, nonce, err := encryptSecret(cfg.EncryptionKey, in.Key)
		if err != nil {
			slog.Error("failed to encrypt api key", "error", err)
			writeError(w, http.StatusInternalServerError, "could not secure the key")
			return
		}

		safe, err := sb.InsertAPIKey(userID, in.Provider, in.Label, ciphertext, nonce, last4(in.Key))
		if err != nil {
			slog.Error("failed to store api key", "error", err)
			writeError(w, http.StatusBadGateway, "could not store the key")
			return
		}
		writeJSON(w, http.StatusCreated, safe)
	}
}

func listKeysHandler(sb *SupabaseClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		keys, err := sb.ListAPIKeys(userIDFrom(r))
		if err != nil {
			slog.Error("failed to list api keys", "error", err)
			writeError(w, http.StatusBadGateway, "could not load keys")
			return
		}
		if keys == nil {
			keys = []APIKeySafe{}
		}
		writeJSON(w, http.StatusOK, keys)
	}
}

func deleteKeyHandler(sb *SupabaseClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if id == "" {
			writeError(w, http.StatusBadRequest, "missing key id")
			return
		}
		if err := sb.DeleteAPIKey(userIDFrom(r), id); err != nil {
			slog.Error("failed to delete api key", "error", err)
			writeError(w, http.StatusBadGateway, "could not delete the key")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// roomsHandler lists the authenticated user's rooms (must run behind
// authMiddleware so userIDFrom is populated).
func roomsHandler(sb *SupabaseClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rooms, err := sb.ListRoomsForUser(userIDFrom(r))
		if err != nil {
			slog.Error("failed to list rooms", "error", err)
			http.Error(w, `{"error":"failed to fetch rooms"}`, http.StatusBadGateway)
			return
		}
		if rooms == nil {
			rooms = []RoomRecord{}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(rooms)
	}
}
