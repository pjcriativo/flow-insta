import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { BEST_TIMES } from "@/constants/best-times";
import { ChannelTypeEnum } from "@/constants/channels";
import { NextResponse } from "next/server";

// GET /api/best-times — melhores horários para postar.
// Combina a heurística por rede (constants/best-times) com o histórico real
// de publicação da organização (dia/hora em que mais publicou).
export async function GET() {
  try {
    const { supabase, orgId } = await getActiveOrg();

    // Quais redes a org tem conectadas (para focar nelas).
    const { data: channels } = await supabase
      .from("user_channels")
      .select("is_connected, channel_types(type)")
      .eq("org_id", orgId)
      .eq("is_connected", true);

    const connectedTypes = new Set(
      (channels ?? [])
        .map((c) => (c.channel_types as unknown as { type?: string })?.type)
        .filter(Boolean) as string[]
    );

    // Histórico de publicações (últimos 90 dias) para personalizar.
    const { data: published } = await supabase
      .from("scheduled_posts")
      .select("published_at")
      .eq("org_id", orgId)
      .eq("status", "published")
      .gte("published_at", new Date(Date.now() - 90 * 86400000).toISOString());

    // Mapa de frequência (dia-hora) do que o usuário já publicou.
    const histogram = new Map<string, number>();
    for (const p of published ?? []) {
      if (!p.published_at) continue;
      const d = new Date(p.published_at);
      const key = `${d.getDay()}-${d.getHours()}`;
      histogram.set(key, (histogram.get(key) ?? 0) + 1);
    }
    const hasHistory = histogram.size > 0;

    // Slots recomendados por rede (só as conectadas; se nenhuma, mostra as principais).
    const targetTypes =
      connectedTypes.size > 0
        ? (Array.from(connectedTypes) as ChannelTypeEnum[])
        : [ChannelTypeEnum.INSTAGRAM, ChannelTypeEnum.LINKEDIN, ChannelTypeEnum.TWITTER];

    const perChannel = targetTypes
      .filter((t) => BEST_TIMES[t])
      .map((type) => ({
        type,
        slots: BEST_TIMES[type].map((s) => ({
          ...s,
          // "score" leve: bônus se o usuário já publicou bem nesse dia/hora.
          boosted: histogram.has(`${s.day}-${s.hour}`),
        })),
      }));

    // Top horários personalizados (a partir do histórico), se houver.
    const personalized = hasHistory
      ? Array.from(histogram.entries())
          .map(([k, count]) => {
            const [day, hour] = k.split("-").map(Number);
            return { day, hour, count };
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
      : [];

    return NextResponse.json({
      hasHistory,
      perChannel,
      personalized,
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error computing best times:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
