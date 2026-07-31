package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// WSEvent is the envelope for every message sent over a room's WebSocket,
// in both directions.
type WSEvent struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type SystemPayload struct {
	Message string `json:"message"`
}

type AIChunkPayload struct {
	GenerationID string `json:"generation_id"`
	Chunk        string `json:"chunk"`
	Done         bool   `json:"done"`
}

type StatsPayload struct {
	TotalTokensUsed int64 `json:"total_tokens_used"`
}

// clientMessage is a raw frame received from a client, awaiting processing
// by its room's single owning goroutine.
type clientMessage struct {
	client *Client
	data   []byte
}

// Hub tracks all active rooms. Room lookup/creation is guarded by mu, but
// each Room's own state (clients, etc.) is only ever touched by that
// Room's run() goroutine, so no locking is needed there.
type Hub struct {
	mu    sync.Mutex
	rooms map[string]*Room
	sb    *SupabaseClient
	cfg   Config
}

func NewHub(sb *SupabaseClient, cfg Config) *Hub {
	return &Hub{
		rooms: make(map[string]*Room),
		sb:    sb,
		cfg:   cfg,
	}
}

func (h *Hub) GetOrCreateRoom(roomID string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()

	if room, ok := h.rooms[roomID]; ok {
		return room
	}

	room := &Room{
		id:         roomID,
		clients:    make(map[*Client]bool),
		broadcast:  make(chan clientMessage, 32),
		outgoing:   make(chan []byte, 32),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		sb:         h.sb,
		cfg:        h.cfg,
	}
	h.rooms[roomID] = room
	go room.run()
	return room
}

// Room owns one chat room's live client set. All fields except aiBusy are
// only ever accessed from within run(), which is the single goroutine that
// mutates this room's state — this is what keeps it race-free. Code outside
// run() (like the AI streaming goroutine) must send frames via outgoing
// rather than touching clients directly.
type Room struct {
	id         string
	clients    map[*Client]bool
	broadcast  chan clientMessage
	outgoing   chan []byte
	register   chan *Client
	unregister chan *Client
	sb         *SupabaseClient
	cfg        Config
	aiBusy     sync.Mutex
}

func (r *Room) run() {
	for {
		select {
		case c := <-r.register:
			r.clients[c] = true
			slog.Info("client joined room", "room", r.id, "user", c.userID)

		case c := <-r.unregister:
			if _, ok := r.clients[c]; ok {
				delete(r.clients, c)
				close(c.send)
				slog.Info("client left room", "room", r.id, "user", c.userID)
			}

		case msg := <-r.broadcast:
			r.handleIncoming(msg)

		case data := <-r.outgoing:
			r.broadcastAll(data)
		}
	}
}

func (r *Room) handleIncoming(msg clientMessage) {
	var evt WSEvent
	if err := json.Unmarshal(msg.data, &evt); err != nil {
		slog.Warn("dropping malformed ws frame", "room", r.id, "error", err)
		return
	}

	switch evt.Type {
	case "CHAT":
		r.handleChat(msg.client, evt.Payload)
	case "PIN_ARTIFACT":
		r.handlePinArtifact(evt.Payload)
	case "UNPIN_ARTIFACT":
		r.handleUnpinArtifact(evt.Payload)
	default:
		slog.Warn("unhandled ws event type", "room", r.id, "type", evt.Type)
	}
}

func (r *Room) handlePinArtifact(payload json.RawMessage) {
	var in struct {
		MessageID string `json:"message_id"`
		Content   string `json:"content"`
		Author    string `json:"author"`
	}
	if err := json.Unmarshal(payload, &in); err != nil || in.MessageID == "" || in.Content == "" {
		slog.Warn("dropping malformed PIN_ARTIFACT payload", "room", r.id)
		return
	}

	artifacts, err := r.sb.GetRoomArtifacts(r.id)
	if err != nil {
		slog.Error("failed to load artifacts", "room", r.id, "error", err)
		return
	}

	for _, a := range artifacts {
		if a.ID == in.MessageID {
			return // already pinned
		}
	}

	artifacts = append(artifacts, Artifact{
		ID:        in.MessageID,
		Content:   in.Content,
		Author:    in.Author,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})

	r.persistAndBroadcastArtifacts(artifacts)
}

func (r *Room) handleUnpinArtifact(payload json.RawMessage) {
	var in struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(payload, &in); err != nil || in.ID == "" {
		slog.Warn("dropping malformed UNPIN_ARTIFACT payload", "room", r.id)
		return
	}

	artifacts, err := r.sb.GetRoomArtifacts(r.id)
	if err != nil {
		slog.Error("failed to load artifacts", "room", r.id, "error", err)
		return
	}

	filtered := make([]Artifact, 0, len(artifacts))
	for _, a := range artifacts {
		if a.ID != in.ID {
			filtered = append(filtered, a)
		}
	}

	r.persistAndBroadcastArtifacts(filtered)
}

func (r *Room) persistAndBroadcastArtifacts(artifacts []Artifact) {
	if err := r.sb.UpdateRoomArtifacts(r.id, artifacts); err != nil {
		slog.Error("failed to persist artifacts", "room", r.id, "error", err)
		return
	}

	payload, err := json.Marshal(artifacts)
	if err != nil {
		return
	}
	out, err := json.Marshal(WSEvent{Type: "ARTIFACT_UPDATE", Payload: payload})
	if err != nil {
		return
	}
	r.broadcastAll(out)
}

