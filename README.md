# Climbing Race — climbing gym game

A climbing game with a solo time-attack mode and a two-player online race.
Static frontend on GitHub Pages, data and realtime on Supabase — no server to run.

## The four walls

The gym has four routes (`src/climbs.ts`), picked with buttons before a solo run
and on the create-game form for a race. They are all **200m tall and never repeat
inside those 200m** — past the top the same block simply stacks again, which no
clock in the game is long enough to reach.

Each wall is painted differently: Home Wall is the warm plywood the gym always
had, Slate Quarry is cold grey stone, Salewa Cube is a pale sponsored box with
eagles sprayed up the panels, and Night Session is dark with the lights out —
a wash over the whole column, climber included. The palettes live with the
climbs in `src/climbs.ts`; `ClimbingCanvas` reads one via `themeFor`.

The climber is painted off the hold palette on purpose. Green, red, blue and
amber belong to the four hold types, so the kit is cut from the two hues the
wall never uses: violet arms (pale left, deep right) and pink legs (same), with
a teal jersey for player 1 and fuchsia for player 2. Before this the climber was
jug-green with a blue arm, an orange arm and a green leg — limbs that read as
holds.

The eagle is `assets/salewa.png`, blitted behind the holds at seeded positions.
The mark is Salewa's trademark, used here the way a gym paints a sponsor on its
own panels — decoration in a personal, non-commercial project, not an
endorsement by or affiliation with Salewa.

Every wall gets harder with height, in 5m sections:

| Section | Green jugs | Holds |
|---|---|---|
| 0–5m | 80% | 20 |
| 5–10m | 72% | 18 |
| 10–15m | 66% | 16 |
| 15–20m | 61% | 14 |
| 20–25m | 56% | 13 |
| 25–30m | 51% | 12 |
| 30–35m | 50% | 11 |
| 35m and up | 50% (floor) | 10 (floor) |

Green falls eight points a section down to 66%, then five a section down to 51%;
holds drop by two down to 14, then by one down to 11. The two reach their own
floors a section apart — steps of eight from 80% skip straight past 66% (80 → 72
→ 64), so green stops there and switches to fives while the holds are still
stepping down by two.

Green jugs are the restful holds — the only ones you recover stamina on and the
only ones you can hammer a nail from — so thinning them out is what makes the
route bite. The shares are exact, not a dice roll per hold: a 16-hold section at
66% gets 11 jugs. `sectionGreenShare` / `sectionHoldCount` in `src/utils.ts` are
the single source of truth, and the in-app ramp card reads from them.

## Modes

**Single Player** — pick a wall, **120 seconds** on the clock, and the clock does
not start until you make your first move: no run is burned reading the route.
(A race is different — it starts on the shared countdown.) Ends when you top
out or time runs out; your score is the height in metres you reached, saved under
a name you enter. **Each wall keeps its own Hall of Fame**, and a name owns one
record per wall: a run only goes on the board if it beats what that name already
holds there, and a weaker one is reported back ("previous record 12m, this run
7m") instead of being written. Each board shows one line per climber, their best.

**Create / Join Game** — the host picks a game ID (e.g. `GYM1234`), a wall and a
grade; the other climber opens the same page and joins with that ID. A shared
10-second countdown, then a 3-minute race. First to top out wins; if the clock
runs out, the higher climber wins.

## Controls

Click a limb to select it, then click a reachable hold to move it there;
selection auto-cycles LH → RH → RF → LF. Limbs cannot cross: a foot never goes
above your lowest hand and a hand never goes below your highest foot, which is
the flat edge that cuts the reach arc into a dome. A hold with a limb already on
it is not offered again — no highlight, no click. A hold takes one limb — except the big
yellow **volumes**, which are wide enough for two in any pairing (a hand and a
foot, both hands, or both feet); each limb grips its own corner of the volume,
and reach is measured to that corner rather than to the middle of the blob. **Space** — or the **chalk bag button on
the top right of the wall**, which is how you do it on a phone — chalks up, which
makes your stamina drain 55% slower for 5 seconds (needs 70% in the bag, drains
70%; it never refills stamina — only resting both hands on jugs does that). **Double-tap your body** to place a rock — it eases the climb
but drops you to your last nail. **Hold your body for 2 seconds** on four green
jugs to hammer a nail, which catches your next fall.

The short version of all this pops up over the menu on the first visit and
closes for good on "OK, got it" — the **How to Play** button in the header is the
way back to it, and the full briefing sits one click further in.

On a touch screen every click above is a tap and there is no keyboard, so the
instructions rewrite themselves — `useIsTouch` (`src/lib/useIsTouch.ts`) watches
`(hover: none) and (pointer: coarse)`, which asks about the input device rather
than guessing from the window width.

---

## Database migration

The four walls need one column that older databases do not have:

```sql
alter table public.scores add column if not exists climb smallint not null default 1;
```

The default is what puts every score saved before the walls existed onto Climb 1,
where they were in fact climbed. `supabase/schema.sql` has this plus the check
constraint, the index, and the seed rows that open walls 2–4 with a few names on
them; paste the whole file into the SQL editor — it is written to be re-runnable.

Until it is run, the app does not break: `net.ts` probes for the column once and,
when it is missing, reads and writes without it and shows every score on Climb 1.

## How the multiplayer works without a server

| Data | Where it goes | Why |
|---|---|---|
| Room state — phase, settings, names, result | `rooms` table + Realtime Postgres changes | Low frequency, must survive a reload |
| Climber positions, ~20/sec | Realtime **broadcast** | Throwaway data; never hits the database |
| Someone's tab closing | Realtime **presence** | Leave events end a live round cleanly |

There is no referee process, so anything that must happen exactly once is settled
by a conditional `UPDATE`. Ending a race is `... where id = $1 and phase = 'playing'`
— if both clients report at the same instant, only the first write matches and
the second is a no-op. The host client owns the countdown-to-race transition.

## Security

The game has no login, so everything runs through Supabase's anonymous key, which
ships in the frontend bundle by design. The RLS policies let anyone read and write
`scores` and `rooms`. That means **a determined visitor can post a fake score or
interfere with a room** — an accepted trade for a toy game with no accounts. Don't
put anything private in this project, and don't reuse it for anything that matters.

## Free tier notes

- Supabase pauses free projects after about a week with no activity; opening the
  dashboard resumes them. Check current limits in your dashboard.
- Realtime has a monthly message allowance. Positions are relayed every 50ms per
  player, so a 3-minute race costs roughly 7,000 messages. If you get close to the
  cap, raise the interval in `ClimbingCanvas.tsx` (search for `lastEmitRef`).

## Going back to a self-hosted Node server

An earlier version ran everything from one Express + socket.io process with scores
in a `scores.txt` file. It was removed in favour of this setup but is still in git
history — `git log --diff-filter=D -- server.ts` will find it.
