import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runTick } from "@/lib/jobs/tick";

// Motor de jobs: chamado pelo pg_cron (via pg_net) a cada minuto.
// Protegido por CRON_SECRET no header X-Cron-Secret. Roda como service_role.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUDGET_MS = 50_000; // margem antes do maxDuration

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/tick] CRON_SECRET não configurado");
    return false;
  }
  const provided = req.headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  // timingSafeEqual exige buffers do mesmo tamanho.
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  try {
    const result = await runTick({ startedAt, budgetMs: BUDGET_MS });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron/tick] erro no tick", String(e));
    return NextResponse.json({ ok: false, error: "tick_failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// GET permitido (mesmo secret) para trigger manual em dev / health.
export async function GET(req: NextRequest) {
  return handle(req);
}
