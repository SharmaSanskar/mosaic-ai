"use client";

import { useEffect, useState } from "react";
import { Bot, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useRoomAgents } from "@/lib/room-agents";
import { useRoomSocketContext } from "@/lib/room-socket-context";
import { listKeys } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ApiKey } from "@/lib/types";

interface AgentsDialogProps {
  roomId: string;
}

const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google (Gemini)" },
];

const MODEL_PLACEHOLDER: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
  google: "gemini-1.5-flash",
};

function sanitizeHandle(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

export function AgentsDialog({ roomId }: AgentsDialogProps) {
  const [open, setOpen] = useState(false);
  const { agents, refetch } = useRoomAgents(roomId);
  const { send, on } = useRoomSocketContext();

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [keyId, setKeyId] = useState("");
  const [color, setColor] = useState("#4a3aa7");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      try {
        const k = await listKeys();
        if (active) setKeys(k);
      } catch {
        // Non-fatal: the key dropdown just stays empty.
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  // Keep the list fresh when anyone changes the room's agents.
  useEffect(() => {
    return on("AGENTS_UPDATE", () => void refetch());
  }, [on, refetch]);

  const keysForProvider = keys.filter((k) => k.provider === provider);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const cleanHandle = sanitizeHandle(handle);
    if (!name.trim() || !cleanHandle || !model.trim()) {
      toast.error("Name, handle, and model are required");
      return;
    }
    if (provider !== "openai" && !keyId) {
      toast.error(`Select one of your ${provider} keys (add one under “API keys”).`);
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: agent, error: insertErr } = await supabase
        .from("agents")
        .insert({
          owner_id: user.id,
          name: name.trim(),
          handle: cleanHandle,
          system_prompt: systemPrompt.trim(),
          provider,
          model: model.trim(),
          api_key_id: provider === "openai" && !keyId ? null : keyId || null,
          color,
        })
        .select("id")
        .single();
      if (insertErr || !agent) throw new Error(insertErr?.message ?? "Failed to create agent");

      const { error: linkErr } = await supabase
        .from("room_agents")
        .insert({ room_id: roomId, agent_id: agent.id, added_by: user.id });
      if (linkErr) throw new Error(linkErr.message);

      send("AGENTS_CHANGED", {});
      await refetch();
      setName("");
      setHandle("");
      setSystemPrompt("");
      setModel("");
      setKeyId("");
      toast.success(`@${cleanHandle} added to the room`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(agentId: string) {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("room_agents")
        .delete()
        .eq("room_id", roomId)
        .eq("agent_id", agentId);
      if (error) throw new Error(error.message);
      send("AGENTS_CHANGED", {});
      await refetch();
      toast.success("Agent removed from room");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove agent");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="secondary" size="icon-sm" title="Manage agents" />}
      >
        <Bot />
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agents in this room</DialogTitle>
          <DialogDescription>
            Platform agents are always available. Add your own to bring in different
            models — use an OpenAI persona, or your Anthropic/Gemini key.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-48 flex-col gap-2 overflow-auto">
          {agents.map((a) => {
            const isPlatform = a.owner_id === null;
            return (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: a.color ?? "var(--ai)" }}
                  />
                  <span className="font-medium">{a.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    @{a.handle} · {a.model}
                  </span>
                </div>
                {isPlatform ? (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    default
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleRemove(a.id)}
                    title="Remove from room"
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <form onSubmit={handleCreate} className="flex flex-col gap-2 border-t pt-3">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Name (e.g. Planner)" value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              placeholder="handle (e.g. planner)"
              value={handle}
              onChange={(e) => setHandle(sanitizeHandle(e.target.value))}
            />
          </div>
          <textarea
            placeholder="System prompt / persona"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={2}
            className="rounded-md border bg-transparent px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setKeyId("");
              }}
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <Input
              placeholder={MODEL_PLACEHOLDER[provider]}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              className="h-9 flex-1 rounded-md border bg-transparent px-3 text-sm"
            >
              <option value="">
                {provider === "openai" ? "Platform key (default)" : "Select a key…"}
              </option>
              {keysForProvider.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label || k.provider} ••••{k.last4}
                </option>
              ))}
            </select>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-10 rounded-md border bg-transparent"
              title="Accent color"
            />
          </div>
          {provider !== "openai" && keysForProvider.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No {provider} keys yet — add one under “API keys” on the dashboard.
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add agent to room"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
