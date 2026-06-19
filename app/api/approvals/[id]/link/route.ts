import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { signToken, hashToken } from "@/lib/approvals/token";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 dias

const createLinkSchema = z.object({
  expiresInDays: z.number().int().min(1).max(90).optional(),
  maxUses: z.number().int().min(1).max(10000).nullable().optional(),
});

// POST /api/approvals/[id]/link — gera um magic link para a coleção.
// Persiste APENAS o hash; retorna o token cru UMA ÚNICA VEZ na resposta.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, orgId, userId, role } = await getActiveOrg();
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: collectionId } = await params;

    const body = await request.json().catch(() => ({}));
    const parsed = createLinkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const expiresInMs = (parsed.data.expiresInDays ?? 14) * 24 * 60 * 60 * 1000 || DEFAULT_TTL_MS;
    const maxUses = parsed.data.maxUses ?? null;

    // Confirma que a coleção é da org.
    const { data: collection } = await supabase
      .from("approval_collections")
      .select("id")
      .eq("id", collectionId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!collection) {
      return NextResponse.json({ error: "Coleção não encontrada" }, { status: 404 });
    }

    // Cria a linha do link primeiro (precisamos do id no payload do token).
    const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
    const { data: link, error: linkErr } = await supabase
      .from("approval_links")
      .insert({
        collection_id: collectionId,
        organization_id: orgId,
        token_hash: "pending", // substituído abaixo
        scope: {},
        expires_at: expiresAt,
        max_uses: maxUses,
        created_by: userId,
      })
      .select("id")
      .single();

    if (linkErr || !link) {
      console.error("Error creating link row:", linkErr);
      return NextResponse.json({ error: "Falha ao gerar link" }, { status: 500 });
    }

    // Assina o token com o link_id real e grava SÓ o hash.
    const token = signToken({
      link_id: link.id,
      collection_id: collectionId,
      scope: {},
      expiresInMs,
    });
    const { error: updErr } = await supabase
      .from("approval_links")
      .update({ token_hash: hashToken(token) })
      .eq("id", link.id)
      .eq("organization_id", orgId);

    if (updErr) {
      // Remove a linha órfã para não deixar token_hash='pending'.
      await supabase.from("approval_links").delete().eq("id", link.id);
      return NextResponse.json({ error: "Falha ao gerar link" }, { status: 500 });
    }

    // Marca a coleção como em revisão.
    await supabase
      .from("approval_collections")
      .update({ status: "in_review" })
      .eq("id", collectionId)
      .eq("organization_id", orgId);

    const base = process.env.APP_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "";
    const url = `${base}/aprovar/${token}`;

    // O token cru só aparece AQUI, nesta resposta. Nunca mais é recuperável.
    return NextResponse.json({ id: link.id, url, expiresAt }, { status: 201 });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error generating link:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

const revokeSchema = z.object({ linkId: z.string().uuid() });

// DELETE /api/approvals/[id]/link — revoga um link (revoked_at = now()).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, orgId, role } = await getActiveOrg();
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: collectionId } = await params;

    const parsed = revokeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "linkId inválido" }, { status: 400 });
    }

    const { error } = await supabase
      .from("approval_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", parsed.data.linkId)
      .eq("collection_id", collectionId)
      .eq("organization_id", orgId);

    if (error) {
      return NextResponse.json({ error: "Falha ao revogar" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
