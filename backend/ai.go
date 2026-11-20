package main

import (
	"crypto/rand"
	"encoding/hex"
)

// defaultAgentSystemPrompt is the persona used only as a fallback when an agent
// row somehow has an empty system_prompt. Real agents carry their own persona
// (see public.agents / the seed in migration 0005). Streaming now lives behind
// the Provider interface in provider.go.
const defaultAgentSystemPrompt = "You are a helpful AI participant in Mosaic, a real-time collaborative chat room shared by multiple humans. " +
	"Respond concisely and helpfully to the conversation, especially the most recent message."

func randomID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
