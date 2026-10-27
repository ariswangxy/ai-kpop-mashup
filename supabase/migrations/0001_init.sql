-- K-pop AI Mashup: initial schema.
-- Ownership is an anonymous per-browser id sent as the `x-owner-id` request header.
-- This is development-grade isolation only. Switch to auth.uid() once Supabase Auth is added.

create or replace function public.request_owner_id() returns text
language sql stable as $$
  select coalesce(current_setting('request.headers', true)::json ->> 'x-owner-id', '')
$$;

create table if not exists public.mashups (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  title text not null,
  song_a_name text not null,
  song_b_name text not null,
  song_a_path text,
  song_b_path text,
  output_path text,
  a_start_sec numeric not null default 0,
  b_start_sec numeric not null default 0,
  vocal_gain numeric not null default 1,
  inst_gain numeric not null default 1,
  processor text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists mashups_owner_created_idx on public.mashups (owner_id, created_at desc);

alter table public.mashups enable row level security;

create policy "owner can read" on public.mashups
  for select using (owner_id = public.request_owner_id());
create policy "owner can insert" on public.mashups
  for insert with check (owner_id = public.request_owner_id());
create policy "owner can delete" on public.mashups
  for delete using (owner_id = public.request_owner_id());

-- Private buckets; files live under `<owner_id>/...`.
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('tracks', 'tracks', false, 20971520),
  ('mashups', 'mashups', false, 20971520)
on conflict (id) do nothing;

create policy "owner manages own files" on storage.objects
  for all
  using (bucket_id in ('tracks', 'mashups') and (storage.foldername(name))[1] = public.request_owner_id())
  with check (bucket_id in ('tracks', 'mashups') and (storage.foldername(name))[1] = public.request_owner_id());
