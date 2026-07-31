"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useRoomSocket, type ConnectionStatus } from "@/lib/ws";
import type { WSEventType } from "@/lib/types";

interface RoomSocketContextValue {
  status: ConnectionStatus;
  on: (type: WSEventType, handler: (payload: unknown) => void) => () => void;
  send: (type: WSEventType, payload: unknown) => void;
}

const RoomSocketContext = createContext<RoomSocketContextValue | null>(null);

// One WebSocket connection per room, shared by every pane. Each pane used to
// call useRoomSocket independently, which meant up to 4 separate Client
// registrations (and 4 separate rate-limit buckets) in the Go hub for one
// human — this fixes that by connecting exactly once per room.
export function RoomSocketProvider({
  roomId,
  children,
}: {
  roomId: string;
  children: ReactNode;
}) {
  const { status, on, send } = useRoomSocket(roomId);
  const value = useMemo(() => ({ status, on, send }), [status, on, send]);

  return <RoomSocketContext.Provider value={value}>{children}</RoomSocketContext.Provider>;
}

export function useRoomSocketContext() {
  const ctx = useContext(RoomSocketContext);
  if (!ctx) {
    throw new Error("useRoomSocketContext must be used within a RoomSocketProvider");
  }
  return ctx;
}
