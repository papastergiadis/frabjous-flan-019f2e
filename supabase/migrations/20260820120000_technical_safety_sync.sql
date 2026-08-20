-- Technical Safety visits: durable per-user storage and TA-SYNC audit trail.
-- Apply through the Supabase SQL editor or migration workflow before deploying
-- the technical-safety-sync Edge Function.

create table if not exists public.be_safety_visits (
  id text primary key,
  owner_auth_user_id uuid not null references auth.users(id) on delete cascade,
  company text not null check (char_length(company) between 1 and 180),
  visit_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 0 and 1440),
  location text not null default '' check (char_length(location) <= 300),
  notes text not null default '' check (char_length(notes) <= 2000),
  reminder_at timestamptz,
  completed boolean not null default false,
  announcement_path text,
  announcement_name text check (announcement_name is null or char_length(announcement_name) <= 220),
  announcement_type text,
  announcement_size bigint not null default 0 check (announcement_size >= 0),
  sync_source text check (sync_source is null or sync_source = 'TA-SYNC'),
  source_file text check (source_file is null or source_file ~ '^[0-9]{4}_[0-9]{2}\.pdf$'),
  sync_key text,
  source_payload_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (sync_source is null and source_file is null and sync_key is null)
    or
    (sync_source = 'TA-SYNC' and source_file is not null and sync_key is not null)
  )
);

create unique index if not exists be_safety_visits_sync_identity_uidx
  on public.be_safety_visits (owner_auth_user_id, source_file, sync_key)
  where sync_source = 'TA-SYNC';

create index if not exists be_safety_visits_owner_visit_idx
  on public.be_safety_visits (owner_auth_user_id, visit_at);

alter table public.be_safety_visits enable row level security;

drop policy if exists be_safety_visits_select_own on public.be_safety_visits;
create policy be_safety_visits_select_own
  on public.be_safety_visits for select
  to authenticated
  using (owner_auth_user_id = auth.uid());

drop policy if exists be_safety_visits_insert_own on public.be_safety_visits;
create policy be_safety_visits_insert_own
  on public.be_safety_visits for insert
  to authenticated
  with check (owner_auth_user_id = auth.uid() and sync_source is null);

drop policy if exists be_safety_visits_update_own on public.be_safety_visits;
create policy be_safety_visits_update_own
  on public.be_safety_visits for update
  to authenticated
  using (owner_auth_user_id = auth.uid())
  with check (
    owner_auth_user_id = auth.uid()
    and (
      sync_source is null
      or (
        sync_source = 'TA-SYNC'
        and source_file is not null
        and sync_key is not null
      )
    )
  );

drop policy if exists be_safety_visits_delete_own on public.be_safety_visits;
create policy be_safety_visits_delete_own
  on public.be_safety_visits for delete
  to authenticated
  using (owner_auth_user_id = auth.uid());

-- Service-role-only log: RLS is enabled and no user policy is granted.
create table if not exists public.be_safety_sync_runs (
  id uuid primary key default gen_random_uuid(),
  owner_auth_user_id uuid not null references auth.users(id) on delete cascade,
  source_file text not null,
  source_checksum text,
  dry_run boolean not null default false,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  deleted_count integer not null default 0,
  unchanged_count integer not null default 0,
  status text not null check (status in ('success', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.be_safety_sync_runs enable row level security;

comment on table public.be_safety_visits is
  'Per-user Technical Safety visits. Rows marked TA-SYNC are managed only by the sync Edge Function.';
comment on table public.be_safety_sync_runs is
  'Service-role-only audit log for Technical Safety synchronization runs.';
