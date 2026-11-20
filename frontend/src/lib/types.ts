// Mirrors backend/supabase.go and the public.rooms / public.messages tables.

export interface Room {
  id: string;
  name: string;
  created_at: string;
  viz_state: VizState;
  artifacts_state: Artifact[];
  total_tokens_used: number;
  join_code?: string;
  created_by?: string | null;
}

export interface Message {
  id: string;
  room_id: string;
  user_id: string; // auth user uuid, or the literal 'AI'
  content: string;
  created_at: string;
}

// The AI-authored visualization of a room's conversation. Mirrors
// backend/viz.go VizState and the public.rooms.viz_state JSONB column. The model
// chooses whichever Mermaid diagram form best represents the conversation, so
// `mermaid` is raw Mermaid source and `diagram_type` is its leading keyword.
export interface VizState {
  title?: string;
  diagram_type?: string;
  mermaid?: string;
}

// A moodboard card. Mirrors backend/supabase.go Artifact. One of three kinds —
// "idea" (AI-distilled from a message), "diagram" (a saved viz snapshot), or
// "note" (free text). Legacy pins have no `kind` and render as notes.
export type ArtifactKind = "idea" | "diagram" | "note";

export interface Artifact {
  id: string;
  kind?: ArtifactKind;
  title?: string;
  content: string; // idea summary / note text (empty for diagram)
  source?: string; // original chat message behind an idea card
  mermaid?: string; // diagram source (diagram kind only)
  diagram_type?: string; // mermaid keyword (diagram kind only)
  author: string;
  created_at: string;
}

// WebSocket event envelope (Phase 3+) — mirrors the Go hub's broadcast shape.
export type WSEventType =
  | "CHAT"
  | "VIZ_UPDATE"
  | "VIZ_REPAIR"
  | "ARTIFACT_UPDATE"
  | "PIN_ARTIFACT"
  | "PIN_IDEA"
  | "PIN_DIAGRAM"
  | "ADD_NOTE"
  | "REORDER_ARTIFACTS"
  | "UNPIN_ARTIFACT"
  | "STATS"
  | "AI_CHUNK"
  | "SYSTEM"
  | "AGENTS_CHANGED"
  | "AGENTS_UPDATE"
  | "TYPING"
  | "PRESENCE";

export interface WSEvent<T = unknown> {
  type: WSEventType;
  payload: T;
}

export interface ChatPayload {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
}

export interface AIChunkPayload {
  generation_id: string;
  agent_id: string;
  agent_name: string;
  agent_color?: string;
  chunk: string;
  done: boolean;
}

// Safe metadata for a user's stored BYO provider key (never the key itself).
// Mirrors backend/supabase.go APIKeySafe.
export interface ApiKey {
  id: string;
  provider: string;
  label: string;
  last4: string;
  created_at: string;
}

// An AI participant. Mirrors backend/agents.go Agent and the public.agents table.
// owner_id null = a platform default agent, available in every room.
export interface Agent {
  id: string;
  owner_id: string | null;
  name: string;
  handle: string;
  system_prompt: string;
  provider: string;
  model: string;
  api_key_id: string | null;
  color: string | null;
  created_at: string;
}

export interface StatsPayload {
  total_tokens_used: number;
}

export interface SystemPayload {
  message: string;
}

export interface PresencePayload {
  users: string[];
}

export interface TypingPayload {
  user_id: string;
  is_typing: boolean;
}

// Sent by the client when the current VizState's Mermaid source fails to parse
// in the browser; the backend asks the model to repair it and re-broadcasts a
// corrected VIZ_UPDATE.
export interface VizRepairPayload {
  code: string;
  error: string;
}

// Outgoing client payloads.
export interface PinArtifactPayload {
  message_id: string;
  content: string;
  author: string;
}

// Save a chat message as an AI-distilled idea card.
export interface PinIdeaPayload {
  message_id: string;
  content: string;
  author: string;
}

// Snapshot the current visualization as a diagram card.
export interface PinDiagramPayload {
  title: string;
  diagram_type?: string;
  mermaid: string;
}

// Add a free-text note card.
export interface AddNotePayload {
  content: string;
}

// Reorder the moodboard cards to this id order.
export interface ReorderArtifactsPayload {
  ids: string[];
}

export interface UnpinArtifactPayload {
  id: string;
}
