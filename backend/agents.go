package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// Agent is an AI participant in a room. It mirrors a row in public.agents and
// the frontend's src/lib/types.ts Agent shape.
type Agent struct {
	ID           string  `json:"id"`
	OwnerID      *string `json:"owner_id"`
	Name         string  `json:"name"`
	Handle       string  `json:"handle"`
	SystemPrompt string  `json:"system_prompt"`
	Provider     string  `json:"provider"`
	Model        string  `json:"model"`
	APIKeyID     *string `json:"api_key_id"`
	Color        string  `json:"color"`
	CreatedAt    string  `json:"created_at"`
}

// agentAuthorID is the messages.user_id value stored for an agent's replies. The
// "agent:" prefix lets both the backend (conversation role mapping) and the
// frontend (attribution) distinguish an agent-authored message from a human one
// without a lookup, since both humans and agents are identified by UUIDs.
func agentAuthorID(a Agent) string {
	return "agent:" + a.ID
}

// isAIAuthor reports whether a messages.user_id belongs to the AI side of the
// conversation: an agent ("agent:<id>") or a legacy "AI" message.
func isAIAuthor(userID string) bool {
	return userID == "AI" || strings.HasPrefix(userID, "agent:")
}

var mentionRE = regexp.MustCompile(`@([A-Za-z0-9_-]+)`)

// parseMentions extracts unique, lowercased @handles from a message.
func parseMentions(content string) []string {
	matches := mentionRE.FindAllStringSubmatch(content, -1)
	seen := make(map[string]bool, len(matches))
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		h := strings.ToLower(m[1])
		if !seen[h] {
			seen[h] = true
			out = append(out, h)
		}
	}
	return out
}

// GetRoomAgents returns every agent available in a room: the platform defaults
// (owner_id is null, available everywhere) plus any custom agents explicitly
// attached via room_agents. Deduplicated by id.
func (c *SupabaseClient) GetRoomAgents(roomID string) ([]Agent, error) {
	platform, err := c.getPlatformAgents()
	if err != nil {
		return nil, err
	}
	custom, err := c.getCustomRoomAgents(roomID)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]bool, len(platform)+len(custom))
	out := make([]Agent, 0, len(platform)+len(custom))
	for _, a := range append(platform, custom...) {
		if a.ID == "" || seen[a.ID] {
			continue
		}
		seen[a.ID] = true
		out = append(out, a)
	}
	return out, nil
}

func (c *SupabaseClient) getPlatformAgents() ([]Agent, error) {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/rest/v1/agents?owner_id=is.null&select=*&order=created_at.asc", nil)
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
		return nil, fmt.Errorf("supabase platform agents query failed: status %d", resp.StatusCode)
	}

	var agents []Agent
	if err := json.NewDecoder(resp.Body).Decode(&agents); err != nil {
		return nil, err
	}
	return agents, nil
}

func (c *SupabaseClient) getCustomRoomAgents(roomID string) ([]Agent, error) {
	q := url.Values{}
	q.Set("room_id", "eq."+roomID)
	q.Set("select", "agents(*)")

	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/rest/v1/room_agents?"+q.Encode(), nil)
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
		return nil, fmt.Errorf("supabase room agents query failed: status %d", resp.StatusCode)
	}

	var rows []struct {
		Agent *Agent `json:"agents"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	out := make([]Agent, 0, len(rows))
	for _, r := range rows {
		if r.Agent != nil {
			out = append(out, *r.Agent)
		}
	}
	return out, nil
}
