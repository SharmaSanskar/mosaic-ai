"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CopyCodeButtonProps {
  code: string;
  className?: string;
  // When true, stop the click from bubbling (e.g. inside a card that's a link).
  stopPropagation?: boolean;
}

export function CopyCodeButton({ code, className, stopPropagation }: CopyCodeButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Share code copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy the code");
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy share code"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {copied ? <Check className="size-3 text-primary" /> : <Copy className="size-3" />}
      <span>code {code}</span>
    </button>
  );
}
