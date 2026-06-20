-- ============================================================
-- MOTOR DE JOBS (Supabase pg_cron + pg_net) — substitui o Inngest
-- ------------------------------------------------------------
-- O status no banco É a fila. Um pg_cron chama POST /api/cron/tick
-- a cada minuto (via pg_net) e o endpoint avança os jobs pendentes.
--
-- Idempotente: pode reaplicar com segurança.
-- Aplicar via: supabase db query --linked --file lib/db/create-job-engine.sql
-- (extensões pg_cron/pg_net podem exigir aplicação no schema do projeto Supabase)
-- ============================================================

-- ---------------------------------------------------------
-- 1. EXTENSÕES
-- ---------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------
-- 2. COLUNAS DE LOCKING / RETRY em atomization_jobs
--    locked_at: lease — quando um tick reivindicou o job
--    attempts: tentativas da ETAPA atual (reseta ao avançar de status)
--    next_attempt_at: backoff — só elegível quando <= now()
-- ---------------------------------------------------------
alter table public.atomization_jobs
  add column if not exists locked_at       timestamptz,
  add column if not exists attempts        int not null default 0,
  add column if not exists next_attempt_at timestamptz;

-- ---------------------------------------------------------
-- 3. STATUS 'publishing' em scheduled_posts
--    (estado intermediário do claim — evita publicar 2x).
--    Constraint atual: status in ('queue','draft','published','failed').
-- ---------------------------------------------------------
alter table public.scheduled_posts drop constraint if exists scheduled_posts_status_check;
alter table public.scheduled_posts
  add constraint scheduled_posts_status_check
  check (status in ('draft','queue','publishing','published','failed'));

-- ---------------------------------------------------------
-- 3b. TRIGGER updated_at em scheduled_posts
--     scheduled_posts não tinha trigger de updated_at; o reclaim de órfão de
--     publicação (claim_due_posts: updated_at < now()-lease) depende dele.
--     Sem isto o updated_at fica congelado na criação e o reclaim re-publica
--     durante a publicação ativa (publicação DUPLICADA).
-- ---------------------------------------------------------
drop trigger if exists set_updated_at on public.scheduled_posts;
create trigger set_updated_at
  before update on public.scheduled_posts
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------
-- 4. ÍNDICES PARA OS POLLS
-- ---------------------------------------------------------
create index if not exists idx_atom_jobs_claimable
  on public.atomization_jobs (status, next_attempt_at)
  where status not in ('completed','failed','canceled');

create index if not exists idx_sched_posts_due
  on public.scheduled_posts (scheduled_at)
  where status = 'queue';

-- ---------------------------------------------------------
-- 5. RPC: claim_atomization_jobs
--    Reivindica até p_limit jobs elegíveis com FOR UPDATE SKIP LOCKED,
--    marca o lease (locked_at, attempts++) atomicamente e retorna as linhas.
--    Elegível = não-terminal, fora de backoff, e lease livre OU expirado.
-- ---------------------------------------------------------
create or replace function public.claim_atomization_jobs(p_limit int, p_lease interval)
returns setof public.atomization_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.atomization_jobs
    where status not in ('completed','failed','canceled')
      and (next_attempt_at is null or next_attempt_at <= now())
      and (locked_at is null or locked_at < now() - p_lease)
    order by created_at asc
    limit p_limit
    for update skip locked
  )
  update public.atomization_jobs j
  set locked_at = now(),
      attempts  = j.attempts + 1
  from candidates c
  where j.id = c.id
  returning j.*;
end;
$$;

-- ---------------------------------------------------------
-- 6. RPC: claim_due_posts
--    Reivindica até p_limit posts 'queue' vencidos, movendo-os para
--    'publishing' atomicamente (lease implícito pelo próprio status).
--    Reclama órfãos: posts presos em 'publishing' além do lease voltam a ser
--    elegíveis (caso um tick tenha morrido no meio).
-- ---------------------------------------------------------
create or replace function public.claim_due_posts(p_limit int, p_lease interval)
returns setof public.scheduled_posts
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.scheduled_posts
    where (
        (status = 'queue' and scheduled_at <= now())
        or (status = 'publishing' and updated_at < now() - p_lease)
      )
    order by scheduled_at asc
    limit p_limit
    for update skip locked
  )
  update public.scheduled_posts p
  set status = 'publishing',
      updated_at = now() -- CRÍTICO: marca o instante do claim; o reclaim de
                         -- órfão (updated_at < now()-lease) só dispara se o
                         -- tick que reivindicou realmente morreu. Sem isto, o
                         -- updated_at fica congelado na criação do post e o
                         -- reclaim re-publica durante a publicação ativa.
  from candidates c
  where p.id = c.id
  returning p.*;
end;
$$;

-- ---------------------------------------------------------
-- 7. AGENDAMENTO DO TICK (pg_cron -> pg_net.http_post)
-- ---------------------------------------------------------
-- IMPORTANTE: substitua <APP_URL> e <CRON_SECRET> antes de aplicar este bloco,
-- OU rode o bloco "schedule" separadamente com os valores reais (o restante do
-- arquivo é seguro/idempotente sem ele).
--
-- pg_net é ASSÍNCRONO: net.http_post apenas enfileira a requisição e retorna
-- um id; a resposta chega em net._http_response (consultar para depurar).
-- O secret fica legível em cron.job para quem tem acesso ao banco — aceitável
-- para um SaaS pequeno. Alternativa mais segura: guardar em vault.create_secret
-- e ler via vault no comando agendado.
--
-- Reaplicar: unschedule antes de reagendar (evita duplicar o job).
--
-- select cron.unschedule('flow-insta-tick');
-- select cron.schedule(
--   'flow-insta-tick',
--   '* * * * *',
--   $cron$
--     select net.http_post(
--       url     := '<APP_URL>/api/cron/tick',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'X-Cron-Secret', '<CRON_SECRET>'
--       ),
--       body    := '{}'::jsonb
--     );
--   $cron$
-- );

-- ---------------------------------------------------------
-- ROLLBACK (referência — não executar automaticamente)
-- ---------------------------------------------------------
-- select cron.unschedule('flow-insta-tick');
-- drop function if exists public.claim_atomization_jobs(int, interval);
-- drop function if exists public.claim_due_posts(int, interval);
-- alter table public.atomization_jobs
--   drop column if exists locked_at,
--   drop column if exists attempts,
--   drop column if exists next_attempt_at;
-- (status check volta a ('queue','draft','published','failed'))
