-- =========================================================
-- FLOW INSTA — Aprovação de Agência (Client Approval)
-- =========================================================
-- Aditiva: roda DEPOIS de create-org-multitenancy.sql.
-- Ajustes vs schema original:
--   - posts(id) -> scheduled_posts(id) (tabela real do projeto)
--   - gen_random_uuid() (padrão do projeto)
--   - RLS via funções SECURITY DEFINER is_org_member()/org_role()
--   - approval_decisions append-only (sem policy de update/delete + revoke)
-- Aplicar: supabase db query --linked --file lib/db/create-approvals.sql
-- =========================================================

-- ---------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------
create table if not exists public.approval_collections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by      uuid not null references auth.users(id) on delete set null,
  client_name     text not null,
  title           text not null,
  status          text not null default 'draft'
                  check (status in ('draft','in_review','approved','changes_requested','archived')),
  due_at          timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.approval_collection_items (
  id              uuid primary key default gen_random_uuid(),
  collection_id   uuid not null references public.approval_collections(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  post_id         uuid not null references public.scheduled_posts(id) on delete cascade,
  position        int not null default 0,
  item_status     text not null default 'pending'
                  check (item_status in ('pending','approved','changes_requested','rejected')),
  created_at      timestamptz not null default now(),
  unique (collection_id, post_id)
);

create table if not exists public.approval_links (
  id              uuid primary key default gen_random_uuid(),
  collection_id   uuid not null references public.approval_collections(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  token_hash      text not null unique,           -- sha256(token); NUNCA o token cru
  scope           jsonb not null default '{}',
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  max_uses        int,
  used_count      int not null default 0,
  created_by      uuid not null references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create table if not exists public.approval_sessions (
  id              uuid primary key default gen_random_uuid(),
  link_id         uuid not null references public.approval_links(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_email  text,
  display_name    text,
  ip              inet,
  user_agent      text,
  started_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

create table if not exists public.approval_decisions (
  id                 uuid primary key default gen_random_uuid(),
  collection_item_id uuid not null references public.approval_collection_items(id) on delete cascade,
  collection_id      uuid not null references public.approval_collections(id) on delete cascade,
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  session_id         uuid references public.approval_sessions(id) on delete set null,
  decision           text not null check (decision in ('approved','changes_requested','rejected')),
  comment            text,
  decided_by_email   text,
  created_at         timestamptz not null default now()
);

create table if not exists public.approval_comments (
  id                 uuid primary key default gen_random_uuid(),
  collection_item_id uuid not null references public.approval_collection_items(id) on delete cascade,
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  author_type        text not null check (author_type in ('client','agency')),
  author_session_id  uuid references public.approval_sessions(id) on delete set null,
  author_user_id     uuid references auth.users(id) on delete set null,
  body               text not null,
  created_at         timestamptz not null default now()
);

create table if not exists public.workspace_branding (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade unique,
  logo_path       text,
  primary_color   text default '#6366f1',
  accent_color    text default '#06b6d4',
  custom_domain   text,
  domain_verified boolean not null default false,
  email_from_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 2. ÍNDICES
-- ---------------------------------------------------------
create index if not exists idx_appcoll_org      on public.approval_collections(organization_id);
create index if not exists idx_appitems_coll    on public.approval_collection_items(collection_id);
create index if not exists idx_appitems_post    on public.approval_collection_items(post_id);
create index if not exists idx_applinks_hash     on public.approval_links(token_hash);
create index if not exists idx_appsessions_link  on public.approval_sessions(link_id);
create index if not exists idx_appdecisions_item on public.approval_decisions(collection_item_id);
create index if not exists idx_appcomments_item  on public.approval_comments(collection_item_id);
create index if not exists idx_branding_org      on public.workspace_branding(organization_id);

-- ---------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------
alter table public.approval_collections      enable row level security;
alter table public.approval_collection_items enable row level security;
alter table public.approval_links            enable row level security;
alter table public.approval_sessions         enable row level security;
alter table public.approval_decisions        enable row level security;
alter table public.approval_comments         enable row level security;
alter table public.workspace_branding        enable row level security;

alter table public.approval_collections      force row level security;
alter table public.approval_collection_items force row level security;
alter table public.approval_links            force row level security;
alter table public.approval_sessions         force row level security;
alter table public.approval_decisions        force row level security;
alter table public.approval_comments         force row level security;
alter table public.workspace_branding        force row level security;

-- Leitura: qualquer membro da org. (Funções SECURITY DEFINER evitam recursão.)
drop policy if exists appcoll_select on public.approval_collections;
create policy appcoll_select on public.approval_collections
  for select to authenticated using ( public.is_org_member(organization_id) );

drop policy if exists appitems_select on public.approval_collection_items;
create policy appitems_select on public.approval_collection_items
  for select to authenticated using ( public.is_org_member(organization_id) );

drop policy if exists applinks_select on public.approval_links;
create policy applinks_select on public.approval_links
  for select to authenticated using ( public.is_org_member(organization_id) );

drop policy if exists appsessions_select on public.approval_sessions;
create policy appsessions_select on public.approval_sessions
  for select to authenticated using ( public.is_org_member(organization_id) );

drop policy if exists appdecisions_select on public.approval_decisions;
create policy appdecisions_select on public.approval_decisions
  for select to authenticated using ( public.is_org_member(organization_id) );

drop policy if exists appcomments_select on public.approval_comments;
create policy appcomments_select on public.approval_comments
  for select to authenticated using ( public.is_org_member(organization_id) );

drop policy if exists branding_select on public.workspace_branding;
create policy branding_select on public.workspace_branding
  for select to authenticated using ( public.is_org_member(organization_id) );

-- Escrita (owner/admin): coleções, itens, links, branding.
drop policy if exists appcoll_write on public.approval_collections;
create policy appcoll_write on public.approval_collections
  for all to authenticated
  using ( public.org_role(organization_id) in ('owner','admin') )
  with check ( public.org_role(organization_id) in ('owner','admin') );

drop policy if exists appitems_write on public.approval_collection_items;
create policy appitems_write on public.approval_collection_items
  for all to authenticated
  using ( public.org_role(organization_id) in ('owner','admin') )
  with check ( public.org_role(organization_id) in ('owner','admin') );

drop policy if exists applinks_write on public.approval_links;
create policy applinks_write on public.approval_links
  for all to authenticated
  using ( public.org_role(organization_id) in ('owner','admin') )
  with check ( public.org_role(organization_id) in ('owner','admin') );

drop policy if exists branding_write on public.workspace_branding;
create policy branding_write on public.workspace_branding
  for all to authenticated
  using ( public.org_role(organization_id) in ('owner','admin') )
  with check ( public.org_role(organization_id) in ('owner','admin') );

-- Comentários da agência: qualquer membro pode inserir.
drop policy if exists appcomments_insert_agency on public.approval_comments;
create policy appcomments_insert_agency on public.approval_comments
  for insert to authenticated
  with check ( public.is_org_member(organization_id) );

-- ---------------------------------------------------------
-- 4. APPEND-ONLY de approval_decisions
-- ---------------------------------------------------------
-- Sem policy de UPDATE/DELETE (RLS forçado já bloqueia authenticated/anon).
-- Reforço explícito de privilégios. As rotas públicas usam service_role
-- (que bypassa RLS) APENAS para INSERT — nunca update/delete de decisões.
revoke update, delete on public.approval_decisions from authenticated, anon;

-- ---------------------------------------------------------
-- 5. TRIGGERS updated_at
-- ---------------------------------------------------------
create or replace function public.update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.approval_collections;
create trigger set_updated_at before update on public.approval_collections
  for each row execute function public.update_updated_at_column();

drop trigger if exists set_updated_at on public.workspace_branding;
create trigger set_updated_at before update on public.workspace_branding
  for each row execute function public.update_updated_at_column();
