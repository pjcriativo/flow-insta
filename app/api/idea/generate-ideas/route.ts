import { AI_MODEL, getOpenAI } from "@/lib/ai";
import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { enforceLimit, planLimitResponse } from "@/lib/plan-limits";
import { NextRequest, NextResponse } from "next/server";




export async function POST(request: NextRequest) {
    try {
        const { supabase, orgId } = await getActiveOrg();
        await enforceLimit(supabase, orgId, "ai");

        const { businessType, targetAudience } = await request.json()
        if (!businessType || !targetAudience) {
            return NextResponse.json({ error: "Missing businessType or targetAudience" }, { status: 400 });
        }

        const result = await getOpenAI().chat.completions.create({
            model: AI_MODEL,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `You are a social media content ideation assistant. 
Return only valid JSON.
The response must be an object with an "ideas" array.
Each item must have: "title" and "description".
Generate 3 ideas.
Keep titles catchy.
Keep descriptions practical and specific.
Do not use markdown formatting like **, *, #, or backticks.
Return plain text only inside the JSON strings.`,
                },
                {
                    role: "user",
                    content: `Business type: ${businessType}. Target audience: ${targetAudience}.`
                }
            ]
        })

        const text = result.choices[0]?.message?.content ?? ""

        const parsed = JSON.parse(text) as { ideas?: { title: string, description: string }[] }
        const ideas = Array.isArray(parsed.ideas) ? parsed.ideas.slice(0, 3) : []

        return NextResponse.json({ ideas })

    } catch (error) {
        const authErr = authErrorResponse(error)
        if (authErr) return authErr
        const planErr = planLimitResponse(error)
        if (planErr) return NextResponse.json({ error: planErr.message }, { status: 403 })
        console.error("Error generating ideas:", error)
        return NextResponse.json({ error: "Failed to generate ideas" }, { status: 500 })
    }
}
