package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
)

// ChatRequest is a provider-agnostic chat completion request. It carries the
// agent's model and persona plus the rolling conversation, so a single call
// shape works across OpenAI, Anthropic, Google, etc.
type ChatRequest struct {
	Model        string
	SystemPrompt string
	History      []Message
	MaxTokens    int64
}

// Provider abstracts a chat model behind one interface, so the hub can drive any
// agent — on the platform key or a user's BYO key — without knowing which vendor
// sits behind it. OpenAI streams token-by-token; the BYO providers reply in one
// shot (onDelta is called once) — both finish the same way for the caller.
type Provider interface {
	StreamChat(ctx context.Context, req ChatRequest, onDelta func(string)) (int64, error)
}

var providerHTTP = &http.Client{Timeout: 60 * time.Second}

func maxTokensOrDefault(n int64) int64 {
	if n <= 0 {
		return 300
	}
	return n
}

// chatTurn is a role-tagged conversation turn used to build each vendor's
// request shape. Role is "user" or "ai".
type chatTurn struct {
	Role string
	Text string
}

// buildTurns converts message history into alternating turns, merging
// consecutive same-role messages and dropping any leading AI turns (vendors
// require the conversation to start with a user turn).
func buildTurns(history []Message) []chatTurn {
	var turns []chatTurn
	for _, m := range history {
		role := "user"
		if isAIAuthor(m.UserID) {
			role = "ai"
		}
		if n := len(turns); n > 0 && turns[n-1].Role == role {
			turns[n-1].Text += "\n" + m.Content
		} else {
			turns = append(turns, chatTurn{Role: role, Text: m.Content})
		}
	}
	for len(turns) > 0 && turns[0].Role == "ai" {
		turns = turns[1:]
	}
	return turns
}

// --- OpenAI (streaming) ---

type openaiProvider struct{ apiKey string }

func (p *openaiProvider) StreamChat(ctx context.Context, req ChatRequest, onDelta func(string)) (int64, error) {
	client := openai.NewClient(option.WithAPIKey(p.apiKey))

	messages := make([]openai.ChatCompletionMessageParamUnion, 0, len(req.History)+1)
	if req.SystemPrompt != "" {
		messages = append(messages, openai.SystemMessage(req.SystemPrompt))
	}
	for _, m := range req.History {
		if isAIAuthor(m.UserID) {
			messages = append(messages, openai.AssistantMessage(m.Content))
		} else {
			messages = append(messages, openai.UserMessage(m.Content))
		}
	}

	stream := client.Chat.Completions.NewStreaming(ctx, openai.ChatCompletionNewParams{
		Model:               openai.ChatModel(req.Model),
		Messages:            messages,
		MaxCompletionTokens: openai.Int(maxTokensOrDefault(req.MaxTokens)),
		StreamOptions: openai.ChatCompletionStreamOptionsParam{
			IncludeUsage: openai.Bool(true),
		},
	})
	defer stream.Close()

	acc := openai.ChatCompletionAccumulator{}
	for stream.Next() {
		chunk := stream.Current()
		acc.AddChunk(chunk)
		if len(chunk.Choices) == 0 {
			continue
		}
		if delta := chunk.Choices[0].Delta.Content; delta != "" {
			onDelta(delta)
		}
	}
	if err := stream.Err(); err != nil {
		return 0, fmt.Errorf("openai stream error: %w", err)
	}
	return acc.Usage.TotalTokens, nil
}

// --- Anthropic (request/response over HTTPS) ---

type anthropicProvider struct{ apiKey string }

