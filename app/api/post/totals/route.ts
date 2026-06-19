import { getSupabaseServerClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";


export async function GET(request: NextRequest) {
  try {
    const { supabase, userId } = await getSupabaseServerClient()
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const searchParams = request.nextUrl.searchParams
    const channelIds = searchParams.getAll("channelIds")
      .flatMap((value) => value.split(",")).filter(Boolean)

    const countQuery = (status: string) => {
        let query = supabase
            .from("scheduled_posts")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("status", status)
        
        if (channelIds.length > 0) query = query.in("user_channel_id", channelIds)
        
        return query
    }

    const [draft, queue, published, failed] = await Promise.all([
      countQuery("draft"),
      countQuery("queue"),
      countQuery("published"),
      countQuery("failed"),
    ])

    if (draft.error) throw draft.error
    if (queue.error) throw queue.error
    if (published.error) throw published.error
    if (failed.error) throw failed.error

    return NextResponse.json({
      totalDrafts: draft.count ?? 0,
      totalQueue: queue.count ?? 0,
      totalPublished: published.count ?? 0,
      totalFailed: failed.count ?? 0,
    })
  } catch (error: unknown) {
    console.error("Server error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

