-- ============================================================
-- DM PILOT — DELTA do zip (camada determinística + agente editável)
-- ------------------------------------------------------------
-- ADITIVO e não-destrutivo. O Piloto de DM já existe (create-dm-pilot.sql):
-- este script só acrescenta o que o "cérebro #4"/zip traz e ainda faltava:
--   1. keyword_responses: resposta pronta por palavra-chave (antes do LLM).
--   2. automation_configs.agent_prompt: system prompt editável do agente.
--   3. conversations.agent_active: liga/desliga o agente por conversa.
--
-- Convenções do projeto: gen_random_uuid(), RLS via is_org_member()/org_role(),
-- force row level security, trigger update_updated_at_column(). FK de canal =
-- user_channels (NÃO social_channels).
--
-- Idempotente: pode reaplicar com segurança.
-- Aplicar: supabase db query --linked --file lib/db/create-dm-keyword-layer.sql
-- ============================================================

-- ---------------------------------------------------------
-- 1. keyword_responses (camada determinística do zip)
--    variations é preenchido pelo backend (generateVariations) ao criar/editar.
--    channel_id NULL = vale para toda a org.
-- ---------------------------------------------------------
create table if not exists public.keyword_responses (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  channel_id       uuid references public.user_channels(id) on delete cascade,
  keyword          text not null,
  variations       text[] not null default '{}',
  response_message text not null,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_keyword_org     on public.keyword_responses(organization_id);
create index if not exists idx_keyword_channel on public.keyword_responses(channel_id);

-- ---------------------------------------------------------
-- 2. automation_configs.agent_prompt (system prompt editável)
-- ---------------------------------------------------------
alter table public.automation_configs
  add column if not exists agent_prompt text not null default '';

-- ---------------------------------------------------------
-- 3. conversations.agent_active (toggle por conversa)
--    Default true: o agente atua até alguém desligar (ou do_not_contact).
-- ---------------------------------------------------------
alter table public.conversations
  add column if not exists agent_active boolean not null default true;

-- ---------------------------------------------------------
-- 4. RLS de keyword_responses (mesmo padrão das demais tabelas do DM)
--    leitura: membro; escrita: owner/admin.
-- ---------------------------------------------------------
alter table public.keyword_responses enable row level security;
alter table public.keyword_responses force row level security;

drop policy if exists keyword_responses_select on public.keyword_responses;
create policy keyword_responses_select on public.keyword_responses
  for select to authenticated using ( public.is_org_member(organization_id) );

drop policy if exists keyword_responses_write on public.keyword_responses;
create policy keyword_responses_write on public.keyword_responses
  for all to authenticated
  using ( public.org_role(organization_id) in ('owner','admin') )
  with check ( public.org_role(organization_id) in ('owner','admin') );

-- ---------------------------------------------------------
-- 5. TRIGGER updated_at
-- ---------------------------------------------------------
drop trigger if exists set_updated_at on public.keyword_responses;
create trigger set_updated_at before update on public.keyword_responses
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------
-- ROLLBACK (referência — não executar automaticamente)
-- ---------------------------------------------------------
-- drop table if exists public.keyword_responses cascade;
-- alter table public.automation_configs drop column if exists agent_prompt;
-- alter table public.conversations drop column if exists agent_active;
