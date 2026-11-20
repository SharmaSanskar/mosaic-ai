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

// vizModel is the model used for the (cheap, non-streamed) visualization call.
// Kept separate from the chat model so it can be tuned independently.
const vizModel = openai.ChatModelGPT4oMini

const vizSystemPrompt = `You turn the CURRENT TOPIC of a collaborative chat into a single diagram that captures the SUBSTANCE being discussed — the actual things, options, steps, trade-offs, or decision — so the team can use it to think and decide. You are NOT diagramming the conversation itself.

HARD RULES (most important):
- Diagram the KNOWLEDGE, never the dialogue. Do NOT model "user", "AI", speakers, turns, or messages as nodes.
- Do NOT produce a sequenceDiagram of who-said-what. Only use sequenceDiagram if the SUBJECT itself is a genuine protocol or exchange between systems (e.g. a client/server handshake being explained).
- If the answer lists items, the diagram shows those items — not the fact that an answer was given.

Choose the ONE Mermaid diagram type that fits the CONTENT. PREFER "flowchart TD" — it is the most robust and fits lists, steps, options, and comparisons. Use another type only when it clearly fits better:
- a list, ranking, or set of options (e.g. "best FPS games") -> flowchart TD with one root branching to each item (or mindmap)
- a how-to, process, or steps (e.g. "how do I build one") -> flowchart TD of the ordered steps
- a comparison or trade-offs -> flowchart TD grouping each side
- a decision with alternatives -> flowchart TD of the options and the chosen path
- events, milestones, or phases over time -> timeline
- statuses and transitions -> stateDiagram-v2
When unsure, use flowchart TD. Avoid quadrantChart, pie, and gantt unless the content is unmistakably two-axis / proportional / scheduled.

SYNTAX RULES (follow exactly — malformed Mermaid is rejected):
- flowchart: start with "flowchart TD". Every node label is quoted: A["Top FPS games"] --> B["Counter-Strike"]. Node ids are simple (A, B, C, n1). One edge per line.
- mindmap: start with "mindmap", then "  root((Topic))", then child lines indented with TWO extra spaces per level. Node text has NO parentheses or quotes.
- timeline: start with "timeline", then "  title My Title", then lines like "  2024 : Did a thing".
- Never put parentheses (), semicolons ;, colons (except where the syntax requires), #, or raw double-quotes INSIDE a label. Keep labels short (<= 5 words).

Respond with ONLY a strict JSON object, no markdown fences, no commentary, matching exactly this shape:
{"title":"short human title naming the TOPIC, <= 6 words","diagram_type":"the mermaid keyword, e.g. flowchart","mermaid":"the complete Mermaid source"}

Rules:
- "title" names the subject (e.g. "Top FPS games", "Steps to build an FPS"), never "conversation" or "chat".
- "mermaid" must be complete, valid Mermaid source beginning with its diagram keyword.
- Summarize the substance: prefer 4-12 nodes/steps with short, concrete labels drawn from the content.
- Output valid JSON and nothing else.`

const vizRepairSystemPrompt = `You fix broken Mermaid diagram source. You are given a Mermaid snippet and the parser error it produced. Return a corrected version that preserves the diagram's intent and fixes only the syntax.

Respond with ONLY a strict JSON object, no markdown fences, no commentary, matching exactly this shape:
{"title":"short human title, <= 6 words","diagram_type":"the mermaid keyword","mermaid":"the corrected, complete Mermaid source"}

Rules:
- The "mermaid" value must be complete, valid Mermaid beginning with its diagram keyword.
- Quote every flowchart node label: A["Some label"]. Keep labels <= 5 words.
- Never put parentheses, semicolons, #, or raw double-quotes inside a label.
- If the broken source is hopeless, return a simple valid "flowchart TD" that preserves the intent.
- Output valid JSON and nothing else.`

// VizState is the AI-authored visualization of a room's conversation. It mirrors
// the frontend's src/lib/types.ts VizState shape and the public.rooms.viz_state
// JSONB column. Unlike the previous fixed DAG, the model chooses whichever
// Mermaid diagram form best describes the conversation.
type VizState struct {
	Title       string `json:"title"`
	DiagramType string `json:"diagram_type"`
	Mermaid     string `json:"mermaid"`
}

