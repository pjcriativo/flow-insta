import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { fetchYouTubeMeta } from "@/lib/atomization/youtube";
import { NextRequest, NextResponse } from "next/server";

// GET /api/atomization/preview?url=... — valida a URL do YouTube e devolve
// metadados (título, canal, duração, thumb) para o preview do wizard.
// NÃO cria job. Só exige sessão/org ativa (qualquer membro pode pré-visualizar).
export async function GET(request: NextRequest) {
  try {
    // Garante que há sessão + org ativa (lança em caso contrário).
    await getActiveOrg();

    const url = request.nextUrl.searchParams.get("url")?.trim() ?? "";
    if (!url) {
      return NextResponse.json({ error: "Informe a URL do vídeo" }, { status: 400 });
    }

    let meta;
    try {
      meta = await fetchYouTubeMeta(url);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "INVALID_URL") {
        return NextResponse.json(
          { error: "Informe uma URL válida do YouTube" },
          { status: 400 }
        );
      }
      if (code === "VIDEO_UNAVAILABLE") {
        return NextResponse.json(
          { error: "Vídeo indisponível, privado ou inexistente" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: "Não foi possível validar o vídeo" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      videoId: meta.videoId,
      title: meta.title,
      channelTitle: meta.channelTitle,
      durationSeconds: meta.durationSeconds,
      // Thumb pública padrão do YouTube (sempre disponível p/ vídeo público).
      thumbnailUrl: `https://i.ytimg.com/vi/${meta.videoId}/hqdefault.jpg`,
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
