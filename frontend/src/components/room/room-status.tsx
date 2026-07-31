"use client";

import { useEffect, useState } from "react";
import { useRoomSocketContext } from "@/lib/room-socket-context";
import { cn } from "@/lib/utils";
import type { StatsPayload } from "@/lib/types";

interface RoomStatusProps {
  initialTokens: number;
}

export function RoomStatus({ initialTokens }: RoomStatusProps) {
  const [tokens, setTokens] = useState(initialTokens);
  const { status, on } = useRoomSocketContext();

  useEffect(() => {
    return on("STATS", (payload) => {
      setTokens((payload as StatsPayload).total_tokens_used);
    });
  }, [on]);

  return (
    <div className="ml-auto flex items-center gap-3 font-mono text-xs text-muted-foreground">
      <span>{tokens.toLocaleString()} tokens</span>
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "size-2 rounded-full",
            status === "open" ? "bg-emerald-500" : "bg-destructive animate-pulse",
          )}
        />
        {status === "open" ? "connected" : status}
      </span>
    </div>
  );
}
