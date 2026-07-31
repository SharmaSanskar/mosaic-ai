"use client";

import { useEffect, useState } from "react";
import { PinOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRoomSocketContext } from "@/lib/room-socket-context";
import { useUserNames } from "@/lib/user-names";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { avatarColorFor } from "@/lib/utils";
import type { Artifact } from "@/lib/types";

interface ArtifactsPaneProps {
  roomId: string;
}

export function ArtifactsPane({ roomId }: ArtifactsPaneProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const { on, send } = useRoomSocketContext();
  const { ensureNames, getName } = useUserNames();

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("rooms")
      .select("artifacts_state")
      .eq("id", roomId)
      .maybeSingle<{ artifacts_state: Artifact[] }>()
      .then(({ data }) => {
        if (data?.artifacts_state) setArtifacts(data.artifacts_state);
      });
  }, [roomId]);

  useEffect(() => {
    ensureNames(artifacts.map((a) => a.author));
  }, [artifacts, ensureNames]);

  useEffect(() => {
    return on("ARTIFACT_UPDATE", (payload) => {
      setArtifacts(payload as Artifact[]);
    });
  }, [on]);

  function handleUnpin(id: string) {
    send("UNPIN_ARTIFACT", { id });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">Moodboard</h2>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 p-3">
          {artifacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing pinned yet. Pinned messages and decisions will show up here.
            </p>
          ) : (
            artifacts.map((a) => {
              const author = a.author === "AI" ? "AI" : getName(a.author);
              return (
                <Card
                  key={a.id}
                  size="sm"
                  className="border-l-2"
                  style={{ borderLeftColor: avatarColorFor(a.author) }}
                >
                  <CardContent className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-1">
                      <p className="text-sm leading-relaxed">{a.content}</p>
                      <span className="font-mono text-xs text-muted-foreground">
                        {author} · {new Date(a.created_at).toLocaleString()}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0"
                      onClick={() => handleUnpin(a.id)}
                      title="Unpin"
                    >
                      <PinOff />
                    </Button>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
