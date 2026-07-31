package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
)

const aiSystemPrompt = "You are a helpful AI participant in Mosaic, a real-time collaborative chat room shared by multiple humans. " +
	"Respond concisely and helpfully to the conversation, especially the most recent message."

// streamAIResponse builds the rolling conversation context from history and
// streams a chat completion, invoking onDelta for each content chunk.
// Returns the total tokens used (0 if the final usage chunk never arrived,
// e.g. an interrupted stream).
func streamAIResponse(ctx context.Context, apiKey string, history []Message, onDelta func(string)) (int64, error) {
	client := openai.NewClient(option.WithAPIKey(apiKey))

	messages := []openai.ChatCompletionMessageParamUnion{
		openai.SystemMessage(aiSystemPrompt),
	}
	for _, m := range history {
		if m.UserID == "AI" {
			messages = append(messages, openai.AssistantMessage(m.Content))
		} else {
			messages = append(messages, openai.UserMessage(m.Content))
		}
	}

	stream := client.Chat.Completions.NewStreaming(ctx, openai.ChatCompletionNewParams{
		Model:               openai.ChatModelGPT4oMini,
		Messages:            messages,
		MaxCompletionTokens: openai.Int(300), // keep replies short; caps cost per @AI trigger
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

func randomID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
