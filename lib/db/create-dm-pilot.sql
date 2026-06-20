-- ============================================================
-- PILOTO DE DM/COMENTÁRIO (DM Pilot) — Instagram automation
-- ------------------------------------------------------------
-- Webhook recebe comentário/menção/DM do Instagram -> IA classifica
-- intenção -> responde em público na voz do criador + puxa intenção
-- de compra pro DM com funil de venda. Kill-switch, revisão humana
-- e compliance da Meta (janela de 24h).
--
-- MOTOR: este recurso NÃO usa Inngest (removido do projeto). O status
-- em interaction_events É a fila — o pg_cron chama /api/cron/tick a cada
-- minuto e o runner dm-pilot reivindica eventos via claim_due_interactions
-- (FOR UPDATE SKIP LOCKED + lease), igual a atomization_jobs.
--
-- Idempotente: pode reaplicar com segurança.
-- Aplicar via: supabase db query --linked --file lib/db/create-dm-pilot.sql
--
-- Dependências (já existentes):
--   public.organizations, public.organization_members
--   public.user_channels            (canal social — FK de channel_id)
--   public.brand_voice_profiles     (criada no recurso de Atomização)
--   public.is_org_member(uuid), public.org_role(uuid)  (helpers RLS)
--   public.update_updated_at_column()                  (trigger updated_at)
-- ============================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------

-- Config por canal: liga/desliga, kill-switch, revisão humana, confiança.
create table if not exists public.automation_configs (
  id                   uuid primary key default uuid_generate_v4(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  channel_id           uuid not null references public.user_channels(id) on delete cascade,
  enabled              boolean not null default false,
  kill_switch          boolean not null default false,
  require_human_review boolean not null default true,
  min_confidence       numeric(4,3) not null default 0.75,
  business_hours       jsonb not null default '{}',
  auto_reply_intents   text[] not null default '{}',
  brand_voice_id       uuid references public.brand_voice_profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (organization_id, channel_id)
);

-- Regras por intenção: qual ação tomar para cada intenção detectada.
create table if not exists public.automation_rules (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id      uuid not null references public.user_channels(id) on delete cascade,
  intent          text not null check (intent in ('purchase','question','praise','complaint','troll','spam','other')),
  action_type     text not null check (action_type in ('public_reply','private_reply','route_dm','hide','like','ignore','human')),
  prompt_template text,
  priority        int not null default 100,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, channel_id, intent)
);

