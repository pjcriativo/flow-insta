-- ============================================================
-- AGENTE DE POST E CARROSSEL — Marca fundida + projetos de conteúdo
-- ------------------------------------------------------------
-- Port do protótipo single-tenant para o flow-insta multi-tenant.
--
-- FASE 1 desta migração:
--   1. brand_profiles: tabela FUNDIDA (identidade visual do protótipo +
--      voz verbal que vinha de brand_voice_profiles). SUPERSET.
--   2. Migra os dados de brand_voice_profiles -> brand_profiles
--      PRESERVANDO os ids (para a FK do DM Pilot continuar válida).
--   3. Reponta a FK automation_configs.brand_voice_id para brand_profiles.
--   4. content_projects / content_slides / image_library (org-scoped).
--   5. DROP brand_voice_profiles (após copiar e repontar).
--
-- MOTOR: este recurso NÃO usa Inngest. A geração de imagem (Fase 2) usa o
-- motor pg_cron existente (claim por lease, FOR UPDATE SKIP LOCKED), igual a
-- atomization_jobs. A publicação (Fase 3) enxerta no runPublishPost.
--
-- Convenções do projeto: gen_random_uuid(), RLS via is_org_member()/org_role(),
-- force row level security, trigger update_updated_at_column().
--
-- Idempotente: pode reaplicar com segurança.
-- Aplicar via: supabase db query --linked --file lib/db/create-content-agent.sql
--
-- Dependências (já existentes):
--   public.organizations, public.organization_members
--   public.user_channels
--   public.brand_voice_profiles   (será migrada e dropada por esta migração)
--   public.automation_configs     (DM Pilot; FK brand_voice_id repontada)
--   public.is_org_member(uuid), public.org_role(uuid)
--   public.update_updated_at_column()
-- ============================================================

create extension if not exists "vector";

-- ---------------------------------------------------------
-- 1. brand_profiles (FUNDIDA: visual + voz verbal)
-- ---------------------------------------------------------
create table if not exists public.brand_profiles (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  -- Perfil por canal (mais específico) ou geral da org (channel_id null).
  -- Mantém o seletor de voz canal->org->genérico que a Atomização usa.
  channel_id        uuid references public.user_channels(id) on delete cascade,
  -- identidade
  brand_name        text not null,
  instagram_handle  text,
  description       text,
  target_audience   text,
  tone_of_voice     text,
  -- visual
  color_palette     jsonb not null default '[]',   -- [{name,hex,role}]
  logo_path         text,                           -- storage path; backend assina ao ler
  logo_placement    text,
  typography        jsonb not null default '{}',    -- {primary_font,secondary_font,style_notes}
  visual_style      text,
  mood_keywords     text[] not null default '{}',
  reference_images  text[] not null default '{}',   -- storage paths
  -- voz verbal aprendida (migrada de brand_voice_profiles)
  voice_summary     text,
  voice_tone        jsonb not null default '{}',
  voice_exemplars   jsonb not null default '[]',
  voice_embedding   vector(1536),
  source_post_count int not null default 0,
  refreshed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
  -- Unicidade do seletor de voz: ver índices parciais abaixo. NÃO usar
  -- `unique(organization_id, channel_id)` — em Postgres NULL != NULL, então
  -- essa constraint permitiria N perfis org-wide (channel_id NULL) por org, e
  -- o seletor (voice.ts, .is(channel_id,null).maybeSingle()) quebraria com a
  -- 2ª linha. Índices parciais impõem: 1 por canal E 1 org-wide por org.
);

-- Unicidade do seletor de voz (substitui a unique composta ingênua):
--   - no máximo 1 perfil por (org, canal) quando channel_id é definido;
--   - no máximo 1 perfil org-wide (channel_id NULL) por org.
create unique index if not exists uq_brand_profiles_org_channel
  on public.brand_profiles (organization_id, channel_id)
  where channel_id is not null;
create unique index if not exists uq_brand_profiles_org_wide
  on public.brand_profiles (organization_id)
  where channel_id is null;

