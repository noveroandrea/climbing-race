/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Networking for Grip & Race, on Supabase instead of a Node server.
 *
 * Three jobs the old `server.ts` used to do, split by how often they change:
 *   • room state (who's in, phase, settings, result) → a `rooms` row + Realtime
 *     Postgres changes. Low frequency, needs to survive a page reload.
 *   • climber positions, ~20/sec → Realtime *broadcast* on a per-game channel.
 *     Never touches the database; it is throwaway data.
 *   • presence → tells us when the other climber's tab disappears.
 *
 * There is no referee process any more, so anything that has to happen exactly
 * once is done with a conditional UPDATE and let Postgres pick the winner.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isConfigured } from './lib/supabase';

export type Role = 'p1' | 'p2';

export interface RoomSettings {
  wallHeight: number;
  difficulty: 'easy' | 'medium' | 'hard';
  seed: string;
}

export interface PlayerSlot {
  name: string;
  connected: boolean;
}

export interface RaceResult {
  winner: string;
  p1Time: number;
  p2Time: number;
  reason: string;
}

export interface RoomState {
  id: string;
  phase: 'lobby' | 'countdown' | 'playing' | 'finished';
  settings: RoomSettings;
  p1: PlayerSlot;
  p2: PlayerSlot;
  result: RaceResult | null;
  startsIn: number | null;
  abandoned: { role: Role; name: string; at: number } | null;
}

export interface JoinAck {
  ok: boolean;
  error?: string;
  role?: Role;
  room?: RoomState;
}

/** Shape of a `rooms` row, as Postgres stores it. */
interface RoomRow {
  id: string;
  phase: RoomState['phase'];
  settings: RoomSettings;
  p1_name: string;
  p1_present: boolean;
  p2_name: string;
  p2_present: boolean;
  starts_at: string | null;
  result: RaceResult | null;
  abandoned: { role: Role; name: string; at: number } | null;
}

export const COUNTDOWN_MS = 10000;

// ── Module state ─────────────────────────────────────────────────────────────

let channel: RealtimeChannel | null = null;
let myRole: Role | null = null;
let myGameId: string | null = null;
let lastRow: RoomRow | null = null;
let countdownTimer: ReturnType<typeof setTimeout> | null = null;

type RoomHandler = (room: RoomState) => void;
type StateHandler = (payload: { role: string; state: unknown }) => void;
type OverHandler = (result: RaceResult) => void;

const roomHandlers = new Set<RoomHandler>();
const stateHandlers = new Set<StateHandler>();
const overHandlers = new Set<OverHandler>();

export const onRoomUpdate = (fn: RoomHandler) => { roomHandlers.add(fn); return () => roomHandlers.delete(fn); };
export const onRemoteState = (fn: StateHandler) => { stateHandlers.add(fn); return () => stateHandlers.delete(fn); };
export const onGameOver = (fn: OverHandler) => { overHandlers.add(fn); return () => overHandlers.delete(fn); };

export const myRoleIs = () => myRole;

// ── Helpers ──────────────────────────────────────────────────────────────────

export const normalizeId = (raw: string) =>
  raw.toUpperCase().replace(/[^A-Z0-9_-]/g, '').substring(0, 16);

const cleanName = (raw: string) => raw.replace(/[\r\n\t]/g, ' ').trim().substring(0, 20);

/** Row → the shape the UI already knows, resolving the countdown to a duration. */
function toRoomState(row: RoomRow): RoomState {
  const startsIn = row.starts_at ? Math.max(0, new Date(row.starts_at).getTime() - Date.now()) : null;
  return {
    id: row.id,
    phase: row.phase,
    settings: row.settings,
    p1: { name: row.p1_name, connected: row.p1_present },
    p2: { name: row.p2_name, connected: row.p2_present },
    result: row.result,
    startsIn: row.phase === 'countdown' ? startsIn : null,
    abandoned: row.abandoned,
  };
}

function publish(row: RoomRow) {
  lastRow = row;
  const state = toRoomState(row);
  roomHandlers.forEach(fn => fn(state));
}

async function patchRoom(patch: Record<string, unknown>) {
  if (!myGameId) return;
  await supabase.from('rooms').update(patch).eq('id', myGameId);
}

