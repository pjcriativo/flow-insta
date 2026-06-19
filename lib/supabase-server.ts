import { auth } from '@clerk/nextjs/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertPublicEnv() {
  if (!SUPABASE_URL) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
  }
  if (!SUPABASE_ANON_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable');
  }
}

/**
 * Server-side client bound to the current Clerk user.
 *
 * Uses Clerk as a third-party auth provider for Supabase: the Clerk session
 * token is injected on every request via the `accessToken` callback, so RLS
 * policies that read `auth.jwt()->>'sub'` see the Clerk user id.
 *
 * Make sure Clerk is configured as a Supabase third-party auth provider and
 * that the JWT exposes the user id in the `sub` claim.
 */
export async function getSupabaseServerClient(): Promise<{
  supabase: SupabaseClient;
  userId: string | null;
}> {
  assertPublicEnv();

  const { userId, getToken } = await auth();

  const supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    async accessToken() {
      // Returns the Clerk session token so Supabase can apply RLS per user.
      return (await getToken()) ?? null;
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return { supabase, userId };
}

/**
 * Admin client that bypasses RLS using the service role key.
 *
 * Use ONLY in trusted server contexts (e.g. background jobs, uploads) where
 * there is no end-user session to scope to.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (!SUPABASE_URL) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export const getSupabaseUploadClient = getSupabaseAdminClient;
