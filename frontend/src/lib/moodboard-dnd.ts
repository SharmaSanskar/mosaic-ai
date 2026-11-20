// Shared drag-and-drop contract for the moodboard. Native HTML5 DnD carries the
// payload in dataTransfer, so a chat message (one panel) or the live diagram
// (another panel) can be dropped onto the board (a third panel) with no shared
// React context. A "save" drag mirrors the 💡 / Save buttons; a "reorder" drag
// rearranges cards within the board.

import type React from "react";

export const MOODBOARD_MIME = "application/x-mosaic-moodboard";

export type MoodboardDrag =
  | { op: "save"; kind: "idea"; message_id: string; content: string; author: string }
  | { op: "save"; kind: "diagram"; title: string; diagram_type?: string; mermaid: string }
  | { op: "reorder"; id: string };

export function setMoodboardDrag(e: React.DragEvent, data: MoodboardDrag) {
  e.dataTransfer.setData(MOODBOARD_MIME, JSON.stringify(data));
  e.dataTransfer.effectAllowed = data.op === "reorder" ? "move" : "copy";
}

export function readMoodboardDrag(e: React.DragEvent): MoodboardDrag | null {
  const raw = e.dataTransfer.getData(MOODBOARD_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MoodboardDrag;
  } catch {
    return null;
  }
}

// dataTransfer.getData() is blocked during dragover (only the type list is
// readable), so this is how a dropzone decides whether to accept the drag.
export function hasMoodboardDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(MOODBOARD_MIME);
}
