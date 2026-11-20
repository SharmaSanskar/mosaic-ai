"use client";

import { Lightbulb, Network, StickyNote } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MermaidView } from "@/components/room/mermaid-view";
import type { Artifact, ArtifactKind } from "@/lib/types";

const KIND_ICON = { idea: Lightbulb, diagram: Network, note: StickyNote } as const;

interface ArtifactDetailDialogProps {
  artifact: Artifact | null;
  authorName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ArtifactDetailDialog({
  artifact,
  authorName,
  open,
  onOpenChange,
}: ArtifactDetailDialogProps) {
  if (!artifact) return null;

  const kind = (artifact.kind ?? "note") as ArtifactKind;
  const Icon = KIND_ICON[kind];
  const when = new Date(artifact.created_at).toLocaleString();
  const isDiagram = kind === "diagram";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isDiagram
            ? "flex h-[88vh] max-w-[92vw] flex-col sm:max-w-[92vw]"
            : "max-w-lg"
        }
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" />
            {artifact.title || (kind === "note" ? "Note" : "Saved")}
            {isDiagram && artifact.diagram_type && (
              <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {artifact.diagram_type}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {isDiagram ? (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted/20 p-4">
            {artifact.mermaid && (
              <MermaidView
                code={artifact.mermaid}
                className="flex min-h-full items-center justify-center [&_svg]:max-w-full"
              />
            )}
          </div>
        ) : kind === "idea" ? (
          <div className="flex flex-col gap-4">
            {artifact.content && (
              <p className="text-sm leading-relaxed">{artifact.content}</p>
            )}
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Original message
              </p>
              {artifact.source ? (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {artifact.source}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The original message wasn&rsquo;t captured for this card.
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{artifact.content}</p>
        )}

        <p className="font-mono text-xs text-muted-foreground">
          {authorName} · {when}
        </p>
      </DialogContent>
    </Dialog>
  );
}
