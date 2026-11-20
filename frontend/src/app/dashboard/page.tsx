import Link from "next/link";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CreateRoomDialog } from "@/components/dashboard/create-room-dialog";
import { JoinRoomDialog } from "@/components/dashboard/join-room-dialog";
import { RoomCard } from "@/components/dashboard/room-card";
import { ApiKeysDialog } from "@/components/settings/api-keys-dialog";
import { LogoutButton } from "@/components/dashboard/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/brand";
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
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-5">
          <Link href="/">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <ApiKeysDialog />
            <div className="ml-1 flex items-center gap-2 border-l border-border pl-3">
              <Avatar size="sm">
                <AvatarFallback
                  className="text-xs text-white"
                  style={{ backgroundColor: avatarColorFor(user?.id ?? email) }}
                >
                  {initialsFor(email)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden max-w-[12rem] truncate text-sm text-muted-foreground sm:inline">
                {email}
              </span>
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Your rooms</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Shared spaces where your team and your agents think together.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <JoinRoomDialog />
            <CreateRoomDialog />
          </div>
        </div>

        <div className="mt-8">
          {!rooms || rooms.length === 0 ? (
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card/40 py-20 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
                <Users className="size-6" />
              </span>
              <div>
                <p className="font-medium">No rooms yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create your first room, or join one with a share code.
                </p>
              </div>
              <CreateRoomDialog />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  isOwner={!!user && room.created_by === user.id}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
