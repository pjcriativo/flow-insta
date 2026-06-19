import { getSupabaseServerClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";


export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    try {
        const {supabase, userId} = await getSupabaseServerClient();
        if(!userId){
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        if(!id)return NextResponse.json({ error: "Missing idea ID" }, { status: 400 });

        const {error} = await supabase
            .from("ideas")
            .delete()
            .eq("id", id)
            .eq("user_id", userId);
        
        if(error){
            console.error("Error deleting idea:", error);
            return NextResponse.json({ error: "Failed to delete idea" }, { status: 500 });
        }

        return NextResponse.json({ success: true },{ status: 200 });
    } catch (error) {
        console.error("Error deleting idea:", error);
        return NextResponse.json({ error: "Failed to delete idea" }, { status: 500 });
    }
}