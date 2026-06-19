import { AI_MODEL, getOpenAI } from "@/lib/ai";
import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { enforceLimit, planLimitResponse } from "@/lib/plan-limits";
import { NextRequest, NextResponse } from "next/server";


const ACTIONS = ["generate", "rephrase", "shorten", "expand"] as const;
type ActionType = (typeof ACTIONS)[number];

export async function POST(request:NextRequest){
    try {
        const { supabase, orgId } = await getActiveOrg();
        await enforceLimit(supabase, orgId, "ai");

        const {
            action,
            content="",
            prompt="",
            channelId
        } =await request.json()

        if(!ACTIONS.includes(action as ActionType)){
            return NextResponse.json({ error: "Invalid action" }, { status: 400 })
        }
        if(action === "generate" && !prompt.trim()){
            return NextResponse.json({ error: "Prompt is required for generate action" }, { status: 400 })
        }

        let channelType:string | undefined;
        let characterLimit:number | undefined;

        if(channelId){
            const {data: channelData, error: channelError} = await supabase
                .from("channel_types")
                .select("type, character_limit")
                .eq("id", channelId)
                .single();
            
            if(channelError){
                return NextResponse.json({ error: "Invalid channel ID" }, { status: 400 });
            }
            if(!channelData){
                return NextResponse.json({ error: "Channel not found" }, { status: 404 });
            }
            channelType = channelData.type;
            characterLimit = channelData.character_limit;
        }

        const result = await getOpenAI().chat.completions.create({
          model: AI_MODEL,
            messages: [
                {
                    role: "system",
                    content: buildSystemPrompt(channelType, characterLimit)
                },{
                    role: "user",
                    content: buildPrompt(action, content, prompt),
                }
            ]
        });

        const text = result.choices[0]?.message?.content ?? "";
        return NextResponse.json({ content: text})
    } catch (error) {
        const authErr = authErrorResponse(error)
        if (authErr) return authErr
        const planErr = planLimitResponse(error)
        if (planErr) return NextResponse.json({ error: planErr.message }, { status: 403 })
        return NextResponse.json({ error: "Failed to generate post"},{ status:500})
    }
}

function buildSystemPrompt( channelType?: string, characterLimit?: number){
      const system_prompt = [
        "You are a social media writing assistant.",
        "Return only the final post text.",
        "Do not add quotes, labels, bullet points, or explanations.",
        "Do not use markdown formatting like **, *, #, or backticks.",
        "Return plain text only.",
    ]
    if(channelType){
        system_prompt.push(`Write for ${channelType}. Match the platform's tone, style, and expected length. and relevant hashtags. `);
    }
    if(characterLimit){
        system_prompt.push(`Must be less than the maximum character limit: ${characterLimit}. `);
    }
    return system_prompt.join("\n");
}

function buildPrompt(action:ActionType,content:string, prompt:string){
    if (action === "generate") {
        return `Write one clean social media post based on this request:\n${prompt}`
    }
    if (!content.trim()) {
        throw new Error("Content is required for this action")
    }
    if (action === "rephrase") {
        return `Rephrase this social media post while keeping the meaning:\n${content}`
    }
    if (action === "shorten") {
        return `Shorten this social media post while keeping the key message:\n${content}`
    }
    return `Expand this social media post with more helpful detail while keeping the same tone:\n${content}`
}