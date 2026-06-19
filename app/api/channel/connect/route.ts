import { ChannelTypeEnum } from "@/constants/channels";
import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { enforceLimit, planLimitResponse } from "@/lib/plan-limits";
import { getOAuthProvider } from "@/lib/social-oauth";
import { createPkcePair, getPkceCookieName } from "@/lib/social-oauth/pkce";
import { createOAuthState } from "@/lib/social-oauth/state";
import { NextRequest, NextResponse } from "next/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL

export async function POST(request: NextRequest) {
    try {

        const {supabase, orgId, userId} = await getActiveOrg();

        const {channelTypeId} = await request.json();
        if(!channelTypeId) return NextResponse.json({ error: 'Channel type ID is required' }, { status: 400 });

        // Limite de canais do plano. Só barra se o canal ainda não está conectado.
        const { data: existing } = await supabase
            .from("user_channels")
            .select("is_connected")
            .eq("org_id", orgId)
            .eq("channel_type_id", channelTypeId)
            .maybeSingle();
        if (!existing?.is_connected) {
            await enforceLimit(supabase, orgId, "channels");
        }

        const {data:channelType, error} = await supabase
            .from("channel_types")
            .select("id, type")
            .eq("id", channelTypeId)
            .single();

            if(error || !channelType) {
                return NextResponse.json({ error: 'Channel type not found' }, { status: 404 });
            }

            const redirectTo = `${APP_URL}/settings`;

            const provider = getOAuthProvider(channelType.type as ChannelTypeEnum);
            const state = createOAuthState({
                userId,
                orgId,
                channelTypeId: channelType.id,
                channelType: channelType.type,
                redirectTo,
            })

           const callbackUrl = `${APP_URL}/api/channel/callback`

           const pkce = channelType.type === ChannelTypeEnum.TWITTER ? 
            createPkcePair()
           : null

           const url = provider.getAuthorizationUrl({
            state,
            redirectUri: callbackUrl,
            codeChallenge: pkce?.codeChallenge,
            codeChallengeMethod: pkce?.codeChallengeMethod,
           })

           const response = NextResponse.json({ url})

           if(pkce) {
            response.cookies.set(getPkceCookieName(state), pkce.codeVerifier, {
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
                path: '/',
                maxAge: 60 * 10, // 10 minutes
            })
           }
            
           return response;
        
    } catch (error) {
        const authErr = authErrorResponse(error);
        if (authErr) return authErr;
        const planErr = planLimitResponse(error);
        if (planErr) return NextResponse.json({ error: planErr.message }, { status: 403 });
        console.error('Error connecting channel:', error);
        return NextResponse.json({ error: 'Failed to connect channel' }, { status: 500 });
    }
}