-- ---------------------------------------------------------
-- 2. MIGRAÇÃO DE DADOS brand_voice_profiles -> brand_profiles
--    Só roda se a tabela antiga ainda existir (idempotente em reaplicação).
--    PRESERVA o id de cada linha — assim a FK automation_configs.brand_voice_id
--    (que aponta para esses ids) continua válida após repontar.
--    brand_name é NOT NULL: deriva um placeholder quando não há nome.
-- ---------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'brand_voice_profiles'
  ) then
    insert into public.brand_profiles (
      id, organization_id, channel_id, brand_name,
      voice_summary, voice_tone, voice_exemplars, voice_embedding,
      source_post_count, refreshed_at, created_at, updated_at
    )
    -- DEDUP DEFENSIVO: a constraint antiga (unique org,channel) permitia N
    -- perfis org-wide (channel_id NULL) por org. Os índices únicos parciais
    -- novos não toleram isso — sem dedup a migração abortaria. DISTINCT ON
    -- mantém a linha mais recente de cada (org, canal); para os por-canal é
    -- no-op (já eram únicos). NULLs agrupam juntos no DISTINCT ON (≠ unique).
    select distinct on (bvp.organization_id, bvp.channel_id)
      bvp.id,
      bvp.organization_id,
      bvp.channel_id,
      coalesce(nullif(btrim(bvp.summary), ''), 'Marca sem nome'),
      bvp.summary,
      bvp.tone,
      bvp.exemplars,
      bvp.embedding,
      bvp.source_post_count,
      bvp.refreshed_at,
      bvp.created_at,
      bvp.updated_at
    from public.brand_voice_profiles bvp
    order by bvp.organization_id, bvp.channel_id, bvp.updated_at desc
    on conflict (id) do nothing;
  end if;
end $$;

-- ---------------------------------------------------------
-- 3. REPONTAR FK do DM Pilot: automation_configs.brand_voice_id
--    Era -> brand_voice_profiles(id) on delete set null.
--    Passa a -> brand_profiles(id) on delete set null. Os valores existentes
--    continuam válidos porque os ids foram preservados na cópia (passo 2).
--    Só executa se a tabela automation_configs existir (DM Pilot já aplicado).
-- ---------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'automation_configs'
      and column_name = 'brand_voice_id'
  ) then
    -- derruba a FK antiga (nome gerado pelo Postgres); descobre dinamicamente.
    if exists (
      select 1
      from information_schema.table_constraints tc
      join information_schema.constraint_column_usage ccu
        on tc.constraint_name = ccu.constraint_name
       and tc.table_schema = ccu.table_schema
      where tc.table_schema = 'public'
        and tc.table_name = 'automation_configs'
        and tc.constraint_type = 'FOREIGN KEY'
        and ccu.table_name = 'brand_voice_profiles'
    ) then
      execute (
        select 'alter table public.automation_configs drop constraint ' || quote_ident(tc.constraint_name)
        from information_schema.table_constraints tc
        join information_schema.constraint_column_usage ccu
          on tc.constraint_name = ccu.constraint_name
         and tc.table_schema = ccu.table_schema
        where tc.table_schema = 'public'
          and tc.table_name = 'automation_configs'
          and tc.constraint_type = 'FOREIGN KEY'
          and ccu.table_name = 'brand_voice_profiles'
        limit 1
      );
    end if;

    -- recria a FK apontando para brand_profiles (idempotente pelo nome fixo).
    if not exists (
      select 1 from information_schema.table_constraints
      where table_schema = 'public'
        and table_name = 'automation_configs'
        and constraint_name = 'automation_configs_brand_profile_fk'
    ) then
      alter table public.automation_configs
        add constraint automation_configs_brand_profile_fk
        foreign key (brand_voice_id)
        references public.brand_profiles(id) on delete set null;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------
