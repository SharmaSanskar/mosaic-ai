"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
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

export function JoinRoomDialog() {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.rpc("join_room", {
      p_code: code.trim().toLowerCase(),
    });

    setLoading(false);

    if (error || !data) {
      toast.error(
        error?.message?.includes("room not found")
          ? "No room with that code"
          : (error?.message ?? "Could not join room"),
      );
      return;
    }

    setCode("");
    setOpen(false);
    router.push(`/room/${data}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <LogIn className="size-4" />
        Join room
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleJoin}>
          <DialogHeader>
            <DialogTitle>Join a room</DialogTitle>
            <DialogDescription>
              Enter the share code someone gave you.
            </DialogDescription>
          </DialogHeader>
          <Input
            className="mt-4 font-mono"
            placeholder="e.g. a1b2c3d4"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus
          />
          <DialogFooter>
            <Button type="submit" disabled={loading || !code.trim()}>
              {loading ? "Joining…" : "Join"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
