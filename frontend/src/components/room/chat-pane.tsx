"use client";

import { useEffect, useRef, useState } from "react";
import { Pin, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useRoomSocketContext } from "@/lib/room-socket-context";
import { useUserNames } from "@/lib/user-names";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, avatarColorFor, initialsFor } from "@/lib/utils";
import type { AIChunkPayload, ChatPayload, SystemPayload } from "@/lib/types";

interface ChatPaneProps {
  roomId: string;
}

const NEAR_BOTTOM_THRESHOLD_PX = 120;

function classifySystemMessage(message: string): "warning" | "error" | "info" {
  const lower = message.toLowerCase();
  if (lower.includes("too fast") || lower.includes("already thinking")) return "warning";
  if (lower.includes("failed") || lower.includes("not configured") || lower.includes("couldn't"))
    return "error";
  return "info";
}

export function ChatPane({ roomId }: ChatPaneProps) {
  const [messages, setMessages] = useState<ChatPayload[]>([]);
  const [streaming, setStreaming] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const streamingRef = useRef<Record<string, string>>({});
  const { status, on, send } = useRoomSocketContext();
  const { ensureNames, getName } = useUserNames();

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));

    supabase
      .from("messages")
      .select("id, user_id, content, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .returns<ChatPayload[]>()
      .then(({ data }) => {
        if (data) setMessages(data);
      });
  }, [roomId]);

  useEffect(() => {
    ensureNames(messages.map((m) => m.user_id));
  }, [messages, ensureNames]);

  useEffect(() => {
    return on("CHAT", (payload) => {
      setMessages((prev) => [...prev, payload as ChatPayload]);
    });
  }, [on]);

  useEffect(() => {
    return on("AI_CHUNK", (payload) => {
      const p = payload as AIChunkPayload;

      if (!p.done) {
        streamingRef.current = {
          ...streamingRef.current,
          [p.generation_id]: (streamingRef.current[p.generation_id] ?? "") + p.chunk,
        };
        setStreaming({ ...streamingRef.current });
        return;
      }

      const text = streamingRef.current[p.generation_id];
      const { [p.generation_id]: _finished, ...rest } = streamingRef.current;
      streamingRef.current = rest;
      setStreaming(rest);

      if (text) {
        setMessages((msgs) => [
          ...msgs,
          {
            id: `ai-${p.generation_id}`,
            user_id: "AI",
            content: text,
            created_at: new Date().toISOString(),
          },
        ]);
      }
    });
  }, [on]);

  useEffect(() => {
    return on("SYSTEM", (payload) => {
      const message = (payload as SystemPayload).message;
      const severity = classifySystemMessage(message);
      if (severity === "warning") toast.warning(message);
      else if (severity === "error") toast.error(message);
      else toast(message);
    });
  }, [on]);

  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streaming]);

  function handleViewportScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_THRESHOLD_PX;
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    send("CHAT", { content });
    setDraft("");
  }

  function handlePin(m: ChatPayload) {
    send("PIN_ARTIFACT", { message_id: m.id, content: m.content, author: m.user_id });
    toast.success("Pinned to moodboard");
  }

  const streamingEntries = Object.entries(streaming);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">Chat</h2>
        {status !== "open" && (
          <span className="font-mono text-xs text-destructive">{status}…</span>
        )}
      </div>
      <ScrollArea
        className="flex-1"
        viewportRef={viewportRef}
        onViewportScroll={handleViewportScroll}
      >
        <div className="flex flex-col gap-3 p-3">
          {messages.length === 0 && streamingEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No messages yet. Say hello, or tag @AI to bring in the assistant.
            </p>
          ) : (
            <>
              {messages.map((m) => {
                const isAI = m.user_id === "AI";
                const isOwn = !isAI && m.user_id === userId;
                const name = isAI ? "AI" : getName(m.user_id);

                return (
                  <div
                    key={m.id}
                    className={cn("group flex items-end gap-2", isOwn && "flex-row-reverse")}
                  >
                    {!isOwn && (
                      <Avatar size="sm" className="mb-0.5 shrink-0">
                        {isAI ? (
                          <AvatarFallback className="bg-ai text-ai-foreground">
                            <Sparkles className="size-3" />
                          </AvatarFallback>
                        ) : (
                          <AvatarFallback
                            className="text-white"
                            style={{ backgroundColor: avatarColorFor(m.user_id) }}
                          >
                            {initialsFor(name)}
                          </AvatarFallback>
                        )}
                      </Avatar>
                    )}
                    <div className={cn("flex max-w-[75%] flex-col gap-1", isOwn && "items-end")}>
                      {!isOwn && (
                        <span className="px-1 text-xs font-medium text-muted-foreground">
                          {name}
                        </span>
                      )}
                      <div className="flex items-center gap-1">
                        <div
                          className={cn(
                            "rounded-2xl px-3 py-2 text-sm leading-relaxed",
                            isAI
                              ? "bg-ai-subtle text-foreground"
                              : isOwn
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-foreground",
                          )}
                        >
                          {m.content}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={() => handlePin(m)}
                          title="Pin to moodboard"
                        >
                          <Pin />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {streamingEntries.map(([generationId, text]) => (
                <div key={generationId} className="flex items-end gap-2">
                  <Avatar size="sm" className="mb-0.5 shrink-0">
                    <AvatarFallback className="bg-ai text-ai-foreground">
                      <Sparkles className="size-3 animate-pulse" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex max-w-[75%] flex-col gap-1">
                    <span className="px-1 text-xs font-medium text-muted-foreground">
                      AI is typing…
                    </span>
                    <div className="rounded-2xl bg-ai-subtle px-3 py-2 text-sm leading-relaxed text-foreground">
                      {text}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
          <div ref={scrollAnchorRef} />
        </div>
      </ScrollArea>
      <form onSubmit={handleSend} className="flex gap-2 border-t p-3">
        <Input
          placeholder="Message… (try @AI)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={status !== "open"}
        />
        <Button type="submit" disabled={status !== "open" || !draft.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
