-- Topplistor för Kick Masters. Klistra in allt i Supabase SQL Editor och tryck Run.
create table if not exists public.km_scores (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 12),
  score integer not null check (score between 1 and 1000),
  level integer not null default 1 check (level between 1 and 200),
  goals integer not null default 0 check (goals between 0 and 1000),
  shirt text check (shirt ~ '^#[0-9a-fA-F]{6}$'),
  number integer check (number between 1 and 99),
  created_at timestamptz not null default now()
);
create index if not exists km_scores_score_idx on public.km_scores (score desc);
create table if not exists public.km_matches (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 12),
  home integer not null check (home between 0 and 99),
  away integer not null check (away between 0 and 99),
  shirt text check (shirt ~ '^#[0-9a-fA-F]{6}$'),
  number integer check (number between 1 and 99),
  created_at timestamptz not null default now()
);
create index if not exists km_matches_created_idx on public.km_matches (created_at desc);
alter table public.km_scores enable row level security;
alter table public.km_matches enable row level security;
drop policy if exists "km scores read" on public.km_scores;
drop policy if exists "km scores insert" on public.km_scores;
drop policy if exists "km matches read" on public.km_matches;
drop policy if exists "km matches insert" on public.km_matches;
create policy "km scores read" on public.km_scores for select to anon, authenticated using (true);
create policy "km scores insert" on public.km_scores for insert to anon, authenticated with check (true);
create policy "km matches read" on public.km_matches for select to anon, authenticated using (true);
create policy "km matches insert" on public.km_matches for insert to anon, authenticated with check (true);
grant select, insert on public.km_scores to anon, authenticated;
grant select, insert on public.km_matches to anon, authenticated;
