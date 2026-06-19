-- =========================================================
-- FLOW INSTA — Planos + Configurações da plataforma + Auditoria
-- =========================================================
-- Aplicar via: supabase db query --linked --file lib/db/create-plans-and-settings.sql
-- =========================================================

-- ---------------------------------------------------------
-- 1. PLANOS
-- ---------------------------------------------------------
-- Catálogo de planos com limites editáveis pelo admin.
-- Limite -1 = ilimitado.
create table if not exists public.plans (
  id            text primary key,            -- 'free' | 'pro' | 'business'
  name          text not null,
  price_cents   integer not null default 0,  -- preço de referência (Stripe depois)
  max_channels  integer not null default 2,
  max_posts     integer not null default 10, -- por mês
  max_members   integer not null default 1,
  ai_enabled    boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

insert into public.plans (id, name, price_cents, max_channels, max_posts, max_members, ai_enabled, sort_order)
values
  ('free',     'Free',     0,      2,  10, 1, false, 0),
  ('pro',      'Pro',      4900,  10, 100, 3, true,  1),
  ('business', 'Business', 9900,  -1,  -1, -1, true, 2)
on conflict (id) do nothing;

-- Coluna de plano nas organizações (default free).
alter table public.organizations
  add column if not exists plan text not null default 'free' references public.plans(id);
create index if not exists idx_orgs_plan on public.organizations(plan);

-- RLS dos planos: leitura pública (autenticados), escrita só admin.
alter table public.plans enable row level security;
drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans
  for select to authenticated using (true);
-- Sem policies de escrita: gestão via service_role (rotas admin).

-- ---------------------------------------------------------
-- 2. CONFIGURAÇÕES DA PLATAFORMA (key-value)
-- ---------------------------------------------------------
create table if not exists public.platform_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

insert into public.platform_settings (key, value) values
  ('signups_enabled', 'true'::jsonb),
  ('ai_enabled',      'true'::jsonb),
  ('scheduling_enabled', 'true'::jsonb),
  ('announcement',    '{"text":"","enabled":false}'::jsonb)
on conflict (key) do nothing;

-- Leitura: autenticados podem ler (para banner/flags); escrita só admin (service_role).
alter table public.platform_settings enable row level security;
drop policy if exists settings_select on public.platform_settings;
create policy settings_select on public.platform_settings
  for select to authenticated using (true);

-- ---------------------------------------------------------
-- 3. LOG DE AUDITORIA
-- ---------------------------------------------------------
create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid,                          -- quem fez (auth.users.id)
  actor_email text,
  action      text not null,                 -- ex.: 'user.promote', 'org.delete'
  target_type text,                          -- 'user' | 'org' | 'settings' | 'plan'
  target_id   text,
  details     jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_created on public.audit_logs(created_at desc);

alter table public.audit_logs enable row level security;
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs
  for select to authenticated
  using ( public.is_platform_admin() );
-- Escrita só via service_role (rotas admin).

-- ---------------------------------------------------------
-- 4. SUSPENSÃO (usuários / orgs)
-- ---------------------------------------------------------
alter table public.organizations
  add column if not exists suspended boolean not null default false;
