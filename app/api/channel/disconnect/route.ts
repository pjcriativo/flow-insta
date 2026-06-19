import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";


export async function POST(request: NextRequest) {
    try {
        const { supabase, orgId } = await getActiveOrg();
        const { userChannelId } = await request.json();

        if (!userChannelId) {
            return NextResponse.json({ error: "User channel ID is required" }, { status: 400 });
        }

        const { data: userChannelData, error } = await supabase
            .from("user_channels")
            .select(
                "id, org_id"
            )
            .eq("id", userChannelId)
            .eq("org_id", orgId)
            .single();

        if (error || !userChannelData) {
            return NextResponse.json({ error: "User channel not found" }, { status: 404 });
        }

        const { error: updateError } = await supabase
            .from("user_channels")
            .update({
                access_token: null,
                refresh_token: null,
                token_expires_at: null,
                is_connected: false,
                is_active: false
            })
            .eq("id", userChannelId)
            .eq("org_id", orgId);

        if (updateError) {
            throw updateError
        }
        return NextResponse.json({ success: true })

    } catch (error) {
        const authErr = authErrorResponse(error);
        if (authErr) return authErr;
        console.error("Error disconnecting channel:", error);
        return NextResponse.json({ error: "Failed to disconnect channel" }, { status: 500 });
    }
}