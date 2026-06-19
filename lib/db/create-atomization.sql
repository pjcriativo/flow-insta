-- =========================================================
-- FLOW INSTA — Atomização (YouTube -> Reels/Carrossel/Story)
-- =========================================================
-- Aditiva: roda depois do schema de organizações.
-- Ajustes vs schema original:
--   posts(id)          -> scheduled_posts(id)
--   social_channels(id)-> user_channels(id)
--   uuid_generate_v4() -> gen_random_uuid()
--   RLS via is_org_member()/org_role()
--   pgvector p/ embedding
-- Aplicar: supabase db query --linked --file lib/db/create-atomization.sql
-- =========================================================

create extension if not exists "vector";

-- Drafts da atomização não têm canal definido ainda.
alter table public.scheduled_posts alter column user_channel_id drop not null;

-- ---------------------------------------------------------
-- 1. BRAND VOICE PROFILES (reusado por outros recursos)
-- ---------------------------------------------------------
create table if not exists public.brand_voice_profiles (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  channel_id        uuid references public.user_channels(id) on delete cascade,
  summary           text,
  tone              jsonb not null default '{}',
  exemplars         jsonb not null default '[]',
  embedding         vector(1536),
  source_post_count int not null default 0,
  refreshed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, channel_id)
);

-- ---------------------------------------------------------
-- 2. ATOMIZATION JOBS
-- ---------------------------------------------------------
create table if not exists public.atomization_jobs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  created_by        uuid not null references auth.users(id) on delete set null,
  source_url        text not null,
  youtube_video_id  text,
  title             text,
  channel_title     text,
  duration_seconds  int,
  language          text,
  rights_attested   boolean not null default false,
  status            text not null default 'queued'
                    check (status in ('queued','fetching','transcribing','selecting','rendering','generating','scheduling','completed','failed','canceled')),
  transcript_source text check (transcript_source in ('native','whisper')),
  clip_count        int not null default 0,
  settings          jsonb not null default '{}',
  error             text,
  inngest_run_id    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 3. TRANSCRIPTS
-- ---------------------------------------------------------
create table if not exists public.atomization_transcripts (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.atomization_jobs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  language        text,
  full_text       text,
  segments        jsonb not null default '[]',
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 4. CLIPS
-- ---------------------------------------------------------
create table if not exists public.atomization_clips (
  id                     uuid primary key default gen_random_uuid(),
  job_id                 uuid not null references public.atomization_jobs(id) on delete cascade,
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  clip_index             int not null,
  start_seconds          numeric(10,2) not null,
  end_seconds            numeric(10,2) not null,
  hook_text              text,
  rationale              text,
  virality_score         numeric(4,3),
  status                 text not null default 'selected'
                         check (status in ('selected','rendering','rendered','render_failed','discarded')),
  video_asset_path       text,
  thumbnail_path         text,
  render_idempotency_key text unique,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (job_id, clip_index)
);

-- ---------------------------------------------------------
-- 5. ASSETS (copy derivada -> liga a posts draft)
-- ---------------------------------------------------------
create table if not exists public.atomization_assets (
  id              uuid primary key default gen_random_uuid(),
  clip_id         uuid not null references public.atomization_clips(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_type      text not null check (asset_type in ('reel_caption','carousel','story','hashtags')),
  payload         jsonb not null default '{}',
  post_id         uuid references public.scheduled_posts(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (clip_id, asset_type)
);

-- ---------------------------------------------------------
-- ÍNDICES
-- ---------------------------------------------------------
create index if not exists idx_brand_voice_org     on public.brand_voice_profiles(organization_id);
create index if not exists idx_atom_jobs_org        on public.atomization_jobs(organization_id);
create index if not exists idx_atom_jobs_status     on public.atomization_jobs(status);
create index if not exists idx_atom_transcripts_job on public.atomization_transcripts(job_id);
create index if not exists idx_atom_clips_job       on public.atomization_clips(job_id);
create index if not exists idx_atom_assets_clip     on public.atomization_assets(clip_id);

-- ---------------------------------------------------------
-- RLS (leitura: membros; escrita de jobs: owner/admin;
--      demais tabelas escritas só pelo worker via service_role)
-- ---------------------------------------------------------
alter table public.brand_voice_profiles   enable row level security;
alter table public.atomization_jobs        enable row level security;
alter table public.atomization_transcripts enable row level security;
alter table public.atomization_clips       enable row level security;
alter table public.atomization_assets      enable row level security;

alter table public.brand_voice_profiles   force row level security;
alter table public.atomization_jobs        force row level security;
alter table public.atomization_transcripts force row level security;
alter table public.atomization_clips       force row level security;
alter table public.atomization_assets      force row level security;

drop policy if exists brand_voice_select on public.brand_voice_profiles;
create policy brand_voice_select on public.brand_voice_profiles
  for select to authenticated using ( public.is_org_member(organization_id) );
drop policy if exists brand_voice_write on public.brand_voice_profiles;
create policy brand_voice_write on public.brand_voice_profiles
  for all to authenticated
  using ( public.org_role(organization_id) in ('owner','admin') )
  with check ( public.org_role(organization_id) in ('owner','admin') );

drop policy if exists atom_jobs_select on public.atomization_jobs;
create policy atom_jobs_select on public.atomization_jobs
  for select to authenticated using ( public.is_org_member(organization_id) );
drop policy if exists atom_jobs_insert on public.atomization_jobs;
create policy atom_jobs_insert on public.atomization_jobs
  for insert to authenticated
  with check ( public.org_role(organization_id) in ('owner','admin') );
drop policy if exists atom_jobs_update on public.atomization_jobs;
create policy atom_jobs_update on public.atomization_jobs
  for update to authenticated
  using ( public.org_role(organization_id) in ('owner','admin') )
  with check ( public.org_role(organization_id) in ('owner','admin') );

drop policy if exists atom_transcripts_select on public.atomization_transcripts;
create policy atom_transcripts_select on public.atomization_transcripts
  for select to authenticated using ( public.is_org_member(organization_id) );

drop policy if exists atom_clips_select on public.atomization_clips;
create policy atom_clips_select on public.atomization_clips
  for select to authenticated using ( public.is_org_member(organization_id) );

drop policy if exists atom_assets_select on public.atomization_assets;
create policy atom_assets_select on public.atomization_assets
  for select to authenticated using ( public.is_org_member(organization_id) );

-- ---------------------------------------------------------
-- TRIGGERS updated_at
-- ---------------------------------------------------------
create or replace function public.update_updated_at_column()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists set_updated_at on public.brand_voice_profiles;
create trigger set_updated_at before update on public.brand_voice_profiles
  for each row execute function public.update_updated_at_column();
drop trigger if exists set_updated_at on public.atomization_jobs;
create trigger set_updated_at before update on public.atomization_jobs
  for each row execute function public.update_updated_at_column();
drop trigger if exists set_updated_at on public.atomization_clips;
create trigger set_updated_at before update on public.atomization_clips
  for each row execute function public.update_updated_at_column();
