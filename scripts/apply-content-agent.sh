#!/usr/bin/env bash
# ============================================================
# Aplica a migração do Agente de Post/Carrossel (Fase 1) e valida.
#
# PRÉ-REQUISITO (única ação manual — o CLI precisa da SUA conta Supabase):
#   supabase login            # abre o navegador; autoriza com sua conta
#
# Depois é só rodar este script:
#   bash scripts/apply-content-agent.sh
#
# Ele: linka o projeto, aplica a migração e roda a suíte de isolamento RLS.
# Idempotente: pode rodar de novo com segurança.
# ============================================================
set -euo pipefail

REF="xdmmzmzhoaqaucwuegkj"
MIGRATION="lib/db/create-content-agent.sql"

cd "$(dirname "$0")/.."

echo "==> 1/4 Verificando autenticação do CLI…"
if ! npx supabase projects list >/dev/null 2>&1; then
  echo "ERRO: o CLI Supabase não está autenticado."
  echo "      Rode 'supabase login' (abre o navegador) e execute este script de novo."
  exit 1
fi
echo "    OK — autenticado."

echo "==> 2/4 Linkando o projeto ($REF)…"
npx supabase link --project-ref "$REF"

echo "==> 3/4 Aplicando a migração ($MIGRATION)…"
echo "    ⚠️  Esta migração DROPA brand_voice_profiles (irreversível)."
echo "    Faça um snapshot do banco antes (Dashboard → Database → Backups) se ainda não fez."
npx supabase db query --linked --file "$MIGRATION"

echo "==> 4/4 Validando isolamento RLS (org A/B, member, Atomização/DM Pilot)…"
npm run test:rls

echo "==> CONCLUÍDO. Fase 1 aplicada e validada."