// knownMermaidHeaders are the leading keywords of Mermaid diagram sources. Used
// only as a light sanity check — real validation happens client-side where
// mermaid.js runs (there is no Mermaid parser for Go).
var knownMermaidHeaders = []string{
	"flowchart", "graph", "sequenceDiagram", "classDiagram",
	"stateDiagram-v2", "stateDiagram", "erDiagram", "journey",
	"gantt", "pie", "quadrantChart", "requirementDiagram",
	"gitGraph", "mindmap", "timeline", "sankey-beta",
	"xychart-beta", "block-beta", "C4Context", "C4Container",
}

// looksLikeMermaid checks that the source starts with a recognized diagram
// keyword. It's intentionally permissive about everything after the header.
func looksLikeMermaid(src string) bool {
	trimmed := strings.TrimSpace(src)
	if trimmed == "" {
		return false
	}
	// Mermaid allows a leading directive/frontmatter block; skip past it.
	for strings.HasPrefix(trimmed, "%%") || strings.HasPrefix(trimmed, "---") {
		if idx := strings.IndexByte(trimmed, '\n'); idx >= 0 {
			trimmed = strings.TrimSpace(trimmed[idx+1:])
		} else {
			break
		}
	}
	for _, h := range knownMermaidHeaders {
		if strings.HasPrefix(trimmed, h) {
			return true
		}
	}
	return false
}

// renderTopic isolates the CURRENT topic from the history and frames it as a
// question + answer so the model diagrams the substance of the latest exchange,
// not the whole chat flow. The topic is the last human (non-AI) message and
// everything after it (the answer(s) to it). Anything before that is condensed
// into a single short "Earlier context" line so a follow-up like "how do I build
// one" still knows what "one" refers to, without dragging in unrelated topics.
func renderTopic(history []Message) string {
	// Find the last human message; it opens the current topic.
	topicStart := 0
	for i := len(history) - 1; i >= 0; i-- {
		if !isAIAuthor(history[i].UserID) {
			topicStart = i
			break
		}
	}

	var b strings.Builder

	// One line of prior context (the human turn just before this topic), if any.
	for i := topicStart - 1; i >= 0; i-- {
		if !isAIAuthor(history[i].UserID) {
			fmt.Fprintf(&b, "Earlier context: %s\n\n", oneLine(history[i].Content))
			break
		}
	}

	// The current topic: the latest question and the answer(s) to it.
	for i := topicStart; i < len(history); i++ {
		m := history[i]
		if isAIAuthor(m.UserID) {
			fmt.Fprintf(&b, "Answer: %s\n", m.Content)
		} else {
			fmt.Fprintf(&b, "Question: %s\n", m.Content)
		}
	}
	return b.String()
}

// oneLine collapses whitespace and truncates, for the single context line.
func oneLine(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 160 {
		s = s[:160] + "…"
	}
	return s
}

func parseVizResponse(content string, tokens int64) (*VizState, int64, error) {
	var parsed VizState
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, tokens, fmt.Errorf("invalid viz JSON: %w", err)
	}
	parsed.Mermaid = strings.TrimSpace(parsed.Mermaid)
	if parsed.Mermaid == "" {
		return nil, tokens, fmt.Errorf("viz response had empty mermaid source")
	}
	if !looksLikeMermaid(parsed.Mermaid) {
		return nil, tokens, fmt.Errorf("viz response did not start with a known mermaid header")
	}
	if parsed.Title == "" {
		parsed.Title = "Conversation map"
	}
	return &parsed, tokens, nil
}

func newVizClient(apiKey string) openai.Client {
	return openai.NewClient(option.WithAPIKey(apiKey))
}

