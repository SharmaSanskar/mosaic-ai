"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookmarkPlus, Minus, Plus, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useRoomSocketContext } from "@/lib/room-socket-context";
import { Button } from "@/components/ui/button";
import { setMoodboardDrag } from "@/lib/moodboard-dnd";
import type { VizState } from "@/lib/types";

interface VizPaneProps {
  roomId: string;
}

type RenderStatus = "empty" | "rendering" | "ready" | "repairing" | "error";

// mermaid is browser-only (it touches the DOM), so it's imported dynamically
// inside the effect rather than at module scope — see Next's "Loading External
// Libraries" guidance for client components.
function mermaidTheme(): "dark" | "default" {
  if (typeof window === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "default";
}

let renderSeq = 0;

export function VizPane({ roomId }: VizPaneProps) {
  const [viz, setViz] = useState<VizState | null>(null);
  const [svg, setSvg] = useState<string>("");
  const [status, setStatus] = useState<RenderStatus>("empty");
  const [zoom, setZoom] = useState(1);
  const [themeTick, setThemeTick] = useState(0);
  const { on, send } = useRoomSocketContext();

  // Guards against an infinite repair loop: we only ask the backend to fix a
  // given Mermaid string once. A genuinely new VIZ_UPDATE (different source)
  // is eligible for its own single repair attempt.
  const repairedCodeRef = useRef<string | null>(null);

  // Initial load from the persisted column.
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("rooms")
      .select("viz_state")
      .eq("id", roomId)
      .maybeSingle<{ viz_state: VizState }>()
      .then(({ data }) => {
        if (data?.viz_state && data.viz_state.mermaid) setViz(data.viz_state);
      });
  }, [roomId]);

  // Live updates (including repaired diagrams coming back from the backend).
  useEffect(() => {
    return on("VIZ_UPDATE", (payload) => {
      setViz(payload as VizState);
    });
  }, [on]);

  // Re-render when the theme (the .dark class on <html>) changes.
  useEffect(() => {
    const bump = () => setThemeTick((t) => t + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const code = viz?.mermaid?.trim() ?? "";

  // Render (and validate / repair) whenever the diagram or theme changes. All
  // state updates happen inside the async callback (not synchronously in the
  // effect body) to avoid cascading renders.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!code) {
        if (!cancelled) {
          setSvg("");
          setStatus("empty");
        }
        return;
      }

      setStatus("rendering");
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: mermaidTheme(),
          securityLevel: "strict", // sanitize model-authored source
          fontFamily: "inherit",
          logLevel: "fatal", // we handle parse failures ourselves; don't spam the console
        });

        // parse() throws on invalid syntax without touching the DOM.
        await mermaid.parse(code);
        const { svg: rendered } = await mermaid.render(`mosaic-viz-${++renderSeq}`, code);
        if (cancelled) return;
        setSvg(rendered);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);

        // Ask the backend to repair this exact source, at most once.
        if (repairedCodeRef.current !== code) {
          repairedCodeRef.current = code;
          setStatus("repairing");
          send("VIZ_REPAIR", { code, error: message });
        } else {
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, themeTick, send]);

  // Safety net: a parse failure asks the backend to repair the diagram and sets
  // status "repairing" while awaiting a VIZ_UPDATE. If that repair also fails the
  // backend stays silent, so without this the pane would hang on "repairing…"
  // forever. After a grace period, fall back to the error state (which already
  // says it'll refresh on the next @AI reply).
  useEffect(() => {
    if (status !== "repairing") return;
    const timer = setTimeout(() => setStatus("error"), 15000);
    return () => clearTimeout(timer);
  }, [status]);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.2, 3)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.2, 0.4)), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  const saveToBoard = useCallback(() => {
    if (!code) return;
    send("PIN_DIAGRAM", {
      title: viz?.title ?? "Saved diagram",
      diagram_type: viz?.diagram_type,
      mermaid: code,
    });
    toast.success("Saved to moodboard");
  }, [code, viz?.title, viz?.diagram_type, send]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-y-1 border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight">
            {viz?.title || "Reasoning map"}
          </h2>
          {viz?.diagram_type && (
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {viz.diagram_type}
            </span>
          )}
        </div>
        {status === "ready" && (
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon-sm" onClick={zoomOut} title="Zoom out">
              <Minus />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={zoomReset} title="Reset zoom">
              <Maximize2 />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={zoomIn} title="Zoom in">
              <Plus />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="ml-1"
              onClick={saveToBoard}
              title="Save this diagram to the moodboard"
              data-icon="inline-start"
            >
              <BookmarkPlus />
              Save
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-muted/20">
        {status === "empty" && (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            No visualization yet — tag @AI in chat and one will build itself here.
          </div>
        )}

        {status === "rendering" && (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Rendering diagram…
          </div>
        )}

        {status === "repairing" && (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            The AI produced a diagram that needs a quick fix — repairing…
          </div>
        )}

        {status === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{viz?.title || "Diagram unavailable"}</span>
            <span>Couldn’t render this visualization. It will refresh on the next @AI reply.</span>
          </div>
        )}

        {status === "ready" && (
          <div
            className="p-4"
            draggable
            onDragStart={(e) =>
              setMoodboardDrag(e, {
                op: "save",
                kind: "diagram",
                title: viz?.title ?? "Saved diagram",
                diagram_type: viz?.diagram_type,
                mermaid: code,
              })
            }
            title="Drag to the moodboard to save this diagram"
          >
            <div
              className="origin-top-left transition-transform"
              style={{ transform: `scale(${zoom})` }}
              // SVG is produced by mermaid with securityLevel "strict", which
              // sanitizes the model-authored source before it reaches the DOM.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
