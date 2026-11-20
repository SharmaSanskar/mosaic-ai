"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Agent } from "@/lib/types";

// useRoomAgents loads the AI agents available in a room: the platform defaults
// (owner_id is null, available everywhere) plus any custom agents attached to
// this room. Used for @mention discovery and for attributing agent messages in
// the chat (resolving an "agent:<id>" author to a name/color).
// Pure fetch (no React state), so it can be called from both the mount effect
// and the exposed refetch without tripping the set-state-in-effect rule.
async function fetchRoomAgents(roomId: string): Promise<Agent[]> {
  const supabase = createClient();
  const [platform, custom] = await Promise.all([
    supabase
      .from("agents")
      .select("*")
      .is("owner_id", null)
      .order("created_at", { ascending: true }),
    supabase.from("room_agents").select("agents(*)").eq("room_id", roomId),
  ]);

  const seen = new Set<string>();
  const list: Agent[] = [];
  for (const a of (platform.data ?? []) as Agent[]) {
    if (a && !seen.has(a.id)) {
      seen.add(a.id);
      list.push(a);
    }
  }
  for (const row of (custom.data ?? []) as unknown as { agents: Agent | null }[]) {
    const a = row.agents;
    if (a && !seen.has(a.id)) {
      seen.add(a.id);
      list.push(a);
    }
  }
  return list;
}

export function useRoomAgents(roomId: string) {
  const [agents, setAgents] = useState<Agent[]>([]);

  // Called only from event handlers / socket callbacks, never synchronously in
  // an effect body.
  const refetch = useCallback(async () => {
    setAgents(await fetchRoomAgents(roomId));
  }, [roomId]);

  useEffect(() => {
    let active = true;
    (async () => {
      const list = await fetchRoomAgents(roomId);
      if (active) setAgents(list);
    })();
    return () => {
      active = false;
    };
  }, [roomId]);

  const getAgent = useCallback(
    (id: string) => agents.find((a) => a.id === id),
    [agents],
  );

  return { agents, getAgent, refetch };
}
