import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

// GET /api/approvals/[id] — detalhe da coleção (itens+posts, links ativos,
// decisões e comentários). Tudo escopado por org via RLS.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const { id } = await params;

    const { data: collection } = await supabase
      .from("approval_collections")
      .select("id, client_name, title, status, due_at, created_at")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!collection) {
      return NextResponse.json({ error: "Coleção não encontrada" }, { status: 404 });
    }

    const [itemsRes, linksRes, decisionsRes, commentsRes] = await Promise.all([
      supabase
        .from("approval_collection_items")
        .select(
          "id, post_id, position, item_status, scheduled_posts(id, content, images, scheduled_at, status, user_channels(handle, channel_types(type, name, color)))"
        )
        .eq("collection_id", id)
        .order("position", { ascending: true }),
      supabase
        .from("approval_links")
        .select("id, expires_at, revoked_at, max_uses, used_count, created_at")
        .eq("collection_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("approval_decisions")
        .select("id, collection_item_id, decision, comment, decided_by_email, created_at")
        .eq("collection_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("approval_comments")
        .select("id, collection_item_id, author_type, body, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true }),
    ]);

    return NextResponse.json({
      collection,
      items: itemsRes.data ?? [],
      links: linksRes.data ?? [],
      decisions: decisionsRes.data ?? [],
      comments: commentsRes.data ?? [],
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error loading approval detail:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

// DELETE /api/approvals/[id] — arquiva a coleção (não exclui histórico).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, orgId, role } = await getActiveOrg();
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;

    const { error } = await supabase
      .from("approval_collections")
      .update({ status: "archived" })
      .eq("id", id)
      .eq("organization_id", orgId);

    if (error) {
      return NextResponse.json({ error: "Falha ao arquivar" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
