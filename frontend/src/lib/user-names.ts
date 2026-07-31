"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves user_id -> display name, with an in-memory cache shared across a
 * component's lifetime. Filters out the "AI" sentinel before querying:
 * public.users.id is a uuid column, so including "AI" in an `.in()` filter
 * would reject the whole batch, silently breaking name resolution for every
 * real user in it too.
 */
export function useUserNames() {
  const supabase = useMemo(() => createClient(), []);
  const [names, setNames] = useState<Record<string, string>>({});
  const knownRef = useRef<Set<string>>(new Set());

  const ensureNames = useCallback(
    (ids: string[]) => {
      const toFetch = ids.filter((id) => UUID_RE.test(id) && !knownRef.current.has(id));
      if (toFetch.length === 0) return;

      toFetch.forEach((id) => knownRef.current.add(id));

      supabase
        .from("users")
        .select("id, name, email")
        .in("id", toFetch)
        .then(({ data, error }) => {
          if (error) {
            console.error("Failed to load user names:", error);
            toFetch.forEach((id) => knownRef.current.delete(id)); // allow retry
            return;
          }
          if (!data || data.length === 0) return;
          setNames((prev) => {
            const next = { ...prev };
            for (const row of data) {
              next[row.id] = row.name || row.email || `User ${row.id.slice(0, 6)}`;
            }
            return next;
          });
        });
    },
    [supabase],
  );

  const getName = useCallback(
    (id: string) => {
      if (id === "AI") return "AI";
      return names[id] ?? `User ${id.slice(0, 6)}`;
    },
    [names],
  );

  return { ensureNames, getName };
}
