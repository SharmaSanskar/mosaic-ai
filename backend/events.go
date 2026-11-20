package main

// WebSocket event-type strings, used as the Type field of WSEvent in both
// directions. Centralized here so the set is discoverable in one place and
// the frontend's WSEventType union (frontend/src/lib/types.ts) has a single
// Go counterpart to mirror.
const (
	// Inbound (client → server)
	EventChat          = "CHAT"
	EventPinArtifact   = "PIN_ARTIFACT" // legacy raw-message pin (kept for back-compat)
	EventPinIdea       = "PIN_IDEA"     // save a message as an AI-distilled idea card
	EventPinDiagram    = "PIN_DIAGRAM"  // snapshot the current viz as a diagram card
	EventAddNote         = "ADD_NOTE"          // add a free-text note card
	EventReorderArtifact = "REORDER_ARTIFACTS" // reorder the moodboard cards
	EventUnpinArtifact   = "UNPIN_ARTIFACT"
	EventVizRepair     = "VIZ_REPAIR"
	EventAgentsChanged = "AGENTS_CHANGED" // a client added/removed an agent in this room

	// Bidirectional
	EventTyping = "TYPING" // in: this client is/not typing; out: user_id is/not typing

	// Outbound (server → clients)
	EventArtifactUpdate = "ARTIFACT_UPDATE"
	EventVizUpdate      = "VIZ_UPDATE"
	EventAIChunk        = "AI_CHUNK"
	EventStats          = "STATS"
	EventSystem         = "SYSTEM"
	EventAgentsUpdate   = "AGENTS_UPDATE" // tells clients to re-fetch the room's agents
	EventPresence       = "PRESENCE"      // the set of connected users in this room
)
