"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { WSEvent, WSEventType } from "@/lib/types";

export type ConnectionStatus = "connecting" | "open" | "closed";

type EventHandler = (payload: unknown) => void;

const MAX_RECONNECT_DELAY_MS = 10000;

export function useRoomSocket(roomId: string) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const socketRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<WSEventType, Set<EventHandler>>>(new Map());

  const on = useCallback((type: WSEventType, handler: EventHandler) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);
    return () => {
      handlersRef.current.get(type)?.delete(handler);
    };
  }, []);

  const send = useCallback((type: WSEventType, payload: unknown) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type, payload }));
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    async function connect() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || cancelled) return;

      const url = `${process.env.NEXT_PUBLIC_WS_URL}/ws?room=${roomId}&token=${session.access_token}`;
      const socket = new WebSocket(url);
      socketRef.current = socket;
      setStatus("connecting");

      socket.onopen = () => {
        reconnectAttempt = 0;
        setStatus("open");
      };

      socket.onmessage = (event) => {
        let parsed: WSEvent;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return; // ignore malformed frame
        }
        handlersRef.current.get(parsed.type)?.forEach((handler) => handler(parsed.payload));
      };

      socket.onclose = () => {
        setStatus("closed");
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY_MS);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [roomId]);

  return { status, on, send };
}
