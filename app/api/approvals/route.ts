import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

function requireManager(role: string) {
  if (role !== "owner" && role !== "admin") {
    throw new Error("FORBIDDEN");
  }
}

// GET /api/approvals — lista as coleções da org ativa.
export async function GET() {
  try {
    const { supabase, orgId } = await getActiveOrg();

    const { data, error } = await supabase
      .from("approval_collections")
      .select("id, client_name, title, status, due_at, created_at, updated_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Falha ao listar coleções" }, { status: 500 });
    }

    // Contagem de itens por coleção (para a lista).
    const collections = await Promise.all(
      (data ?? []).map(async (c) => {
        const { count } = await supabase
          .from("approval_collection_items")
          .select("id", { count: "exact", head: true })
          .eq("collection_id", c.id);
        return { ...c, itemCount: count ?? 0 };
      })
    );

    return NextResponse.json({ collections });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error listing approvals:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

const createSchema = z.object({
  client_name: z.string().min(1, "Nome do cliente é obrigatório").max(200),
  title: z.string().min(1, "Título é obrigatório").max(200),
  due_at: z.string().datetime().nullable().optional(),
  post_ids: z.array(z.string().uuid()).min(1, "Selecione ao menos um post"),
});

// POST /api/approvals — cria uma coleção e adiciona os posts como itens.
export async function POST(request: NextRequest) {
  try {
    const { supabase, orgId, userId, role } = await getActiveOrg();
    requireManager(role);

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
        { status: 400 }
      );
    }
    const { client_name, title, due_at, post_ids } = parsed.data;

    // Confirma que todos os posts pertencem à org (RLS já restringe, mas valida explicitamente).
    const { data: ownedPosts } = await supabase
      .from("scheduled_posts")
      .select("id")
      .eq("org_id", orgId)
      .in("id", post_ids);
    const ownedIds = new Set((ownedPosts ?? []).map((p) => p.id));
    const invalid = post_ids.filter((id) => !ownedIds.has(id));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: "Um ou mais posts não pertencem à sua organização" },
        { status: 400 }
      );
    }

    // Cria a coleção.
    const { data: collection, error: collErr } = await supabase
      .from("approval_collections")
      .insert({
        organization_id: orgId,
        created_by: userId,
        client_name,
        title,
        due_at: due_at ?? null,
        status: "draft",
      })
      .select("id")
      .single();

    if (collErr || !collection) {
      console.error("Error creating collection:", collErr);
      return NextResponse.json({ error: "Falha ao criar coleção" }, { status: 500 });
    }

    // Adiciona itens (posições na ordem recebida).
    const items = post_ids.map((post_id, position) => ({
      collection_id: collection.id,
      organization_id: orgId,
      post_id,
      position,
      item_status: "pending" as const,
    }));
    const { error: itemsErr } = await supabase
      .from("approval_collection_items")
      .insert(items);
    if (itemsErr) {
      console.error("Error adding items:", itemsErr);
      return NextResponse.json({ error: "Falha ao adicionar posts" }, { status: 500 });
    }

    return NextResponse.json({ id: collection.id }, { status: 201 });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error creating approval:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
