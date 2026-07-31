package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func roomsHandler(sb *SupabaseClient) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		rooms, err := sb.ListRooms()
		if err != nil {
			slog.Error("failed to list rooms", "error", err)
			http.Error(w, `{"error":"failed to fetch rooms"}`, http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(rooms)
	}
}