// generateViz asks OpenAI to represent the whole conversation as the single
// Mermaid diagram that best fits it, and returns the tokens used. It returns an
// error on malformed output — callers must discard rather than persist/broadcast.
func generateViz(ctx context.Context, apiKey string, history []Message) (*VizState, int64, error) {
	client := newVizClient(apiKey)
	jsonObjectFormat := shared.NewResponseFormatJSONObjectParam()

	completion, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: vizModel,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(vizSystemPrompt),
			openai.UserMessage(renderTopic(history)),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONObject: &jsonObjectFormat,
		},
		MaxCompletionTokens: openai.Int(700),
	})
	if err != nil {
		return nil, 0, fmt.Errorf("openai viz call failed: %w", err)
	}
	if len(completion.Choices) == 0 {
		return nil, completion.Usage.TotalTokens, fmt.Errorf("openai viz call returned no choices")
	}
	return parseVizResponse(completion.Choices[0].Message.Content, completion.Usage.TotalTokens)
}

// repairViz asks OpenAI to fix Mermaid source that failed to parse client-side,
// given the parser error. Returns the corrected VizState and tokens used.
func repairViz(ctx context.Context, apiKey, brokenCode, parseError string) (*VizState, int64, error) {
	client := newVizClient(apiKey)
	jsonObjectFormat := shared.NewResponseFormatJSONObjectParam()

	userMsg := fmt.Sprintf("Mermaid source that failed to parse:\n%s\n\nParser error:\n%s", brokenCode, parseError)
	completion, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: vizModel,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(vizRepairSystemPrompt),
			openai.UserMessage(userMsg),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONObject: &jsonObjectFormat,
		},
		MaxCompletionTokens: openai.Int(700),
	})
	if err != nil {
		return nil, 0, fmt.Errorf("openai viz repair call failed: %w", err)
	}
	if len(completion.Choices) == 0 {
		return nil, completion.Usage.TotalTokens, fmt.Errorf("openai viz repair returned no choices")
	}
	return parseVizResponse(completion.Choices[0].Message.Content, completion.Usage.TotalTokens)
}

const distillIdeaSystemPrompt = `You turn a single chat message into a crisp, reusable idea or decision card for a team's moodboard. Capture the essence as something worth remembering later — not a transcription.

Respond with ONLY a strict JSON object, no markdown fences, no commentary, matching exactly this shape:
{"title":"<= 6 words naming the idea","summary":"1-2 short sentences stating the idea or decision"}

Rules:
- If the message is a decision or recommendation, begin the title with "Decision: " or "Idea: " as appropriate.
- The summary states the substance plainly; do not mention "the message", "the user", or "the chat".
- Output valid JSON and nothing else.`

// IdeaCard is the distilled result of turning a message into a moodboard idea.
type IdeaCard struct {
	Title   string `json:"title"`
	Summary string `json:"summary"`
}

// distillIdea asks the model to compress a message into a short idea/decision card.
// One cheap, on-demand call (same model as viz). Returns the card and tokens used.
func distillIdea(ctx context.Context, apiKey, content string) (*IdeaCard, int64, error) {
	client := newVizClient(apiKey)
	jsonObjectFormat := shared.NewResponseFormatJSONObjectParam()

	completion, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: vizModel,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(distillIdeaSystemPrompt),
			openai.UserMessage(content),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONObject: &jsonObjectFormat,
		},
		MaxCompletionTokens: openai.Int(200),
	})
	if err != nil {
		return nil, 0, fmt.Errorf("openai idea distill failed: %w", err)
	}
	if len(completion.Choices) == 0 {
		return nil, completion.Usage.TotalTokens, fmt.Errorf("openai idea distill returned no choices")
	}

	var card IdeaCard
	if err := json.Unmarshal([]byte(completion.Choices[0].Message.Content), &card); err != nil {
		return nil, completion.Usage.TotalTokens, fmt.Errorf("invalid idea JSON: %w", err)
	}
	card.Title = strings.TrimSpace(card.Title)
	card.Summary = strings.TrimSpace(card.Summary)
	if card.Summary == "" {
		return nil, completion.Usage.TotalTokens, fmt.Errorf("idea distill produced empty summary")
	}
	if card.Title == "" {
		card.Title = "Idea"
	}
	return &card, completion.Usage.TotalTokens, nil
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}
