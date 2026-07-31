import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RoomShell } from "@/components/room/room-shell";
import type { Room } from "@/lib/types";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: room } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", id)
    .maybeSingle<Room>();

  if (!room) {
    notFound();
  }

  return <RoomShell room={room} />;
}
