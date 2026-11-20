"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Lightbulb, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useRoomSocketContext } from "@/lib/room-socket-context";
import { useUserNames } from "@/lib/user-names";
import { useRoomAgents } from "@/lib/room-agents";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Markdown } from "@/components/room/markdown";
import { setMoodboardDrag } from "@/lib/moodboard-dnd";
import { cn, avatarColorFor, initialsFor } from "@/lib/utils";
import type { AIChunkPayload, ChatPayload, SystemPayload, TypingPayload } from "@/lib/types";

interface ChatPaneProps {
  roomId: string;
}

const NEAR_BOTTOM_THRESHOLD_PX = 120;

// An in-flight agent generation being streamed into the chat.
interface StreamingEntry {
  text: string;
  agentId: string;
  agentName: string;
  agentColor?: string;
}

function classifySystemMessage(message: string): "warning" | "error" | "info" {
  const lower = message.toLowerCase();
  if (lower.includes("too fast") || lower.includes("already thinking")) return "warning";
  if (lower.includes("failed") || lower.includes("not configured") || lower.includes("couldn't"))
    return "error";
  return "info";
}

export function ChatPane({ roomId }: ChatPaneProps) {
  const [messages, setMessages] = useState<ChatPayload[]>([]);
  const [streaming, setStreaming] = useState<Record<string, StreamingEntry>>({});
  const [draft, setDraft] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  // @-mention autocomplete: the active token being typed (null = closed), and the
  // highlighted suggestion.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const streamingRef = useRef<Record<string, StreamingEntry>>({});
  const { status, on, send } = useRoomSocketContext();
  const { ensureNames, getName } = useUserNames();
  const { agents, getAgent, refetch: refetchAgents } = useRoomAgents(roomId);

  // userId -> expiry timestamp; pruned on an interval so a missed "stop" clears.
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({});
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  // Resolve a message author to AI-side display info, or null if it's a human.
  // Agent messages are stored as "agent:<id>"; "AI" is a legacy generic author.
  function aiAuthorInfo(authorId: string): { name: string; color?: string } | null {
    if (authorId === "AI") return { name: "AI" };
    if (authorId.startsWith("agent:")) {
      const agent = getAgent(authorId.slice("agent:".length));
      return { name: agent?.name ?? "AI", color: agent?.color ?? undefined };
    }
    return null;
  }

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
    // Only resolve human author ids; agent ("agent:<id>") and legacy "AI"
    // authors are named from the agents list, not the users table.
    ensureNames(
      messages
        .filter((m) => m.user_id !== "AI" && !m.user_id.startsWith("agent:"))
        .map((m) => m.user_id),
    );
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
        const prev = streamingRef.current[p.generation_id];
        streamingRef.current = {
          ...streamingRef.current,
          [p.generation_id]: {
            text: (prev?.text ?? "") + p.chunk,
            agentId: p.agent_id,
            agentName: p.agent_name,
            agentColor: p.agent_color,
          },
        };
        setStreaming({ ...streamingRef.current });
        return;
      }

      const entry = streamingRef.current[p.generation_id];
      const rest = { ...streamingRef.current };
      delete rest[p.generation_id];
      streamingRef.current = rest;
      setStreaming(rest);

      if (entry?.text) {
        setMessages((msgs) => [
          ...msgs,
          {
            id: `ai-${p.generation_id}`,
            user_id: entry.agentId ? `agent:${entry.agentId}` : "AI",
            content: entry.text,
            created_at: new Date().toISOString(),
          },
        ]);
      }
    });
  }, [on]);

  useEffect(() => {
    return on("AGENTS_UPDATE", () => void refetchAgents());
  }, [on, refetchAgents]);

  useEffect(() => {
    return on("TYPING", (payload) => {
      const p = payload as TypingPayload;
      if (p.user_id === userId) return; // ignore our own echo
      setTypingUsers((prev) => {
        const next = { ...prev };
        if (p.is_typing) next[p.user_id] = Date.now() + 5000;
        else delete next[p.user_id];
        return next;
      });
    });
  }, [on, userId]);

  // Prune stale typing entries (in case a "stop" event was missed).
  useEffect(() => {
    const interval = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const next: Record<string, number> = {};
        let changed = false;
        for (const [id, exp] of Object.entries(prev)) {
          if (exp > now) next[id] = exp;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    ensureNames(Object.keys(typingUsers));
  }, [typingUsers, ensureNames]);

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

  // Throttled typing signal: send "typing" at most every 2s, and schedule a
  // "stopped" after a short idle gap. TYPING frames bypass the chat rate limit.
  function notifyTyping() {
    const now = Date.now();
    if (now - lastTypingSent.current > 2000) {
      send("TYPING", { is_typing: true });
      lastTypingSent.current = now;
    }
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = setTimeout(stopTyping, 2500);
  }

  function stopTyping() {
    if (typingStopTimer.current) {
      clearTimeout(typingStopTimer.current);
      typingStopTimer.current = null;
    }
    if (lastTypingSent.current !== 0) {
      send("TYPING", { is_typing: false });
      lastTypingSent.current = 0;
    }
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    send("CHAT", { content });
    setDraft("");
    setMentionQuery(null);
    stopTyping();
  }

  // Suggestions for the @-token currently being typed (empty query = all agents).
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return agents.filter((a) => a.handle.toLowerCase().startsWith(q)).slice(0, 6);
  }, [mentionQuery, agents]);

  const mentionOpen = mentionSuggestions.length > 0;
  const activeMention = Math.min(mentionIndex, mentionSuggestions.length - 1);

  // Recompute the active @-token from the text up to the caret.
  function syncMention(value: string, caret: number) {
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\w-]*)$/);
    if (m) {
      setMentionQuery(m[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  function handleDraftChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setDraft(value);
    notifyTyping();
    syncMention(value, e.target.selectionStart ?? value.length);
  }

  function selectMention(handle: string) {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\w-]*)$/);
    if (!m) return;
    const atIndex = caret - m[1].length - 1; // position of the '@'
    const insert = `@${handle} `;
    const next = draft.slice(0, atIndex) + insert + draft.slice(caret);
    const nextCaret = atIndex + insert.length;
    setDraft(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (node) {
        node.focus();
        node.setSelectionRange(nextCaret, nextCaret);
      }
    });
  }

  function handleComposerKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!mentionOpen) return;
    const n = mentionSuggestions.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIndex((i) => (Math.min(i, n - 1) + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIndex((i) => (Math.min(i, n - 1) - 1 + n) % n);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectMention(mentionSuggestions[activeMention].handle);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMentionQuery(null);
    }
  }

  function handleSaveIdea(m: ChatPayload) {
    send("PIN_IDEA", { message_id: m.id, content: m.content, author: m.user_id });
    toast.success("Saving idea to moodboard…");
  }

  const streamingEntries = Object.entries(streaming);
  const typingNames = Object.keys(typingUsers).map(getName);
  const typingLabel =
    typingNames.length === 1
      ? `${typingNames[0]} is typing…`
      : typingNames.length === 2
        ? `${typingNames[0]} and ${typingNames[1]} are typing…`
        : typingNames.length > 2
          ? "Several people are typing…"
          : "";
  const mentionHint =
    agents.length > 0
      ? `Message… (try ${agents.slice(0, 3).map((a) => "@" + a.handle).join(", ")})`
      : "Message…";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">Chat</h2>
        {status !== "open" && (
          <span className="font-mono text-xs text-destructive">{status}…</span>
        )}
      </div>
      {agents.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Agents</span>
          {agents.map((a) => (
            <span
              key={a.id}
              className="flex items-center gap-1 text-[11px] text-muted-foreground"
              title={a.name}
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: a.color ?? "var(--ai)" }}
              />
              @{a.handle}
            </span>
          ))}
        </div>
      )}
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
                const aiInfo = aiAuthorInfo(m.user_id);
                const isAI = aiInfo !== null;
                const isOwn = !isAI && m.user_id === userId;
                const name = aiInfo ? aiInfo.name : getName(m.user_id);

                return (
                  <div
                    key={m.id}
                    className={cn("group flex items-end gap-2", isOwn && "flex-row-reverse")}
                  >
                    {!isOwn && (
                      <Avatar size="sm" className="mb-0.5 shrink-0">
                        {isAI ? (
                          <AvatarFallback
                            className={aiInfo?.color ? "text-white" : "bg-ai text-ai-foreground"}
                            style={aiInfo?.color ? { backgroundColor: aiInfo.color } : undefined}
                          >
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
                          draggable
                          onDragStart={(e) =>
                            setMoodboardDrag(e, {
                              op: "save",
                              kind: "idea",
                              message_id: m.id,
                              content: m.content,
                              author: m.user_id,
                            })
                          }
                          title="Drag to the moodboard to save as an idea"
                          className={cn(
                            "cursor-grab rounded-2xl px-3 py-2 text-sm leading-relaxed active:cursor-grabbing",
                            isAI
                              ? "bg-ai-subtle text-foreground"
                              : isOwn
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-foreground",
                          )}
                        >
                          {isAI ? <Markdown>{m.content}</Markdown> : m.content}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={() => handleSaveIdea(m)}
                          title="Save as idea"
                        >
                          <Lightbulb />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {streamingEntries.map(([generationId, entry]) => (
                <div key={generationId} className="flex items-end gap-2">
                  <Avatar size="sm" className="mb-0.5 shrink-0">
                    <AvatarFallback
                      className={entry.agentColor ? "text-white" : "bg-ai text-ai-foreground"}
                      style={entry.agentColor ? { backgroundColor: entry.agentColor } : undefined}
                    >
                      <Sparkles className="size-3 animate-pulse" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex max-w-[75%] flex-col gap-1">
                    <span className="px-1 text-xs font-medium text-muted-foreground">
                      {entry.agentName || "AI"} is typing…
                    </span>
                    <div className="rounded-2xl bg-ai-subtle px-3 py-2 text-sm leading-relaxed text-foreground">
                      <Markdown>{entry.text}</Markdown>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
          <div ref={scrollAnchorRef} />
        </div>
      </ScrollArea>
      <div className="h-5 px-3 text-xs italic text-muted-foreground">
        {typingLabel}
      </div>
      <form onSubmit={handleSend} className="relative flex gap-2 border-t p-3">
        {mentionOpen && (
          <div
            className="absolute bottom-full left-3 z-20 mb-1 w-64 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-md"
            role="listbox"
          >
            {mentionSuggestions.map((a, i) => (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={i === activeMention}
                // onMouseDown (not onClick) so selection happens before the input blurs.
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectMention(a.handle);
                }}
                onMouseEnter={() => setMentionIndex(i)}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm",
                  i === activeMention ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: a.color ?? "var(--ai)" }}
                />
                <span className="font-medium">@{a.handle}</span>
                <span className="truncate text-xs text-muted-foreground">{a.name}</span>
              </button>
            ))}
          </div>
        )}
        <Input
          ref={inputRef}
          placeholder={mentionHint}
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={handleComposerKeyDown}
          disabled={status !== "open"}
        />
        <Button type="submit" disabled={status !== "open" || !draft.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
