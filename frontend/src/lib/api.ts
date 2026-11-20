"use client";

import { createClient } from "@/lib/supabase/client";
import type { ApiKey } from "@/lib/types";

// The Go backend's HTTP base, derived from the WS URL (ws->http, wss->https).
const API_BASE = (process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080").replace(
  /^ws/,
  "http",
);

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

export async function listKeys(): Promise<ApiKey[]> {
  const res = await fetch(`${API_BASE}/api/keys`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(await errorMessage(res, "Failed to load keys"));
  return res.json();
}

export async function createKey(input: {
  provider: string;
  label: string;
  key: string;
}): Promise<ApiKey> {
  const res = await fetch(`${API_BASE}/api/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Failed to save key"));
  return res.json();
}

export async function deleteKey(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/keys/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Failed to delete key"));
}
