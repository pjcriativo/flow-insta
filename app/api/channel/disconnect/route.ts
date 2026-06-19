import { getSupabaseServerClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";


export async function POST(request: NextRequest) {
    try {
        const { supabase, userId } = await getSupabaseServerClient();
        if (!userId) {
            return NextResponse.json({ error: "User not authenticated" }, { status: 401 });
        }
        const { userChannelId } = await request.json();

        if (!userChannelId) {
            return NextResponse.json({ error: "User channel ID is required" }, { status: 400 });
        }

        const { data: userChannelData, error } = await supabase
            .from("user_channels")
            .select(
                "id, user_id"
            )
            .eq("id", userChannelId)
            .eq("user_id", userId)
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
            .eq("user_id", userId);

        if (updateError) {
            throw updateError
        }
        return NextResponse.json({ success: true })

    } catch (error) {
        console.error("Error disconnecting channel:", error);
        return NextResponse.json({ error: "Failed to disconnect channel" }, { status: 500 });
    }
}