function clearCountdownTimer() {
  if (countdownTimer !== null) {
    clearTimeout(countdownTimer);
    countdownTimer = null;
  }
}

/**
 * The host owns the transition out of 'countdown'. Both clients render their own
 * ticking number, but only one writes 'playing' so the race starts once.
 */
function armCountdown(row: RoomRow) {
  if (myRole !== 'p1' || row.phase !== 'countdown' || !row.starts_at) return;
  clearCountdownTimer();
  const delay = Math.max(0, new Date(row.starts_at).getTime() - Date.now());
  countdownTimer = setTimeout(async () => {
    countdownTimer = null;
    const now = lastRow;
    if (!now || now.phase !== 'countdown') return;
    // Don't start a race the other climber can't run
    const bothIn = now.p1_present && now.p2_present;
    await patchRoom(bothIn
      ? { phase: 'playing', starts_at: null }
      : { phase: 'lobby', starts_at: null });
  }, delay);
}

// ── Channel wiring ───────────────────────────────────────────────────────────

/**
 * One channel per game carries all three streams. Presence keys are the role, so
 * a leave event tells us exactly which seat emptied.
 */
async function openChannel(gameId: string, role: Role) {
  await closeChannel();
  myGameId = gameId;
  myRole = role;

  const ch = supabase.channel(`game:${gameId}`, {
    config: { presence: { key: role }, broadcast: { self: false } },
  });

  ch.on('postgres_changes',
    { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${gameId}` },
    payload => {
      if (payload.eventType === 'DELETE') return;
      const row = payload.new as RoomRow;
      publish(row);
      armCountdown(row);
    });

  ch.on('broadcast', { event: 'climber' }, ({ payload }) => {
    stateHandlers.forEach(fn => fn(payload as { role: string; state: unknown }));
  });

  ch.on('broadcast', { event: 'finished' }, ({ payload }) => {
    overHandlers.forEach(fn => fn(payload as RaceResult));
  });

  ch.on('presence', { event: 'leave' }, ({ key }) => {
    void handlePeerLeft(key as Role);
  });

  await ch.subscribe(async status => {
    if (status === 'SUBSCRIBED') await ch.track({ role, at: Date.now() });
  });

  channel = ch;
}

export async function closeChannel() {
  clearCountdownTimer();
  if (channel) {
    await supabase.removeChannel(channel);
    channel = null;
  }
}

/**
 * The other tab vanished. If a round was live it cannot continue, so whoever is
 * left records the walkout and drops the room back to the lobby.
 */
async function handlePeerLeft(who: Role) {
  if (!myGameId || who === myRole || !lastRow) return;
  const seatFlag = who === 'p1' ? { p1_present: false } : { p2_present: false };
  const wasLive = lastRow.phase === 'countdown' || lastRow.phase === 'playing';
  clearCountdownTimer();
  await patchRoom({
    ...seatFlag,
    ...(wasLive
      ? {
          phase: 'lobby',
          starts_at: null,
          abandoned: { role: who, name: who === 'p1' ? lastRow.p1_name : lastRow.p2_name, at: Date.now() },
        }
      : {}),
  });
}

// ── Room lifecycle ───────────────────────────────────────────────────────────

export async function createGame(rawId: string, rawName: string): Promise<JoinAck> {
  if (!isConfigured) return { ok: false, error: 'Online play is not configured for this build.' };
  const id = normalizeId(rawId);
  if (!id) return { ok: false, error: 'Pick a game ID (letters and numbers).' };

  // Clear out rooms nobody came back to, so IDs can be reused
  await supabase.rpc('sweep_stale_rooms');

  const { data, error } = await supabase
    .from('rooms')
    .insert({
      id,
      phase: 'lobby',
      p1_name: cleanName(rawName) || 'Player 1',
      p1_present: true,
      p2_name: 'Player 2',
      p2_present: false,
      settings: { wallHeight: 2000, difficulty: 'medium', seed: 'BETA_CLIMB_32' },
    })
    .select()
    .single();

  if (error) {
    // 23505 = unique violation, i.e. that ID is already taken
    if (error.code === '23505') return { ok: false, error: `Game "${id}" already exists — pick another ID.` };
    return { ok: false, error: error.message };
  }

  await openChannel(id, 'p1');
  publish(data as RoomRow);
  return { ok: true, role: 'p1', room: toRoomState(data as RoomRow) };
}

export async function joinGame(rawId: string, rawName: string): Promise<JoinAck> {
  if (!isConfigured) return { ok: false, error: 'Online play is not configured for this build.' };
  const id = normalizeId(rawId);

  const { data: existing } = await supabase.from('rooms').select('*').eq('id', id).maybeSingle();
  if (!existing) return { ok: false, error: `No game called "${id || '—'}". Check the ID with the host.` };
  if ((existing as RoomRow).p2_present) return { ok: false, error: `Game "${id}" already has two climbers.` };

  // Only claim the seat if it is still free when the write lands
  const { data, error } = await supabase
    .from('rooms')
    .update({ p2_name: cleanName(rawName) || 'Player 2', p2_present: true, abandoned: null })
    .eq('id', id)
    .eq('p2_present', false)
    .select()
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: `Game "${id}" already has two climbers.` };

  await openChannel(id, 'p2');
  publish(data as RoomRow);
  return { ok: true, role: 'p2', room: toRoomState(data as RoomRow) };
}

export async function leaveGame() {
  if (!myGameId) { await closeChannel(); return; }
  const row = lastRow;
  const wasLive = row && (row.phase === 'countdown' || row.phase === 'playing');
  const leaving = myRole;

  if (leaving === 'p1') {
    // The host leaving ends the room outright — nobody else can start a race in it
    await supabase.from('rooms').delete().eq('id', myGameId);
  } else {
    await patchRoom({
      p2_name: 'Player 2',
      p2_present: false,
      ...(wasLive && row
        ? { phase: 'lobby', starts_at: null, abandoned: { role: 'p2', name: row.p2_name, at: Date.now() } }
        : {}),
    });
  }

  await closeChannel();
  myGameId = null;
  myRole = null;
  lastRow = null;
}

// ── In-game actions ──────────────────────────────────────────────────────────

export async function updateSettings(patch: Partial<RoomSettings>) {
  if (myRole !== 'p1' || !lastRow) return;
  await patchRoom({ settings: { ...lastRow.settings, ...patch } });
}

export async function startGame() {
  if (myRole !== 'p1' || !lastRow) return;
  if (lastRow.phase === 'countdown' || lastRow.phase === 'playing') return;
  if (!lastRow.p2_present) return;
  await patchRoom({
    phase: 'countdown',
    starts_at: new Date(Date.now() + COUNTDOWN_MS).toISOString(),
    result: null,
    abandoned: null,
  });
}

export async function returnLobby() {
  if (myRole !== 'p1') return;
  clearCountdownTimer();
  await patchRoom({ phase: 'lobby', starts_at: null });
}

/** Fire-and-forget position relay — broadcast only, never written to Postgres. */
export function sendPlayerState(state: unknown) {
  if (!channel || !myRole) return;
  void channel.send({ type: 'broadcast', event: 'climber', payload: { role: myRole, state } });
}

/**
 * Ends the race. The conditional `.eq('phase', 'playing')` is the referee: if both
 * clients report at once, only the first UPDATE matches and the second is a no-op,
 * so the result can't be overwritten.
 */
export async function reportFinish(result: RaceResult) {
  if (!channel || !myGameId) return;
  void channel.send({ type: 'broadcast', event: 'finished', payload: result });
  await supabase
    .from('rooms')
    .update({ phase: 'finished', result, starts_at: null })
    .eq('id', myGameId)
    .eq('phase', 'playing');
}

// ── Leaderboard ──────────────────────────────────────────────────────────────

export interface ScoreEntry {
  name: string;
  meters: number;
  date: string;
}

const asDate = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export async function fetchScores(limit = 20): Promise<ScoreEntry[]> {
  if (!isConfigured) return [];
  const { data, error } = await supabase
    .from('scores')
    .select('name, meters, created_at')
    .order('meters', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return data.map(r => ({ name: r.name, meters: r.meters, date: asDate(r.created_at) }));
}

export async function submitScore(rawName: string, meters: number): Promise<ScoreEntry[]> {
  if (!isConfigured) return [];
  const name = cleanName(rawName) || 'Anonymous';
  await supabase.from('scores').insert({ name, meters: Math.max(0, Math.floor(meters)) });
  return fetchScores();
}
