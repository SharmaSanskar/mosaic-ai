"use client";

import { useEffect, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { listKeys, createKey, deleteKey } from "@/lib/api";
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

const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google (Gemini)" },
];

export function ApiKeysDialog() {
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [provider, setProvider] = useState("anthropic");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      try {
        const k = await listKeys();
        if (active) setKeys(k);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load keys");
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    try {
      await createKey({ provider, label: label.trim(), key: key.trim() });
      setKey("");
      setLabel("");
      toast.success("Key saved (encrypted)");
      setKeys(await listKeys());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteKey(id);
      toast.success("Key removed");
      setKeys(await listKeys());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete key");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <KeyRound className="size-4" />
        API keys
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Your API keys</DialogTitle>
          <DialogDescription>
            Add a provider key to run your own agents on Anthropic or Gemini. Keys are
            encrypted on the server and never shown again.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No keys yet.</p>
          ) : (
            keys.map((k) => (
              <div
                key={k.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex flex-col">
                  <span className="font-medium">
                    {k.label || PROVIDERS.find((p) => p.value === k.provider)?.label || k.provider}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {k.provider} · ••••{k.last4}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleDelete(k.id)}
                  title="Delete key"
                >
                  <Trash2 />
                </Button>
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleAdd} className="flex flex-col gap-2 border-t pt-3">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <Input
            placeholder="Label (optional, e.g. 'My Anthropic key')"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Input
            type="password"
            placeholder="Paste API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
          />
          <Button type="submit" disabled={busy || !key.trim()}>
            {busy ? "Saving…" : "Add key"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
