"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRoomSocketContext } from "@/lib/room-socket-context";
import { useUserNames } from "@/lib/user-names";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArtifactCard } from "@/components/room/artifact-card";
import { ArtifactDetailDialog } from "@/components/room/artifact-detail-dialog";
import { hasMoodboardDrag, readMoodboardDrag, type MoodboardDrag } from "@/lib/moodboard-dnd";
import type { Artifact } from "@/lib/types";

interface ArtifactsPaneProps {
  roomId: string;
}

// Produce the new id order when a reorder drag drops: pull `draggedId` out and
// reinsert it before `beforeId` (or at the end when dropped on open board space).
function reorderIds(ids: string[], draggedId: string, beforeId: string | null): string[] {
  const without = ids.filter((id) => id !== draggedId);
  if (beforeId === null) return [...without, draggedId];
  const idx = without.indexOf(beforeId);
  if (idx === -1) return [...without, draggedId];
  return [...without.slice(0, idx), draggedId, ...without.slice(idx)];
}

export function ArtifactsPane({ roomId }: ArtifactsPaneProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [noteText, setNoteText] = useState("");
  const [detail, setDetail] = useState<Artifact | null>(null);
  const [boardDragOver, setBoardDragOver] = useState(false);
  const artifactsRef = useRef<Artifact[]>([]);
  const { on, send } = useRoomSocketContext();
  const { ensureNames, getName } = useUserNames();

  // Mirror the latest artifacts so drop handlers (event-time, not render-time) can
  // compute a reorder from the current order without a stale closure.
  useEffect(() => {
    artifactsRef.current = artifacts;
  }, [artifacts]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("rooms")
      .select("artifacts_state")
      .eq("id", roomId)
      .maybeSingle<{ artifacts_state: Artifact[] }>()
      .then(({ data }) => {
        if (data?.artifacts_state) setArtifacts(data.artifacts_state);
      });
  }, [roomId]);

  useEffect(() => {
    ensureNames(artifacts.map((a) => a.author));
  }, [artifacts, ensureNames]);

  useEffect(() => {
    return on("ARTIFACT_UPDATE", (payload) => {
      setArtifacts(payload as Artifact[]);
    });
  }, [on]);

  const authorName = (author: string) => (author === "AI" ? "AI" : getName(author));

  function handleUnpin(id: string) {
    send("UNPIN_ARTIFACT", { id });
  }

  function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    const content = noteText.trim();
    if (!content) return;
    send("ADD_NOTE", { content });
    setNoteText("");
  }

  // Apply a dropped payload: save a dragged chat/diagram (mirrors the buttons), or
  // reorder an existing card before `beforeId` (null = end of board).
  function applyDrop(data: MoodboardDrag, beforeId: string | null) {
    if (data.op === "save") {
      if (data.kind === "idea") {
        send("PIN_IDEA", { message_id: data.message_id, content: data.content, author: data.author });
      } else {
        send("PIN_DIAGRAM", { title: data.title, diagram_type: data.diagram_type, mermaid: data.mermaid });
      }
      return;
    }
    // reorder
    if (data.id === beforeId) return;
    const current = artifactsRef.current;
    const ids = reorderIds(current.map((a) => a.id), data.id, beforeId);
    const byId = new Map(current.map((a) => [a.id, a]));
    const next = ids.map((id) => byId.get(id)).filter((a): a is Artifact => !!a);
    setArtifacts(next); // optimistic; the server echo reconciles
    send("REORDER_ARTIFACTS", { ids });
  }

  function handleBoardDrop(e: React.DragEvent) {
    const data = readMoodboardDrag(e);
    setBoardDragOver(false);
    if (!data) return;
    e.preventDefault();
    applyDrop(data, null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">Moodboard</h2>
      </div>

      <form onSubmit={handleAddNote} className="flex items-center gap-1.5 border-b px-3 py-2">
        <Input
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Jot down an idea…"
          aria-label="Add a note"
          className="h-8"
        />
        <Button type="submit" size="icon-sm" variant="secondary" disabled={!noteText.trim()} title="Add note">
          <Plus />
        </Button>
      </form>

      <ScrollArea className="flex-1">
        <div
          className="@container min-h-full p-3"
          onDragOver={(e) => {
            if (!hasMoodboardDrag(e)) return;
            e.preventDefault();
            setBoardDragOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setBoardDragOver(false);
          }}
          onDrop={handleBoardDrop}
        >
          {artifacts.length === 0 ? (
            <div
              className={[
                "flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground transition-colors",
                boardDragOver ? "border-primary bg-primary/5 text-foreground" : "border-border",
              ].join(" ")}
            >
              Nothing saved yet. Drag a message or a diagram here, or use the 💡 / Save buttons.
            </div>
          ) : (
            <div
              className={[
                "grid grid-cols-1 gap-2 rounded-xl transition-colors @sm:grid-cols-2 @lg:grid-cols-3 [grid-auto-flow:dense]",
                boardDragOver ? "outline-2 outline-offset-4 outline-dashed outline-primary/40" : "",
              ].join(" ")}
            >
              {artifacts.map((a) => (
                <ArtifactCard
                  key={a.id}
                  artifact={a}
                  authorName={authorName(a.author)}
                  onOpen={() => setDetail(a)}
                  onRemove={() => handleUnpin(a.id)}
                  onDropOnCard={(e) => {
                    const data = readMoodboardDrag(e);
                    setBoardDragOver(false);
                    if (data) applyDrop(data, a.id);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <ArtifactDetailDialog
        artifact={detail}
        authorName={detail ? authorName(detail.author) : ""}
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      />
    </div>
  );
}
