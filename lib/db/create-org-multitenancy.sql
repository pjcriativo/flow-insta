-- =========================================================
-- FLOW INSTA — Multi-tenancy (B2C + B2B) + Platform Admin
-- =========================================================
-- Roda DEPOIS de create-social-scheduling-tables.sql.
-- Introduz organizações como container universal de dados:
--   - B2C: cada usuário ganha uma org "personal" (1 membro) no signup.
--   - B2B: orgs "team" com vários membros, papéis e convites.
-- O eixo de isolamento dos dados passa de user_id para org_id.
-- Aplicar via: supabase db query --linked --file lib/db/create-org-multitenancy.sql
-- =========================================================

-- ---------------------------------------------------------
-- 1. TABELAS DE ORGANIZAÇÃO
-- ---------------------------------------------------------
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique,
  type        text not null default 'personal'
              check (type in ('personal','team')),
  created_by  uuid not null,                 -- auth.users.id (autoria)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_orgs_created_by on public.organizations(created_by);

create table if not exists public.organization_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null,                 -- auth.users.id
  role        text not null default 'member'
              check (role in ('owner','admin','member')),
  created_at  timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists idx_members_user on public.organization_members(user_id);
create index if not exists idx_members_org  on public.organization_members(org_id);

create table if not exists public.invitations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  email        text not null,
  role         text not null default 'member'
               check (role in ('owner','admin','member')),
  token        text not null unique,
  invited_by   uuid not null,                -- auth.users.id
  status       text not null default 'pending'
               check (status in ('pending','accepted','revoked','expired')),
  expires_at   timestamptz not null default (now() + interval '7 days'),
  created_at   timestamptz not null default now(),
  unique (org_id, email, status)
);
create index if not exists idx_invitations_email on public.invitations(lower(email));
create index if not exists idx_invitations_token on public.invitations(token);

create table if not exists public.platform_admins (
  user_id     uuid primary key,              -- auth.users.id
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 2. FUNÇÕES SECURITY DEFINER (quebram recursão de RLS)
-- ---------------------------------------------------------
-- Rodam como owner -> NÃO reaplicam RLS ao ler organization_members,
-- evitando a recursão infinita clássica do Supabase.

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where org_id = p_org_id
      and user_id = (select auth.uid())
  );
$$;

