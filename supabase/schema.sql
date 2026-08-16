-- Climbing Race — Supabase schema
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
--
-- The game has no login. Everything below is reachable by the anonymous key that
-- ships in the frontend bundle, so treat every row as public and forgeable: a
-- determined visitor can post a fake score or poke at a room. That is an accepted
-- trade for a toy game with no accounts. Do not put anything private in here.

-- ── Solo leaderboard ─────────────────────────────────────────────────────────
-- One row per record-setting run. The board is one line per climber per wall,
-- and a run that does not beat that name's standing record on that wall is
-- never inserted — the client checks first (see submitScore in src/net.ts) and
-- collapses the rest on read. There is deliberately no unique constraint on
-- (name, climb): anon has no update or delete policy here, so a unique index
-- would just make repeat saves fail.

create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  name       text        not null check (char_length(name) between 1 and 20),
  meters     integer     not null check (meters >= 0 and meters <= 1000),
  created_at timestamptz not null default now()
);

-- Which of the four gym walls the run was on. Everything saved before the walls
-- existed was climbed on wall 1, which is exactly what the default backfills.
alter table public.scores
  add column if not exists climb smallint not null default 1;

do $$ begin
  alter table public.scores add constraint scores_climb_range check (climb between 1 and 4);
exception when duplicate_object then null;
end $$;

-- The board is always read best-first
create index if not exists scores_meters_idx on public.scores (meters desc, created_at asc);
create index if not exists scores_climb_idx on public.scores (climb, meters desc);

-- Walls 2-4 open with a few names on them so the boards are not blank. Guarded
-- so re-running this file does not stack up another set.
insert into public.scores (name, meters, climb, created_at)
select * from (values
  ('Milo', 0, 2, '2026-06-08T19:05:00Z'::timestamptz),
  ('Zora', 9, 2, '2026-07-02T12:05:00Z'::timestamptz),
  ('Pia', 8, 2, '2026-06-10T15:18:00Z'::timestamptz),
  ('Noor', 8, 2, '2026-06-19T13:18:00Z'::timestamptz),
  ('Emre', 1, 2, '2026-06-12T10:12:00Z'::timestamptz),
  ('Bram', 9, 2, '2026-06-20T12:56:00Z'::timestamptz),
  ('Femke', 10, 2, '2026-07-25T14:56:00Z'::timestamptz),
  ('Iris', 9, 3, '2026-07-12T13:27:00Z'::timestamptz),
  ('Aksel', 2, 3, '2026-06-03T18:33:00Z'::timestamptz),
  ('Ines', 8, 3, '2026-07-29T14:56:00Z'::timestamptz),
  ('Jae', 4, 3, '2026-06-04T17:49:00Z'::timestamptz),
  ('Sana', 2, 3, '2026-07-05T16:49:00Z'::timestamptz),
  ('Nika', 0, 3, '2026-06-25T17:41:00Z'::timestamptz),
  ('Otto', 5, 3, '2026-07-20T16:56:00Z'::timestamptz),
  ('Kofi', 1, 4, '2026-06-09T16:12:00Z'::timestamptz),
  ('Ruben', 0, 4, '2026-07-21T18:56:00Z'::timestamptz),
  ('Hana', 4, 4, '2026-07-29T19:41:00Z'::timestamptz),
  ('Tobias', 0, 4, '2026-07-12T11:12:00Z'::timestamptz),
  ('Lucia', 7, 4, '2026-06-07T21:33:00Z'::timestamptz),
  ('Alba', 2, 4, '2026-06-13T15:56:00Z'::timestamptz),
  ('Vera', 1, 4, '2026-06-15T15:33:00Z'::timestamptz)
) as seed(name, meters, climb, created_at)
where not exists (select 1 from public.scores where climb > 1);

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