-- Eventos recebidos do webhook. O status É a fila do tick.
-- Colunas de motor (locked_at/attempts/next_attempt_at): lease + retry,
-- mesmo padrão de atomization_jobs.
create table if not exists public.interaction_events (
  id                uuid primary key default uuid_generate_v4(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  channel_id        uuid not null references public.user_channels(id) on delete cascade,
  provider          text not null default 'instagram',
  provider_event_id text not null,
  type              text not null check (type in ('comment','mention','message')),
  external_user_id  text,
  external_username text,
  post_external_id  text,
  text              text,
  intent            text,
  intent_confidence numeric(4,3),
  sentiment         text check (sentiment in ('positive','neutral','negative')),
  raw               jsonb not null default '{}',
  status            text not null default 'received'
                    check (status in ('received','classified','actioned','held','ignored','failed')),
  locked_at         timestamptz,
  attempts          int not null default 0,
  next_attempt_at   timestamptz,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  -- INVARIANTE #2: idempotência — a Meta reentrega; conflito = no-op.
  unique (provider, provider_event_id)
);

-- Ações de saída (cada chamada à Meta vira uma linha com provider_message_id ou error).
create table if not exists public.interaction_actions (
  id                  uuid primary key default uuid_generate_v4(),
  event_id            uuid not null references public.interaction_events(id) on delete cascade,
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  action_type         text not null,
  payload             jsonb not null default '{}',
  provider_message_id text,
  status              text not null default 'pending'
                      check (status in ('pending','held','sent','failed','skipped')),
  actor               text not null default 'system',
  error               text,
  created_at          timestamptz not null default now()
);

-- Conversas de DM (funil de venda). Janela de 24h: window_expires_at.
create table if not exists public.conversations (
  id                uuid primary key default uuid_generate_v4(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  channel_id        uuid not null references public.user_channels(id) on delete cascade,
  external_user_id  text not null,
  external_username text,
  flow_id           uuid,
  state             text not null default 'open'
                    check (state in ('open','qualified','won','lost','handed_off','blocked')),
  context           jsonb not null default '{}',
  do_not_contact    boolean not null default false,
  last_inbound_at   timestamptz,
  window_expires_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (channel_id, external_user_id)
);

create table if not exists public.conversation_messages (
  id                  uuid primary key default uuid_generate_v4(),
  conversation_id     uuid not null references public.conversations(id) on delete cascade,
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  direction           text not null check (direction in ('in','out')),
  text                text,
  intent              text,
  provider_message_id text,
  created_at          timestamptz not null default now()
);

-- Funis de venda (passos do fluxo de qualificação no DM).
create table if not exists public.sales_flows (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  steps           jsonb not null default '[]',
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Fila de revisão humana (baixa confiança ou require_human_review).
create table if not exists public.review_queue (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  event_id         uuid not null references public.interaction_events(id) on delete cascade,
  suggested_action jsonb not null default '{}',
  status           text not null default 'pending'
                   check (status in ('pending','approved','rejected','edited')),
  reviewer_id      uuid references auth.users(id) on delete set null,
  final_text       text,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);

create table if not exists public.faq_entries (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id      uuid references public.user_channels(id) on delete cascade,
  question        text not null,
  answer          text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 2. ÍNDICES
-- ---------------------------------------------------------
create index if not exists idx_events_org           on public.interaction_events(organization_id);
create index if not exists idx_events_status         on public.interaction_events(status);
-- Índice do poll do tick: eventos reivindicáveis (não-terminais), por backoff.
create index if not exists idx_events_claimable
  on public.interaction_events (status, next_attempt_at)
  where status not in ('actioned','ignored','failed');
create index if not exists idx_actions_event         on public.interaction_actions(event_id);
create index if not exists idx_conv_channel_user     on public.conversations(channel_id, external_user_id);
create index if not exists idx_convmsg_conv          on public.conversation_messages(conversation_id);
create index if not exists idx_review_org_status     on public.review_queue(organization_id, status);

-- ---------------------------------------------------------
-- 3. RPC: claim_due_interactions
--    Reivindica até p_limit eventos elegíveis (não-terminais, fora de
--    backoff, lease livre/expirado) com FOR UPDATE SKIP LOCKED, marca o
--    lease (locked_at, attempts++) atomicamente e retorna as linhas.
--    Espelha claim_atomization_jobs do motor de jobs.
-- ---------------------------------------------------------
create or replace function public.claim_due_interactions(p_limit int, p_lease interval)
returns setof public.interaction_events
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.interaction_events
    where status not in ('actioned','ignored','failed')
      and (next_attempt_at is null or next_attempt_at <= now())
      and (locked_at is null or locked_at < now() - p_lease)
    order by received_at asc
    limit p_limit
    for update skip locked
  )
  update public.interaction_events e
  set locked_at = now(),
      attempts  = e.attempts + 1
  from candidates c
  where e.id = c.id
  returning e.*;
end;
$$;

-- ---------------------------------------------------------
-- 4. RLS
--    Leitura: membros da org. Escrita de config/regras/funil/faq:
--    owner/admin. interaction_events/actions/conversations/messages e
--    a maioria das escritas são feitas pelo worker via service_role
--    (que ignora RLS). review_queue: membros podem decidir (update).
-- ---------------------------------------------------------
alter table public.automation_configs    enable row level security;
alter table public.automation_rules       enable row level security;
alter table public.interaction_events     enable row level security;
alter table public.interaction_actions    enable row level security;
alter table public.conversations          enable row level security;
alter table public.conversation_messages  enable row level security;
alter table public.sales_flows            enable row level security;
alter table public.review_queue           enable row level security;
alter table public.faq_entries            enable row level security;

alter table public.automation_configs    force row level security;
alter table public.automation_rules       force row level security;
alter table public.interaction_events     force row level security;
alter table public.interaction_actions    force row level security;
alter table public.conversations          force row level security;
alter table public.conversation_messages  force row level security;
alter table public.sales_flows            force row level security;
alter table public.review_queue           force row level security;
alter table public.faq_entries            force row level security;

-- automation_configs: leitura membro, escrita admin.
drop policy if exists automation_configs_select on public.automation_configs;
create policy automation_configs_select on public.automation_configs
  for select to authenticated using ( public.is_org_member(organization_id) );
drop policy if exists automation_configs_write on public.automation_configs;
create policy automation_configs_write on public.automation_configs
  for all to authenticated
  using ( public.org_role(organization_id) in ('owner','admin') )
  with check ( public.org_role(organization_id) in ('owner','admin') );

-- automation_rules: leitura membro, escrita admin.
drop policy if exists automation_rules_select on public.automation_rules;
create policy automation_rules_select on public.automation_rules
  for select to authenticated using ( public.is_org_member(organization_id) );
drop policy if exists automation_rules_write on public.automation_rules;
create policy automation_rules_write on public.automation_rules
  for all to authenticated
  using ( public.org_role(organization_id) in ('owner','admin') )
  with check ( public.org_role(organization_id) in ('owner','admin') );

-- interaction_events: leitura membro (escrita só service_role).
drop policy if exists interaction_events_select on public.interaction_events;
create policy interaction_events_select on public.interaction_events
  for select to authenticated using ( public.is_org_member(organization_id) );

-- interaction_actions: leitura membro (escrita só service_role).
drop policy if exists interaction_actions_select on public.interaction_actions;
create policy interaction_actions_select on public.interaction_actions
  for select to authenticated using ( public.is_org_member(organization_id) );

-- conversations: leitura membro (escrita só service_role).
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select to authenticated using ( public.is_org_member(organization_id) );

-- conversation_messages: leitura membro (escrita só service_role).
drop policy if exists conversation_messages_select on public.conversation_messages;
create policy conversation_messages_select on public.conversation_messages
  for select to authenticated using ( public.is_org_member(organization_id) );

-- sales_flows: leitura membro, escrita admin.
drop policy if exists sales_flows_select on public.sales_flows;
create policy sales_flows_select on public.sales_flows
  for select to authenticated using ( public.is_org_member(organization_id) );
drop policy if exists sales_flows_write on public.sales_flows;
create policy sales_flows_write on public.sales_flows
  for all to authenticated
  using ( public.org_role(organization_id) in ('owner','admin') )
  with check ( public.org_role(organization_id) in ('owner','admin') );

-- faq_entries: leitura membro, escrita admin.
drop policy if exists faq_entries_select on public.faq_entries;
create policy faq_entries_select on public.faq_entries
  for select to authenticated using ( public.is_org_member(organization_id) );
drop policy if exists faq_entries_write on public.faq_entries;
create policy faq_entries_write on public.faq_entries
  for all to authenticated
  using ( public.org_role(organization_id) in ('owner','admin') )
  with check ( public.org_role(organization_id) in ('owner','admin') );

-- review_queue: leitura membro; decisão (update) por membro da org.
drop policy if exists review_queue_select on public.review_queue;
create policy review_queue_select on public.review_queue
  for select to authenticated using ( public.is_org_member(organization_id) );
drop policy if exists review_queue_decide on public.review_queue;
create policy review_queue_decide on public.review_queue
  for update to authenticated
  using ( public.is_org_member(organization_id) )
  with check ( public.is_org_member(organization_id) );

-- ---------------------------------------------------------
-- 5. TRIGGERS updated_at (reusa public.update_updated_at_column())
-- ---------------------------------------------------------
drop trigger if exists set_updated_at on public.automation_configs;
create trigger set_updated_at before update on public.automation_configs
  for each row execute function public.update_updated_at_column();

drop trigger if exists set_updated_at on public.automation_rules;
create trigger set_updated_at before update on public.automation_rules
  for each row execute function public.update_updated_at_column();

drop trigger if exists set_updated_at on public.conversations;
create trigger set_updated_at before update on public.conversations
  for each row execute function public.update_updated_at_column();

drop trigger if exists set_updated_at on public.sales_flows;
create trigger set_updated_at before update on public.sales_flows
  for each row execute function public.update_updated_at_column();

drop trigger if exists set_updated_at on public.faq_entries;
create trigger set_updated_at before update on public.faq_entries
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------
-- ROLLBACK (referência — não executar automaticamente)
-- ---------------------------------------------------------
-- drop function if exists public.claim_due_interactions(int, interval);
-- drop table if exists public.faq_entries, public.review_queue, public.sales_flows,
--   public.conversation_messages, public.conversations, public.interaction_actions,
--   public.interaction_events, public.automation_rules, public.automation_configs cascade;
