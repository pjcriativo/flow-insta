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
# Precisa de uma org + canal p/ as FKs. Se não houver user_channel, cria um
# canal de teste descartável (vinculado à 1ª org + channel_type INSTAGRAM) e
# remove no fim.
ORG=$(curl -s "$URL/rest/v1/organizations?select=id&limit=1" "${H_KEY[@]}" | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
CH=$(curl -s "$URL/rest/v1/user_channels?select=id&limit=1" "${H_KEY[@]}" | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
TEMP_CH=""

if [[ -z "$ORG" ]]; then
  sk "sem organization p/ testar FK"
  echo ""; echo "Resultado: $PASS ok, $FAIL faltando, $SKIP pulado"
  exit $([[ "$FAIL" -gt 0 ]] && echo 1 || echo 0)
fi

if [[ -z "$CH" ]]; then
  CT=$(curl -s "$URL/rest/v1/channel_types?select=id&type=eq.INSTAGRAM&limit=1" "${H_KEY[@]}" | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
  # Remove canal de teste residual de execução anterior (constraint org+tipo único).
  curl -s -X DELETE "$URL/rest/v1/user_channels?provider_account_id=eq.e2e_ig" "${H_KEY[@]}" >/dev/null
  # return=representation p/ obter o id do canal criado.
  CH=$(curl -s -X POST "$URL/rest/v1/user_channels" "${H_KEY[@]}" \
    -H "Content-Type: application/json" -H "Prefer: return=representation" \
    -d "{\"user_id\":\"e2e-test\",\"org_id\":\"$ORG\",\"channel_type_id\":\"$CT\",\"handle\":\"e2e_dmpilot\",\"provider_account_id\":\"e2e_ig\"}" \
    | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
  TEMP_CH="$CH"
  [[ -n "$CH" ]] && ok "canal de teste descartável criado" || no "criar canal de teste"
fi

cleanup_data(){
  curl -s -X DELETE "$URL/rest/v1/interaction_events?channel_id=eq.$CH&provider_event_id=like.e2e-*" "${H_KEY[@]}" >/dev/null
  [[ -n "$TEMP_CH" ]] && curl -s -X DELETE "$URL/rest/v1/user_channels?id=eq.$TEMP_CH" "${H_KEY[@]}" >/dev/null
}
trap cleanup_data EXIT

EVID="e2e-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo manual)"
BODY="{\"organization_id\":\"$ORG\",\"channel_id\":\"$CH\",\"provider\":\"instagram\",\"provider_event_id\":\"$EVID\",\"type\":\"comment\",\"text\":\"e2e\"}"
JSON=(-H "Content-Type: application/json")

# Limpa resíduo anterior.
curl -s -X DELETE "$URL/rest/v1/interaction_events?provider=eq.instagram&provider_event_id=eq.$EVID" "${H_KEY[@]}" >/dev/null

# 1ª inserção -> 201. (sem Prefer: return=representation p/ o status vir limpo)
c1=$(code -X POST "$URL/rest/v1/interaction_events" "${H_KEY[@]}" "${JSON[@]}" -d "$BODY")
[[ "$c1" == "201" ]] && ok "1ª inserção -> 201" || no "1ª inserção -> $c1 (esperado 201)"

# 2ª inserção do MESMO provider_event_id -> 409 (constraint única / invariante #2).
c2=$(code -X POST "$URL/rest/v1/interaction_events" "${H_KEY[@]}" "${JSON[@]}" -d "$BODY")
[[ "$c2" == "409" ]] && ok "2ª inserção duplicada -> 409 (idempotência #2)" || no "2ª inserção -> $c2 (esperado 409)"

# Confirma que só há 1 linha.
N=$(curl -s "$URL/rest/v1/interaction_events?provider=eq.instagram&provider_event_id=eq.$EVID&select=id" "${H_KEY[@]}" | grep -oE '"id"' | wc -l | tr -d ' ')
[[ "$N" == "1" ]] && ok "apenas 1 linha gravada (dedupe)" || no "$N linhas (esperado 1)"

echo ""
echo "Resultado: $PASS ok, $FAIL falhou, $SKIP pulado"
exit $([[ "$FAIL" -gt 0 ]] && echo 1 || echo 0)
