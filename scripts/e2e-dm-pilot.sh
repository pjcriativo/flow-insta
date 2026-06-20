#!/usr/bin/env bash
# ============================================================
# Teste e2e do Piloto de DM contra a API REST do Supabase.
#
# Usa NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY do .env.
# Verifica:
#   1. Existência das tabelas da migração (404 = migração não aplicada).
#   2. Idempotência: (provider, provider_event_id) único — 2ª inserção = conflito.
#   3. Limpa o que inseriu.
#
# NÃO testa kill-switch/janela/voz (exige canal IG real + a app rodando) —
# esses ficam no checklist manual em lib/db/APPLY-dm-pilot.md.
#
# Uso: bash scripts/e2e-dm-pilot.sh
# ============================================================
set -uo pipefail

# Carrega o .env (na raiz do projeto, um nível acima de scripts/).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env" 2>/dev/null; set +a

URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
if [[ -z "$URL" || -z "$KEY" ]]; then
  echo "✗ NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes no .env"
  exit 1
fi

H_KEY=(-H "apikey: $KEY" -H "Authorization: Bearer $KEY")
H_JSON=(-H "Content-Type: application/json")
PASS=0; FAIL=0; SKIP=0
ok(){ PASS=$((PASS+1)); echo "✓ $1"; }
no(){ FAIL=$((FAIL+1)); echo "✗ $1"; }
sk(){ SKIP=$((SKIP+1)); echo "○ $1"; }

code(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "== 1. Tabelas da migração existem? =="
TABLES=(automation_configs automation_rules interaction_events interaction_actions \
        conversations conversation_messages sales_flows review_queue faq_entries)
MISSING=0
for t in "${TABLES[@]}"; do
  c=$(code "$URL/rest/v1/$t?select=id&limit=1" "${H_KEY[@]}")
  if [[ "$c" == "200" ]]; then ok "$t (200)"; else no "$t ($c)"; MISSING=$((MISSING+1)); fi
done

if [[ "$MISSING" -gt 0 ]]; then
  echo ""
  echo "→ Migração ainda NÃO aplicada ($MISSING tabela(s) ausente(s))."
  echo "  Aplique via lib/db/APPLY-dm-pilot.md e rode este script de novo."
  echo ""
  echo "Resultado: $PASS ok, $FAIL faltando, $SKIP pulado"
  exit 1
fi

echo ""
echo "== 2. Idempotência (provider, provider_event_id) =="
# Precisamos de uma org + canal reais p/ as FKs. Pega os primeiros existentes.
ORG=$(curl -s "$URL/rest/v1/organizations?select=id&limit=1" "${H_KEY[@]}" | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
CH=$(curl -s "$URL/rest/v1/user_channels?select=id&limit=1" "${H_KEY[@]}" | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)

if [[ -z "$ORG" || -z "$CH" ]]; then
  sk "sem organization/user_channel p/ testar FK — pule esta parte ou crie dados de teste"
  echo ""
  echo "Resultado: $PASS ok, $FAIL faltando, $SKIP pulado"
  exit $([[ "$FAIL" -gt 0 ]] && echo 1 || echo 0)
fi

EVID="e2e-test-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo manual)"
BODY="{\"organization_id\":\"$ORG\",\"channel_id\":\"$CH\",\"provider\":\"instagram\",\"provider_event_id\":\"$EVID\",\"type\":\"comment\",\"text\":\"e2e\"}"

# Limpa resíduo de execução anterior.
curl -s -X DELETE "$URL/rest/v1/interaction_events?provider=eq.instagram&provider_event_id=eq.$EVID" "${H_KEY[@]}" >/dev/null

c1=$(code -X POST "$URL/rest/v1/interaction_events" "${H_KEY[@]}" "${H_JSON[@]}" -d "$BODY")
[[ "$c1" == "201" ]] && ok "1ª inserção -> 201" || no "1ª inserção -> $c1 (esperado 201)"

# 2ª inserção do MESMO provider_event_id deve conflitar (409).
c2=$(code -X POST "$URL/rest/v1/interaction_events" "${H_KEY[@]}" "${H_JSON[@]}" -d "$BODY")
[[ "$c2" == "409" ]] && ok "2ª inserção (duplicada) -> 409 conflito" || no "2ª inserção -> $c2 (esperado 409)"

# Confirma que só há 1 linha.
N=$(curl -s "$URL/rest/v1/interaction_events?provider=eq.instagram&provider_event_id=eq.$EVID&select=id" "${H_KEY[@]}" | grep -oE '"id"' | wc -l | tr -d ' ')
[[ "$N" == "1" ]] && ok "apenas 1 linha gravada (dedupe)" || no "$N linhas (esperado 1)"

# Limpeza.
curl -s -X DELETE "$URL/rest/v1/interaction_events?provider=eq.instagram&provider_event_id=eq.$EVID" "${H_KEY[@]}" >/dev/null
ok "limpeza do registro de teste"

echo ""
echo "Resultado: $PASS ok, $FAIL faltando, $SKIP pulado"
exit $([[ "$FAIL" -gt 0 ]] && echo 1 || echo 0)
