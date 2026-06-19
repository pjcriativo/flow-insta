import { headers } from "next/headers";
import { validateAndLoad } from "@/lib/approvals/public-guard";
import { ApprovalClient } from "./_components/approval-client";
import { InvalidLink } from "./_components/invalid-link";

// Página PÚBLICA — sem sessão. Não importa nada que dependa de auth.
export const dynamic = "force-dynamic";

export default async function AprovarPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  const userAgent = h.get("user-agent");

  const result = await validateAndLoad(token, { ip, userAgent });

  // Falha em QUALQUER passo => página inválida genérica (sem vazar a coleção).
  if (!result.ok) {
    return <InvalidLink />;
  }

  return <ApprovalClient token={token} data={result.data} />;
}
