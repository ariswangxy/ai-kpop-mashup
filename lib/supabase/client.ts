import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

const OWNER_KEY = "kpop-mashup:owner-id";

/**
 * Anonymous per-browser id. Sent as the `x-owner-id` header and checked by RLS
 * (see supabase/migrations). Replace with Supabase Auth before going public.
 */
export function getOwnerId(): string {
  try {
    let id = localStorage.getItem(OWNER_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(OWNER_KEY, id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  client ??= createClient(url!, anonKey!, {
    auth: { persistSession: false },
    global: { headers: { "x-owner-id": getOwnerId() } },
  });
  return client;
}