func (r *Room) handleChat(from *Client, payload json.RawMessage) {
	var in struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(payload, &in); err != nil {
		slog.Warn("dropping malformed CHAT payload", "room", r.id, "error", err)
		return
	}
	content := strings.TrimSpace(in.Content)
	if content == "" {
		return
	}

	saved, err := r.sb.InsertMessage(r.id, from.userID, content)
	if err != nil {
		slog.Error("failed to persist message", "room", r.id, "error", err)
		return
	}

	payloadBytes, err := json.Marshal(saved)
	if err != nil {
		slog.Error("failed to marshal chat payload", "error", err)
		return
	}
	out, err := json.Marshal(WSEvent{Type: "CHAT", Payload: payloadBytes})
	if err != nil {
		slog.Error("failed to marshal ws event", "error", err)
		return
	}

	r.broadcastAll(out)

	if strings.Contains(strings.ToLower(content), "@ai") {
		go r.triggerAI()
	}
}

// triggerAI runs on its own goroutine (not the room's run() loop, since the
// OpenAI call is slow) and must only touch client state via r.outgoing.
func (r *Room) triggerAI() {
	if !r.aiBusy.TryLock() {
		r.sendSystem("AI is already thinking… try again in a moment.")
		return
	}
	defer r.aiBusy.Unlock()

	if r.cfg.OpenAIKey == "" {
		r.sendSystem("AI is not configured (missing OPENAI_API_KEY).")
		return
	}

	history, err := r.sb.ListRecentMessages(r.id, 20)
	if err != nil {
		slog.Error("failed to load history for AI", "room", r.id, "error", err)
		r.sendSystem("Couldn't load conversation history for the AI.")
		return
	}

	generationID := randomID()
	var full strings.Builder

	tokens, err := streamAIResponse(context.Background(), r.cfg.OpenAIKey, history, func(delta string) {
		full.WriteString(delta)
		r.sendAIChunk(generationID, delta, false)
	})

	r.sendAIChunk(generationID, "", true)
	r.reportTokenUsage(tokens) // record usage regardless of outcome below — tokens were spent either way

	if err != nil {
		slog.Error("openai stream failed", "room", r.id, "error", err)
		r.sendSystem("AI response failed: " + err.Error())
		return
	}
	if full.Len() == 0 {
		return
	}

	if _, err := r.sb.InsertMessage(r.id, "AI", full.String()); err != nil {
		slog.Error("failed to persist AI message", "room", r.id, "error", err)
		return
	}

	// Fire-and-forget: the reasoning graph is a nice-to-have derived view,
	// not on the critical path for chat, so it gets its own goroutine and
	// doesn't hold aiBusy (a slow/failed graph call shouldn't block the next
	// @AI mention).
	fullHistory := append(history, Message{UserID: "AI", Content: full.String()})
	go r.updateGraph(fullHistory)
}

// updateGraph runs on its own goroutine and must only touch client state via
// r.outgoing, same constraint as triggerAI.
func (r *Room) updateGraph(history []Message) {
	graph, tokens, err := generateGraph(context.Background(), r.cfg.OpenAIKey, history)
	r.reportTokenUsage(tokens) // record usage regardless of outcome below — tokens were spent either way
	if err != nil {
		slog.Warn("discarding malformed graph response", "room", r.id, "error", err)
		return
	}

	if err := r.sb.UpdateRoomGraph(r.id, *graph); err != nil {
		slog.Error("failed to persist graph", "room", r.id, "error", err)
		return
	}

	payload, err := json.Marshal(graph)
	if err != nil {
		return
	}
	out, err := json.Marshal(WSEvent{Type: "GRAPH_UPDATE", Payload: payload})
	if err != nil {
		return
	}
	r.outgoing <- out
}

func (r *Room) sendSystem(message string) {
	payload, err := json.Marshal(SystemPayload{Message: message})
	if err != nil {
		return
	}
	out, err := json.Marshal(WSEvent{Type: "SYSTEM", Payload: payload})
	if err != nil {
		return
	}
	r.outgoing <- out
}

func (r *Room) sendAIChunk(generationID, chunk string, done bool) {
	payload, err := json.Marshal(AIChunkPayload{GenerationID: generationID, Chunk: chunk, Done: done})
	if err != nil {
		return
	}
	out, err := json.Marshal(WSEvent{Type: "AI_CHUNK", Payload: payload})
	if err != nil {
		return
	}
	r.outgoing <- out
}

// reportTokenUsage increments the room's persisted total and broadcasts the
// new value. Called from triggerAI/updateGraph, so it must go through
// r.outgoing rather than touching client state directly.
func (r *Room) reportTokenUsage(tokens int64) {
	if tokens <= 0 {
		return
	}

	newTotal, err := r.sb.IncrementRoomTokens(r.id, tokens)
	if err != nil {
		slog.Error("failed to increment token usage", "room", r.id, "error", err)
		return
	}

	payload, err := json.Marshal(StatsPayload{TotalTokensUsed: newTotal})
	if err != nil {
		return
	}
	out, err := json.Marshal(WSEvent{Type: "STATS", Payload: payload})
	if err != nil {
		return
	}
	r.outgoing <- out
}

func (r *Room) broadcastAll(data []byte) {
	for c := range r.clients {
		select {
		case c.send <- data:
		default:
			// Slow consumer; drop it rather than block the room's loop.
			close(c.send)
			delete(r.clients, c)
		}
	}
}
