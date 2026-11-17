-- Alvins Hajjakt – topplista i Supabase.
-- Kör i Supabase: SQL Editor -> New query -> klistra in -> Run.
-- Fyll sedan i supabaseUrl och supabaseAnonKey (anon public key) i window.HAJ_CONFIG i index.html.

create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  nick       text        not null check (char_length(nick) between 3 and 12 and nick ~ '^[[:alnum:]_åäöÅÄÖ]+$'),
  score      integer     not null check (score between 0 and 2000000),
  level      integer     not null check (level between 1 and 99),
  fish       text        check (fish is null or char_length(fish) <= 24),
  created_at timestamptz not null default now()
);

create index if not exists scores_score_idx   on public.scores (score desc);
create index if not exists scores_created_idx on public.scores (created_at desc, score desc);
create index if not exists scores_nick_idx    on public.scores (nick, created_at desc);

alter table public.scores enable row level security;

-- Anon får läsa och lägga till, men inte ändra eller ta bort.
drop policy if exists "scores_select_anon" on public.scores;
create policy "scores_select_anon" on public.scores
  for select to anon, authenticated using (true);

drop policy if exists "scores_insert_anon" on public.scores;
create policy "scores_insert_anon" on public.scores
  for insert to anon, authenticated
  with check (created_at between now() - interval '1 minute' and now() + interval '1 minute');

revoke all on public.scores from anon, authenticated;
grant select, insert on public.scores to anon, authenticated;
grant usage, select on sequence public.scores_id_seq to anon, authenticated;

-- Enkel rate limit: samma smeknamn högst en rad per 5 sekunder,
-- och samma IP (om Supabase skickar x-forwarded-for) högst 30 rader per 10 minuter.
create table if not exists public.score_ip_log (
  ip         text        not null,
  created_at timestamptz not null default now()
);
create index if not exists score_ip_log_idx on public.score_ip_log (ip, created_at desc);
alter table public.score_ip_log enable row level security;  -- inga policies = ingen direkt åtkomst för anon
revoke all on public.score_ip_log from anon, authenticated;

create or replace function public.scores_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  hdrs json;
  v_ip text;
begin
  new.created_at := now();  -- klienten kan inte välja tidpunkt

  if exists (select 1 from public.scores
             where nick = new.nick and created_at > now() - interval '5 seconds') then
    raise exception 'rate limit (nick)' using errcode = 'P0001';
  end if;

  begin
    hdrs := current_setting('request.headers', true)::json;
  exception when others then
    hdrs := null;
  end;
  v_ip := split_part(coalesce(hdrs ->> 'x-forwarded-for', hdrs ->> 'x-real-ip', ''), ',', 1);

  if v_ip <> '' then
    if (select count(*) from public.score_ip_log
        where score_ip_log.ip = v_ip and created_at > now() - interval '10 minutes') >= 30 then
      raise exception 'rate limit (ip)' using errcode = 'P0001';
    end if;
    insert into public.score_ip_log (ip) values (v_ip);
    delete from public.score_ip_log where created_at < now() - interval '1 day';
  end if;

  return new;
end;
$$;

drop trigger if exists scores_rate_limit on public.scores;
create trigger scores_rate_limit
  before insert on public.scores
  for each row execute function public.scores_rate_limit();
