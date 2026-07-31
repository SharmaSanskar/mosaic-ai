package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/shared"
)

const graphSystemPrompt = `You analyze a group chat conversation and produce a reasoning graph: a DAG capturing the key topics, questions, and decisions, and how they connect.

Respond with ONLY a strict JSON object, no markdown fences, no commentary, matching exactly this shape:
{"nodes":[{"id":"string","label":"string","type":"string"}],"edges":[{"id":"string","source":"node id","target":"node id","label":"string"}]}

Rules:
- "type" must be one of: "topic", "question", "decision", "action".
- Keep labels short (under 8 words).
- Every edge's "source" and "target" must reference an "id" present in "nodes".
- Only include nodes/edges clearly supported by the conversation; prefer fewer, clearer nodes.
- Output valid JSON and nothing else.`

// GraphNode/GraphEdge/GraphState mirror the frontend's src/lib/types.ts shapes
// and the public.rooms.graph_state JSONB column.
type GraphNode struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Type  string `json:"type,omitempty"`
}

type GraphEdge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
	Label  string `json:"label,omitempty"`
}

type GraphState struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

// generateGraph asks OpenAI for a strict-JSON reasoning graph derived from
// the conversation, and returns the tokens used. It returns an error on any
// malformed/invalid output — callers must discard rather than persist/
// broadcast in that case.
func generateGraph(ctx context.Context, apiKey string, history []Message) (*GraphState, int64, error) {
	client := openai.NewClient(option.WithAPIKey(apiKey))

	var convo strings.Builder
	for _, m := range history {
		speaker := "AI"
		if m.UserID != "AI" {
			speaker = "user_" + shortID(m.UserID)
		}
		fmt.Fprintf(&convo, "%s: %s\n", speaker, m.Content)
	}

	jsonObjectFormat := shared.NewResponseFormatJSONObjectParam()
	completion, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: openai.ChatModelGPT4oMini,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(graphSystemPrompt),
			openai.UserMessage(convo.String()),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONObject: &jsonObjectFormat,
		},
		MaxCompletionTokens: openai.Int(500),
	})
	if err != nil {
		return nil, 0, fmt.Errorf("openai graph call failed: %w", err)
	}
	if len(completion.Choices) == 0 {
		return nil, completion.Usage.TotalTokens, fmt.Errorf("openai graph call returned no choices")
	}

	var parsed GraphState
	if err := json.Unmarshal([]byte(completion.Choices[0].Message.Content), &parsed); err != nil {
		return nil, completion.Usage.TotalTokens, fmt.Errorf("invalid graph JSON: %w", err)
	}

	validIDs := make(map[string]bool, len(parsed.Nodes))
	for _, n := range parsed.Nodes {
		if n.ID == "" || n.Label == "" {
			return nil, completion.Usage.TotalTokens, fmt.Errorf("graph node missing id or label")
		}
		validIDs[n.ID] = true
	}

	edges := make([]GraphEdge, 0, len(parsed.Edges))
	for _, e := range parsed.Edges {
		if e.ID == "" || !validIDs[e.Source] || !validIDs[e.Target] {
			continue // drop dangling/invalid edges rather than fail the whole graph
		}
		edges = append(edges, e)
	}

	return &GraphState{Nodes: parsed.Nodes, Edges: edges}, completion.Usage.TotalTokens, nil
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}
