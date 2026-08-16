# Grip & Race — climbing gym game

A climbing game with a solo time-attack mode and a two-player online race.
Static frontend on GitHub Pages, data and realtime on Supabase — no server to run.

## Modes

**Single Player** — a fixed route (medium, 20m, seed `SOLO_FIXED_01`) with **120
seconds** on the clock. Ends when you top out or time runs out; your score is the
height in metres you reached, saved to the leaderboard under a name you enter.

**Create / Join Game** — the host picks a game ID (e.g. `GYM1234`) and sets the
route; the other climber opens the same page and joins with that ID. A shared
10-second countdown, then a 3-minute race. First to top out wins; if the clock
runs out, the higher climber wins.

## Controls

Click a limb to select it, then click a reachable hold to move it there;
selection auto-cycles LH → RH → RF → LF. **Space** — or the **chalk bag button on
the top right of the wall**, which is how you do it on a phone — chalks up (needs
70% in the bag, drains 70%). **Double-tap your body** to place a rock — it eases the climb
but drops you to your last nail. **Hold your body for 2 seconds** on four green
jugs to hammer a nail, which catches your next fall.

---

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
