import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";


export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    try {
        const {supabase, orgId} = await getActiveOrg();

        const { id } = await params;
        if(!id)return NextResponse.json({ error: "Missing idea ID" }, { status: 400 });

        const {error} = await supabase
            .from("ideas")
            .delete()
            .eq("id", id)
            .eq("org_id", orgId);
        
        if(error){
            console.error("Error deleting idea:", error);
            return NextResponse.json({ error: "Failed to delete idea" }, { status: 500 });
        }

        return NextResponse.json({ success: true },{ status: 200 });
    } catch (error) {
        const authErr = authErrorResponse(error);
        if (authErr) return authErr;
        console.error("Error deleting idea:", error);
        return NextResponse.json({ error: "Failed to delete idea" }, { status: 500 });
    }
}