-- Tempo match: detected (or user-corrected) BPMs and whether the vocals were stretched.
alter table public.mashups
  add column if not exists a_bpm numeric,
  add column if not exists b_bpm numeric,
  add column if not exists tempo_matched boolean not null default false;
