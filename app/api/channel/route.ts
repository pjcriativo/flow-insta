import { getSupabaseServerClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {

    try {
        const {supabase, userId} = await getSupabaseServerClient()
        if(!userId) return new NextResponse('Unauthorized', { status: 401 })

        const filter = request.nextUrl.searchParams.get('filter')

        const [typesRes, userChannelsRes] = await Promise.all([
            supabase.from("channel_types")
            .select("*")
            .order("created_at", { ascending: true }),
            supabase.from("user_channels")
            .select("*")
            .eq("user_id", userId)
        ]);

        if (typesRes.error || userChannelsRes.error) {
            return new NextResponse('Internal Server Error', { status: 500 })
        }

        const userChannelMap = new Map(
            userChannelsRes.data.map(channel => 
                [
                    channel.channel_type_id, 
                    channel
                ]
            )
        )

        let channels = (typesRes.data || []).map(channel_type => {
            const userChannel = userChannelMap.get(channel_type.id)
            return {
              id: channel_type.id,
              type: channel_type.type,
              name: channel_type.name,
              color: channel_type.color,
              character_limit: channel_type.character_limit,
              user_channel_id: userChannel?.id ?? null,
              handle: userChannel?.handle ?? null,
              profile_image: userChannel?.profile_image ?? null,
              profile_url: userChannel?.profile_url ?? null,
              connected: userChannel?.is_connected ?? false
            }
        })

        const totalChannels = typesRes.data?.length || 0;
        const connectedCount = channels.filter(channel => channel.connected).length;

        if(filter === 'connected') {
            channels = channels.filter(channel => channel.connected);
        } else if(filter === 'unconnected') {
            channels = channels.filter(channel => !channel.connected);
        }

        return NextResponse.json({
            channels,
            totalChannels,
            connectedCount
        })
        
    } catch (error) {
        console.error('Error fetching channels:', error)
        return new NextResponse('Internal Server Error', { status: 500 })
    }
}
