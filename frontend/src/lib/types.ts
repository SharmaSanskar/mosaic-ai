// Mirrors backend/supabase.go and the public.rooms / public.messages tables.

export interface Room {
  id: string;
  name: string;
  created_at: string;
  graph_state: GraphState;
  artifacts_state: Artifact[];
  total_tokens_used: number;
}

export interface Message {
  id: string;
  room_id: string;
  user_id: string; // auth user uuid, or the literal 'AI'
  content: string;
  created_at: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Artifact {
  id: string;
  content: string;
  author: string;
  created_at: string;
}

// WebSocket event envelope (Phase 3+) — mirrors the Go hub's broadcast shape.
export type WSEventType =
  | "CHAT"
  | "GRAPH_UPDATE"
  | "ARTIFACT_UPDATE"
  | "PIN_ARTIFACT"
  | "UNPIN_ARTIFACT"
  | "STATS"
  | "AI_CHUNK"
  | "SYSTEM";

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
  chunk: string;
  done: boolean;
}

export interface StatsPayload {
  total_tokens_used: number;
}

export interface SystemPayload {
  message: string;
}

// Outgoing client payloads.
export interface PinArtifactPayload {
  message_id: string;
  content: string;
  author: string;
}

export interface UnpinArtifactPayload {
  id: string;
}
