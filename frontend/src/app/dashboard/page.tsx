import Link from "next/link";
import { Sparkles, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CreateRoomDialog } from "@/components/dashboard/create-room-dialog";
import { LogoutButton } from "@/components/dashboard/logout-button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { avatarColorFor, initialsFor } from "@/lib/utils";
import type { Room } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: rooms } = await supabase
    .from("rooms")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<Room[]>();

  const email = user?.email ?? "";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 p-6 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
          <h1 className="font-mono text-lg font-semibold tracking-tight">mosaic</h1>
        </div>
        <div className="flex items-center gap-3">
          <CreateRoomDialog />
          <div className="flex items-center gap-2">
            <Avatar size="sm">
              <AvatarFallback className="text-white" style={{ backgroundColor: avatarColorFor(user?.id ?? email) }}>
                {initialsFor(email)}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span>
          </div>
          <LogoutButton />
        </div>
      </header>

      <div>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Your rooms
        </h2>
        {!rooms || rooms.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
            <Users className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No rooms yet — create one to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.map((room) => (
              <Link key={room.id} href={`/room/${room.id}`}>
                <Card className="h-full transition-colors hover:border-primary/40 hover:bg-muted/40">
                  <CardHeader>
                    <CardTitle className="truncate">{room.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {new Date(room.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
