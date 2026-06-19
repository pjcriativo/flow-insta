import { getSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

// GET /api/me — informações leves da sessão atual para o client,
// incluindo se o usuário é super-admin de plataforma.
export async function GET() {
  try {
    const { supabase, userId } = await getSupabaseServerClient();
    if (!userId) {
      return NextResponse.json(
        { authenticated: false, isPlatformAdmin: false },
        { status: 200 }
      );
    }

    const { data } = await supabase.rpc("is_platform_admin");

    return NextResponse.json({
      authenticated: true,
      userId,
      isPlatformAdmin: data === true,
    });
  } catch {
    return NextResponse.json(
      { authenticated: false, isPlatformAdmin: false },
      { status: 200 }
    );
  }
}
