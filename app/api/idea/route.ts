import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";


export async function GET() {
    try {
        const { supabase, orgId } = await getActiveOrg();

    const [ideasRes, groupsRes] = await Promise.all([
         supabase
         .from("ideas")
         .select("*")
         .eq("org_id", orgId)
         .order("sort_order", { ascending: true })
         .order("created_at", { ascending: false }),
         supabase
         .from("idea_groups")
         .select("*")
         .order("created_at", { ascending: false })
    ])

    if (ideasRes.error || groupsRes.error) {
        console.error("Error fetching ideas or groups:", ideasRes.error, groupsRes.error);
        return NextResponse.json({ error: "Failed to fetch ideas or groups" }, { status: 500 });
    }

    const ideas = ideasRes.data ?? [];
    const groups = (groupsRes.data ?? []).map((group) => ({
        id:group.id,
        title: group.name,
        ideas:ideas
            .filter((idea) => idea.group_id === group.id)
            .map((idea) => ({
                id: idea.id,
                title: idea.title,
                description: idea.description,
                images: idea.images ?? [],
                columnId: idea.group_id,
                sortOrder: idea.sort_order
            }))
    }))

    return NextResponse.json({ groups });
    } catch (error) {
        const authErr = authErrorResponse(error);
        if (authErr) return authErr;
        console.error("Error fetching ideas or groups:", error);
        return NextResponse.json({ error: "Failed to fetch ideas or groups" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { supabase, orgId, userId } = await getActiveOrg();

        const {
            id,
            title,
            groupId,
            description,
            images,
            sortOrder
        } = await request.json();

        if (!title || !groupId) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const payload = {
            org_id: orgId,
            user_id: userId,
            group_id: groupId,
            title: title,
            description,
            images: images,
            sort_order: typeof sortOrder === 'number' ? sortOrder : 0
        };

        let data, error;

        if (id) {
            const result = await supabase
                .from("ideas")
                .update(payload)
                .eq("id", id)
                .eq("org_id", orgId)
                .select()
                .single();

            data = result.data;
            error = result.error;
        } else {
            const result = await supabase
                .from("ideas")
                .insert(payload)
                .select()
                .single();
            data = result.data;
            error = result.error;
        }

        if (error) {
            console.error("Error upserting idea:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ data });

    } catch (error) {
        const authErr = authErrorResponse(error);
        if (authErr) return authErr;
        console.error("Error upserting idea:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
