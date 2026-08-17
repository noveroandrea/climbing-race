/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GameSettings, SerializedClimberState, FinalHeights } from './types';
import { ClimbingCanvas } from './components/ClimbingCanvas';
import { InstructionsModal } from './components/InstructionsModal';
import { QuickGuide } from './components/InstructionsContent';
import { RouteArchitecture, RouteSummary } from './components/RouteArchitecture';
import { QuickStart } from './components/QuickStart';
import { useIsTouch, usePointerWords } from './lib/useIsTouch';
import { motion } from 'motion/react';
import {
  Trophy,
  Activity,
  Play,
  RotateCcw,
  Sparkles,
  HelpCircle,
  Timer,
  Info,
  Users,
  User,
  PlusCircle,
  LogIn,
  ArrowLeft,
  Copy,
  Check,
  LogOut,
  PersonStanding,
} from 'lucide-react';
import * as net from './net';
import type { Role, RoomState, RoomSettings, JoinAck } from './net';
import { isConfigured } from './lib/supabase';
import { CLIMBS, CLIMB_HEIGHT, climbById } from './climbs';
import { ClimbPicker, ClimbRamp } from './components/ClimbPicker';

type ScoreEntry = net.ScoreEntry;

type Screen = 'menu' | 'climb-select' | 'create' | 'join' | 'lobby' | 'countdown' | 'playing' | 'finished';
type Mode = 'single' | 'multi';

/**
 * Solo runs are always medium and always 2:00 — the wall is the only variable,
 * which is what keeps each climb's board comparable within itself.
 */
const soloSettings = (climb: number): GameSettings => ({
  wallHeight: CLIMB_HEIGHT,
  difficulty: 'medium',
  mode: 'split',
  gravity: 0.45,
  seed: climbById(climb).seed,
  timeLimitMs: 120000, // 2 minutes
  climb,
});

const randomGameId = () => `GYM${Math.floor(1000 + Math.random() * 9000)}`;

/** Shown to whoever is left on the wall when the other climber bails mid-round. */
const ABANDON_LINES = [
  '{name} lowered off and legged it to the café. ☕',
  '{name} has descended to base camp. Permanently.',
  '{name} untied, racked up, and wandered off toward the vending machine.',
  '{name} decided gravity was undefeated and went home.',
  '{name} took the trail of least resistance — straight out the front door.',
  '{name} has been claimed by the sofa. Send a search party. 🛋️',
  '{name} flashed the exit route instead of the climb.',
  '{name} said “it’s more of a sandbagged grade anyway” and bailed.',
  '{name} is off to check the weather forecast. From bed.',
  '{name} pulled the rope and walked to the car park. 🥾',
  '{name} got gripped, got down, got gone.',
  '{name} discovered the summit was optional.',
];

const pickAbandonLine = (name: string) =>
  ABANDON_LINES[Math.floor(Math.random() * ABANDON_LINES.length)].replace('{name}', name);

