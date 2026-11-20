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
	VizState        json.RawMessage `json:"viz_state"`
	ArtifactsState  json.RawMessage `json:"artifacts_state"`
	TotalTokensUsed int             `json:"total_tokens_used"`
}

// ListRoomsForUser returns the rooms the user is a member of (newest first),
// using a PostgREST inner join on room_members to scope the result.
func (c *SupabaseClient) ListRoomsForUser(userID string) ([]RoomRecord, error) {
	q := url.Values{}
	q.Set("select", "*,room_members!inner(user_id)")
	q.Set("room_members.user_id", "eq."+userID)
	q.Set("order", "created_at.desc")

	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/rest/v1/rooms?"+q.Encode(), nil)
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

// IsRoomMember reports whether userID belongs to roomID.
func (c *SupabaseClient) IsRoomMember(roomID, userID string) (bool, error) {
	q := url.Values{}
	q.Set("room_id", "eq."+roomID)
	q.Set("user_id", "eq."+userID)
	q.Set("select", "room_id")
	q.Set("limit", "1")

	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/rest/v1/room_members?"+q.Encode(), nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("apikey", c.serviceKey)
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("supabase membership query failed: status %d", resp.StatusCode)
	}

	var rows []struct {
		RoomID string `json:"room_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return false, err
	}
	return len(rows) > 0, nil
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

// UpdateRoomViz replaces rooms.viz_state for roomID with a freshly regenerated
// visualization. Each call asks the model to represent the whole conversation
// again (the diagram form itself may change), so a full replace keeps the
// stored viz internally consistent rather than trying to merge.
func (c *SupabaseClient) UpdateRoomViz(roomID string, viz VizState) error {
	body, err := json.Marshal(map[string]any{"viz_state": viz})
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
		return fmt.Errorf("supabase update viz failed: status %d", resp.StatusCode)
	}
	return nil
}

// Artifact mirrors the frontend's src/lib/types.ts Artifact shape and an entry in
// rooms.artifacts_state. A card is one of three kinds — "idea" (AI-distilled from a
// message), "diagram" (a saved snapshot of the viz pane), or "note" (free text a
// human typed). Legacy entries have no Kind and render as notes. The extra fields
// are omitempty so each kind only carries what it needs, and old JSONB stays valid.
type Artifact struct {
	ID          string `json:"id"`
	Kind        string `json:"kind,omitempty"` // "idea" | "diagram" | "note"; empty = legacy note
	Title       string `json:"title,omitempty"`
	Content     string `json:"content"`                // idea summary / note text (empty for diagram)
	Source      string `json:"source,omitempty"`      // original chat message behind an idea card
	Mermaid     string `json:"mermaid,omitempty"`      // diagram source (diagram kind only)
	DiagramType string `json:"diagram_type,omitempty"` // mermaid keyword (diagram kind only)
	Author      string `json:"author"`
	CreatedAt   string `json:"created_at"`
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

// APIKeyRecord mirrors a row in public.api_keys. Ciphertext/Nonce are only ever
// read by the backend (service_role); they are never serialized to any client.
type APIKeyRecord struct {
	ID         string `json:"id"`
	OwnerID    string `json:"owner_id"`
	Provider   string `json:"provider"`
	Label      string `json:"label"`
	Ciphertext string `json:"ciphertext"`
	Nonce      string `json:"nonce"`
	Last4      string `json:"last4"`
	CreatedAt  string `json:"created_at"`
}

// APIKeySafe is the client-facing view of a stored key: metadata only, never the
// ciphertext or nonce.
type APIKeySafe struct {
	ID        string `json:"id"`
	Provider  string `json:"provider"`
	Label     string `json:"label"`
	Last4     string `json:"last4"`
	CreatedAt string `json:"created_at"`
}

// InsertAPIKey stores an already-encrypted key and returns its safe metadata.
func (c *SupabaseClient) InsertAPIKey(ownerID, provider, label, ciphertext, nonce, last4 string) (*APIKeySafe, error) {
	body, err := json.Marshal(map[string]string{
		"owner_id":   ownerID,
		"provider":   provider,
		"label":      label,
		"ciphertext": ciphertext,
		"nonce":      nonce,
		"last4":      last4,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, c.baseURL+"/rest/v1/api_keys", bytes.NewReader(body))
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
		return nil, fmt.Errorf("supabase insert api key failed: status %d", resp.StatusCode)
	}

	var rows []APIKeyRecord
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("supabase insert api key returned no rows")
	}
	r := rows[0]
	return &APIKeySafe{ID: r.ID, Provider: r.Provider, Label: r.Label, Last4: r.Last4, CreatedAt: r.CreatedAt}, nil
}

// ListAPIKeys returns the owner's keys as safe metadata (no secrets).
func (c *SupabaseClient) ListAPIKeys(ownerID string) ([]APIKeySafe, error) {
	q := url.Values{}
	q.Set("owner_id", "eq."+ownerID)
	q.Set("select", "id,provider,label,last4,created_at")
	q.Set("order", "created_at.desc")

	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/rest/v1/api_keys?"+q.Encode(), nil)
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
		return nil, fmt.Errorf("supabase list api keys failed: status %d", resp.StatusCode)
	}

	var rows []APIKeySafe
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// GetAPIKey returns one key record (including ciphertext) for the backend to
// decrypt just before a provider call.
func (c *SupabaseClient) GetAPIKey(id string) (*APIKeyRecord, error) {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/rest/v1/api_keys?id=eq."+id+"&select=*", nil)
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
		return nil, fmt.Errorf("supabase get api key failed: status %d", resp.StatusCode)
	}

	var rows []APIKeyRecord
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("api key not found: %s", id)
	}
	return &rows[0], nil
}

// DeleteAPIKey removes a key the owner controls.
func (c *SupabaseClient) DeleteAPIKey(ownerID, id string) error {
	q := url.Values{}
	q.Set("id", "eq."+id)
	q.Set("owner_id", "eq."+ownerID) // scope deletion to the owner

	req, err := http.NewRequest(http.MethodDelete, c.baseURL+"/rest/v1/api_keys?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("apikey", c.serviceKey)
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)
	req.Header.Set("Prefer", "return=minimal")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("supabase delete api key failed: status %d", resp.StatusCode)
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
