import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertPublicEnv() {
  if (!SUPABASE_URL) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable");
  }
  if (!SUPABASE_ANON_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable");
  }
}

/**
 * Server-side Supabase client bound to the current user's session.
 *
 * Reads/writes the auth cookies via @supabase/ssr so RLS policies that call
 * `requesting_user_id()` (i.e. auth.uid()) are scoped to the logged-in user.
 *
 * Returns `{ supabase, userId }` — same shape used across the API routes.
 */
export async function getSupabaseServerClient(): Promise<{
  supabase: SupabaseClient;
  userId: string | null;
}> {
  assertPublicEnv();

  const cookieStore = await cookies();

  const supabase = createServerClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // `setAll` can be called from a Server Component where setting cookies
          // is not allowed. Safe to ignore when middleware refreshes the session.
        }
      },
    },
  });

  // getUser() validates the JWT with the Supabase Auth server (trustworthy).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, userId: user?.id ?? null };
}

/**
 * Admin client that bypasses RLS using the service role key.
 *
 * Use ONLY in trusted server contexts (background jobs, uploads) where there is
 * no end-user session to scope to.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (!SUPABASE_URL) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable");
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export const getSupabaseUploadClient = getSupabaseAdminClient;
