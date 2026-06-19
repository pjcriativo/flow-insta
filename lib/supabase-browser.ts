import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

/**
 * Browser-side Supabase client (singleton).
 *
 * Used by client components for auth (sign in/up/out) and reading the current
 * session. Shares cookies with the server client via @supabase/ssr.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
  if (!client) {
    client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}
