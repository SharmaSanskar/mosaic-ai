package main

import (
	"encoding/json"
	"log/slog"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/time/rate"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 8192

	// Rate limit for inbound WS messages per connection: sustained ~1/sec
	// with bursts up to 5, so normal chatting is unaffected but spam trips it.
	rateLimitPerSecond = 1
	rateLimitBurst     = 5
)

// Client is one connected browser tab. Its own goroutines (readPump,
// writePump) never touch Room state directly — they hand raw frames to the
// room's broadcast channel and read outgoing frames from send.
type Client struct {
	room    *Room
	conn    *websocket.Conn
	send    chan []byte
	userID  string
	remote  string
	limiter *rate.Limiter
}

func newClientLimiter() *rate.Limiter {
	return rate.NewLimiter(rate.Limit(rateLimitPerSecond), rateLimitBurst)
}

func (c *Client) readPump() {
	defer func() {
		c.room.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				slog.Warn("websocket read error", "user", c.userID, "error", err)
			}
			return
		}

		if !c.limiter.Allow() {
			slog.Warn("rate limit exceeded", "user", c.userID, "remote", c.remote)
			c.sendRateLimitWarning()
			continue
		}

		c.room.broadcast <- clientMessage{client: c, data: data}
	}
}

// sendRateLimitWarning notifies only this client — it never touches Room
// state, so it's safe to call directly from readPump's own goroutine.
func (c *Client) sendRateLimitWarning() {
	payload, err := json.Marshal(SystemPayload{Message: "You're sending messages too fast — slow down a little."})
	if err != nil {
		return
	}
	out, err := json.Marshal(WSEvent{Type: "SYSTEM", Payload: payload})
	if err != nil {
		return
	}
	select {
	case c.send <- out:
	default:
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case data, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
