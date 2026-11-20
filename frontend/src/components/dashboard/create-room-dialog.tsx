"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  DialogTrigger,
} from "@/components/ui/dialog";

export function CreateRoomDialog() {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.rpc("create_room", { p_name: name });

    setLoading(false);

    const room = Array.isArray(data) ? data[0] : data;
    if (error || !room) {
      toast.error(error?.message ?? "Could not create room");
      return;
    }

    setName("");
    setOpen(false);
    toast.success(`Room created · share code ${room.join_code}`);
    router.push(`/room/${room.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>Create room</DialogTrigger>
      <DialogContent>
        <form onSubmit={handleCreate}>
          <DialogHeader>
            <DialogTitle>Create a new room</DialogTitle>
            <DialogDescription>
              Give your collaborative workspace a name.
            </DialogDescription>
          </DialogHeader>
          <Input
            className="mt-4"
            placeholder="Room name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
          <DialogFooter>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
