-- ============================================================
-- APROVAÇÃO DE AGÊNCIA — DELTA: fila durável de notificação no motor pg_cron
-- ------------------------------------------------------------
-- ADITIVO. A Aprovação de Agência já existe (create-approvals.sql). Hoje a
-- notificação ao tomar a decisão é INLINE (fire-and-forget na rota decide) —
-- pode se perder em cold-start serverless e não tem retry.
--
-- Este delta torna a notificação DURÁVEL: a decisão enfileira em
-- approval_notifications; o pg_cron (/api/cron/tick) reivindica via
-- claim_approval_notifications (FOR UPDATE SKIP LOCKED + lease) e envia com
-- retry. Idempotente: dois ticks não enviam duplicado. (Invariante #8.)
--
-- Convenções do projeto: gen_random_uuid(), RLS via is_org_member(), trigger
-- update_updated_at_column(). Idempotente: pode reaplicar.
-- Aplicar: supabase db query --linked --file lib/db/create-approval-notify-queue.sql
-- ============================================================

-- ---------------------------------------------------------
-- 1. approval_notifications (fila; mesmo padrão de lease das outras filas)
-- ---------------------------------------------------------
create table if not exists public.approval_notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  collection_id   uuid not null references public.approval_collections(id) on delete cascade,
  decision_id     uuid references public.approval_decisions(id) on delete set null,
  -- contexto mínimo para o sender montar a mensagem sem recomputar.
  collection_item_id uuid references public.approval_collection_items(id) on delete set null,
  decision        text,
  channel         text not null default 'email' check (channel in ('email','whatsapp')),
  payload         jsonb not null default '{}',
  status          text not null default 'pending'
                  check (status in ('pending','processing','sent','failed')),
  attempts        int not null default 0,
  -- colunas de motor: lease (igual atomization_jobs/content_projects).
  locked_at       timestamptz,
  next_attempt_at timestamptz,
  created_at      timestamptz not null default now()
);

-- Índice do poll do claim: notificações reivindicáveis por backoff.
create index if not exists idx_appnotif_claim
  on public.approval_notifications (status, next_attempt_at)
  where status in ('pending','processing');
create index if not exists idx_appnotif_org on public.approval_notifications(organization_id);

-- ---------------------------------------------------------
-- 2. RLS: leitura por membro; escrita só service_role (tick/rota pública).
-- ---------------------------------------------------------
alter table public.approval_notifications enable row level security;
alter table public.approval_notifications force row level security;

drop policy if exists approval_notifications_select on public.approval_notifications;
create policy approval_notifications_select on public.approval_notifications
  for select to authenticated using ( public.is_org_member(organization_id) );

-- ---------------------------------------------------------
-- 3. RPC: claim_approval_notifications (molde dos outros claim_*)
--    Reivindica pending OU processing com lease vencido; seta processing +
--    locked_at + attempts++; retorna as linhas. FOR UPDATE SKIP LOCKED.
-- ---------------------------------------------------------
create or replace function public.claim_approval_notifications(p_limit int, p_lease interval)
returns setof public.approval_notifications
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.approval_notifications
    where status in ('pending','processing')
      and (next_attempt_at is null or next_attempt_at <= now())
      and (locked_at is null or locked_at < now() - p_lease)
    order by created_at asc
    limit p_limit
    for update skip locked
  )
  update public.approval_notifications n
  set status    = 'processing',
      locked_at = now(),
      attempts  = n.attempts + 1
  from candidates c
  where n.id = c.id
  returning n.*;
end;
$$;

-- ---------------------------------------------------------
-- ROLLBACK (referência)
-- ---------------------------------------------------------
-- drop function if exists public.claim_approval_notifications(int, interval);
-- drop table if exists public.approval_notifications cascade;
