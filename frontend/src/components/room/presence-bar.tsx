"use client";

import { useEffect, useState } from "react";
import { useRoomSocketContext } from "@/lib/room-socket-context";
import { useUserNames } from "@/lib/user-names";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { avatarColorFor, initialsFor } from "@/lib/utils";
import type { PresencePayload } from "@/lib/types";

// Shows stacked avatars of everyone currently connected to the room, driven by
// the hub's PRESENCE broadcasts (deduped per user, so multiple tabs count once).
export function PresenceBar() {
  const { on } = useRoomSocketContext();
  const { ensureNames, getName } = useUserNames();
  const [users, setUsers] = useState<string[]>([]);

  useEffect(() => {
    return on("PRESENCE", (payload) => {
      setUsers((payload as PresencePayload).users ?? []);
    });
  }, [on]);

  useEffect(() => {
    ensureNames(users);
  }, [users, ensureNames]);

  if (users.length === 0) return null;

  const shown = users.slice(0, 5);
  const extra = users.length - shown.length;

  return (
    <div className="flex items-center -space-x-2" title={`${users.length} online`}>
      {shown.map((id) => {
        const name = getName(id);
        return (
          <Avatar key={id} size="sm" className="ring-2 ring-card">
            <AvatarFallback
              className="text-[10px] text-white"
              style={{ backgroundColor: avatarColorFor(id) }}
              title={name}
            >
              {initialsFor(name)}
            </AvatarFallback>
          </Avatar>
        );
      })}
      {extra > 0 && (
        <span className="z-10 flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-card">
          +{extra}
        </span>
      )}
    </div>
  );
}
