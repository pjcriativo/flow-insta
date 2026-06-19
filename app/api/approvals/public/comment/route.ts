import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { validateTokenOnly } from "@/lib/approvals/public-guard";
import { rateLimit, getClientIp } from "@/lib/approvals/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  token: z.string().min(1),
  collection_item_id: z.string().uuid(),
  body: z.string().min(1).max(2000),
});

const GENERIC = NextResponse.json({ error: "Requisição inválida" }, { status: 400 });

// POST /api/approvals/public/comment — PÚBLICO. Comentário do cliente num item.
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rl = rateLimit(`comment:${ip}`, 40, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Muitas requisições. Tente novamente em instantes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return GENERIC;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return GENERIC;

  const { token, collection_item_id, body } = parsed.data;

  const ctx = await validateTokenOnly(token);
  if (!ctx) return GENERIC;

  const admin = getSupabaseAdminClient();

  // Escopo manual: item pertence ao collection_id/org do token.
  const { data: item } = await admin
    .from("approval_collection_items")
    .select("id")
    .eq("id", collection_item_id)
    .eq("collection_id", ctx.collection_id)
    .eq("organization_id", ctx.organization_id)
    .maybeSingle();
  if (!item) return GENERIC;

  const { data: session } = await admin
    .from("approval_sessions")
    .select("id")
    .eq("link_id", ctx.link_id)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await admin.from("approval_comments").insert({
    collection_item_id,
    organization_id: ctx.organization_id,
    author_type: "client",
    author_session_id: session?.id ?? null,
    body: body.trim(),
  });
  if (error) {
    return NextResponse.json({ error: "Falha ao comentar" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
