-- ============================================================
-- AGENTE DE POST E CARROSSEL — FASE 2: geração de imagem (motor pg_cron)
-- ------------------------------------------------------------
-- A geração de imagem NÃO usa Inngest. content_projects é a fila: a rota
-- /generate-images move o projeto para 'generating'; o pg_cron chama
-- /api/cron/tick, que reivindica projetos via claim_due_content_projects
-- (FOR UPDATE SKIP LOCKED + lease) e gera as imagens slide a slide.
--
-- A migração da Fase 1 já criou as colunas de motor em content_projects
-- (locked_at, attempts, next_attempt_at) e o índice idx_content_projects_claimable.
-- Esta migração só adiciona o RPC de claim.
--
-- Idempotente: pode reaplicar com segurança.
-- Aplicar via: supabase db query --linked --file lib/db/create-content-agent-phase2.sql
-- ============================================================

-- ---------------------------------------------------------
-- RPC: claim_due_content_projects
--   Reivindica até p_limit projetos em 'generating' elegíveis (fora de backoff,
--   lease livre/expirado) com FOR UPDATE SKIP LOCKED, marca o lease
--   (locked_at, attempts++) atomicamente e retorna as linhas.
--   Espelha claim_atomization_jobs. 'generating' é o único status reivindicável:
--   draft/copy_ready ainda não pediram imagem; completed/failed são terminais.
-- ---------------------------------------------------------
create or replace function public.claim_due_content_projects(p_limit int, p_lease interval)
returns setof public.content_projects
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.content_projects
    where status = 'generating'
      and (next_attempt_at is null or next_attempt_at <= now())
      and (locked_at is null or locked_at < now() - p_lease)
    order by updated_at asc
    limit p_limit
    for update skip locked
  )
  update public.content_projects p
  set locked_at = now(),
      attempts  = p.attempts + 1
  from candidates c
  where p.id = c.id
  returning p.*;
end;
$$;

-- ---------------------------------------------------------
-- ROLLBACK (referência — não executar automaticamente)
-- ---------------------------------------------------------
-- drop function if exists public.claim_due_content_projects(int, interval);
