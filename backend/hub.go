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
	AgentID      string `json:"agent_id"`
	AgentName    string `json:"agent_name"`
	AgentColor   string `json:"agent_color,omitempty"`
	Chunk        string `json:"chunk"`
	Done         bool   `json:"done"`
}

type StatsPayload struct {
	TotalTokensUsed int64 `json:"total_tokens_used"`
}

type PresencePayload struct {
	Users []string `json:"users"`
}

type TypingPayload struct {
	UserID   string `json:"user_id"`
	IsTyping bool   `json:"is_typing"`
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
		aiBusy:     make(map[string]bool),
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

	// aiBusy serializes generation per agent (not per room), so distinct agents
	// can reply concurrently while a single agent can't be double-triggered.
	// Guarded by aiMu.
	aiMu   sync.Mutex
	aiBusy map[string]bool
}

func (r *Room) run() {
	for {
		select {
		case c := <-r.register:
			r.clients[c] = true
			slog.Info("client joined room", "room", r.id, "user", c.userID)
			r.broadcastPresence()

		case c := <-r.unregister:
			if _, ok := r.clients[c]; ok {
				delete(r.clients, c)
				close(c.send)
				slog.Info("client left room", "room", r.id, "user", c.userID)
				r.broadcastPresence()
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
	case EventChat:
		r.handleChat(msg.client, evt.Payload)
	case EventPinArtifact:
		r.handlePinArtifact(evt.Payload)
	case EventPinIdea:
		r.handlePinIdea(evt.Payload)
	case EventPinDiagram:
		r.handlePinDiagram(evt.Payload)
	case EventAddNote:
		r.handleAddNote(msg.client, evt.Payload)
	case EventReorderArtifact:
		r.handleReorderArtifacts(evt.Payload)
	case EventUnpinArtifact:
		r.handleUnpinArtifact(evt.Payload)
	case EventVizRepair:
		r.handleVizRepair(evt.Payload)
	case EventTyping:
		r.handleTyping(msg.client, evt.Payload)
	case EventAgentsChanged:
		// A client changed this room's agents (via Supabase); fan out a nudge so
		// everyone re-fetches. No payload is needed.
		if out, err := json.Marshal(WSEvent{Type: EventAgentsUpdate, Payload: json.RawMessage(`{}`)}); err == nil {
			r.broadcastAll(out)
		}
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

// handlePinIdea turns a chat message into an AI-distilled idea card. The distill
// is a (slow) model call, so it runs on its own goroutine and broadcasts via
// r.outgoing (persistAndBroadcastArtifacts now routes through the channel). The
// source message id becomes the card id, so re-saving the same message is a no-op.
func (r *Room) handlePinIdea(payload json.RawMessage) {
	var in struct {
		MessageID string `json:"message_id"`
		Content   string `json:"content"`
		Author    string `json:"author"`
	}
	if err := json.Unmarshal(payload, &in); err != nil || in.MessageID == "" || strings.TrimSpace(in.Content) == "" {
		slog.Warn("dropping malformed PIN_IDEA payload", "room", r.id)
		return
	}
	if r.cfg.OpenAIKey == "" {
		r.sendSystem("Can't distill ideas — no OpenAI key configured.")
		return
	}
	go r.runPinIdea(in.MessageID, in.Content, in.Author)
}

func (r *Room) runPinIdea(messageID, content, author string) {
	card, tokens, err := distillIdea(context.Background(), r.cfg.OpenAIKey, content)
	r.reportTokenUsage(tokens) // tokens were spent regardless of outcome
	if err != nil {
		slog.Warn("idea distill failed", "room", r.id, "error", err)
		r.sendSystem("Couldn't save that as an idea — please try again.")
		return
	}

	artifacts, err := r.sb.GetRoomArtifacts(r.id)
	if err != nil {
		slog.Error("failed to load artifacts", "room", r.id, "error", err)
		return
	}
	for _, a := range artifacts {
		if a.ID == messageID {
			return // this message is already saved as an idea
		}
	}

	artifacts = append(artifacts, Artifact{
		ID:        messageID,
		Kind:      "idea",
		Title:     card.Title,
		Content:   card.Summary,
		Source:    content, // keep the original message for the card's detail view
		Author:    author,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})
	r.persistAndBroadcastArtifacts(artifacts)
}

// handlePinDiagram snapshots the current visualization as a diagram card. No model
// call — it freezes Mermaid source the client already rendered — so it runs inline
// on the run() loop.
func (r *Room) handlePinDiagram(payload json.RawMessage) {
	var in struct {
		Title       string `json:"title"`
		DiagramType string `json:"diagram_type"`
		Mermaid     string `json:"mermaid"`
	}
	if err := json.Unmarshal(payload, &in); err != nil || strings.TrimSpace(in.Mermaid) == "" {
		slog.Warn("dropping malformed PIN_DIAGRAM payload", "room", r.id)
		return
	}

	artifacts, err := r.sb.GetRoomArtifacts(r.id)
	if err != nil {
		slog.Error("failed to load artifacts", "room", r.id, "error", err)
		return
	}

	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = "Saved diagram"
	}
	artifacts = append(artifacts, Artifact{
		ID:          randomID(),
		Kind:        "diagram",
		Title:       title,
		Mermaid:     in.Mermaid,
		DiagramType: in.DiagramType,
		Author:      "AI",
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	})
	r.persistAndBroadcastArtifacts(artifacts)
}

// handleAddNote adds a free-text note card authored by the human who typed it. No
// model call, so it runs inline on the run() loop.
func (r *Room) handleAddNote(from *Client, payload json.RawMessage) {
	var in struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(payload, &in); err != nil {
		slog.Warn("dropping malformed ADD_NOTE payload", "room", r.id)
		return
	}
	content := strings.TrimSpace(in.Content)
	if content == "" {
		return
	}

	artifacts, err := r.sb.GetRoomArtifacts(r.id)
	if err != nil {
		slog.Error("failed to load artifacts", "room", r.id, "error", err)
		return
	}

	artifacts = append(artifacts, Artifact{
		ID:        randomID(),
		Kind:      "note",
		Content:   content,
		Author:    from.userID,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})
	r.persistAndBroadcastArtifacts(artifacts)
}

// handleReorderArtifacts reorders the moodboard to match the given id order. Any
// ids not present are ignored, and any current artifacts missing from the list are
// appended (so a concurrent add isn't dropped). No model call — runs inline.
func (r *Room) handleReorderArtifacts(payload json.RawMessage) {
	var in struct {
		IDs []string `json:"ids"`
	}
	if err := json.Unmarshal(payload, &in); err != nil {
		slog.Warn("dropping malformed REORDER_ARTIFACTS payload", "room", r.id)
		return
	}

	artifacts, err := r.sb.GetRoomArtifacts(r.id)
	if err != nil {
		slog.Error("failed to load artifacts", "room", r.id, "error", err)
		return
	}

	byID := make(map[string]Artifact, len(artifacts))
	for _, a := range artifacts {
		byID[a.ID] = a
	}

	ordered := make([]Artifact, 0, len(artifacts))
	placed := make(map[string]bool, len(artifacts))
	for _, id := range in.IDs {
		if a, ok := byID[id]; ok && !placed[id] {
			ordered = append(ordered, a)
			placed[id] = true
		}
	}
	// Preserve any artifacts the client didn't know about (e.g. a concurrent add).
	for _, a := range artifacts {
		if !placed[a.ID] {
			ordered = append(ordered, a)
		}
	}

	r.persistAndBroadcastArtifacts(ordered)
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
	out, err := json.Marshal(WSEvent{Type: EventArtifactUpdate, Payload: payload})
	if err != nil {
		return
	}
	// Sent via r.outgoing (not broadcastAll) so this is safe to call from a
	// goroutine (handlePinIdea) as well as from the run() loop — same pattern as
	// persistAndBroadcastViz.
	r.outgoing <- out
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
	out, err := json.Marshal(WSEvent{Type: EventChat, Payload: payloadBytes})
	if err != nil {
		slog.Error("failed to marshal ws event", "error", err)
		return
	}

	r.broadcastAll(out)

	if strings.Contains(content, "@") {
		go r.handleMentions(content)
	}
}

// handleMentions resolves the @handles in a message to agents available in the
// room and triggers each matched agent on its own goroutine, so several agents
// can reply to the same message concurrently. "@ai" is a backward-compatible
// alias for the room's default agent.
func (r *Room) handleMentions(content string) {
	handles := parseMentions(content)
	if len(handles) == 0 {
		return
	}

	agents, err := r.sb.GetRoomAgents(r.id)
	if err != nil {
		slog.Error("failed to load room agents", "room", r.id, "error", err)
		return
	}
	if len(agents) == 0 {
		return
	}

	byHandle := make(map[string]Agent, len(agents))
	defaultAgent := agents[0]
	for _, a := range agents {
		byHandle[strings.ToLower(a.Handle)] = a
		if strings.EqualFold(a.Handle, "assistant") {
			defaultAgent = a
		}
	}

	triggered := make(map[string]bool, len(handles))
	for _, h := range handles {
		agent, ok := byHandle[h]
		if h == "ai" { // backward-compatible alias for the default agent
			agent, ok = defaultAgent, true
		}
		if !ok || triggered[agent.ID] {
			continue
		}
		triggered[agent.ID] = true
		go r.triggerAgent(agent)
	}
}

// triggerAgent runs one agent's reply on its own goroutine (not the room's run()
// loop, since the model call is slow) and must only touch client state via
// r.outgoing. Generation is serialized per agent via r.aiBusy.
func (r *Room) triggerAgent(agent Agent) {
	r.aiMu.Lock()
	if r.aiBusy[agent.ID] {
		r.aiMu.Unlock()
		r.sendSystem(agent.Name + " is already thinking… try again in a moment.")
		return
	}
	r.aiBusy[agent.ID] = true
	r.aiMu.Unlock()
	defer func() {
		r.aiMu.Lock()
		delete(r.aiBusy, agent.ID)
		r.aiMu.Unlock()
	}()

	provider, err := providerFor(agent, r.cfg, r.sb)
	if err != nil {
		r.sendSystem(agent.Name + " is unavailable: " + err.Error())
		return
	}

	history, err := r.sb.ListRecentMessages(r.id, 20)
	if err != nil {
		slog.Error("failed to load history for agent", "room", r.id, "agent", agent.Handle, "error", err)
		r.sendSystem("Couldn't load conversation history for " + agent.Name + ".")
		return
	}

	systemPrompt := agent.SystemPrompt
	if systemPrompt == "" {
		systemPrompt = defaultAgentSystemPrompt
	}

	generationID := randomID()
	var full strings.Builder

	tokens, err := provider.StreamChat(context.Background(), ChatRequest{
		Model:        agent.Model,
		SystemPrompt: systemPrompt,
		History:      history,
		MaxTokens:    300,
	}, func(delta string) {
		full.WriteString(delta)
		r.sendAIChunk(generationID, agent, delta, false)
	})

	r.sendAIChunk(generationID, agent, "", true)
	r.reportTokenUsage(tokens) // record usage regardless of outcome below — tokens were spent either way

	if err != nil {
		slog.Error("agent stream failed", "room", r.id, "agent", agent.Handle, "error", err)
		r.sendSystem(agent.Name + " couldn't respond: " + err.Error())
		return
	}
	if full.Len() == 0 {
		return
	}

	if _, err := r.sb.InsertMessage(r.id, agentAuthorID(agent), full.String()); err != nil {
		slog.Error("failed to persist agent message", "room", r.id, "agent", agent.Handle, "error", err)
		return
	}

	// Fire-and-forget: the visualization is a nice-to-have derived view, not
	// on the critical path for chat, so it gets its own goroutine and doesn't
	// hold aiBusy (a slow/failed viz call shouldn't block the next mention).
	fullHistory := append(history, Message{UserID: agentAuthorID(agent), Content: full.String()})
	go r.updateViz(fullHistory)
}

// updateViz runs on its own goroutine and must only touch client state via
// r.outgoing, same constraint as triggerAgent. It asks the model to represent the
// conversation as whichever Mermaid diagram best fits it.
func (r *Room) updateViz(history []Message) {
	viz, tokens, err := generateViz(context.Background(), r.cfg.OpenAIKey, history)
	r.reportTokenUsage(tokens) // record usage regardless of outcome below — tokens were spent either way
	if err != nil {
		slog.Warn("discarding malformed viz response", "room", r.id, "error", err)
		return
	}
	r.persistAndBroadcastViz(viz)
}

// handleVizRepair is invoked from the room's run() loop when a client reports
// that the current Mermaid source failed to parse in the browser. The OpenAI
// call is slow, so the actual work is offloaded to its own goroutine (which
// must only touch client state via r.outgoing).
func (r *Room) handleVizRepair(payload json.RawMessage) {
	var in struct {
		Code  string `json:"code"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(payload, &in); err != nil || strings.TrimSpace(in.Code) == "" {
		slog.Warn("dropping malformed VIZ_REPAIR payload", "room", r.id)
		return
	}
	if r.cfg.OpenAIKey == "" {
		return
	}
	go r.runVizRepair(in.Code, in.Error)
}

func (r *Room) runVizRepair(brokenCode, parseError string) {
	viz, tokens, err := repairViz(context.Background(), r.cfg.OpenAIKey, brokenCode, parseError)
	r.reportTokenUsage(tokens)
	if err != nil {
		slog.Warn("viz repair failed", "room", r.id, "error", err)
		return
	}
	r.persistAndBroadcastViz(viz)
}

func (r *Room) persistAndBroadcastViz(viz *VizState) {
	if err := r.sb.UpdateRoomViz(r.id, *viz); err != nil {
		slog.Error("failed to persist viz", "room", r.id, "error", err)
		return
	}

	payload, err := json.Marshal(viz)
	if err != nil {
		return
	}
	out, err := json.Marshal(WSEvent{Type: EventVizUpdate, Payload: payload})
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
	out, err := json.Marshal(WSEvent{Type: EventSystem, Payload: payload})
	if err != nil {
		return
	}
	r.outgoing <- out
}

func (r *Room) sendAIChunk(generationID string, agent Agent, chunk string, done bool) {
	payload, err := json.Marshal(AIChunkPayload{
		GenerationID: generationID,
		AgentID:      agent.ID,
		AgentName:    agent.Name,
		AgentColor:   agent.Color,
		Chunk:        chunk,
		Done:         done,
	})
	if err != nil {
		return
	}
	out, err := json.Marshal(WSEvent{Type: EventAIChunk, Payload: payload})
	if err != nil {
		return
	}
	r.outgoing <- out
}

// reportTokenUsage increments the room's persisted total and broadcasts the
// new value. Called from triggerAgent/updateViz, so it must go through
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
	out, err := json.Marshal(WSEvent{Type: EventStats, Payload: payload})
	if err != nil {
		return
	}
	r.outgoing <- out
}

// broadcastPresence sends the deduplicated set of connected user ids to the
// room. Called only from run() (which owns r.clients), so it reads the map
// directly.
func (r *Room) broadcastPresence() {
	seen := make(map[string]bool, len(r.clients))
	users := make([]string, 0, len(r.clients))
	for c := range r.clients {
		if !seen[c.userID] {
			seen[c.userID] = true
			users = append(users, c.userID)
		}
	}

	payload, err := json.Marshal(PresencePayload{Users: users})
	if err != nil {
		return
	}
	out, err := json.Marshal(WSEvent{Type: EventPresence, Payload: payload})
	if err != nil {
		return
	}
	r.broadcastAll(out)
}

// handleTyping relays a client's typing state to everyone in the room, tagged
// with the sender's user id. Runs on the room's run() loop (no slow work).
func (r *Room) handleTyping(from *Client, payload json.RawMessage) {
	var in struct {
		IsTyping bool `json:"is_typing"`
	}
	if err := json.Unmarshal(payload, &in); err != nil {
		return
	}
	p, err := json.Marshal(TypingPayload{UserID: from.userID, IsTyping: in.IsTyping})
	if err != nil {
		return
	}
	out, err := json.Marshal(WSEvent{Type: EventTyping, Payload: p})
	if err != nil {
		return
	}
	r.broadcastAll(out)
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
