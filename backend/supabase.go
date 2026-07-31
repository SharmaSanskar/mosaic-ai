package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// SupabaseClient talks to the local Supabase REST (PostgREST) API using the
// service_role key, which bypasses RLS. It must never be exposed to the frontend.
type SupabaseClient struct {
	baseURL    string
	serviceKey string
	httpClient *http.Client
}

func NewSupabaseClient(cfg Config) *SupabaseClient {
	return &SupabaseClient{
		baseURL:    cfg.SupabaseURL,
		serviceKey: cfg.ServiceRoleKey,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// RoomRecord mirrors a row in public.rooms. Named "Record" to avoid clashing
// with Room, the in-memory hub concept in hub.go.
type RoomRecord struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	CreatedAt       string          `json:"created_at"`
	GraphState      json.RawMessage `json:"graph_state"`
	ArtifactsState  json.RawMessage `json:"artifacts_state"`
	TotalTokensUsed int             `json:"total_tokens_used"`
}

func (c *SupabaseClient) ListRooms() ([]RoomRecord, error) {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/rest/v1/rooms?select=*&order=created_at.desc", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", c.serviceKey)
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("supabase rooms query failed: status %d", resp.StatusCode)
	}

	var rooms []RoomRecord
	if err := json.NewDecoder(resp.Body).Decode(&rooms); err != nil {
		return nil, err
	}
	return rooms, nil
}

// Message mirrors a row in public.messages.
type Message struct {
	ID        string `json:"id"`
	RoomID    string `json:"room_id"`
	UserID    string `json:"user_id"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

func (c *SupabaseClient) InsertMessage(roomID, userID, content string) (*Message, error) {
	body, err := json.Marshal(map[string]string{
		"room_id": roomID,
		"user_id": userID,
		"content": content,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, c.baseURL+"/rest/v1/messages", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", c.serviceKey)
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("supabase insert message failed: status %d", resp.StatusCode)
	}

	var rows []Message
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("supabase insert message returned no rows")
	}
	return &rows[0], nil
}

// ListRecentMessages returns up to limit messages for roomID, oldest first,
// suitable as rolling context for the AI.
func (c *SupabaseClient) ListRecentMessages(roomID string, limit int) ([]Message, error) {
	q := url.Values{}
	q.Set("room_id", "eq."+roomID)
	q.Set("select", "*")
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))

	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/rest/v1/messages?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", c.serviceKey)
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("supabase messages query failed: status %d", resp.StatusCode)
	}

	var rows []Message
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}

	// Query returned newest-first; reverse to chronological order.
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}
	return rows, nil
}

// UpdateRoomGraph replaces rooms.graph_state for roomID with a freshly
// regenerated graph, rather than merging by node id: the model doesn't
// guarantee stable ids across calls, so merging risks orphaned/duplicate
// nodes. Each call is asked to represent the whole conversation, so a full
// replace keeps the graph internally consistent.
func (c *SupabaseClient) UpdateRoomGraph(roomID string, graph GraphState) error {
	body, err := json.Marshal(map[string]any{"graph_state": graph})
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPatch, c.baseURL+"/rest/v1/rooms?id=eq."+roomID, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", c.serviceKey)
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("supabase update graph failed: status %d", resp.StatusCode)
	}
	return nil
}

// Artifact mirrors the frontend's src/lib/types.ts Artifact shape and an
// entry in rooms.artifacts_state.
type Artifact struct {
	ID        string `json:"id"`
	Content   string `json:"content"`
	Author    string `json:"author"`
	CreatedAt string `json:"created_at"`
}

// GetRoomArtifacts returns the current pinned artifacts for roomID.
func (c *SupabaseClient) GetRoomArtifacts(roomID string) ([]Artifact, error) {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/rest/v1/rooms?id=eq."+roomID+"&select=artifacts_state", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", c.serviceKey)
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("supabase artifacts query failed: status %d", resp.StatusCode)
	}

	var rows []struct {
		ArtifactsState []Artifact `json:"artifacts_state"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("room not found: %s", roomID)
	}
	return rows[0].ArtifactsState, nil
}

// UpdateRoomArtifacts replaces rooms.artifacts_state with the full list.
func (c *SupabaseClient) UpdateRoomArtifacts(roomID string, artifacts []Artifact) error {
	body, err := json.Marshal(map[string]any{"artifacts_state": artifacts})
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPatch, c.baseURL+"/rest/v1/rooms?id=eq."+roomID, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", c.serviceKey)
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("supabase update artifacts failed: status %d", resp.StatusCode)
	}
	return nil
}

// IncrementRoomTokens atomically adds amount to rooms.total_tokens_used via
// the increment_room_tokens Postgres function (a plain PATCH can't express
// "increment by N" since PostgREST body values are literals, not SQL
// expressions) and returns the new total.
func (c *SupabaseClient) IncrementRoomTokens(roomID string, amount int64) (int64, error) {
	if amount <= 0 {
		return 0, nil
	}

	body, err := json.Marshal(map[string]any{"room_id": roomID, "amount": amount})
	if err != nil {
		return 0, err
	}

	req, err := http.NewRequest(http.MethodPost, c.baseURL+"/rest/v1/rpc/increment_room_tokens", bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("apikey", c.serviceKey)
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("supabase increment tokens failed: status %d", resp.StatusCode)
	}

	var newTotal int64
	if err := json.NewDecoder(resp.Body).Decode(&newTotal); err != nil {
		return 0, err
	}
	return newTotal, nil
}
