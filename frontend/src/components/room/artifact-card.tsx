"use client";

import { useRef, useState } from "react";
import { Lightbulb, Network, StickyNote, X } from "lucide-react";
import { MermaidView } from "@/components/room/mermaid-view";
import { avatarColorFor } from "@/lib/utils";
import {
  hasMoodboardDrag,
  setMoodboardDrag,
  type MoodboardDrag,
} from "@/lib/moodboard-dnd";
import type { Artifact, ArtifactKind } from "@/lib/types";

const KIND_ICON = { idea: Lightbulb, diagram: Network, note: StickyNote } as const;
const KIND_ACCENT: Record<ArtifactKind, string> = {
  idea: "var(--ai)",
  diagram: "var(--primary)",
  note: "var(--muted-foreground)",
};

interface ArtifactCardProps {
  artifact: Artifact;
  authorName: string;
  onOpen: () => void;
  onRemove: () => void;
  // Drop occurred on this card — the board inserts the dragged card before it, or
  // saves a dragged chat/diagram. The board reads the payload from the event.
  onDropOnCard: (e: React.DragEvent) => void;
}

export function ArtifactCard({
  artifact,
  authorName,
  onOpen,
  onRemove,
  onDropOnCard,
}: ArtifactCardProps) {
  const kind = (artifact.kind ?? "note") as ArtifactKind;
  const Icon = KIND_ICON[kind];
  const accent = KIND_ACCENT[kind];
  const isDiagram = kind === "diagram";
  const [dropTarget, setDropTarget] = useState(false);
  const lastDragEnd = useRef(0);

  const reorderPayload: MoodboardDrag = { op: "reorder", id: artifact.id };

  return (
    <div
      draggable
      onDragStart={(e) => setMoodboardDrag(e, reorderPayload)}
      onDragEnd={() => {
        lastDragEnd.current = Date.now();
        setDropTarget(false);
      }}
      onDragOver={(e) => {
        if (!hasMoodboardDrag(e)) return;
        e.preventDefault();
        setDropTarget(true);
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(e) => {
        if (!hasMoodboardDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(false);
        onDropOnCard(e);
      }}
      onClick={() => {
        // Native DnD normally suppresses the post-drag click; this guards the edge.
        if (Date.now() - lastDragEnd.current < 250) return;
        onOpen();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={[
        "group/card relative flex h-full cursor-grab flex-col gap-2 rounded-xl bg-card p-3 text-left ring-1 transition active:cursor-grabbing",
        "hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dropTarget ? "ring-2 ring-primary" : "ring-foreground/10 hover:ring-foreground/25",
        isDiagram ? "@sm:col-span-2" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-lg"
          style={{ color: accent, backgroundColor: `color-mix(in oklch, ${accent} 15%, transparent)` }}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          {artifact.title ? (
            <p className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight">
              {artifact.title}
            </p>
          ) : (
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {kind}
            </p>
          )}
          {isDiagram && artifact.diagram_type && (
            <span className="mt-0.5 inline-block rounded-full bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
              {artifact.diagram_type}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove"
          className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/card:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {isDiagram && artifact.mermaid ? (
        <div className="pointer-events-none min-h-24 flex-1 overflow-hidden rounded-md bg-muted/30 p-2">
          <MermaidView code={artifact.mermaid} className="[&_svg]:max-h-48 [&_svg]:max-w-full" />
        </div>
      ) : (
        artifact.content && (
          <p className="line-clamp-4 flex-1 text-sm leading-relaxed">{artifact.content}</p>
        )
      )}

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: avatarColorFor(artifact.author) }}
        />
        <span className="truncate font-mono">{authorName}</span>
      </div>
    </div>
  );
}
