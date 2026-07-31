package main

import (
	"fmt"
	"log/slog"
	"net/http"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
)

// wsHandler upgrades GET /ws?room=<id>&token=<jwt> to a WebSocket connection.
// The Supabase access token is passed as a query param because browsers
// cannot set custom headers during the WebSocket handshake.
func wsHandler(hub *Hub, cfg Config, jwks *JWKSCache) http.HandlerFunc {
	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			return origin == "" || origin == cfg.CORSOrigin
		},
	}

	return func(w http.ResponseWriter, r *http.Request) {
		roomID := r.URL.Query().Get("room")
		token := r.URL.Query().Get("token")
		if roomID == "" || token == "" {
			http.Error(w, `{"error":"room and token query params are required"}`, http.StatusBadRequest)
			return
		}

		userID, err := verifyJWT(token, cfg.JWTSecret, jwks)
		if err != nil {
			slog.Warn("ws auth rejected", "error", err)
			http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			slog.Error("websocket upgrade failed", "error", err)
			return
		}

		room := hub.GetOrCreateRoom(roomID)
		client := &Client{
			room:    room,
			conn:    conn,
			send:    make(chan []byte, 16),
			userID:  userID,
			remote:  r.RemoteAddr,
			limiter: newClientLimiter(),
		}
		room.register <- client

		go client.writePump()
		go client.readPump()
	}
}

// verifyJWT supports both of Supabase's signing modes: the legacy shared
// HS256 secret, and the newer default of asymmetric ES256 keys served over
// JWKS (identified by the token's "kid" header).
func verifyJWT(tokenString, hmacSecret string, jwks *JWKSCache) (string, error) {
	token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		switch t.Method.(type) {
		case *jwt.SigningMethodHMAC:
			return []byte(hmacSecret), nil
		case *jwt.SigningMethodECDSA:
			kid, _ := t.Header["kid"].(string)
			if kid == "" {
				return nil, fmt.Errorf("missing kid header")
			}
			return jwks.Key(kid)
		default:
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
	})
	if err != nil {
		return "", err
	}
	if !token.Valid {
		return "", fmt.Errorf("token not valid")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", fmt.Errorf("unexpected claims type")
	}
	sub, ok := claims["sub"].(string)
	if !ok || sub == "" {
		return "", fmt.Errorf("missing sub claim")
	}
	return sub, nil
}