func (p *anthropicProvider) StreamChat(ctx context.Context, req ChatRequest, onDelta func(string)) (int64, error) {
	messages := make([]map[string]string, 0, len(req.History))
	for _, t := range buildTurns(req.History) {
		role := "user"
		if t.Role == "ai" {
			role = "assistant"
		}
		messages = append(messages, map[string]string{"role": role, "content": t.Text})
	}
	if len(messages) == 0 {
		return 0, fmt.Errorf("no user message to send")
	}

	payload := map[string]any{
		"model":      req.Model,
		"max_tokens": maxTokensOrDefault(req.MaxTokens),
		"messages":   messages,
	}
	if req.SystemPrompt != "" {
		payload["system"] = req.SystemPrompt
	}

	body, err := doJSON(ctx, http.MethodPost, "https://api.anthropic.com/v1/messages", payload, map[string]string{
		"x-api-key":         p.apiKey,
		"anthropic-version": "2023-06-01",
	})
	if err != nil {
		return 0, fmt.Errorf("anthropic call failed: %w", err)
	}

	var out struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Usage struct {
			InputTokens  int64 `json:"input_tokens"`
			OutputTokens int64 `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return 0, fmt.Errorf("anthropic response parse failed: %w", err)
	}

	var text string
	for _, c := range out.Content {
		if c.Type == "text" {
			text += c.Text
		}
	}
	if text != "" {
		onDelta(text)
	}
	return out.Usage.InputTokens + out.Usage.OutputTokens, nil
}

// --- Google Gemini (request/response over HTTPS) ---

type googleProvider struct{ apiKey string }

func (p *googleProvider) StreamChat(ctx context.Context, req ChatRequest, onDelta func(string)) (int64, error) {
	type part struct {
		Text string `json:"text"`
	}
	type content struct {
		Role  string `json:"role"`
		Parts []part `json:"parts"`
	}

	contents := make([]content, 0, len(req.History))
	for _, t := range buildTurns(req.History) {
		role := "user"
		if t.Role == "ai" {
			role = "model"
		}
		contents = append(contents, content{Role: role, Parts: []part{{Text: t.Text}}})
	}
	if len(contents) == 0 {
		return 0, fmt.Errorf("no user message to send")
	}

	payload := map[string]any{
		"contents": contents,
		"generationConfig": map[string]any{
			"maxOutputTokens": maxTokensOrDefault(req.MaxTokens),
		},
	}
	if req.SystemPrompt != "" {
		payload["system_instruction"] = map[string]any{"parts": []part{{Text: req.SystemPrompt}}}
	}

	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s", req.Model, p.apiKey)
	body, err := doJSON(ctx, http.MethodPost, url, payload, nil)
	if err != nil {
		return 0, fmt.Errorf("gemini call failed: %w", err)
	}

	var out struct {
		Candidates []struct {
			Content struct {
				Parts []part `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		UsageMetadata struct {
			TotalTokenCount int64 `json:"totalTokenCount"`
		} `json:"usageMetadata"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return 0, fmt.Errorf("gemini response parse failed: %w", err)
	}

	var text string
	if len(out.Candidates) > 0 {
		for _, pt := range out.Candidates[0].Content.Parts {
			text += pt.Text
		}
	}
	if text != "" {
		onDelta(text)
	}
	return out.UsageMetadata.TotalTokenCount, nil
}

// doJSON POSTs a JSON body and returns the response body, erroring on non-2xx.
func doJSON(ctx context.Context, method, url string, payload any, headers map[string]string) ([]byte, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}

	resp, err := providerHTTP.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, buf.String())
	}
	return buf.Bytes(), nil
}

// providerFor builds the Provider for an agent, resolving which API key to use:
// a platform agent (no api_key_id) uses the platform OpenAI key; otherwise the
// agent's BYO key is loaded and decrypted just-in-time.
func providerFor(agent Agent, cfg Config, sb *SupabaseClient) (Provider, error) {
	provider := agent.Provider
	if provider == "" {
		provider = "openai"
	}

	var apiKey string
	if agent.APIKeyID != nil {
		rec, err := sb.GetAPIKey(*agent.APIKeyID)
		if err != nil {
			return nil, fmt.Errorf("couldn't load the agent's API key")
		}
		plain, err := decryptSecret(cfg.EncryptionKey, rec.Ciphertext, rec.Nonce)
		if err != nil {
			return nil, fmt.Errorf("couldn't decrypt the agent's API key")
		}
		apiKey = plain
	} else if provider == "openai" {
		apiKey = cfg.OpenAIKey
	} else {
		return nil, fmt.Errorf("%s agents need a bring-your-own API key", provider)
	}

	if apiKey == "" {
		return nil, fmt.Errorf("no API key available for this agent")
	}

	switch provider {
	case "openai":
		return &openaiProvider{apiKey: apiKey}, nil
	case "anthropic":
		return &anthropicProvider{apiKey: apiKey}, nil
	case "google":
		return &googleProvider{apiKey: apiKey}, nil
	default:
		return nil, fmt.Errorf("unknown provider %q", provider)
	}
}
