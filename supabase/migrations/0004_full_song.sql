-- Full-song mashups: flag them, and allow larger WAVs (a 4-minute stereo WAV is about 45 MB).
alter table public.mashups
  add column if not exists full_song boolean not null default false;

update storage.buckets set file_size_limit = 104857600 where id = 'mashups';
