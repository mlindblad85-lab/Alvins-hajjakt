-- Topplista för Protect the base. Klistra in allt i Supabase SQL Editor och tryck Run.
create table if not exists public.ptb_scores (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 14),
  score integer not null check (score between 1 and 5000000),
  night integer not null default 1 check (night between 1 and 500),
  kills integer not null default 0 check (kills between 0 and 200000),
  created_at timestamptz not null default now()
);
create index if not exists ptb_scores_score_idx on public.ptb_scores (score desc);
alter table public.ptb_scores enable row level security;
drop policy if exists "ptb read" on public.ptb_scores;
drop policy if exists "ptb insert" on public.ptb_scores;
create policy "ptb read" on public.ptb_scores for select to anon, authenticated using (true);
create policy "ptb insert" on public.ptb_scores for insert to anon, authenticated with check (true);
grant select, insert on public.ptb_scores to anon, authenticated;
