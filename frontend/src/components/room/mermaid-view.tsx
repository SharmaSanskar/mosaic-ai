"use client";

import { useEffect, useState } from "react";

// mermaid is browser-only (it touches the DOM), so it's imported dynamically
// inside the effect — see Next's "Loading External Libraries" guidance for client
// components. This is a read-only renderer for already-valid Mermaid source (saved
// diagram cards); it does not attempt the backend repair round-trip the live viz
// pane does.
function mermaidTheme(): "dark" | "default" {
  if (typeof window === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "default";
}

let renderSeq = 0;

interface MermaidViewProps {
  code: string;
  className?: string;
}

export function MermaidView({ code, className }: MermaidViewProps) {
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  const [themeTick, setThemeTick] = useState(0);

  // Re-render when the theme (the .dark class on <html>) changes.
  useEffect(() => {
    const bump = () => setThemeTick((t) => t + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const trimmed = code?.trim() ?? "";

    (async () => {
      if (!trimmed) {
        if (!cancelled) {
          setSvg("");
          setFailed(false);
        }
        return;
      }
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: mermaidTheme(),
          securityLevel: "strict", // sanitize model-authored source
          fontFamily: "inherit",
          logLevel: "fatal", // failures are handled in the catch; keep the console quiet
        });
        await mermaid.parse(trimmed);
        const { svg: rendered } = await mermaid.render(`mosaic-card-${++renderSeq}`, trimmed);
        if (cancelled) return;
        setSvg(rendered);
        setFailed(false);
      } catch {
        if (cancelled) return;
        setSvg("");
        setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, themeTick]);

  if (failed) {
    return (
      <p className="text-xs text-muted-foreground">Diagram preview unavailable.</p>
    );
  }

  return (
    <div
      className={className}
      // SVG is produced by mermaid with securityLevel "strict", which sanitizes
      // the source before it reaches the DOM.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
