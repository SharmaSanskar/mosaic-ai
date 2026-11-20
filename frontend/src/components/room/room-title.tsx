"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { CopyCodeButton } from "@/components/copy-code-button";

interface RoomTitleProps {
  roomId: string;
  initialName: string;
  joinCode?: string;
}

export function RoomTitle({ roomId, initialName, joinCode }: RoomTitleProps) {
  const supabase = createClient();
  const [name, setName] = useState(initialName);
  const [draft, setDraft] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  function cancel() {
    setDraft(name);
    setEditing(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const next = draft.trim();
    if (!next || next === name) {
      cancel();
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("rename_room", { p_room: roomId, p_name: next });
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Couldn't rename the room");
      return;
    }
    setName(next);
    setEditing(false);
    toast.success("Room renamed");
  }

  if (editing) {
    return (
      <form onSubmit={save} className="flex items-center gap-1">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
          disabled={busy}
          aria-label="Room name"
          className="h-7 w-44 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          title="Save name"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <Check className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={cancel}
          title="Cancel"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </form>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        title="Rename room"
        className="group/title flex min-w-0 items-center gap-1"
      >
        <h1 className="truncate text-sm font-semibold tracking-tight">{name}</h1>
        <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100" />
      </button>
      {joinCode && <CopyCodeButton code={joinCode} className="hidden md:inline-flex" />}
    </div>
  );
}
