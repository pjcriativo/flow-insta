import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

// GET /api/public-settings — flags públicas para a UI do cliente
// (banner de aviso, signup aberto). Não expõe nada sensível.
export async function GET() {
  try {
    const admin = getSupabaseAdminClient();
    const { data } = await admin
      .from("platform_settings")
      .select("key, value")
      .in("key", ["announcement", "signups_enabled", "ai_enabled", "scheduling_enabled"]);

    const map = Object.fromEntries((data ?? []).map((s) => [s.key, s.value]));
    return NextResponse.json({
      announcement: map.announcement ?? { text: "", enabled: false },
      signupsEnabled: map.signups_enabled !== false,
      aiEnabled: map.ai_enabled !== false,
      schedulingEnabled: map.scheduling_enabled !== false,
    });
  } catch {
    return NextResponse.json({
      announcement: { text: "", enabled: false },
      signupsEnabled: true,
      aiEnabled: true,
      schedulingEnabled: true,
    });
  }
}
