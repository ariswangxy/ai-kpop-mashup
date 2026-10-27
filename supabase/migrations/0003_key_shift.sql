-- Key shift: how many semitones the vocals were transposed (0 = original key).
alter table public.mashups
  add column if not exists key_shift smallint not null default 0;
