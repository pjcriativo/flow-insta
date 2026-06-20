# Aplicar a migração do Piloto de DM

A migração `lib/db/create-dm-pilot.sql` precisa ser aplicada ao banco antes de
usar o recurso. O ambiente de desenvolvimento **não tem credencial DDL** (o
Supabase CLI não está autenticado, não há senha do Postgres nem `psql`), então
a aplicação é **manual**. Duas opções:

## Opção A — SQL Editor do dashboard (mais simples)

1. Abra o projeto no [Supabase Dashboard](https://supabase.com/dashboard) →
   **SQL Editor** → **New query**.
2. Cole o conteúdo inteiro de `lib/db/create-dm-pilot.sql` e clique **Run**.
3. É idempotente (`create table if not exists`, `drop policy if exists`), então
   pode reaplicar com segurança se algo falhar no meio.

Pré-requisito: `create-atomization.sql` já aplicado (define `brand_voice_profiles`
e a função `update_updated_at_column()`). Já está em produção.

## Opção B — Supabase CLI (precisa autenticar)

```bash
# 1. Autenticar (abre o navegador):
supabase login

# 2. Linkar o projeto (ref = xdmmzmzhoaqaucwuegkj, da URL do .env):
supabase link --project-ref xdmmzmzhoaqaucwuegkj

# 3. Aplicar (vai pedir a senha do banco — pegue em Dashboard → Settings → Database):
supabase db query --linked --file lib/db/create-dm-pilot.sql
```

## Configurar as envs da Meta (obrigatório p/ o webhook)

Adicione ao `.env` (e à Vercel):

```
META_APP_SECRET=...        # App Secret do app da Meta (assina o webhook)
META_VERIFY_TOKEN=...      # string que você escolhe; a mesma na config do webhook
META_GRAPH_VERSION=v21.0   # versão da Graph API
```

## Verificar que aplicou

Rode o teste e2e contra a API REST (usa a service_role do `.env`):

```bash
bash scripts/e2e-dm-pilot.sh
```

Antes da migração: as tabelas dão 404. Depois: 200 e o checklist passa.
