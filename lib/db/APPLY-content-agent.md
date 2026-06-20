# Aplicar a migração do Agente de Post/Carrossel (Fase 1)

A migração `lib/db/create-content-agent.sql` cria a tabela **`brand_profiles`**
(marca fundida: identidade visual + voz verbal), migra os dados de
`brand_voice_profiles`, reponta a FK do DM Pilot e **dropa `brand_voice_profiles`**.

> ⚠️ **DROP irreversível.** A migração apaga `brand_voice_profiles` ao final.
> Os dados de voz são copiados para `brand_profiles` (colunas `voice_*`)
> preservando os `id`s. Faça um **backup/snapshot do banco** antes de aplicar em
> produção (Dashboard → Database → Backups).

## Ordem obrigatória (o código já está repontado nesta entrega)

A migração SÓ é segura porque o código que lia `brand_voice_profiles` já foi
atualizado para `brand_profiles` **nesta mesma entrega**:

- `lib/atomization/voice.ts` → lê `brand_profiles` (`voice_summary/voice_tone/voice_exemplars`)
- `lib/dm-pilot/voice.ts` → reusa `voice.ts` (herda a mudança)
- `automation_configs.brand_voice_id` (FK) → repontada para `brand_profiles` (na própria migração)
- `tests/helpers/tenancy.ts`, `tests/rls-isolation.test.ts` → usam `brand_profiles`

**Deploy o código junto com (ou imediatamente antes de) aplicar a migração.**
Se a migração rodar antes do deploy do código, a Atomização e o DM Pilot quebram
até o código novo subir.

## Pré-requisito

`create-atomization.sql` e `create-dm-pilot.sql` já aplicados (definem
`brand_voice_profiles`, `automation_configs`, `update_updated_at_column()` e os
helpers RLS `is_org_member()`/`org_role()`). Já estão em produção.

## Opção A — Supabase CLI (escolhida)

```bash
# 1. Autenticar (abre o navegador):
supabase login

# 2. Linkar o projeto (ref = xdmmzmzhoaqaucwuegkj):
supabase link --project-ref xdmmzmzhoaqaucwuegkj

# 3. Aplicar (pede a senha do banco — Dashboard → Settings → Database):
supabase db query --linked --file lib/db/create-content-agent.sql
```

## Opção B — SQL Editor do dashboard

1. Dashboard → **SQL Editor** → **New query**.
2. Cole o conteúdo inteiro de `lib/db/create-content-agent.sql` → **Run**.
3. Idempotente (`if not exists`, `do $$ ... information_schema ...`,
   `drop policy if exists`): pode reaplicar com segurança.

## Verificar que aplicou

```bash
# A suíte de isolamento RLS bate no Supabase real e agora referencia brand_profiles.
npm run test -- rls-isolation

# Esperado: brand_profiles isola por org (A não lê B), member não escreve marca,
# e as tabelas do DM Pilot/Atomização continuam verdes (voz repontada).
```

Checagens manuais úteis no SQL Editor após aplicar:

```sql
-- brand_voice_profiles não existe mais:
select to_regclass('public.brand_voice_profiles');           -- => null

-- a FK do DM Pilot aponta para brand_profiles:
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.automation_configs'::regclass and contype = 'f';
-- => ... foreign key (brand_voice_id) references brand_profiles(id) ...

-- unicidade do seletor de voz (org-wide + por canal):
select indexname from pg_indexes where tablename = 'brand_profiles';
-- => uq_brand_profiles_org_channel, uq_brand_profiles_org_wide, ...
```

## Rollback (referência)

O drop é irreversível sem backup. Para reverter manualmente: recrie
`brand_voice_profiles` (ver `create-atomization.sql`) e copie de volta as colunas
`voice_*` de `brand_profiles` ANTES de dropar `brand_profiles`. O bloco de
rollback comentado está no fim de `create-content-agent.sql`.
