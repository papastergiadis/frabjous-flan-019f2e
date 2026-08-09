-- ================================================================
-- B&E Solutions – Project Management
-- Τρέξτε αυτό στο Supabase → SQL Editor → New Query
-- ================================================================

-- Πίνακας χρηστών
create table if not exists be_users (
  id   text primary key,
  data jsonb not null
);

-- Πίνακας κατηγοριών
create table if not exists be_categories (
  id   text primary key,
  data jsonb not null
);

-- Πίνακας έργων
create table if not exists be_projects (
  id   text primary key,
  data jsonb not null
);

-- Πίνακας ιστορικού
create table if not exists be_audit_log (
  id   text primary key,
  data jsonb not null,
  ts   timestamptz default now()
);

-- Απενεργοποίηση Row Level Security (η εφαρμογή χειρίζεται μόνη της την ασφάλεια)
alter table be_users      disable row level security;
alter table be_categories disable row level security;
alter table be_projects   disable row level security;
alter table be_audit_log  disable row level security;

-- Storage bucket για αρχεία εγγράφων (public για εύκολο download)
insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do nothing;

-- Policies για ανώνυμη πρόσβαση στο bucket
do $$
begin
  if not exists (
    select 1 from pg_policies where policyname = 'be_anon_select' and tablename = 'objects'
  ) then
    execute 'create policy be_anon_select on storage.objects for select to anon using (bucket_id = ''documents'')';
  end if;

  if not exists (
    select 1 from pg_policies where policyname = 'be_anon_insert' and tablename = 'objects'
  ) then
    execute 'create policy be_anon_insert on storage.objects for insert to anon with check (bucket_id = ''documents'')';
  end if;

  if not exists (
    select 1 from pg_policies where policyname = 'be_anon_update' and tablename = 'objects'
  ) then
    execute 'create policy be_anon_update on storage.objects for update to anon using (bucket_id = ''documents'')';
  end if;

  if not exists (
    select 1 from pg_policies where policyname = 'be_anon_delete' and tablename = 'objects'
  ) then
    execute 'create policy be_anon_delete on storage.objects for delete to anon using (bucket_id = ''documents'')';
  end if;
end $$;