-- 4. content_projects / content_slides / image_library
-- ---------------------------------------------------------
create table if not exists public.content_projects (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  created_by        uuid not null references auth.users(id) on delete set null,
  brand_id          uuid references public.brand_profiles(id) on delete set null,
  content_type      text not null check (content_type in ('post','carousel','thumbnail')),
  idea              text not null,
  reference_content text,
  slide_count       int,
  status            text not null default 'draft'
                    check (status in ('draft','copy_ready','generating','completed','failed')),
  -- colunas de motor (Fase 2): lease + retry, mesmo padrão de atomization_jobs.
  locked_at         timestamptz,
  attempts          int not null default 0,
  next_attempt_at   timestamptz,
  generation_error  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.content_slides (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.content_projects(id) on delete cascade,
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  slide_number        int not null,
  role                text,
  headline            text,
  body                text,
  visual_description  text,
  image_path          text,                           -- storage path
  generation_status   text not null default 'pending'
                      check (generation_status in ('pending','generating','completed','failed')),
  generation_error    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (project_id, slide_number)
);

create table if not exists public.image_library (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id        uuid references public.brand_profiles(id) on delete set null,
  file_path       text not null,
  file_name       text,
  mime_type       text,
  tags            text[] not null default '{}',
  alt_description text,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 5. ÍNDICES
-- ---------------------------------------------------------
create index if not exists idx_brand_profiles_org      on public.brand_profiles(organization_id);
create index if not exists idx_content_projects_org    on public.content_projects(organization_id);
-- Índice do poll do tick (Fase 2): projetos reivindicáveis por backoff.
create index if not exists idx_content_projects_claimable
  on public.content_projects (status, next_attempt_at)
  where status not in ('draft','completed','failed');
create index if not exists idx_content_slides_project  on public.content_slides(project_id, slide_number);
create index if not exists idx_content_slides_org      on public.content_slides(organization_id);
create index if not exists idx_image_library_org       on public.image_library(organization_id);

-- ---------------------------------------------------------
-- 6. RLS (leitura: membros; escrita de marca/projeto/biblioteca: owner/admin;
--    edição de slides: membros — revisão de copy)
-- ---------------------------------------------------------
alter table public.brand_profiles   enable row level security;
alter table public.content_projects enable row level security;
alter table public.content_slides   enable row level security;
alter table public.image_library    enable row level security;

alter table public.brand_profiles   force row level security;
alter table public.content_projects force row level security;
alter table public.content_slides   force row level security;
alter table public.image_library    force row level security;

-- brand_profiles
drop policy if exists brand_profiles_select on public.brand_profiles;
create policy brand_profiles_select on public.brand_profiles
  for select to authenticated using ( public.is_org_member(organization_id) );
drop policy if exists brand_profiles_write on public.brand_profiles;
create policy brand_profiles_write on public.brand_profiles
  for all to authenticated
  using ( public.org_role(organization_id) in ('owner','admin') )
  with check ( public.org_role(organization_id) in ('owner','admin') );

-- content_projects
drop policy if exists content_projects_select on public.content_projects;
create policy content_projects_select on public.content_projects
  for select to authenticated using ( public.is_org_member(organization_id) );
drop policy if exists content_projects_write on public.content_projects;
create policy content_projects_write on public.content_projects
  for all to authenticated
  using ( public.org_role(organization_id) in ('owner','admin') )
  with check ( public.org_role(organization_id) in ('owner','admin') );

-- content_slides: leitura e edição (update) por membro; insert junto com o
-- projeto (admin) ou pelo worker (service_role). Edição de copy é de membro.
drop policy if exists content_slides_select on public.content_slides;
create policy content_slides_select on public.content_slides
  for select to authenticated using ( public.is_org_member(organization_id) );
drop policy if exists content_slides_insert on public.content_slides;
create policy content_slides_insert on public.content_slides
  for insert to authenticated
  with check ( public.org_role(organization_id) in ('owner','admin') );
drop policy if exists content_slides_update on public.content_slides;
create policy content_slides_update on public.content_slides
  for update to authenticated
  using ( public.is_org_member(organization_id) )
  with check ( public.is_org_member(organization_id) );

-- image_library
drop policy if exists image_library_select on public.image_library;
create policy image_library_select on public.image_library
  for select to authenticated using ( public.is_org_member(organization_id) );
drop policy if exists image_library_write on public.image_library;
create policy image_library_write on public.image_library
  for all to authenticated
  using ( public.org_role(organization_id) in ('owner','admin') )
  with check ( public.org_role(organization_id) in ('owner','admin') );

-- ---------------------------------------------------------
-- 7. TRIGGERS updated_at
-- ---------------------------------------------------------
drop trigger if exists set_updated_at on public.brand_profiles;
create trigger set_updated_at before update on public.brand_profiles
  for each row execute function public.update_updated_at_column();

drop trigger if exists set_updated_at on public.content_projects;
create trigger set_updated_at before update on public.content_projects
  for each row execute function public.update_updated_at_column();

drop trigger if exists set_updated_at on public.content_slides;
create trigger set_updated_at before update on public.content_slides
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------
-- 8. DROP brand_voice_profiles (após copiar e repontar)
--    Tudo que lia a tabela foi repontado:
--      - lib/atomization/voice.ts  -> brand_profiles (voice_* cols)
--      - lib/dm-pilot/voice.ts     -> reusa voice.ts
--      - automation_configs FK      -> brand_profiles (passo 3)
--      - tests/*                    -> brand_profiles
--    CASCADE não é necessário: a única FK que apontava para ela (passo 3) já
--    foi repontada. Mantemos sem cascade para falhar alto caso reste alguma.
-- ---------------------------------------------------------
drop table if exists public.brand_voice_profiles;

-- ---------------------------------------------------------
-- ROLLBACK (referência — não executar automaticamente)
-- ---------------------------------------------------------
-- ATENÇÃO: o drop de brand_voice_profiles é irreversível sem backup. Para
-- reverter, recrie brand_voice_profiles (ver create-atomization.sql) e copie de
-- volta as colunas voice_* de brand_profiles ANTES de dropar brand_profiles.
-- drop table if exists public.image_library, public.content_slides,
--   public.content_projects cascade;
-- alter table public.automation_configs drop constraint if exists automation_configs_brand_profile_fk;
-- drop table if exists public.brand_profiles cascade;