export default function App() {
  // ── Navigation ────────────────────────────────────────────────────────────
  const [screen, setScreen] = useState<Screen>('menu');
  const [mode, setMode] = useState<Mode>('single');
  const [showInstructions, setShowInstructions] = useState(false);
  // Back every visit, not just the first — folded away for this session only.
  const [showQuickStart, setShowQuickStart] = useState(true);
  const isTouch = useIsTouch();
  const pointer = usePointerWords();
  const [resetCount, setResetCount] = useState(0);

  // ── Identity / room ───────────────────────────────────────────────────────
  const [myName, setMyName] = useState('Climber');
  const [gameIdInput, setGameIdInput] = useState(randomGameId());
  const [joinError, setJoinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Route picked on the create-game form, before a room exists to push it to.
  const [draftSettings, setDraftSettings] = useState<RoomSettings>(net.DEFAULT_SETTINGS);
  // Which of the four walls a solo run is on, and which board is on screen.
  const [climbId, setClimbId] = useState(1);
  const [boardClimb, setBoardClimb] = useState(1);
  const [role, setRole] = useState<Role | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState(0); // whole seconds left before the wall unlocks

  // ClimbingCanvas keeps its callbacks in a long-lived closure, so anything the
  // finish handler reads has to come from a ref rather than the render scope.
  const modeRef = useRef<Mode>('single');
  const myNameRef = useRef(myName);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { myNameRef.current = myName; }, [myName]);
  useEffect(() => { roleRef.current = role; }, [role]);

  // ── Race result ───────────────────────────────────────────────────────────
  const [winner, setWinner] = useState<'player1' | 'player2' | null>(null);
  const [p1Time, setP1Time] = useState(0);
  const [p2Time, setP2Time] = useState(0);
  const [winReason, setWinReason] = useState<'topout' | 'timelimit'>('topout');
  const [soloMeters, setSoloMeters] = useState(0);
  const [soloToppedOut, setSoloToppedOut] = useState(false);

  // ── Live climber relay ────────────────────────────────────────────────────
  const [remoteP1State, setRemoteP1State] = useState<SerializedClimberState | null>(null);
  const [remoteP2State, setRemoteP2State] = useState<SerializedClimberState | null>(null);
  const gameFinishedRef = useRef(false);
  const lastPhaseRef = useRef<string>('lobby');
  const countdownEndRef = useRef(0);
  const [abandonMsg, setAbandonMsg] = useState<string | null>(null);
  const abandonSeenRef = useRef(0); // timestamp of the walkout we already announced
  const roleRef = useRef<Role | null>(null);

  // ── Leaderboard ───────────────────────────────────────────────────────────
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [showNameEntry, setShowNameEntry] = useState(false);
  const [nameEntryValue, setNameEntryValue] = useState('');
  const [saving, setSaving] = useState(false);
  // How the run measured up to the record this name already held. Set once the
  // save comes back; it turns the name prompt into the verdict.
  const [saveResult, setSaveResult] = useState<net.SoloSaveResult | null>(null);

  const loadScores = useCallback(async () => {
    // The board is optional — an unreachable backend just shows an empty list
    setScores(await net.fetchScores());
  }, []);

  useEffect(() => { loadScores(); }, [loadScores]);

  // Every screen is a page of its own, so it starts at the top. Without this you
  // arrive at a new screen still scrolled down where the last one left you —
  // halfway down the leaderboard, or below the wall you are meant to be climbing.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [screen]);

  // ── Realtime wiring (once) ────────────────────────────────────────────────
  useEffect(() => {
    const offRoom = net.onRoomUpdate((data: RoomState) => {
      setRoom(data);

      // Somebody walked out of a live round — tell the one still on the wall.
      // Checked outside the phase branch so it can't be swallowed by a no-op update.
      const bail = data.abandoned;
      if (bail && bail.at > abandonSeenRef.current) {
        abandonSeenRef.current = bail.at;
        if (bail.role !== roleRef.current) setAbandonMsg(pickAbandonLine(bail.name));
      }

      if (data.phase !== lastPhaseRef.current) {
        lastPhaseRef.current = data.phase;
        if (data.phase === 'countdown') {
          setAbandonMsg(null);
          // Count from what the server just told us, not from a shared wall clock
          countdownEndRef.current = Date.now() + (data.startsIn ?? 0);
          setCountdown(Math.ceil((data.startsIn ?? 0) / 1000));
          setWinner(null);
          setRemoteP1State(null);
          setRemoteP2State(null);
          setScreen('countdown');
        } else if (data.phase === 'playing') {
          gameFinishedRef.current = false;
          setWinner(null);
          setRemoteP1State(null);
          setRemoteP2State(null);
          setResetCount(c => c + 1);
          setScreen('playing');
        } else if (data.phase === 'lobby') {
          setWinner(null);
          setScreen('lobby');
        } else if (data.phase === 'finished') {
          // Normally the game-over event got here first and already drew the
          // scorecard; this is the safety net so nobody is left on the wall.
          gameFinishedRef.current = true;
          if (data.result) {
            applyRaceOver(
              data.result.winner as 'player1' | 'player2',
              data.result.p1Time,
              data.result.p2Time,
              data.result.reason as 'topout' | 'timelimit',
            );
          } else {
            setScreen('finished');
          }
        }
      }
    });

    const offState = net.onRemoteState(({ role: r, state }) => {
      if (r === 'p1') setRemoteP1State(state as SerializedClimberState);
      else if (r === 'p2') setRemoteP2State(state as SerializedClimberState);
    });

    const offOver = net.onGameOver(data => {
      if (gameFinishedRef.current) return; // our own report echoed back
      gameFinishedRef.current = true;
      applyRaceOver(data.winner as 'player1' | 'player2', data.p1Time, data.p2Time, data.reason as 'topout' | 'timelimit');
    });

    return () => {
      offRoom();
      offState();
      offOver();
      void net.closeChannel();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tick the pre-race countdown. The server still owns the actual start — this
  // only drives the number on screen.
  useEffect(() => {
    if (screen !== 'countdown') return;
    const id = setInterval(() => {
      setCountdown(Math.max(0, Math.ceil((countdownEndRef.current - Date.now()) / 1000)));
    }, 100);
    return () => clearInterval(id);
  }, [screen]);

  // ── Derived room values ───────────────────────────────────────────────────
  const isHost = role === 'p1';
  const p1Name = mode === 'single' ? myName : room?.p1.name ?? 'Player 1';
  const p2Name = room?.p2.name ?? 'Player 2';
  const p1Connected = room?.p1.connected ?? false;
  const p2Connected = room?.p2.connected ?? false;
  const localPlayer: 'player1' | 'player2' = role === 'p2' ? 'player2' : 'player1';

  // ClimbingCanvas re-initialises the route whenever this object's identity changes,
  // and App re-renders ~20x/second from remote-state — so it has to be memoised.
  const multiSettings = useMemo<GameSettings>(() => ({
    wallHeight: room?.settings.wallHeight ?? CLIMB_HEIGHT,
    difficulty: room?.settings.difficulty ?? 'medium',
    mode: 'split',
    gravity: 0.45,
    seed: room?.settings.seed ?? climbById(1).seed,
    climb: room?.settings.climb ?? 1,
  }), [room?.settings.wallHeight, room?.settings.difficulty, room?.settings.seed, room?.settings.climb]);
  const soloGameSettings = useMemo<GameSettings>(() => soloSettings(climbId), [climbId]);
  const activeSettings = mode === 'single' ? soloGameSettings : multiSettings;

  // ── Menu actions ──────────────────────────────────────────────────────────
  // Solo goes through the wall picker first; the board follows whatever is picked.
  const openClimbSelect = () => {
    setMode('single');
    setBoardClimb(climbId);
    setScreen('climb-select');
  };

  const startSinglePlayer = (climb: number) => {
    setMode('single');
    setClimbId(climb);
    setBoardClimb(climb);
    setRole(null);
    setWinner(null);
    setSoloMeters(0);
    setSoloToppedOut(false);
    gameFinishedRef.current = false;
    setResetCount(c => c + 1);
    setScreen('playing');
  };

  const openCreate = () => {
    setMode('multi');
    setJoinError(null);
    setGameIdInput(randomGameId());
    setScreen('create');
  };

  const openJoin = () => {
    setMode('multi');
    setJoinError(null);
    setGameIdInput('');
    setScreen('join');
  };

  const submitRoom = async (event: 'create-game' | 'join-game') => {
    const gameId = gameIdInput.trim().toUpperCase();
    if (!gameId) {
      setJoinError('Enter a game ID.');
      return;
    }
    setBusy(true);
    setJoinError(null);
    const ack: JoinAck = event === 'create-game'
      ? await net.createGame(gameId, myName, draftSettings)
      : await net.joinGame(gameId, myName);
    setBusy(false);
    if (!ack.ok) {
      setJoinError(ack.error ?? 'Could not reach the server.');
      return;
    }
    setRole(ack.role!);
    setRoom(ack.room!);
    lastPhaseRef.current = ack.room!.phase;
    setScreen('lobby');
  };

  const backToMenu = () => {
    if (mode === 'multi' && role) void net.leaveGame();
    setRole(null);
    setRoom(null);
    setWinner(null);
    setJoinError(null);
    lastPhaseRef.current = 'lobby';
    gameFinishedRef.current = false;
    setAbandonMsg(null);
    setScreen('menu');
    loadScores();
  };

  const copyGameId = () => {
    if (!room) return;
    navigator.clipboard?.writeText(room.id).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => { /* clipboard blocked — the id is on screen anyway */ },
    );
  };

  // ── Finish handling ───────────────────────────────────────────────────────
  const applyRaceOver = (
    gameWinner: 'player1' | 'player2',
    t1: number,
    t2: number,
    reason: 'topout' | 'timelimit',
  ) => {
    setWinner(gameWinner);
    setP1Time(t1);
    setP2Time(t2);
    setWinReason(reason);
    setScreen('finished');
    lastPhaseRef.current = 'finished';
  };

  /** Called by ClimbingCanvas when someone tops out or the clock runs out. */
  const handleGameFinished = (
    gameWinner: 'player1' | 'player2',
    t1: number,
    t2: number,
    reason: 'topout' | 'timelimit' = 'topout',
    heights?: FinalHeights,
  ) => {
    if (gameFinishedRef.current) return;
    gameFinishedRef.current = true;

    if (modeRef.current === 'single') {
      setSoloMeters(heights?.p1 ?? 0);
      setSoloToppedOut(reason === 'topout');
      setWinReason(reason);
      setNameEntryValue(myNameRef.current);
      setScreen('finished');
      setSaveResult(null);
      setShowNameEntry(true);
      return;
    }

    void net.reportFinish({ winner: gameWinner, p1Time: t1, p2Time: t2, reason });
    applyRaceOver(gameWinner, t1, t2, reason);
  };

  const handleLocalStateUpdate = (state: SerializedClimberState) => {
    if (modeRef.current === 'single') return;
    net.sendPlayerState(state);
  };

  const saveSoloScore = async () => {
    const name = nameEntryValue.trim() || 'Anonymous';
    setSaving(true);
    const result = await net.submitScore(name, soloMeters, climbId);
    setScores(result.scores); // keeps the board visible even if the save failed
    setMyName(name);
    setSaving(false);
    setSaveResult(result); // the modal now reports how it went instead of closing
  };

  const closeNameEntry = () => {
    setShowNameEntry(false);
    setSaveResult(null);
  };

  // ── Small shared bits ─────────────────────────────────────────────────────
  const Dot = ({ on }: { on: boolean }) => (
    <span className={`inline-block w-2 h-2 rounded-full ${on ? 'bg-emerald-400' : 'bg-slate-600'}`} />
  );

  // Every saved run is listed; the list scrolls inside the card instead of being
  // sliced to a top-N. `fullHeight` is the left-column variant: it sticks to the
  // viewport and runs the whole height of the screen. Elsewhere the card is
  // capped at 70vh so it cannot push the rest of the page off-screen.
  const Leaderboard = ({ fullHeight = false }: { fullHeight?: boolean }) => {
    // A score only means something next to runs on the same wall, so each climb
    // gets its own board and the tabs pick which one is on screen.
    const shown = scores.filter(s => s.climb === boardClimb);
    return (
    <div
      className={`bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl w-full flex flex-col ${
        fullHeight ? 'lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] max-h-[70vh] lg:max-h-none' : 'max-h-[70vh]'
      }`}
    >
      <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-slate-800 shrink-0">
        <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <span className="text-[13px] font-mono tracking-wider uppercase font-extrabold text-slate-400">
          Solo Hall of Fame
        </span>
        <span className="ml-auto text-[11.5px] font-mono text-slate-600">
          {shown.length > 0 ? `${shown.length} climbers` : 'metres climbed'}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1 p-1 mb-2.5 bg-slate-950 rounded-xl border border-slate-800/80 shrink-0">
        {CLIMBS.map(c => (
          <button
            key={c.id}
            onClick={() => setBoardClimb(c.id)}
            title={c.name}
            className={`py-1 rounded-lg text-[11.5px] font-mono font-bold tracking-tight transition-all cursor-pointer ${
              boardClimb === c.id ? 'bg-amber-600/80 text-white shadow' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            #{c.id}
          </button>
        ))}
      </div>
      <p className="text-[11.5px] font-mono text-slate-500 mb-2 truncate shrink-0">
        {climbById(boardClimb).name}
      </p>

      {/* min-h-0 lets this flex child shrink below its content height, which is
          what actually makes the overflow scroll rather than stretch the card. */}
      <div className="space-y-1.5 text-[15.5px] font-mono overflow-y-auto min-h-0 flex-1 pr-1 board-scroll">
        {shown.length === 0 ? (
          <span className="text-slate-500 text-[13.5px]">No records yet — climb this wall and put one up.</span>
        ) : (
          shown.map((rec, i) => (
            <div key={`${rec.name}-${rec.date}-${i}`} className="flex justify-between items-center text-slate-300 gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-slate-500 font-bold shrink-0">#{i + 1}</span>
                <span className="text-slate-200 font-semibold truncate">{rec.name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11.5px] text-slate-600">{rec.date}</span>
                <span className="text-sky-400 font-extrabold">{rec.meters}m</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
    );
  };

  const inMatch = screen === 'playing' || screen === 'finished' || screen === 'lobby' || screen === 'countdown';
  // Solo runs are on a fixed route, so there is nothing to configure — and with
  // no room card either, the whole left column would be empty mid-climb.
  const showRoomCard = mode === 'multi' && !!room;
  const showRouteArch = mode === 'multi';
  // The board only ranks solo runs, so it has nothing to say during a race —
  // in multiplayer the left column is the room card and route settings instead.
  const showLeaderboard = screen !== 'playing' && mode !== 'multi';
  const showLeftColumn = showRoomCard || showRouteArch || showLeaderboard;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased selection:bg-sky-500/30 selection:text-sky-200" id="gym-app-root">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      {/* Compact below sm: on a phone the full-size header ate a third of the
          screen and the wrapped title/button labels pushed the wall's timer
          ribbon out of view. Labels collapse to their icons; the buttons keep
          aria-labels so they stay meaningful without visible text. */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40 gap-2 px-2.5 py-1.5 sm:px-6 sm:py-3.5 flex justify-between items-center">
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          <div className="bg-gradient-to-tr from-sky-500 to-emerald-500 p-1 sm:p-2 rounded-lg sm:rounded-xl shadow-lg border border-sky-400/20 shrink-0">
            <Activity className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-white animate-pulse" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[15px] sm:text-[23.5px] leading-tight whitespace-nowrap font-bold font-sans tracking-tight bg-gradient-to-r from-slate-100 via-slate-200 to-sky-400 bg-clip-text text-transparent">
              Climbing Race
            </h1>
            <p className="text-[9.5px] sm:text-[13px] leading-tight uppercase font-mono tracking-wider font-semibold text-sky-400 truncate">
              {screen === 'menu' ? 'Main Menu'
                : mode === 'single' ? '🧗 Solo Run — 2:00'
                : isHost ? `🟢 Host · Game ${room?.id ?? ''}` : `🔴 Guest · Game ${room?.id ?? ''}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {inMatch && mode === 'multi' && (
            <div className="hidden sm:flex items-center gap-2 text-[13px] font-mono">
              <span className="flex items-center gap-1"><Dot on={p1Connected} /><span className="text-slate-400">{p1Name}</span></span>
              <span className="text-slate-700">vs</span>
              <span className="flex items-center gap-1"><Dot on={p2Connected} /><span className="text-slate-400">{p2Name}</span></span>
            </div>
          )}
          {/* Host ends the round for both climbers; it lived on the wall before,
              where it covered holds */}
          {screen === 'playing' && mode === 'multi' && isHost && (
            <button
              onClick={() => void net.returnLobby()}
              aria-label="Stop race"
              className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 bg-amber-950/50 hover:bg-amber-900/50 border border-amber-500/40 rounded-lg text-[13px] sm:text-[15.5px] font-medium text-amber-200 transition-all cursor-pointer"
            >
              <Timer className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="hidden sm:inline">Stop Race</span>
            </button>
          )}
          {screen !== 'menu' && (
            <button
              onClick={backToMenu}
              aria-label={inMatch ? 'Exit game' : 'Back to menu'}
              className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 border rounded-lg text-[13px] sm:text-[15.5px] font-medium transition-all cursor-pointer ${
                screen === 'playing'
                  ? 'bg-rose-950/60 hover:bg-rose-900/60 border-rose-500/40 text-rose-200'
                  : 'bg-slate-800 hover:bg-slate-700/80 border-slate-700 text-slate-300'
              }`}
            >
              {screen === 'playing'
                ? <LogOut className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                : <ArrowLeft className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
              <span className="hidden sm:inline">{inMatch ? 'Exit Game' : 'Menu'}</span>
            </button>
          )}
          <button
            onClick={() => setShowInstructions(true)}
            aria-label="How to climb"
            className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-lg text-[13px] sm:text-[15.5px] font-medium text-slate-300 transition-all cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="hidden sm:inline">How to Climb</span>
          </button>
        </div>
      </header>

      {/* ══ MENU ═════════════════════════════════════════════════════════════ */}
      {screen === 'menu' && (
        <main className="flex-1 w-full max-w-3xl mx-auto p-6 flex flex-col gap-6">
          {showQuickStart && <QuickStart onDismiss={() => setShowQuickStart(false)} />}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-slate-900 border border-slate-800/80 shadow-2xl rounded-2xl p-8 relative overflow-hidden"
          >
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-40 bg-sky-500/10 blur-3xl rounded-full pointer-events-none" />

            <div className="text-center mb-7 relative">
              <Trophy className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
              <h2 className="text-[31px] font-bold font-sans tracking-tight text-white mb-1.5">Pick your climb</h2>
              <p className="text-slate-400 text-[18px] font-sans">Solo against the clock, or race another climber.</p>
            </div>

            <div className="max-w-sm mx-auto mb-7">
              <label className="text-slate-400 text-[15.5px] font-medium block mb-1.5">Your climber name</label>
              <input
                type="text"
                value={myName}
                onChange={e => setMyName(e.target.value.substring(0, 20))}
                placeholder="Your name…"
                className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl px-4 py-2.5 text-white font-bold text-center outline-none font-sans transition-colors"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 relative">
              <button
                onClick={openClimbSelect}
                className="group flex flex-col items-center gap-2 p-5 rounded-2xl bg-slate-950/70 border border-emerald-500/25 hover:border-emerald-400/60 hover:bg-emerald-950/30 transition-all active:scale-95 cursor-pointer"
              >
                <User className="w-7 h-7 text-emerald-400" />
                <span className="font-bold text-[18px] text-white font-sans">Single Player</span>
                <span className="text-[13.5px] text-slate-400 text-center leading-snug">Pick one of four walls, 2:00 on the clock. Score = metres climbed.</span>
              </button>

              <button
                onClick={openCreate}
                disabled={!isConfigured}
                className="group flex flex-col items-center gap-2 p-5 rounded-2xl bg-slate-950/70 border border-sky-500/25 hover:border-sky-400/60 hover:bg-sky-950/30 transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-sky-500/25"
              >
                <PlusCircle className="w-7 h-7 text-sky-400" />
                <span className="font-bold text-[18px] text-white font-sans">Create Game</span>
                <span className="text-[13.5px] text-slate-400 text-center leading-snug">Pick a game ID, set the route, wait for a challenger.</span>
              </button>

              <button
                onClick={openJoin}
                disabled={!isConfigured}
                className="group flex flex-col items-center gap-2 p-5 rounded-2xl bg-slate-950/70 border border-rose-500/25 hover:border-rose-400/60 hover:bg-rose-950/30 transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-rose-500/25"
              >
                <LogIn className="w-7 h-7 text-rose-400" />
                <span className="font-bold text-[18px] text-white font-sans">Join Game</span>
                <span className="text-[13.5px] text-slate-400 text-center leading-snug">Type the host's game ID to climb against them.</span>
              </button>
            </div>

            {!isConfigured && (
              <p className="text-[13px] text-amber-400/80 text-center mt-4 font-mono">
                Online play and the leaderboard need VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
              </p>
            )}
          </motion.div>

          <Leaderboard />
        </main>
      )}

      {/* ══ CLIMB PICKER (solo) ══════════════════════════════════════════════ */}
      {screen === 'climb-select' && (
        <main className="flex-1 w-full max-w-3xl mx-auto p-6 flex flex-col gap-6">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-slate-900 border border-slate-800/80 shadow-2xl rounded-2xl p-6 sm:p-8"
          >
            <div className="text-center mb-6">
              <h2 className="text-[26px] sm:text-[31px] font-bold font-sans tracking-tight text-white mb-1.5">
                Which wall?
              </h2>
              <p className="text-slate-400 text-[15.5px] sm:text-[18px] font-sans">
                Four routes, 200m each, 2:00 on the clock. Every wall keeps its own Hall of Fame.
              </p>
            </div>

            {/* Picking a wall swings the Hall of Fame below over to it too */}
            <ClimbPicker
              value={climbId}
              onPick={id => { setClimbId(id); setBoardClimb(id); }}
            />

            <div className="mt-4">
              <ClimbRamp />
            </div>

            <button
              onClick={() => startSinglePlayer(climbId)}
              className="mt-5 w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer font-sans text-[18px]"
            >
              <Play className="w-5 h-5" />
              <span>Climb {climbById(climbId).name}</span>
            </button>
          </motion.div>

          <Leaderboard />
        </main>
      )}

      {/* ══ CREATE / JOIN FORM ═══════════════════════════════════════════════ */}
      {(screen === 'create' || screen === 'join') && (
        <main className="flex-1 w-full max-w-md mx-auto p-6 flex flex-col justify-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-slate-900 border border-slate-800/80 shadow-2xl rounded-2xl p-8"
          >
            <div className="text-center mb-6">
              {screen === 'create'
                ? <PlusCircle className="w-10 h-10 text-sky-400 mx-auto mb-3" />
                : <LogIn className="w-10 h-10 text-rose-400 mx-auto mb-3" />}
              <h2 className="text-[26px] font-bold font-sans text-white mb-1">
                {screen === 'create' ? 'Create a multiplayer game' : 'Join a multiplayer game'}
              </h2>
              <p className="text-slate-400 text-[15.5px] font-sans">
                {screen === 'create'
                  ? 'Choose an ID and share it — the other climber joins with it from this same page.'
                  : 'Ask the host for their game ID.'}
              </p>
            </div>

            <label className="text-slate-400 text-[15.5px] font-medium block mb-1.5">Game ID</label>
            <input
              type="text"
              value={gameIdInput}
              autoFocus
              onChange={e => setGameIdInput(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').substring(0, 16))}
              onKeyDown={e => { if (e.key === 'Enter') submitRoom(screen === 'create' ? 'create-game' : 'join-game'); }}
              placeholder="GYM1234"
              className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl px-4 py-3 text-sky-300 font-mono font-bold text-center text-[23.5px] tracking-widest outline-none mb-4 transition-colors"
            />

            <label className="text-slate-400 text-[15.5px] font-medium block mb-1.5">Your climber name</label>
            <input
              type="text"
              value={myName}
              onChange={e => setMyName(e.target.value.substring(0, 20))}
              onKeyDown={e => { if (e.key === 'Enter') submitRoom(screen === 'create' ? 'create-game' : 'join-game'); }}
              className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl px-4 py-2.5 text-white font-bold text-center outline-none mb-5 font-sans transition-colors"
            />

            {/* The host picks the route up front; it goes into the room on create
                and stays editable in the lobby. */}
            {screen === 'create' && (
              <div className="mb-5">
                <RouteArchitecture
                  settings={draftSettings}
                  editable={!busy}
                  onChange={patch => setDraftSettings(s => ({ ...s, ...patch }))}
                  className="bg-slate-950/50 border border-slate-800 rounded-xl p-4"
                />
              </div>
            )}

            {joinError && (
              <p className="text-rose-400 text-[15.5px] font-medium text-center mb-4 bg-rose-950/40 border border-rose-500/30 rounded-lg px-3 py-2">
                {joinError}
              </p>
            )}

            <button
              disabled={busy}
              onClick={() => submitRoom(screen === 'create' ? 'create-game' : 'join-game')}
              className="w-full py-3 bg-gradient-to-r from-emerald-500 to-sky-600 hover:from-emerald-400 hover:to-sky-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all cursor-pointer disabled:cursor-not-allowed font-sans"
            >
              {busy ? 'Connecting…' : screen === 'create' ? 'Create Game' : 'Join Game'}
            </button>
          </motion.div>
        </main>
      )}

      {/* ══ LOBBY / PLAYING / FINISHED ═══════════════════════════════════════ */}
      {inMatch && (
        <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* ── Left column ────────────────────────────────────────────────── */}
          {showLeftColumn && (
          <section className="lg:col-span-1 space-y-5 min-w-0">

            {/* Game ID card (multiplayer only) */}
            {showRoomCard && room && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
                <h3 className="text-[15.5px] uppercase tracking-wider text-slate-400 font-bold mb-3 flex items-center gap-1.5 font-sans">
                  <Users className="w-3.5 h-3.5 text-sky-400" />
                  Game ID
                </h3>
                <button
                  onClick={copyGameId}
                  className="w-full flex items-center justify-between gap-2 bg-slate-950 border border-sky-500/30 hover:border-sky-400/60 rounded-xl px-3 py-2.5 transition-all cursor-pointer group"
                >
                  <span className="font-mono text-[23.5px] font-black tracking-widest text-sky-300">{room.id}</span>
                  {copied
                    ? <Check className="w-4 h-4 text-emerald-400" />
                    : <Copy className="w-4 h-4 text-slate-500 group-hover:text-sky-400" />}
                </button>

                <div className="mt-3 space-y-2 text-[15.5px] font-sans">
                  <div className="flex items-center gap-2 p-2 bg-slate-950/40 rounded-lg border border-emerald-500/20">
                    <Dot on={p1Connected} />
                    <span className="text-slate-300 font-semibold truncate">{p1Name}</span>
                    <span className="ml-auto text-[11.5px] font-mono text-emerald-400">HOST</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 bg-slate-950/40 rounded-lg border border-rose-500/20">
                    <Dot on={p2Connected} />
                    <span className={`font-semibold truncate ${p2Connected ? 'text-slate-300' : 'text-slate-600'}`}>
                      {p2Connected ? p2Name : 'Waiting…'}
                    </span>
                    <span className="ml-auto text-[11.5px] font-mono text-rose-400">GUEST</span>
                  </div>
                </div>
              </div>
            )}

            {/* The route is chosen on the create form, so once the room exists
                this is just a reminder of what everyone is climbing. */}
            {showRouteArch && <RouteSummary settings={room?.settings ?? draftSettings} />}

            {showLeaderboard && <Leaderboard fullHeight />}
          </section>
          )}

          {/* ── Right column ───────────────────────────────────────────────── */}
          {/* min-w-0: a grid item defaults to min-width:auto, which would let the
              wall's intrinsic width push this track wider than the viewport. */}
          <section className={`${showLeftColumn ? 'lg:col-span-3' : 'lg:col-span-4'} space-y-4 min-w-0`}>

            {/* The other climber bailed out of a live round */}
            {abandonMsg && screen === 'lobby' && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-amber-950/40 border border-amber-500/40 rounded-2xl p-5 flex items-start gap-4 shadow-xl"
              >
                <div className="bg-amber-500/15 p-2.5 rounded-full border border-amber-500/30 shrink-0">
                  <PersonStanding className="w-6 h-6 text-amber-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[18px] font-black text-amber-200 font-sans mb-0.5">Climber down!</h3>
                  <p className="text-[15.5px] text-amber-100/85 font-sans leading-snug">{abandonMsg}</p>
                  <p className="text-[13px] text-slate-400 mt-1.5 font-sans">
                    The race was called off. {isHost ? 'Wait here for another challenger.' : 'The host can start a new one.'}
                  </p>
                </div>
                <button
                  onClick={() => setAbandonMsg(null)}
                  className="text-slate-500 hover:text-slate-300 transition-all cursor-pointer shrink-0 text-[18px] leading-none px-1"
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </motion.div>
            )}

            {/* LOBBY (multiplayer only) */}
            {screen === 'lobby' && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-slate-900 border border-slate-800/80 shadow-2xl rounded-2xl p-8 flex flex-col items-center justify-center text-center relative overflow-hidden"
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-40 bg-sky-500/10 blur-3xl rounded-full pointer-events-none" />
                <Trophy className="w-14 h-14 text-yellow-500 mb-4 animate-bounce" />

                {isHost ? (
                  <>
                    <h2 className="text-[31px] font-bold font-sans tracking-tight text-white mb-2">Waiting Room</h2>
                    <p className="text-slate-300 text-[18px] max-w-md leading-relaxed mb-6 font-sans">
                      Share game ID <span className="text-sky-400 font-mono font-bold">{room?.id}</span> — the other climber
                      opens this same page and picks <span className="text-rose-400 font-semibold">Join Game</span>.
                    </p>

                    <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border mb-6 text-[18px] font-semibold ${
                      p2Connected ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-400' : 'bg-slate-950/60 border-slate-700 text-slate-500'
                    }`}>
                      <Dot on={p2Connected} />
                      {p2Connected ? `${p2Name} is connected — ready to race!` : 'Waiting for a challenger to join…'}
                    </div>

                    <button
                      disabled={!p2Connected}
                      onClick={() => void net.startGame()}
                      className="flex items-center justify-center gap-2 px-8 py-3 bg-gradient-to-r from-emerald-500 to-sky-600 hover:from-emerald-400 hover:to-sky-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white font-bold tracking-wide rounded-xl shadow-lg active:scale-95 transition-all cursor-pointer disabled:cursor-not-allowed"
                    >
                      <Play className="w-5 h-5 fill-current" />
                      <span>Start Race</span>
                    </button>
                  </>
                ) : (
                  <>
                    <h2 className="text-[31px] font-bold font-sans tracking-tight text-white mb-2">Ready to Climb!</h2>
                    <p className="text-slate-300 text-[18px] max-w-md leading-relaxed mb-6 font-sans">
                      You joined game <span className="text-sky-400 font-mono font-bold">{room?.id}</span>. The host sets the
                      route and starts the race.
                    </p>
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border mb-6 text-[18px] font-semibold ${
                      p1Connected ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-400' : 'bg-slate-950/60 border-slate-700 text-slate-500'
                    }`}>
                      <Dot on={p1Connected} />
                      {p1Connected ? `Host ${p1Name} is connected — waiting to start…` : 'Host disconnected…'}
                    </div>
                    <div className="flex items-center gap-2 text-slate-500 text-[15.5px] font-mono animate-pulse">
                      <Users className="w-4 h-4" />
                      <span>Waiting for host to start the race…</span>
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {/* COUNTDOWN — both climbers watch the same clock */}
            {screen === 'countdown' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-slate-900 border border-slate-800/80 shadow-2xl rounded-2xl p-10 flex flex-col items-center justify-center text-center relative overflow-hidden min-h-[420px]"
              >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-sky-500/10 blur-3xl rounded-full pointer-events-none" />

                <p className="text-[15.5px] uppercase font-mono tracking-[0.3em] font-bold text-sky-400 mb-4 relative">
                  Get on the wall
                </p>

                <motion.div
                  key={countdown}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.25 }}
                  className="relative"
                >
                  <span className={`font-mono font-black leading-none tabular-nums ${
                    countdown <= 3 ? 'text-rose-400 text-[11.7rem]' : 'text-sky-300 text-[10.4rem]'
                  }`}>
                    {countdown > 0 ? countdown : 'GO!'}
                  </span>
                </motion.div>

                <div className="flex items-center gap-6 mt-6 text-[18px] font-sans relative">
                  <span className="flex items-center gap-2 text-emerald-400 font-bold">
                    <Dot on={p1Connected} />{p1Name}
                  </span>
                  <span className="text-slate-600 font-mono text-[15.5px]">VS</span>
                  <span className="flex items-center gap-2 text-rose-400 font-bold">
                    <Dot on={p2Connected} />{p2Name}
                  </span>
                </div>

                <p className="text-slate-500 text-[14.5px] font-mono mt-5 relative">
                  {activeSettings.difficulty.toUpperCase()} · {activeSettings.wallHeight / 100}m · 3:00 on the clock
                </p>
              </motion.div>
            )}

            {/* FINISHED — solo */}
            {screen === 'finished' && mode === 'single' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-slate-900 border border-slate-800 shadow-2xl rounded-2xl p-8 flex flex-col items-center justify-center text-center relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/10 via-amber-500/5 to-sky-500/10 pointer-events-none" />
                <div className="bg-amber-500/15 p-4 rounded-full border border-amber-500/30 mb-4 animate-bounce">
                  <Trophy className="w-12 h-12 text-amber-400" />
                </div>
                <h2 className="text-[31px] font-black font-sans tracking-tight text-white mb-1.5">
                  {soloToppedOut ? 'Route Topped Out!' : "Time's Up!"}
                </h2>
                <p className="text-[15.5px] uppercase font-mono tracking-wider font-extrabold text-sky-400 mb-6">
                  Climb {climbId} · {climbById(climbId).name} · 2:00
                </p>

                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-8 w-full max-w-md mb-6">
                  <span className="text-[15.5px] font-mono uppercase tracking-widest text-slate-500 block mb-2">Height reached</span>
                  <span className="text-[78px] font-black text-sky-400 font-mono">{soloMeters}<span className="text-[31px] text-slate-500">m</span></span>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md font-sans">
                  <button
                    onClick={() => startSinglePlayer(climbId)}
                    className="flex-1 py-3 bg-sky-600 hover:bg-sky-500 active:scale-95 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Climb Again</span>
                  </button>
                  <button
                    onClick={openClimbSelect}
                    className="py-3 px-5 bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-300 rounded-xl font-semibold transition-all cursor-pointer"
                  >
                    Change Wall
                  </button>
                  <button
                    onClick={backToMenu}
                    className="py-3 px-5 bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-300 rounded-xl font-semibold transition-all cursor-pointer"
                  >
                    Main Menu
                  </button>
                </div>
              </motion.div>
            )}

            {/* FINISHED — multiplayer */}
            {screen === 'finished' && mode === 'multi' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-slate-900 border border-slate-800 shadow-2xl rounded-2xl p-8 flex flex-col items-center justify-center text-center relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/10 via-amber-500/5 to-rose-500/10 pointer-events-none" />
                <div className="bg-amber-500/15 p-4 rounded-full border border-amber-500/30 mb-4 animate-bounce">
                  <Trophy className="w-12 h-12 text-amber-400" />
                </div>
                <h2 className="text-[31px] font-black font-sans tracking-tight text-white mb-1.5">
                  {winReason === 'timelimit' ? "Time's Up!" : 'Route Topped Out!'}
                </h2>
                <p className="text-[15.5px] uppercase font-mono tracking-wider font-extrabold text-sky-400 mb-6">
                  Difficulty: {activeSettings.difficulty} | Target: {activeSettings.wallHeight / 100}m
                  {winReason === 'timelimit' && ' | Won by Height'}
                </p>

                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 w-full max-w-md mb-6">
                  <h3 className="text-[18px] font-sans font-bold text-rose-300 uppercase tracking-widest mb-4">Final Scorecard</h3>
                  <div className="space-y-4 font-mono text-[18px] leading-relaxed text-slate-300">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-2.5">
                      <span className="text-slate-400 text-[15.5px]">Winner</span>
                      <span className="text-emerald-400 font-black text-[21px]">
                        🎉 {winner === 'player1' ? p1Name : p2Name} 🎉
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[15.5px]">
                      <span className="text-slate-400">{p1Name}</span>
                      <span className="font-bold text-slate-100">{p1Time > 0 ? `${(p1Time / 1000).toFixed(2)}s` : 'Did not finish'}</span>
                    </div>
                    <div className="flex justify-between items-center text-[15.5px]">
                      <span className="text-slate-400">{p2Name}</span>
                      <span className="font-bold text-slate-100">{p2Time > 0 ? `${(p2Time / 1000).toFixed(2)}s` : 'Did not finish'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md font-sans">
                  {isHost && (
                    <button
                      onClick={() => void net.returnLobby()}
                      className="flex-1 py-3 bg-sky-600 hover:bg-sky-500 active:scale-95 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Back to Waiting Room</span>
                    </button>
                  )}
                  <button
                    onClick={backToMenu}
                    className={`py-3 px-5 bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-300 rounded-xl font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${isHost ? '' : 'flex-1'}`}
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Exit Game</span>
                  </button>
                </div>
                {!isHost && (
                  <p className="text-slate-500 text-[15.5px] font-mono mt-3">
                    Or wait here — the host can start another race.
                  </p>
                )}
              </motion.div>
            )}

            {/* PLAYING — wall on the left, briefing filling the space on the right */}
            {screen === 'playing' && (
              <div className="animate-fade-in flex flex-col xl:flex-row gap-4 items-stretch xl:items-start min-w-0">
                {/* Below xl this is a column: it must span the viewport width so the
                    wall can scale down into it. Only from xl (side-by-side with the
                    briefing) does it hug the canvas at its natural size. */}
                <div className="relative w-full min-w-0 xl:w-auto xl:shrink-0">
                <ClimbingCanvas
                  settings={activeSettings}
                  gameState="playing"
                  p1Name={p1Name}
                  p2Name={p2Name}
                  onGameFinished={handleGameFinished}
                  onResetTrigger={resetCount}
                  localPlayer={mode === 'single' ? 'player1' : localPlayer}
                  singlePlayer={mode === 'single'}
                  p1RemoteState={remoteP1State}
                  p2RemoteState={remoteP2State}
                  onLocalStateUpdate={handleLocalStateUpdate}
                />

                </div>

                {/* Cheat sheet — the full briefing stays behind the header button */}
                <aside className="w-full xl:flex-1 xl:min-w-[300px] xl:max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800 bg-slate-950/40">
                    <HelpCircle className="w-3.5 h-3.5 text-sky-400" />
                    <h3 className="text-[13px] uppercase tracking-wider font-bold text-slate-400 font-sans">Quick Guide</h3>
                  </div>
                  <div className="p-3.5">
                    <QuickGuide />
                  </div>
                </aside>
              </div>
            )}

            {/* Tips footer */}
            {screen !== 'playing' && (
              <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 flex gap-3 text-[15.5px] leading-relaxed text-slate-400">
                <Info className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-slate-300 block">Pro Climbing Tactics:</span>
                  {pointer.tap} a limb to select it, then {pointer.taps} a reachable hold to move it there. Chalk up with{' '}
                  {isTouch ? 'the bag button on the wall' : 'Space'} to slow your stamina drain for 5s, and keep feet on
                  holds to save stamina — campusing drains you fast!
                </div>
              </div>
            )}
          </section>
        </main>
      )}

      {/* ── Instructions modal ───────────────────────────────────────────────── */}
      {showInstructions && <InstructionsModal onClose={() => setShowInstructions(false)} />}

      {/* ── Solo score submission ────────────────────────────────────────────── */}
      {showNameEntry && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-slate-900 border border-amber-500/40 rounded-2xl p-8 max-w-sm w-full shadow-2xl text-center"
          >
            {saveResult ? (
              /* The name already owned a record, so the run is measured against it
                 rather than silently piling up a second line on the board. */
              <>
                <div
                  className={`p-4 rounded-full border inline-flex mb-4 ${
                    saveResult.improved
                      ? 'bg-emerald-500/15 border-emerald-500/30'
                      : 'bg-slate-800 border-slate-700'
                  }`}
                >
                  {saveResult.improved
                    ? <Trophy className="w-10 h-10 text-emerald-400" />
                    : <Info className="w-10 h-10 text-slate-400" />}
                </div>

                {saveResult.improved && saveResult.previous === null && (
                  <>
                    <h2 className="text-[26px] font-black text-emerald-300 mb-2 font-sans">Record set!</h2>
                    <p className="text-slate-400 text-[18px] font-sans">
                      <strong className="text-white">{soloMeters}m</strong> goes on the board as your first record.
                    </p>
                  </>
                )}

                {saveResult.improved && saveResult.previous !== null && (
                  <>
                    <h2 className="text-[26px] font-black text-emerald-300 mb-2 font-sans">
                      Congratulations — you improved your record!
                    </h2>
                    <p className="text-slate-400 text-[18px] font-sans">
                      Previous record <strong className="text-slate-300">{saveResult.previous}m</strong> →{' '}
                      <strong className="text-emerald-300">{soloMeters}m</strong>.
                    </p>
                  </>
                )}

                {!saveResult.improved && saveResult.previous !== null && (
                  <>
                    <h2 className="text-[26px] font-black text-white mb-2 font-sans">Your record stands</h2>
                    <p className="text-slate-400 text-[18px] font-sans">
                      Previous record is <strong className="text-sky-300">{saveResult.previous}m</strong>, this run is{' '}
                      <strong className="text-slate-300">{soloMeters}m</strong>. The board keeps your best.
                    </p>
                  </>
                )}

                {!saveResult.improved && saveResult.previous === null && (
                  <>
                    <h2 className="text-[26px] font-black text-white mb-2 font-sans">Could not save</h2>
                    <p className="text-slate-400 text-[18px] font-sans">
                      The Hall of Fame is unreachable right now — your {soloMeters}m did not make it onto the board.
                    </p>
                  </>
                )}

                <button
                  autoFocus
                  onClick={closeNameEntry}
                  className="mt-6 w-full py-3 bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-200 font-bold rounded-xl transition-all cursor-pointer font-sans"
                >
                  Got it
                </button>
              </>
            ) : (
              <>
                <div className="bg-amber-500/15 p-4 rounded-full border border-amber-500/30 inline-flex mb-4">
                  <Sparkles className="w-10 h-10 text-amber-400" />
                </div>
                <h2 className="text-[26px] font-black text-white mb-1 font-sans">
                  {soloMeters}m climbed
                </h2>
                <p className="text-slate-400 text-[18px] mb-6 font-sans">
                  Your name for the <strong className="text-slate-300">{climbById(climbId).name}</strong> board.
                  One record per name on each wall — this only replaces yours if it is higher.
                </p>
                <input
                  type="text"
                  value={nameEntryValue}
                  onChange={e => setNameEntryValue(e.target.value.substring(0, 20))}
                  onKeyDown={e => { if (e.key === 'Enter') saveSoloScore(); }}
                  placeholder="Your name…"
                  autoFocus
                  className="w-full bg-slate-950 border border-amber-500/40 focus:border-amber-400 rounded-xl px-4 py-3 text-white font-bold text-center text-[23.5px] outline-none mb-4 font-sans"
                />
                <button
                  disabled={saving}
                  onClick={saveSoloScore}
                  className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-60 active:scale-95 text-white font-bold rounded-xl transition-all cursor-pointer font-sans"
                >
                  {saving ? 'Saving…' : 'Save to Hall of Fame'}
                </button>
                <button
                  onClick={closeNameEntry}
                  className="mt-2 w-full py-2 text-slate-500 hover:text-slate-300 text-[18px] transition-all cursor-pointer"
                >
                  Skip
                </button>
              </>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}
