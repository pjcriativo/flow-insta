import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cookie that holds the user's active organization id (B2B org switcher).
// Never trusted as-is — always revalidated against memberships server-side.
export const ACTIVE_ORG_COOKIE = "active_org_id";

export type OrgRole = "owner" | "admin" | "member";

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

/**
 * Ensures the user has at least a personal organization, creating one if the
 * signup trigger didn't run (defense-in-depth). Idempotent. Uses the admin
 * client because the user may have no membership yet to satisfy RLS.
 *
 * Returns the personal org id and the user's role on it ("owner").
 */
export async function ensurePersonalOrg(
  userId: string
): Promise<{ orgId: string; role: OrgRole }> {
  const admin = getSupabaseAdminClient();

  // Already a member of some org? Reuse the first one.
  const { data: existing } = await admin
    .from("organization_members")
    .select("org_id, role")
    .eq("user_id", userId)
    .limit(1);

  if (existing && existing.length > 0) {
    return { orgId: existing[0].org_id, role: existing[0].role as OrgRole };
  }

  // Create a personal org + owner membership.
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: "Meu workspace", type: "personal", created_by: userId })
    .select("id")
    .single();
  if (orgErr || !org) {
    throw new Error(`Failed to create personal org: ${orgErr?.message}`);
  }

  const { error: memErr } = await admin
    .from("organization_members")
    .insert({ org_id: org.id, user_id: userId, role: "owner" });
  if (memErr) {
    throw new Error(`Failed to create membership: ${memErr.message}`);
  }

  return { orgId: org.id, role: "owner" };
}

/**
 * Resolves the active organization for the current request.
 *
 * - Reads the desired org from the `active_org_id` cookie.
 * - Validates it against the user's memberships (never trusts the cookie raw).
 * - Falls back to the first membership, or creates a personal org if none.
 *
 * Throws if there is no authenticated user.
 */
export async function getActiveOrg(): Promise<{
  supabase: SupabaseClient;
  userId: string;
  orgId: string;
  role: OrgRole;
}> {
  const { supabase, userId } = await getSupabaseServerClient();
  if (!userId) {
    throw new Error("UNAUTHORIZED");
  }

  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

  // RLS members_select restricts this to the user's own memberships.
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("org_id, role")
    .eq("user_id", userId);

  let active = memberships?.find((m) => m.org_id === requested) ?? memberships?.[0];

  if (!active) {
    // No org yet (trigger didn't run / edge case) — create personal org.
    const personal = await ensurePersonalOrg(userId);
    return { supabase, userId, orgId: personal.orgId, role: personal.role };
  }

  return {
    supabase,
    userId,
    orgId: active.org_id,
    role: active.role as OrgRole,
  };
}

/**
 * Returns the authenticated user id only if they are a platform admin.
 * Throws "UNAUTHORIZED" if not signed in, "FORBIDDEN" if not an admin.
 */
export async function requirePlatformAdmin(): Promise<{
  supabase: SupabaseClient;
  userId: string;
}> {
  const { supabase, userId } = await getSupabaseServerClient();
  if (!userId) {
    throw new Error("UNAUTHORIZED");
  }

  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error || data !== true) {
    throw new Error("FORBIDDEN");
  }

  return { supabase, userId };
}
