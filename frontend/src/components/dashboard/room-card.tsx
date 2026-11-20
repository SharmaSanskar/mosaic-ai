"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CopyCodeButton } from "@/components/copy-code-button";
import { avatarColorFor, initialsFor } from "@/lib/utils";
import type { Room } from "@/lib/types";

interface RoomCardProps {
  room: Room;
  isOwner: boolean;
}

export function RoomCard({ room, isOwner }: RoomCardProps) {
  const router = useRouter();
  const supabase = createClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(room.name);
  const [busy, setBusy] = useState(false);

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    const next = name.trim();
    if (!next || next === room.name) {
      setRenameOpen(false);
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("rename_room", { p_room: room.id, p_name: next });
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Couldn't rename the room");
      return;
    }
    setRenameOpen(false);
    toast.success("Room renamed");
    router.refresh();
  }

  async function handleDelete() {
    setBusy(true);
    const { error } = await supabase.rpc("delete_room", { p_room: room.id });
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Couldn't delete the room");
      return;
    }
    setDeleteOpen(false);
    toast.success("Room deleted");
    router.refresh();
  }

  return (
    <div className="group relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-5 ring-1 ring-foreground/5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:ring-primary/20">
      {/* Stretched link covers the card; content is non-interactive so clicks fall
          through to it, while the action controls sit above with their own events.
          (Buttons can't be nested inside an <a>, hence the overlay pattern.) */}
      <Link
        href={`/room/${room.id}`}
        aria-label={`Open ${room.name}`}
        className="absolute inset-0 z-0 rounded-2xl"
      />

      <div className="pointer-events-none relative z-10 flex items-start justify-between">
        <span
          className="flex size-10 items-center justify-center rounded-xl text-sm font-semibold text-white"
          style={{ backgroundColor: avatarColorFor(room.id) }}
        >
          {initialsFor(room.name)}
        </span>
        <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <div className="pointer-events-none relative z-10">
        <h2 className="truncate font-medium tracking-tight">{room.name}</h2>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {new Date(room.created_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>

      <div className="relative z-10 mt-auto flex items-center justify-between gap-2">
        {room.join_code ? (
          <CopyCodeButton code={room.join_code} stopPropagation />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            title="Rename room"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setName(room.name);
              setRenameOpen(true);
            }}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </button>
          {isOwner && (
            <button
              type="button"
              title="Delete room"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDeleteOpen(true);
              }}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <form onSubmit={handleRename}>
            <DialogHeader>
              <DialogTitle>Rename room</DialogTitle>
              <DialogDescription>Give this room a new name.</DialogDescription>
            </DialogHeader>
            <Input
              className="mt-4"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Room name"
              required
              autoFocus
            />
            <DialogFooter>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{room.name}”?</DialogTitle>
            <DialogDescription>
              This permanently deletes the room and all of its messages, diagrams, and
              moodboard for everyone. This can&rsquo;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              {busy ? "Deleting…" : "Delete room"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
