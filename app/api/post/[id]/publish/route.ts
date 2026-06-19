import { inngest } from "@/inngest/client";
import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextResponse } from "next/server";


export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
    try {
        const {id} = await params;
        const {supabase, orgId} = await getActiveOrg();

        const {data: post, error: postError} = await supabase
            .from("scheduled_posts")
            .select("id, status")
            .eq("id", id)
            .eq("org_id", orgId)
            .single();
        
        if(postError || !post) {
            return NextResponse.json({error:"Post not found"}, {status:404});
        }
        if(post.status === "published") {
            return NextResponse.json({error:"Post already published"}, {status:400});
        }

        const {error:updateError} = await supabase
            .from("scheduled_posts")
            .update({
                status: "queue",
                scheduled_at: new Date().toISOString()
            })
            .eq("id", id)
            .eq("org_id", orgId)
            .single();

            if(updateError){
                return NextResponse.json({error:"Failed to update post"}, {status:500});
            }
            
            await inngest.send({
                name: "post/publish.requested",
                data: {
                    postId: id
                }
            });
            return NextResponse.json({success:true});

    } catch (error) {
        const authErr = authErrorResponse(error);
        if (authErr) return authErr;
        return NextResponse.json({error:"Internal server error"}, {status:500});
    }
}