create or replace function public.org_role(p_org_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.organization_members
  where org_id = p_org_id and user_id = (select auth.uid())
  limit 1;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins where user_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------
-- 3. ORG_ID NAS TABELAS DE DADOS
-- ---------------------------------------------------------
-- Banco dev/vazio: adicionamos org_id e mantemos user_id (autoria).
-- O isolamento passa a ser por org_id.

alter table public.user_channels
  add column if not exists org_id uuid references public.organizations(id) on delete cascade;
create index if not exists idx_user_channels_org on public.user_channels(org_id);

alter table public.ideas
  add column if not exists org_id uuid references public.organizations(id) on delete cascade;
create index if not exists idx_ideas_org on public.ideas(org_id);

alter table public.scheduled_posts
  add column if not exists org_id uuid references public.organizations(id) on delete cascade;
create index if not exists idx_scheduled_posts_org on public.scheduled_posts(org_id);

-- Unicidade do canal passa a ser por organização (1 conta da rede por org).
alter table public.user_channels
  drop constraint if exists user_channels_user_id_channel_type_id_key;
alter table public.user_channels
  drop constraint if exists user_channels_org_channel_unique;
alter table public.user_channels
  add constraint user_channels_org_channel_unique unique (org_id, channel_type_id);

-- ---------------------------------------------------------
-- 4. RLS DAS TABELAS DE DADOS (org-scoped)
-- ---------------------------------------------------------
-- Remove as policies antigas baseadas em user_id e cria 4 policies
-- granulares por tabela. SELECT também libera platform_admin (somente leitura).

-- user_channels
drop policy if exists user_channels_policy on public.user_channels;
alter table public.user_channels enable row level security;
alter table public.user_channels force row level security;
create policy user_channels_select on public.user_channels
  for select to authenticated
  using ( public.is_org_member(org_id) or public.is_platform_admin() );
create policy user_channels_insert on public.user_channels
  for insert to authenticated
  with check ( public.is_org_member(org_id) );
create policy user_channels_update on public.user_channels
  for update to authenticated
  using ( public.is_org_member(org_id) )
  with check ( public.is_org_member(org_id) );
create policy user_channels_delete on public.user_channels
  for delete to authenticated
  using ( public.is_org_member(org_id) );

-- ideas
drop policy if exists ideas_policy on public.ideas;
alter table public.ideas enable row level security;
alter table public.ideas force row level security;
create policy ideas_select on public.ideas
  for select to authenticated
  using ( public.is_org_member(org_id) or public.is_platform_admin() );
create policy ideas_insert on public.ideas
  for insert to authenticated
  with check ( public.is_org_member(org_id) );
create policy ideas_update on public.ideas
  for update to authenticated
  using ( public.is_org_member(org_id) )
  with check ( public.is_org_member(org_id) );
create policy ideas_delete on public.ideas
  for delete to authenticated
  using ( public.is_org_member(org_id) );

-- scheduled_posts
drop policy if exists scheduled_posts_policy on public.scheduled_posts;
alter table public.scheduled_posts enable row level security;
alter table public.scheduled_posts force row level security;
create policy scheduled_posts_select on public.scheduled_posts
  for select to authenticated
  using ( public.is_org_member(org_id) or public.is_platform_admin() );
create policy scheduled_posts_insert on public.scheduled_posts
  for insert to authenticated
  with check ( public.is_org_member(org_id) );
create policy scheduled_posts_update on public.scheduled_posts
  for update to authenticated
  using ( public.is_org_member(org_id) )
  with check ( public.is_org_member(org_id) );
create policy scheduled_posts_delete on public.scheduled_posts
  for delete to authenticated
  using ( public.is_org_member(org_id) );

-- ---------------------------------------------------------
-- 5. RLS DAS TABELAS DE ORGANIZAÇÃO
-- ---------------------------------------------------------

-- organizations
alter table public.organizations enable row level security;
alter table public.organizations force row level security;
drop policy if exists orgs_select on public.organizations;
drop policy if exists orgs_insert on public.organizations;
drop policy if exists orgs_update on public.organizations;
drop policy if exists orgs_delete on public.organizations;
create policy orgs_select on public.organizations
  for select to authenticated
  using ( public.is_org_member(id) or public.is_platform_admin() );
create policy orgs_insert on public.organizations
  for insert to authenticated
  with check ( created_by = (select auth.uid()) );
create policy orgs_update on public.organizations
  for update to authenticated
  using ( public.org_role(id) in ('owner','admin') )
  with check ( public.org_role(id) in ('owner','admin') );
create policy orgs_delete on public.organizations
  for delete to authenticated
  using ( public.org_role(id) = 'owner' );

-- organization_members
alter table public.organization_members enable row level security;
alter table public.organization_members force row level security;
drop policy if exists members_select on public.organization_members;
drop policy if exists members_insert_self_owner on public.organization_members;
drop policy if exists members_update on public.organization_members;
drop policy if exists members_delete on public.organization_members;
create policy members_select on public.organization_members
  for select to authenticated
  using ( public.is_org_member(org_id) or public.is_platform_admin() );
-- Único INSERT permitido ao cliente: o criador da org virando owner.
-- Demais adições (convites B2B) são server-side via service_role.
create policy members_insert_self_owner on public.organization_members
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'owner'
    and (select created_by from public.organizations o where o.id = org_id) = (select auth.uid())
  );
create policy members_update on public.organization_members
  for update to authenticated
  using ( public.org_role(org_id) in ('owner','admin') )
  with check ( public.org_role(org_id) in ('owner','admin') );
create policy members_delete on public.organization_members
  for delete to authenticated
  using ( public.org_role(org_id) in ('owner','admin')
          or user_id = (select auth.uid()) );

-- invitations
alter table public.invitations enable row level security;
alter table public.invitations force row level security;
drop policy if exists invitations_select on public.invitations;
drop policy if exists invitations_insert on public.invitations;
drop policy if exists invitations_update on public.invitations;
create policy invitations_select on public.invitations
  for select to authenticated
  using (
    public.org_role(org_id) in ('owner','admin')
    or lower(email) = lower((select auth.jwt() ->> 'email'))
    or public.is_platform_admin()
  );
create policy invitations_insert on public.invitations
  for insert to authenticated
  with check ( public.org_role(org_id) in ('owner','admin') );
create policy invitations_update on public.invitations
  for update to authenticated
  using ( public.org_role(org_id) in ('owner','admin') )
  with check ( public.org_role(org_id) in ('owner','admin') );

-- platform_admins — sem escrita para authenticated (gestão só via service_role/SQL)
alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;
drop policy if exists platform_admins_select on public.platform_admins;
create policy platform_admins_select on public.platform_admins
  for select to authenticated
  using ( public.is_platform_admin() );

-- ---------------------------------------------------------
-- 6. TRIGGER: cria org pessoal + membership owner no signup
-- ---------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_org_id uuid;
begin
  insert into public.organizations (name, type, created_by)
  values (
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)) || '''s workspace',
    'personal',
    new.id
  )
  returning id into v_org_id;

  insert into public.organization_members (org_id, user_id, role)
  values (v_org_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
