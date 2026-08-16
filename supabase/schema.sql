-- Climbing Race — Supabase schema
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
--
-- The game has no login. Everything below is reachable by the anonymous key that
-- ships in the frontend bundle, so treat every row as public and forgeable: a
-- determined visitor can post a fake score or poke at a room. That is an accepted
-- trade for a toy game with no accounts. Do not put anything private in here.

-- ── Solo leaderboard ─────────────────────────────────────────────────────────
-- One row per record-setting run. The board is one line per climber, and a run
-- that does not beat that name's standing record is never inserted — the client
-- checks first (see submitScore in src/net.ts) and collapses the rest on read.
-- There is deliberately no unique constraint on `name`: anon has no update or
-- delete policy here, so a unique index would just make repeat saves fail.

create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  name       text        not null check (char_length(name) between 1 and 20),
  meters     integer     not null check (meters >= 0 and meters <= 1000),
  created_at timestamptz not null default now()
);

-- The board is always read best-first
create index if not exists scores_meters_idx on public.scores (meters desc, created_at asc);

alter table public.scores enable row level security;

drop policy if exists "scores are public" on public.scores;
create policy "scores are public"
  on public.scores for select
  to anon using (true);

drop policy if exists "anyone may post a score" on public.scores;
create policy "anyone may post a score"
  on public.scores for insert
  to anon with check (true);

-- ── Multiplayer rooms ────────────────────────────────────────────────────────
-- One row per game ID. This replaces the in-memory room map the Node server used
-- to hold, and Realtime streams the changes to both climbers.

create table if not exists public.rooms (
  id         text primary key check (id ~ '^[A-Z0-9_-]{1,16}$'),
  phase      text        not null default 'lobby'
               check (phase in ('lobby', 'countdown', 'playing', 'finished')),
  settings   jsonb       not null default
               '{"wallHeight": 2000, "difficulty": "medium", "seed": "BETA_CLIMB_32"}'::jsonb,
  p1_name    text        not null default 'Player 1',
  p1_present boolean     not null default false,
  p2_name    text        not null default 'Player 2',
  p2_present boolean     not null default false,
  starts_at  timestamptz,            -- when the wall unlocks, during 'countdown'
  result     jsonb,                  -- winner + times of the last finished race
  abandoned  jsonb,                  -- who walked out of a live round
  updated_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

drop policy if exists "rooms are public" on public.rooms;
create policy "rooms are public"
  on public.rooms for select
  to anon using (true);

drop policy if exists "anyone may open a room" on public.rooms;
create policy "anyone may open a room"
  on public.rooms for insert
  to anon with check (true);

drop policy if exists "anyone may update a room" on public.rooms;
create policy "anyone may update a room"
  on public.rooms for update
  to anon using (true) with check (true);

drop policy if exists "anyone may close a room" on public.rooms;
create policy "anyone may close a room"
  on public.rooms for delete
  to anon using (true);

-- Touch updated_at on every write, so abandoned rooms can be swept up later
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rooms_touch_updated_at on public.rooms;
create trigger rooms_touch_updated_at
  before update on public.rooms
  for each row execute function public.touch_updated_at();

-- Stream row changes to subscribed clients
alter publication supabase_realtime add table public.rooms;

-- ── Housekeeping ─────────────────────────────────────────────────────────────
-- Rooms are only alive while someone is in them. Clients delete their own room on
-- the way out, but a browser that crashes leaves one behind, so sweep the stale
-- ones whenever a new room is opened. Call this from the client; it is cheap.

create or replace function public.sweep_stale_rooms()
returns void language sql security definer set search_path = public as $$
  delete from public.rooms where updated_at < now() - interval '6 hours';
$$;

grant execute on function public.sweep_stale_rooms() to anon;
