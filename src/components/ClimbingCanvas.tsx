/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';
import { Climber, Hold, GameSettings, ClimberLimb, SerializedClimberState, FinalHeights } from '../types';
import { generateHoldsForWall, calculateJointBend, getDistance, ROCK_COLOR, ROCK_SIZE, ROCK_SHAPE } from '../utils';
import rightShoesUrl from '@/assets/right_shoes.png';

interface ClimbingCanvasProps {
  settings: GameSettings;
  gameState: 'lobby' | 'playing' | 'finished';
  p1Name: string;
  p2Name: string;
  onGameFinished: (
    winner: 'player1' | 'player2',
    p1Time: number,
    p2Time: number,
    reason?: 'topout' | 'timelimit',
    heights?: FinalHeights,
  ) => void;
  onResetTrigger: number;
  // Multiplayer props
  localPlayer?: 'player1' | 'player2' | 'spectator'; // undefined = local 2-player
  p1RemoteState?: SerializedClimberState | null;
  p2RemoteState?: SerializedClimberState | null;
  onLocalStateUpdate?: (state: SerializedClimberState) => void;
  /** Solo practice run: only player 1 exists, no opponent marker, no race. */
  singlePlayer?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  size: number;
  life: number;
  maxLife: number;
}

export const ClimbingCanvas: React.FC<ClimbingCanvasProps> = ({
  settings,
  gameState,
  p1Name,
  p2Name,
  onGameFinished,
  onResetTrigger,
  localPlayer,
  p1RemoteState,
  p2RemoteState,
  onLocalStateUpdate,
  singlePlayer = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Shoe icon image for foot limbs (loaded once; mirrored for the left foot)
  const rightShoeImg = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const r = new Image();
    r.src = rightShoesUrl;
    rightShoeImg.current = r;
  }, []);

  // Game state refs to keep values stable across the animation loop
  const p1Ref = useRef<Climber | null>(null);
  const p2Ref = useRef<Climber | null>(null);
  const holdsRef = useRef<Hold[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const gameRunningRef = useRef<boolean>(false);

  // Timers
  const startTimeRef = useRef<number>(0);
  const elapsedRef = useRef<{ p1: number; p2: number }>({ p1: 0, p2: 0 });
  const [p1DisplayTime, setP1DisplayTime] = useState<number>(0);
  const [p2DisplayTime, setP2DisplayTime] = useState<number>(0);
  const [p1Stamina, setP1Stamina] = useState<number>(100);
  const [p2Stamina, setP2Stamina] = useState<number>(100);
  const [p1Chalk, setP1Chalk] = useState<number>(100);
  const [p2Chalk, setP2Chalk] = useState<number>(100);
  const [p1Height, setP1Height] = useState<number>(0);
  const [p2Height, setP2Height] = useState<number>(0);

  // Short-lived line under the ribbon (never over the wall) explaining what a
  // key press just did — or why it did nothing.
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<number | null>(null);
  const showHint = (msg: string) => {
    setHint(msg);
    if (hintTimer.current !== null) clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 1600);
  };
  useEffect(() => () => { if (hintTimer.current !== null) clearTimeout(hintTimer.current); }, []);

  // Key state tracking
  const keysPressed = useRef<{ [key: string]: boolean }>({});
  const p1LastMoveTime = useRef<number>(0);
  const p2LastMoveTime = useRef<number>(0);

  // ── Mouse-driven limb selection ─────────────────────────────────────────────
  // Click a hand/foot to select it, then click a reachable hold to move it there.
  // After each move, selection auto-advances clockwise: LH → RH → RF → LF → LH.
  type LimbName = 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot';
  const CLOCKWISE: LimbName[] = ['leftHand', 'rightHand', 'rightFoot', 'leftFoot'];

  // Sentinel hold ids for feet planted on the ground floor at the start
  const GROUND_L = '__ground_L__';
  const GROUND_R = '__ground_R__';
  const isGroundHold = (id: string | null) => id === GROUND_L || id === GROUND_R;
  const selectedRef = useRef<{ player: 'player1' | 'player2'; limb: LimbName }>({ player: 'player1', limb: 'leftHand' });
  const [selectedUI, setSelectedUI] = useState<{ player: 'player1' | 'player2'; limb: LimbName }>({ player: 'player1', limb: 'leftHand' });

  const setSelection = (sel: { player: 'player1' | 'player2'; limb: LimbName }) => {
    selectedRef.current = sel;
    setSelectedUI(sel);
  };
  const advanceSelection = () => {
    const cur = selectedRef.current;
    const idx = CLOCKWISE.indexOf(cur.limb);
    setSelection({ player: cur.player, limb: CLOCKWISE[(idx + 1) % CLOCKWISE.length] });
  };
  const limbDisplayName = (limb: LimbName) =>
    ({ leftHand: 'Left Hand', rightHand: 'Right Hand', leftFoot: 'Left Foot', rightFoot: 'Right Foot' }[limb]);

  // ── Body interactions (mouse on the climber's torso) ────────────────────────
  // • double-tap the body  → place a new rock (sabotage)
  // • hold the body 2s     → hammer in a nail that will catch a future fall
  type Nail = { id: string; player: 'player1' | 'player2'; x: number; y: number };
  const nailsRef = useRef<Nail[]>([]);
  const bodyPressRef = useRef<{ player: 'player1' | 'player2'; startTime: number } | null>(null);
  const lastBodyTapRef = useRef<{ player: 'player1' | 'player2'; time: number }>({ player: 'player1', time: 0 });
  const NAIL_HOLD_MS = 2000;     // total press time to plant a nail
  const NAIL_ANIM_START_MS = 500; // hammering animation begins after this

  // Multiplayer refs — keep latest props accessible inside the animation loop closure
  const localPlayerRef = useRef(localPlayer);
  const p1RemoteStateRef = useRef<SerializedClimberState | null>(null);
  const p2RemoteStateRef = useRef<SerializedClimberState | null>(null);
  const onLocalStateUpdateRef = useRef(onLocalStateUpdate);
  const lastEmitRef = useRef<number>(0);

  const singlePlayerRef = useRef(singlePlayer);

  useEffect(() => { localPlayerRef.current = localPlayer; }, [localPlayer]);
  useEffect(() => { singlePlayerRef.current = singlePlayer; }, [singlePlayer]);
  useEffect(() => { p1RemoteStateRef.current = p1RemoteState ?? null; }, [p1RemoteState]);
  useEffect(() => { p2RemoteStateRef.current = p2RemoteState ?? null; }, [p2RemoteState]);
  useEffect(() => { onLocalStateUpdateRef.current = onLocalStateUpdate; }, [onLocalStateUpdate]);

  // Constants
  const CANVAS_WIDTH = 800;
  const VIEW_HEIGHT = 650;
  // Everything below is authored in wall units (100 = 1m). ZOOM blows that up on
  // screen: the wall gets wider at the same pixel height, which means less of the
  // route fits vertically — the view is cropped at the top.
  const ZOOM = 1.5;
  const WALL_HEIGHT = settings.wallHeight;
  const REACH_DISTANCE = 150; // 1.5m extension bound where 100px = 1m
  const MOVE_COOLDOWN = 180;
  const FALLING_ACCELERATION = 0.4;
  const MAX_FALL_SPEED = 14;
  const TIME_LIMIT_MS = settings.timeLimitMs ?? 180000; // 3 minutes unless the mode says otherwise
  const CHALK_REQUIRED = 70; // you need this much in the bag to chalk up
  const CHALK_COST = 70;     // and one dip drains exactly that, emptying it

  // Timer display state
  const [timeRemaining, setTimeRemaining] = useState<number>(TIME_LIMIT_MS);

  // Height in metres, the single-player score (100px of wall = 1m). A top-out
  // counts as the full wall — the finish line sits a little below the true top.
  const metersOf = (player: Climber) =>
    player.hasFinished ? Math.round(WALL_HEIGHT / 100) : Math.max(0, Math.floor(player.y / 100));
  const finalHeights = (): FinalHeights => ({
    p1: p1Ref.current ? metersOf(p1Ref.current) : 0,
    p2: p2Ref.current ? metersOf(p2Ref.current) : 0,
  });

  // Apply a serialized remote state onto a live Climber ref
  const applyRemoteState = (player: Climber, s: SerializedClimberState) => {
    player.x = s.x; player.y = s.y; player.vx = s.vx; player.vy = s.vy;
    player.stamina = s.stamina; player.chalk = s.chalk; player.chalkPowerTime = s.chalkPowerTime;
    player.isFalling = s.isFalling; player.hasFinished = s.hasFinished;
    player.leftHand  = { ...s.leftHand  };
    player.rightHand = { ...s.rightHand };
    player.leftFoot  = { ...s.leftFoot  };
    player.rightFoot = { ...s.rightFoot };
  };

  // Get all active, unique holds within REACH_DISTANCE (150px) from body position
  const getReachableHoldsForLimb = (player: Climber, limbName: 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot'): Hold[] => {
    const holds = holdsRef.current;
    const bodyPos = { x: player.x, y: player.y };

    // Find all other hold IDs currently held by this player to avoid crowding
    const otherHoldIds = new Set<string>();
    if (limbName !== 'leftHand' && player.leftHand.holdId) otherHoldIds.add(player.leftHand.holdId);
    if (limbName !== 'rightHand' && player.rightHand.holdId) otherHoldIds.add(player.rightHand.holdId);
    if (limbName !== 'leftFoot' && player.leftFoot.holdId) otherHoldIds.add(player.leftFoot.holdId);
    if (limbName !== 'rightFoot' && player.rightFoot.holdId) otherHoldIds.add(player.rightFoot.holdId);

    // Holds must lie within the reach circle (radius REACH_DISTANCE around the torso)
    // AND on the correct side of the limb-ordering line — this is exactly the dome
    // drawn on screen:
    //  • a HAND can only reach holds at/above the topmost foot
    //  • a FOOT can only reach holds at/below the lowest hand
    const isHand = limbName === 'leftHand' || limbName === 'rightHand';
    const topFootY = Math.max(player.leftFoot.y, player.rightFoot.y);
    const lowHandY = Math.min(player.leftHand.y, player.rightHand.y);
    const candidates = holds.filter(hold => {
      if (otherHoldIds.has(hold.id)) return false;
      if (isHand && hold.y < topFootY) return false;
      if (!isHand && hold.y > lowHandY) return false;
      const dist = getDistance({ x: hold.x, y: hold.y }, bodyPos);
      return dist <= REACH_DISTANCE;
    });

    // Sort clockwise starting from 12 o'clock (top → right → bottom → left)
    // Gym coords: +y = up. Screen coords: +y = down, so we flip dy for the angle.
    const clockwiseAngle = (hold: Hold) => {
      const dx = hold.x - player.x;
      const dy = hold.y - player.y; // positive = above player
      return (Math.atan2(-dy, dx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
    };
    return candidates.sort((a, b) => clockwiseAngle(a) - clockwiseAngle(b));
  };

  // Initialize/Reset Game Elements
  const initGame = () => {
    // Generate identical or unique routes
    const holds = generateHoldsForWall(WALL_HEIGHT, CANVAS_WIDTH / 2, settings.difficulty, settings.seed);
    holdsRef.current = holds;
    
    const initialLimb = (x: number, y: number, holdId: string | null): ClimberLimb => ({
      x,
      y,
      holdId,
      targetX: x,
      targetY: y,
      lerpFactor: 1
    });

    // Climbers START STANDING on the ground floor (feet planted on the ground,
    // hands free at their sides) rather than already hanging on the wall.
    const COL_CENTER = CANVAS_WIDTH / 4; // middle of one 400px-wide wall column
    const FOOT_Y = 8;    // on the ground
    const TORSO_Y = 58;  // hips above the feet
    const HAND_Y = 70;   // resting hands roughly at shoulder height

    const makeStandingClimber = (
      id: 'player1' | 'player2',
      name: string,
      color: string,
      accentColor: string,
    ): Climber => ({
      id,
      name,
      color,
      accentColor,
      x: COL_CENTER,
      y: TORSO_Y,
      targetX: COL_CENTER,
      targetY: TORSO_Y,
      vx: 0,
      vy: 0,
      stamina: 100,
      maxStamina: 100,
      chalk: 100,
      chalkPowerTime: 0,
      isFalling: false,
      score: 0,
      climbTime: 0,
      leftHand: initialLimb(COL_CENTER - 13, HAND_Y, null),
      rightHand: initialLimb(COL_CENTER + 13, HAND_Y, null),
      leftFoot: initialLimb(COL_CENTER - 16, FOOT_Y, GROUND_L),
      rightFoot: initialLimb(COL_CENTER + 16, FOOT_Y, GROUND_R),
      checkpointY: 0,
      hasFinished: false,
      grounded: true,
    });

    p1Ref.current = makeStandingClimber('player1', p1Name || 'Climber 1', '#4ade80', '#15803d');
    p2Ref.current = makeStandingClimber('player2', p2Name || 'Climber 2', '#ef4444', '#991b1b');

    // Pre-select the left hand of the player this client controls
    const lp = localPlayerRef.current;
    const firstPid: 'player1' | 'player2' = lp === 'player2' ? 'player2' : 'player1';
    setSelection({ player: firstPid, limb: 'leftHand' });

    particlesRef.current = [];
    elapsedRef.current = { p1: 0, p2: 0 };
    setP1DisplayTime(0);
    setP2DisplayTime(0);
    setP1Stamina(100);
    setP2Stamina(100);
    setP1Chalk(100);
    setP2Chalk(100);
    setP1Height(0);
    setP2Height(0);
    setTimeRemaining(TIME_LIMIT_MS);
    
    if (gameState === 'playing') {
      startTimeRef.current = Date.now();
      gameRunningRef.current = true;
    } else {
      gameRunningRef.current = false;
    }
  };

  // Re-initialize whenever settings, names, or reset triggers change
  useEffect(() => {
    initGame();
  }, [settings, onResetTrigger, gameState]);

  // Handle key listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent browser default scrolling for certain keys
      if (['Space', 'Enter', 'Semicolon', 'Tab'].includes(e.code) || e.key === ' ' || e.key === ';') {
        e.preventDefault();
      }
      keysPressed.current[e.code] = true;
      keysPressed.current[e.key.toLowerCase()] = true;
      // Mark custom accent key alias
      if (e.key === 'ò' || e.key === 'Ò') {
        keysPressed.current['ò'] = true;
      }

      if (gameState !== 'playing') return;

      // Avoid auto-repeated events
      if (e.repeat) return;

      // Limb movement and rock/nail placement are mouse-driven (see canvas handlers).
      // Keys remain only for chalking up.

      const p1Key = e.code === 'Space' || e.key === ' ';
      const p2Key = e.code === 'Slash' || e.code === 'Enter' || e.key === '/' || e.key === 'Enter';
      if (!p1Key && !p2Key) return;

      const lp = localPlayerRef.current;
      if (!lp) {
        // Local two-player on one keyboard: the two climbers need separate keys
        if (p1Key) tryChalkUp(p1Ref.current!);
        if (p2Key) tryChalkUp(p2Ref.current!);
        return;
      }

      // Online: this client drives exactly one climber, so Space chalks for both
      // roles (Enter and / stay as aliases). Player 2 used to be Enter-only, which
      // made Space — the key the instructions name — do nothing at all.
      if (lp === 'player1' || lp === 'player2') {
        tryChalkUp(lp === 'player1' ? p1Ref.current! : p2Ref.current!);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current[e.code] = false;
      keysPressed.current[e.key.toLowerCase()] = false;
      if (e.key === 'ò' || e.key === 'Ò') {
        keysPressed.current['ò'] = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState, settings]);

  // ── Mouse click handler: select a limb, or move the selected limb to a hold ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const controllable = (pid: 'player1' | 'player2') => {
      const lp = localPlayerRef.current;
      if (lp === 'spectator') return false;
      if (!lp) return true; // local 2-player controls both
      return lp === pid;
    };

    const handleClick = (e: MouseEvent) => {
      if (!gameRunningRef.current) return;
      const cv = canvasRef.current;
      if (!cv) return;

      // Back out of the ZOOM transform so clicks land in wall units
      const rect = cv.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (cv.width / rect.width) / ZOOM;
      const my = (e.clientY - rect.top) * (cv.height / rect.height) / ZOOM;
      const VIEW_H = cv.height / ZOOM;

      // Which player's column was clicked?
      const lp = localPlayerRef.current;
      let pid: 'player1' | 'player2';
      let xOffset: number;
      if (lp === 'player1') { pid = 'player1'; xOffset = 0; }
      else if (lp === 'player2') { pid = 'player2'; xOffset = 0; }
      else if (mx < CANVAS_WIDTH / 2) { pid = 'player1'; xOffset = 0; }
      else { pid = 'player2'; xOffset = CANVAS_WIDTH / 2; }

      const player = pid === 'player1' ? p1Ref.current : p2Ref.current;
      if (!player || player.isFalling || player.hasFinished) return;
      if (!controllable(pid)) return;

      // Replicate the render camera transform for this column
      let cameraY = Math.max(0, player.y - VIEW_H * 0.45);
      cameraY = Math.min(WALL_HEIGHT - VIEW_H, cameraY);
      const sX = (gx: number) => xOffset + gx;
      const sY = (gy: number) => VIEW_H - (gy - cameraY);
      const d = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

      // 1) Clicked on one of this player's limbs? → select it
      const limbs: LimbName[] = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'];
      let pickLimb: LimbName | null = null;
      let pickLimbD = 15;
      limbs.forEach(ln => {
        const dd = d(mx, my, sX(player[ln].x), sY(player[ln].y));
        if (dd < pickLimbD) { pickLimbD = dd; pickLimb = ln; }
      });
      if (pickLimb) {
        const sel = selectedRef.current;
        const onRock = !!player[pickLimb].holdId && !isGroundHold(player[pickLimb].holdId);
        if (sel.player === pid && sel.limb === pickLimb && onRock) {
          // Clicking the already-selected limb that's already on a rock confirms its
          // position and advances to the next limb clockwise.
          spawnParticles(player[pickLimb].x, player[pickLimb].y, '#e5e7eb', 6);
          advanceSelection();
        } else {
          setSelection({ player: pid, limb: pickLimb });
        }
        return;
      }

      // 2) Clicked on the body/torso? → double-tap places a rock, hold 2s plants a nail
      const bodyD = d(mx, my, sX(player.x), sY(player.y));
      if (bodyD < 20) {
        const now = Date.now();
        const last = lastBodyTapRef.current;
        if (last.player === pid && now - last.time < 300) {
          // Double-tap → place a new rock (sabotage). Cancel any pending nail hold.
          throwStone(player);
          bodyPressRef.current = null;
          lastBodyTapRef.current = { player: pid, time: 0 };
        } else {
          lastBodyTapRef.current = { player: pid, time: now };
          // Begin a nail hold only if every hand & foot is on a stable green hold
          if (allLimbsOnStableHolds(player)) {
            bodyPressRef.current = { player: pid, startTime: now };
          } else {
            bodyPressRef.current = null;
            spawnParticles(player.x, player.y, '#ef4444', 8); // feedback: not stable enough
          }
        }
        return;
      }

      // 3) Otherwise move the currently selected limb to the clicked hold
      const sel = selectedRef.current;
      if (sel.player !== pid) return; // selection belongs to the other player's wall
      const candidates = getReachableHoldsForLimb(player, sel.limb);
      let pickHold: Hold | null = null;
      let pickHoldD = 26;
      candidates.forEach(h => {
        const dd = d(mx, my, sX(h.x), sY(h.y));
        if (dd < pickHoldD) { pickHoldD = dd; pickHold = h; }
      });
      if (pickHold && moveLimbToHold(player, sel.limb, pickHold)) {
        advanceSelection();
      }
    };

    // Releasing (or leaving the canvas) cancels an in-progress nail hold
    const endPress = () => { bodyPressRef.current = null; };

    canvas.addEventListener('mousedown', handleClick);
    canvas.addEventListener('mouseup', endPress);
    canvas.addEventListener('mouseleave', endPress);
    return () => {
      canvas.removeEventListener('mousedown', handleClick);
      canvas.removeEventListener('mouseup', endPress);
      canvas.removeEventListener('mouseleave', endPress);
    };
  }, [gameState, settings]);

  // Chalk restoring power-up
  const tryChalkUp = (player: Climber) => {
    if (player.isFalling || player.hasFinished) return;

    // Every rejection below used to be a silent no-op, which reads as a broken
    // key — say why instead, and puff red so the press is visibly registered.
    const reject = (why: string) => {
      spawnParticles(player.x, player.y - 30, '#ef4444', 8);
      showHint(why);
    };

    // Can only chalk up if hanging on at least one solid hand hold and not fully falling
    const hasHandHold = player.leftHand.holdId || player.rightHand.holdId;
    if (!hasHandHold) {
      reject('Grab a hold with a hand before chalking up');
      return;
    }

    // Chalking is all-or-nothing: the bag has to be full, and one dip empties
    // most of it. Chalk trickles back at ~3%/s while you hang steady, so a use
    // costs roughly 23 seconds before you can chalk again.
    if (player.chalk < CHALK_REQUIRED) {
      reject(`Chalk bag at ${Math.floor(player.chalk)}% — needs ${CHALK_REQUIRED}%`);
      return;
    }

    {
      player.chalk = Math.max(0, player.chalk - CHALK_COST);
      player.chalkPowerTime = 5000; // 5 seconds of grip buff
      player.stamina = Math.min(player.maxStamina, player.stamina + 22); // subtle recovery
      showHint('Chalked up! Stamina drain −55% for 5s');

      // Spawn chalk powder puff particles at hands
      const rootX = player.x;
      const rootY = player.y - 45;
      spawnParticles(rootX, rootY, '#ffffff', 18);
    }
  };

  // Particle Spawner Helper
  const spawnParticles = (x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 2.5;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.4, // float up slightly
        color,
        alpha: 0.9,
        size: 3 + Math.random() * 4,
        life: 0,
        maxLife: 30 + Math.floor(Math.random() * 25)
      });
    }
  };

  // Move a limb to a SPECIFIC hold (mouse-driven). Returns true if the move was valid.
  const moveLimbToHold = (player: Climber, limbName: LimbName, hold: Hold): boolean => {
    const candidates = getReachableHoldsForLimb(player, limbName);
    if (!candidates.some(c => c.id === hold.id)) return false;

    player[limbName].holdId = hold.id;
    player[limbName].targetX = hold.x;
    player[limbName].targetY = hold.y;
    player[limbName].lerpFactor = 0; // Trigger slide/reaching animation

    spawnParticles(hold.x, hold.y, '#e5e7eb', 8);

    if (hold.y > player.checkpointY + 150 && !player.isFalling) {
      player.checkpointY = player.y;
    }
    return true;
  };

  // Stone-throw sabotage: place a crimp 1m above thrower's head, thrower falls immediately
  const throwStone = (thrower: Climber) => {
    const halfW = CANVAS_WIDTH / 2;
    const stoneX = Math.max(40, Math.min(halfW - 40, thrower.x));
    const stoneY = thrower.y + 100;

    holdsRef.current = [
      ...holdsRef.current,
      {
        id: `stone_${Date.now()}_${Math.random()}`,
        x: stoneX,
        y: stoneY,
        type: 'crimp',
        color: ROCK_COLOR,
        size: ROCK_SIZE,
        shapePoints: ROCK_SHAPE,
      },
    ];

    thrower.isFalling = true;
    thrower.vy = -0.5;
    thrower.leftHand.holdId = null;
    thrower.rightHand.holdId = null;
    thrower.leftFoot.holdId = null;
    thrower.rightFoot.holdId = null;
    spawnParticles(thrower.x, thrower.y, '#78716c', 18);
  };

  // A nail may only be hammered in when every hand and foot is on a STABLE hold —
  // i.e. a green "jug". Ground/nail anchors and any other hold type don't count.
  const allLimbsOnStableHolds = (p: Climber): boolean =>
    (['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as LimbName[]).every(ln => {
      const id = p[ln].holdId;
      if (!id) return false;
      const h = holdsRef.current.find(hh => hh.id === id);
      return !!h && h.type === 'jug';
    });

  // Hammer a nail into the wall at the climber's current position — it will catch
  // a later fall (acts as a safety anchor / piton).
  const placeNail = (player: Climber) => {
    nailsRef.current = [
      ...nailsRef.current,
      { id: `nail_${Date.now()}_${Math.random()}`, player: player.id, x: player.x, y: player.y },
    ];
    // Placement burst
    spawnParticles(player.x, player.y, '#fbbf24', 18);
    spawnParticles(player.x, player.y, '#cbd5e1', 12);
  };

  // Trigger top out win status — only the local player's client fires this
  const checkTopOut = (player: Climber) => {
    if (player.hasFinished) return;
    // Spectator never fires game-over (they receive it from socket)
    if (localPlayerRef.current === 'spectator') return;
    
    // Top-out condition: climber's hips or hands cross the finish height (e.g. within 120px of top out target)
    const topOutLineY = WALL_HEIGHT - 120;
    if (player.y >= topOutLineY) {
      player.hasFinished = true;
      const finishedTime = Date.now() - startTimeRef.current;
      
      if (player.id === 'player1') {
        elapsedRef.current.p1 = finishedTime;
      } else {
        elapsedRef.current.p2 = finishedTime;
      }

      // Play epic local particles on buzzer top out!
      spawnParticles(player.x, WALL_HEIGHT - 60, '#f59e0b', 45); // gold confetti
      spawnParticles(player.x, WALL_HEIGHT - 60, player.color, 30); // player color confetti

      // If both finished or a racer won on single-screen criteria:
      // In normal races, first to top wins or let both finish if close.
      // Let's immediately call finish if playing in competitive.
      const p1Finished = p1Ref.current!.hasFinished;
      const p2Finished = p2Ref.current!.hasFinished;
      
      if (p1Finished && p2Finished) {
        onGameFinished('player1', elapsedRef.current.p1, elapsedRef.current.p2, 'topout', finalHeights());
      } else {
        // First top out wins — wait 1.5 seconds then stop game loop
        setTimeout(() => {
          if (gameRunningRef.current) {
            const winner = p1Finished ? 'player1' : 'player2';
            onGameFinished(winner, elapsedRef.current.p1, elapsedRef.current.p2, 'topout', finalHeights());
            gameRunningRef.current = false;
          }
        }, 1500);
      }
    }
  };

  // Main Physics & State Tick Loop
  useEffect(() => {
    if (gameState !== 'playing') return;

    let rAFId: number;
    
    // Physics update logic running inside tick
    const updatePhysics = () => {
      const p1 = p1Ref.current;
      const p2 = p2Ref.current;
      const holds = holdsRef.current;
      
      if (!p1 || !p2) return;

      const now = Date.now();

      // Update remaining chalk timer
      if (p1.chalkPowerTime > 0) p1.chalkPowerTime -= 16;
      if (p2.chalkPowerTime > 0) p2.chalkPowerTime -= 16;

      // Update display clocks
      const elapsed = now - startTimeRef.current;
      if (!p1.hasFinished) setP1DisplayTime(elapsed);
      if (!p2.hasFinished) setP2DisplayTime(elapsed);

      // Update countdown timer display
      const remaining = Math.max(0, TIME_LIMIT_MS - elapsed);
      setTimeRemaining(remaining);

      // Time limit check — highest player wins (only local clients fire this)
      if (remaining === 0 && gameRunningRef.current && localPlayerRef.current !== 'spectator') {
        gameRunningRef.current = false;
        // Solo runs have no opponent to out-climb: the run simply ends where it is.
        const winner: 'player1' | 'player2' = singlePlayerRef.current ? 'player1' : p1.y >= p2.y ? 'player1' : 'player2';
        elapsedRef.current.p1 = winner === 'player1' ? TIME_LIMIT_MS : 0;
        elapsedRef.current.p2 = winner === 'player2' ? TIME_LIMIT_MS : 0;
        spawnParticles(winner === 'player1' ? p1.x : p2.x, winner === 'player1' ? p1.y : p2.y, '#f59e0b', 45);
        onGameFinished(winner, elapsedRef.current.p1, elapsedRef.current.p2, 'timelimit', finalHeights());
        return;
      }

      // Which players are simulated locally?
      const lp2 = localPlayerRef.current; // 'player1' | 'player2' | 'spectator' | undefined
      const simulateP1 = !lp2 || lp2 === 'player1';
      const simulateP2 = !lp2 || lp2 === 'player2';

      // Apply remote states for non-local players
      if (!simulateP1 && p1RemoteStateRef.current) applyRemoteState(p1, p1RemoteStateRef.current);
      if (!simulateP2 && p2RemoteStateRef.current) applyRemoteState(p2, p2RemoteStateRef.current);

      // Emit local player state to server (~20fps)
      const emitCandidate = lp2 === 'player1' ? p1 : lp2 === 'player2' ? p2 : null;
      if (emitCandidate && onLocalStateUpdateRef.current && now - lastEmitRef.current >= 50) {
        lastEmitRef.current = now;
        onLocalStateUpdateRef.current({
          x: emitCandidate.x, y: emitCandidate.y,
          vx: emitCandidate.vx, vy: emitCandidate.vy,
          stamina: emitCandidate.stamina, chalk: emitCandidate.chalk,
          chalkPowerTime: emitCandidate.chalkPowerTime,
          isFalling: emitCandidate.isFalling, hasFinished: emitCandidate.hasFinished,
          leftHand:  { ...emitCandidate.leftHand  },
          rightHand: { ...emitCandidate.rightHand },
          leftFoot:  { ...emitCandidate.leftFoot  },
          rightFoot: { ...emitCandidate.rightFoot },
        });
      }

      // Process both climbers (skip physics for remote players)
      [p1, p2].forEach((p, idx) => {
        const isLocal = idx === 0 ? simulateP1 : simulateP2;
        if (!isLocal || p.hasFinished) return;

        // --- 0. Nail press: hold the body NAIL_HOLD_MS to plant a safety nail.
        //        Requires every hand & foot to stay on a stable green hold. ---
        const bp = bodyPressRef.current;
        if (bp && bp.player === p.id) {
          if (p.isFalling || !allLimbsOnStableHolds(p)) {
            bodyPressRef.current = null; // cancel if falling or a grip slips off a green hold
          } else if (now - bp.startTime >= NAIL_HOLD_MS) {
            placeNail(p);
            bodyPressRef.current = null;
          }
        }

        // --- 1. Lerpend Limb Movements (Reach hands/feet cleanly) ---
        const speedFactor = 0.2; // Lerp velocity
        [p.leftHand, p.rightHand, p.leftFoot, p.rightFoot].forEach(limb => {
          if (limb.lerpFactor < 1) {
            limb.lerpFactor += speedFactor;
            if (limb.lerpFactor >= 1) {
              limb.lerpFactor = 1;
              limb.x = limb.targetX;
              limb.y = limb.targetY;
            } else {
              limb.x = limb.x + (limb.targetX - limb.x) * speedFactor;
              limb.y = limb.y + (limb.targetY - limb.y) * speedFactor;
            }
          }
        });

        // --- 1b. Standing on the ground floor ---
        if (p.grounded) {
          // The climber commits to the wall (starts hanging) once BOTH feet have
          // left the ground onto real holds.
          const stillOnGround = isGroundHold(p.leftFoot.holdId) || isGroundHold(p.rightFoot.holdId);
          if (!stillOnGround) {
            p.grounded = false;
            // fall through to normal climbing physics this frame
          } else {
            // Stay fresh and upright while standing
            p.stamina = p.maxStamina;
            const footX = (p.leftFoot.x + p.rightFoot.x) / 2;
            p.x += (footX - p.x) * 0.2;
            const standY = Math.max(p.leftFoot.y, p.rightFoot.y) + 50;
            p.y += (standY - p.y) * 0.2;

            // Free hands rest at the climber's sides until they reach for a hold
            const restHand = (limb: ClimberLimb, dx: number) => {
              if (!limb.holdId && limb.lerpFactor >= 1) {
                limb.x = limb.targetX = p.x + dx;
                limb.y = limb.targetY = p.y + 12;
              }
            };
            restHand(p.leftHand, -13);
            restHand(p.rightHand, 13);

            checkTopOut(p);
            return;
          }
        }

        // --- 2. Fall Handling ---
        if (p.isFalling) {
          const prevY = p.y;
          // Falling physics
          p.vy -= FALLING_ACCELERATION; // dynamic downward velocity
          if (p.vy < -MAX_FALL_SPEED) p.vy = -MAX_FALL_SPEED;

          p.y += p.vy;

          // Re-center hands/feet as they tumble
          p.leftHand.x = p.rightHand.x = p.leftFoot.x = p.rightFoot.x = p.x;
          p.leftHand.y = p.rightHand.y = p.leftFoot.y = p.rightFoot.y = p.y;

          // Catch on a nail: stop at the highest of this player's nails the body crosses
          const caught = nailsRef.current
            .filter(n => n.player === p.id && n.y <= prevY && n.y >= p.y)
            .sort((a, b) => b.y - a.y)[0];
          if (caught) {
            p.y = caught.y;
            p.vy = 0;
            p.isFalling = false;
            p.stamina = Math.max(p.stamina, 55);
            p.checkpointY = caught.y;
            // Hang both hands off the nail; feet dangle until the climber moves them
            [p.leftHand, p.rightHand].forEach((h, i) => {
              h.holdId = caught.id;
              h.x = h.targetX = caught.x + (i === 0 ? -8 : 8);
              h.y = h.targetY = caught.y;
              h.lerpFactor = 1;
            });
            p.leftFoot.holdId = null;
            p.rightFoot.holdId = null;
            spawnParticles(caught.x, caught.y, '#fbbf24', 16);
            return;
          }

          // Check if player landed on bottom safety mats (y coordinate ~110px represents crash pad height)
          if (p.y <= 130) {
            p.y = 130;
            p.vy = 0;
            p.isFalling = false;
            p.stamina = 100;
            p.chalk = 100;
            
            // Re-anchor hands & feet to nearest starter holds
            const starters = holds.filter(h => h.y < 190);
            if (starters.length >= 2) {
              p.leftHand.holdId = starters[0].id;
              p.leftHand.x = p.leftHand.targetX = starters[0].x;
              p.leftHand.y = p.leftHand.targetY = starters[0].y;
              p.leftHand.lerpFactor = 1;

              p.rightHand.holdId = starters[1].id;
              p.rightHand.x = p.rightHand.targetX = starters[1].x;
              p.rightHand.y = p.rightHand.targetY = starters[1].y;
              p.rightHand.lerpFactor = 1;
            }
            if (starters.length >= 4) {
              p.leftFoot.holdId = starters[2].id;
              p.leftFoot.x = p.leftFoot.targetX = starters[2].x;
              p.leftFoot.y = p.leftFoot.targetY = starters[2].y;
              p.leftFoot.lerpFactor = 1;

              p.rightFoot.holdId = starters[3].id;
              p.rightFoot.x = p.rightFoot.targetX = starters[3].x;
              p.rightFoot.y = p.rightFoot.targetY = starters[3].y;
              p.rightFoot.lerpFactor = 1;
            }
            spawnParticles(p.x, 110, '#0d9488', 15); // soft landing puff
          }
          return;
        }

        // --- 3. Body Physics Tracking (Pull torso dynamically to secure grips) ---
        // Torso strictly follows the arithmetic mean of all gripped holds
        let sumX = 0;
        let sumY = 0;
        let activeGripsCount = 0;

        [p.leftHand, p.rightHand, p.leftFoot, p.rightFoot].forEach(limb => {
          if (limb.holdId) {
            sumX += limb.x;
            sumY += limb.y;
            activeGripsCount++;
          }
        });

        if (activeGripsCount > 0) {
          // Centroid target position (strictly at the center of gripped points)
          const targetX = sumX / activeGripsCount;
          const targetY = sumY / activeGripsCount;

          // Smoothly glide character torso/hip to central alignment
          p.x += (targetX - p.x) * 0.20;
          p.y += (targetY - p.y) * 0.20;

          // Stretch limits check: if body is too far from any secured hold (exceeds 1.5m stretch), the limb slips!
          const MAX_STRETCH = 155; // 1.55m
          [p.leftHand, p.rightHand, p.leftFoot, p.rightFoot].forEach((limb) => {
            if (limb.holdId) {
              const limbDistance = getDistance({ x: p.x, y: p.y }, { x: limb.x, y: limb.y });
              // Slipping limit representing max extension
              if (limbDistance > MAX_STRETCH) {
                // Limb blows!
                limb.holdId = null;
                limb.targetX = p.x;
                limb.targetY = p.y;
                limb.lerpFactor = 0;
                
                // Spawn warning dust
                spawnParticles(limb.x, limb.y, '#e5e7eb', 6);
              }
            }
          });
        } else {
          // No grips! Instant tumble fall
          p.isFalling = true;
          p.vy = -1;
          spawnParticles(p.x, p.y, '#ef4444', 10);
        }

        // --- 4. Stamina Core Engine & Hold multipliers ---
        // Find hold objects for active hands
        const lhHold = holds.find(h => h.id === p.leftHand.holdId);
        const rhHold = holds.find(h => h.id === p.rightHand.holdId);
        const lfHold = holds.find(h => h.id === p.leftFoot.holdId);
        const rfHold = holds.find(h => h.id === p.rightFoot.holdId);

        let drainRate = 1.6; // Base passive drain per second (divided by 60 frames)
        let isResting = false;

        // If holding tough hold types, increase drain
        if (lhHold?.type === 'crimp' || rhHold?.type === 'crimp') drainRate += 4.5;
        if (lhHold?.type === 'sloper' || rhHold?.type === 'sloper') drainRate += 2.8;

        // Hand configurations multipliers
        const handCount = (p.leftHand.holdId ? 1 : 0) + (p.rightHand.holdId ? 1 : 0);
        if (handCount === 1) {
          drainRate *= 1.8; // harder to hold on 1 hand ("lock-off")
        } else if (handCount === 0) {
          drainRate *= 3.8; // slipping instantly
        }

        // Feet cut penalty: "Campusing" (hanging with no footholds) is grueling!
        const hasFeetOnWall = p.leftFoot.holdId || p.rightFoot.holdId;
        if (!hasFeetOnWall) {
          drainRate *= 2.8;
        }

        // If resting with BOTH hands securely on a cozy big JUG and feet are anchored:
        if (lhHold?.type === 'jug' && rhHold?.type === 'jug' && hasFeetOnWall) {
          isResting = true;
          // Recover stamina!
          p.stamina = Math.min(p.maxStamina, p.stamina + 0.35);
        }

        // Apply chalk reduction modifier
        if (p.chalkPowerTime > 0) {
          drainRate *= 0.45; // 55% reduction in stamina drain!
        }

        // Apply difficulty scaling
        if (settings.difficulty === 'easy') drainRate *= 0.7;
        else if (settings.difficulty === 'hard') drainRate *= 1.35;

        // Deplete stamina if not actively resting
        if (!isResting) {
          p.stamina = Math.max(0, p.stamina - drainRate / 60);
        }

        // Replenish climber chalk slowly if standing steady with feet and at least 1 hand
        if (hasFeetOnWall && handCount > 0) {
          p.chalk = Math.min(100, p.chalk + 0.05);
        }

        // Trigger fall on zero stamina
        if (p.stamina <= 0) {
          p.isFalling = true;
          p.vy = -0.5;
          p.leftHand.holdId = p.rightHand.holdId = p.leftFoot.holdId = p.rightFoot.holdId = null;
          spawnParticles(p.x, p.y, '#ef4444', 16);
        }

        // Check top out conditions
        checkTopOut(p);
      });

      // Update state for the ribbon read-outs above the wall
      setP1Stamina(Math.floor(p1.stamina));
      setP2Stamina(Math.floor(p2.stamina));
      setP1Chalk(Math.floor(p1.chalk));
      setP2Chalk(Math.floor(p2.chalk));
      setP1Height(Math.max(0, Math.floor(p1.y / 100)));
      setP2Height(Math.max(0, Math.floor(p2.y / 100)));

      // Update flying chalk/dust particles
      particlesRef.current.forEach(pt => {
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.life++;
        pt.alpha = 1 - pt.life / pt.maxLife;
      });
      // Filter dead particles
      particlesRef.current = particlesRef.current.filter(pt => pt.life < pt.maxLife);
    };

    // Rendering Frame loop
    const renderCanvas = () => {
      const now = Date.now();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const p1 = p1Ref.current;
      const p2 = p2Ref.current;
      const holds = holdsRef.current;
      
      if (!p1 || !p2) return;

      // Draw in wall units and let the transform scale it up to pixels. VIEW_HEIGHT
      // is therefore how much wall fits on screen, which shrinks as ZOOM grows.
      ctx.setTransform(ZOOM, 0, 0, ZOOM, 0, 0);
      const VIEW_HEIGHT = canvas.height / ZOOM;

      // Clear Canvas
      ctx.clearRect(0, 0, canvas.width / ZOOM, VIEW_HEIGHT);

      // halfW is always 400 — the coordinate-space width of one player's column
      const halfW = CANVAS_WIDTH / 2;
      const lp = localPlayerRef.current;
      const isSoloRender = lp === 'player1' || lp === 'player2';

      // --- RENDER FUNCTION FOR A SINGLE PLAYER'S HALF ---
      // oppY is null in solo runs — there is no opponent line to draw.
      const drawPlayerWall = (player: Climber, xOffset: number, oppY: number | null) => {
        ctx.save();
        
        // Setup clip region for this player's screen half
        ctx.beginPath();
        ctx.rect(xOffset, 0, halfW, VIEW_HEIGHT);
        ctx.clip();

        // CAMERA SYSTEM: Scroll camera view upward as the player climbs
        // Camera Y is based on player's current vertical height coordinate
        // Let y=0 be ground (bottom). Canvas views from y=0 to y=view_height
        // Camera offset represents the Y coordinate at the bottom of the visible screen.
        let cameraY = Math.max(0, player.y - VIEW_HEIGHT * 0.45);
        // Constrain camera from scrolling past the extreme gym roof top
        cameraY = Math.min(WALL_HEIGHT - VIEW_HEIGHT, cameraY);

        // Transform coords: Canvas (Y=0 is top) to Gym Wall space (Y=0 is ground/bottom)
        const toScreenY = (gymY: number) => {
          return VIEW_HEIGHT - (gymY - cameraY);
        };
        const toScreenX = (gymX: number) => {
          return xOffset + gymX;
        };

        // --- DRAW WOOD PANEL GYM WALL BACKGROUND ---
        ctx.fillStyle = settings.wallStyle === 'concrete' ? '#4b5563' : settings.wallStyle === 'neon' ? '#0f172a' : '#dbc3a7'; // warm wood plywood defaults
        ctx.fillRect(xOffset, 0, halfW, VIEW_HEIGHT);

        // Wooden joint panels Lines & Peg Bolt Holes
        ctx.strokeStyle = settings.wallStyle === 'concrete' ? '#374151' : settings.wallStyle === 'neon' ? '#1e293b' : '#c49f76';
        ctx.lineWidth = 2;
        
        // Plywood tile patterns (200px x 200px grid layout)
        const scrollOffsetGrid = cameraY % 200;
        for (let gy = -scrollOffsetGrid; gy < VIEW_HEIGHT + 200; gy += 200) {
          ctx.beginPath();
          ctx.moveTo(xOffset, gy);
          ctx.lineTo(xOffset + halfW, gy);
          ctx.stroke();
        }
        for (let gx = 0; gx < halfW; gx += 200) {
          ctx.beginPath();
          ctx.moveTo(xOffset + gx, 0);
          ctx.lineTo(xOffset + gx, VIEW_HEIGHT);
          ctx.stroke();
        }

        // Subtle bolt holes
        ctx.fillStyle = settings.wallStyle === 'concrete' ? '#1f2937' : settings.wallStyle === 'neon' ? '#020617' : '#8c603b';
        for (let gy = -scrollOffsetGrid + 100; gy < VIEW_HEIGHT + 200; gy += 200) {
          for (let gx = 100; gx < halfW; gx += 200) {
            ctx.beginPath();
            ctx.arc(xOffset + gx, gy, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // --- DRAW BOTTOM SAFETY CRASH MAT ---
        const matsScreenY = toScreenY(0);
        if (matsScreenY < VIEW_HEIGHT) {
          ctx.fillStyle = '#0f766e'; // Deep teal matting
          ctx.fillRect(xOffset, matsScreenY, halfW, VIEW_HEIGHT - matsScreenY);
          
          ctx.strokeStyle = '#115e59';
          ctx.lineWidth = 4;
          ctx.strokeRect(xOffset + 2, matsScreenY, halfW - 4, VIEW_HEIGHT - matsScreenY);

          ctx.fillStyle = '#2dd4bf';
          ctx.font = 'bold 11px monospace';
          ctx.fillText('SAFETY PAD - 100% SECURE', xOffset + 15, matsScreenY + 24);
        }

        // --- DRAW FINISHING TOPOUT ROOF ZONE AT THE VERY TOP ---
        const finishScreenY = toScreenY(WALL_HEIGHT - 60);
        if (finishScreenY > -100 && finishScreenY < VIEW_HEIGHT) {
          // Draw a big hazard warning stripes roof
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(xOffset, finishScreenY - 40, halfW, 25);
          
          // Stripes
          ctx.fillStyle = '#000000';
          ctx.save();
          ctx.beginPath();
          ctx.rect(xOffset, finishScreenY - 40, halfW, 25);
          ctx.clip();
          ctx.lineWidth = 10;
          ctx.strokeStyle = '#000000';
          for (let sx = -50; sx < halfW + 100; sx += 30) {
            ctx.beginPath();
            ctx.moveTo(xOffset + sx, finishScreenY - 45);
            ctx.lineTo(xOffset + sx + 20, finishScreenY - 10);
            ctx.stroke();
          }
          ctx.restore();

          // Anchor chain lines
          ctx.strokeStyle = '#4b5563';
          ctx.lineWidth = 4;
          for (let cx = 80; cx < halfW; cx += 150) {
            ctx.beginPath();
            ctx.moveTo(xOffset + cx, finishScreenY - 40);
            ctx.lineTo(xOffset + cx, finishScreenY + 25);
            ctx.stroke();
          }

          // Winner buzzer label
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 13px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText('🏆 WINNER TOUCH BUZZER! 🏆', xOffset + halfW / 2, finishScreenY - 14);
        }

        // --- DRAW ENTIRE HOLDS GRAPHICS ---
        holds.forEach(hold => {
          const sY = toScreenY(hold.y);
          if (sY < -40 || sY > VIEW_HEIGHT + 40) return; // scroll optimization
          const sX = toScreenX(hold.x);

          // Draw hold base shadows for elegant relief/depth
          ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
          ctx.beginPath();
          ctx.moveTo(sX + hold.shapePoints[0].x + 4, sY + hold.shapePoints[0].y + 4);
          for (let i = 1; i < hold.shapePoints.length; i++) {
            ctx.lineTo(sX + hold.shapePoints[i].x + 4, sY + hold.shapePoints[i].y + 4);
          }
          ctx.closePath();
          ctx.fill();

          // Fill core color matching hold categorization
          ctx.fillStyle = hold.color;
          ctx.beginPath();
          ctx.moveTo(sX + hold.shapePoints[0].x, sY + hold.shapePoints[0].y);
          for (let i = 1; i < hold.shapePoints.length; i++) {
            ctx.lineTo(sX + hold.shapePoints[i].x, sY + hold.shapePoints[i].y);
          }
          ctx.closePath();
          ctx.fill();

          // Highlight edges for 3D realism
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(sX + hold.shapePoints[0].x, sY + hold.shapePoints[0].y);
          ctx.lineTo(sX + hold.shapePoints[1].x, sY + hold.shapePoints[1].y);
          ctx.stroke();

          // Draw grip text indicators for slopers or crimps (very clean display style)
          if (hold.type === 'crimp') {
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.font = 'bold 8px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('CRIMP', sX, sY + 3);
          } else if (hold.type === 'sloper') {
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.font = 'bold 8px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('SLIP', sX, sY + 3);
          }
        });

        // --- DRAW OPPONENT INDICATOR GHOST SPIRIT CRUMB ---
        // Helpful racer marker indicating how far along your opponent is on their wall!
        const oppOppY = oppY === null ? -1 : toScreenY(oppY);
        if (oppOppY > 0 && oppOppY < VIEW_HEIGHT) {
          ctx.strokeStyle = '#9ca3af';
          ctx.setLineDash([4, 6]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(xOffset, oppOppY);
          ctx.lineTo(xOffset + halfW, oppOppY);
          ctx.stroke();
          ctx.setLineDash([]); // Reset
          
          ctx.fillStyle = '#6b7280';
          ctx.font = '10px monospace';
          ctx.textAlign = 'right';
          ctx.fillText('OPPONENT HEIGHT', xOffset + halfW - 8, oppOppY - 4);
        }

        // --- ACTIVE SELECTION REACH INDICATOR + YELLOW HOLD HIGHLIGHTS ---
        // Drawn before the nails (and the body) so nails render on top of the highlights.
        {
          const scrTorsoX = toScreenX(player.x);
          const scrTorsoY = toScreenY(player.y);
          if (gameState === 'playing' && !player.isFalling && !player.hasFinished) {
            const sel = selectedRef.current;
            if (sel.player === player.id) {
              const limbName = sel.limb;
              const handSelected = limbName === 'leftHand' || limbName === 'rightHand';

              // The dome is the reach circle clipped by a horizontal line:
              //  • hands: flat edge at the topmost foot, curved part above it
              //  • feet:  flat edge at the lowest hand, curved part below it
              const topFootY = Math.max(player.leftFoot.y, player.rightFoot.y);
              const lowHandY = Math.min(player.leftHand.y, player.rightHand.y);
              const lineScrY = toScreenY(handSelected ? topFootY : lowHandY);
              const R = REACH_DISTANCE;
              const dyLine = lineScrY - scrTorsoY;
              const halfChord = Math.abs(dyLine) < R ? Math.sqrt(R * R - dyLine * dyLine) : 0;

              const drawDome = (stroke: string, lineWidth: number, dash: number[] | null) => {
                ctx.strokeStyle = stroke;
                ctx.lineWidth = lineWidth;
                ctx.setLineDash(dash ?? []);

                // Curved part: clip to the correct side of the line, then stroke the circle
                ctx.save();
                ctx.beginPath();
                if (handSelected) {
                  ctx.rect(scrTorsoX - R - 2, scrTorsoY - R - 2, 2 * R + 4, (lineScrY) - (scrTorsoY - R - 2));
                } else {
                  ctx.rect(scrTorsoX - R - 2, lineScrY, 2 * R + 4, (scrTorsoY + R + 2) - lineScrY);
                }
                ctx.clip();
                ctx.beginPath();
                ctx.arc(scrTorsoX, scrTorsoY, R, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();

                if (halfChord > 0) {
                  ctx.beginPath();
                  ctx.moveTo(scrTorsoX - halfChord, lineScrY);
                  ctx.lineTo(scrTorsoX + halfChord, lineScrY);
                  ctx.stroke();
                }
                ctx.setLineDash([]);
              };

              drawDome('rgba(255, 255, 255, 0.85)', 5, null);    // bright halo backing
              drawDome(player.color, 3, null);                   // bold colored line

              const reachable = getReachableHoldsForLimb(player, limbName);
              reachable.forEach(hold => {
                const holdScrX = toScreenX(hold.x);
                const holdScrY = toScreenY(hold.y);
                const scalePulse = 1.0 + Math.sin(Date.now() / 140) * 0.18;

                // Light-yellow highlight marking an allowed (clickable) hold
                ctx.fillStyle = 'rgba(253, 224, 71, 0.35)';
                ctx.beginPath();
                ctx.arc(holdScrX, holdScrY, hold.size * 1.7 * scalePulse, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#fde68a';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(holdScrX, holdScrY, hold.size * 1.5 * scalePulse, 0, Math.PI * 2);
                ctx.stroke();

                // Faint yellow filament from the body to each reachable hold
                ctx.strokeStyle = 'rgba(253, 224, 71, 0.45)';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([2, 5]);
                ctx.beginPath();
                ctx.moveTo(scrTorsoX, scrTorsoY);
                ctx.lineTo(holdScrX, holdScrY);
                ctx.stroke();
                ctx.setLineDash([]);
              });
            }
          }
        }

        // --- DRAW THIS PLAYER'S NAILS (safety anchors) ---
        // Drawn after all wall decorations (rocks, highlights, opponent marker) so
        // nails sit on the top wall layer, but BEFORE the body so the climber covers them.
        nailsRef.current.filter(n => n.player === player.id).forEach(n => {
          const nx = toScreenX(n.x);
          const ny = toScreenY(n.y);
          if (ny < -20 || ny > VIEW_HEIGHT + 20) return;
          // soft drop shadow so the nail reads clearly against the rocks
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(nx - 1, ny - 7, 4, 18);
          // shaft
          ctx.fillStyle = '#cbd5e1';
          ctx.fillRect(nx - 1.5, ny - 9, 3, 18);
          // head
          ctx.fillStyle = '#94a3b8';
          ctx.beginPath();
          ctx.ellipse(nx, ny - 9, 5.5, 2.5, 0, 0, Math.PI * 2);
          ctx.fill();
          // glint
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.fillRect(nx - 0.5, ny - 7, 1, 12);
        });

        // --- DRAW THE CORE CLIMBER CHARACTER ---
        // Node coordinates translated to screen space
        const scrTorsoX = toScreenX(player.x);
        const scrTorsoY = toScreenY(player.y);
        const scrLHX = toScreenX(player.leftHand.x);
        const scrLHY = toScreenY(player.leftHand.y);
        const scrRHX = toScreenX(player.rightHand.x);
        const scrRHY = toScreenY(player.rightHand.y);
        const scrLFX = toScreenX(player.leftFoot.x);
        const scrLFY = toScreenY(player.leftFoot.y);
        const scrRFX = toScreenX(player.rightFoot.x);
        const scrRFY = toScreenY(player.rightFoot.y);

        // Draw the harness safety rope — it threads through every nail this player
        // has placed, then dangles off the bottom of the screen.
        {
          const anchor = { x: scrTorsoX, y: scrTorsoY + 16 };
          const nailPts = nailsRef.current
            .filter(n => n.player === player.id)
            .map(n => ({ x: toScreenX(n.x), y: toScreenY(n.y) - 9 })); // through the nail head
          // Order the anchor + nails top→bottom so the rope is a clean monotonic line
          const ropePts = [anchor, ...nailPts].sort((a, b) => a.y - b.y);
          const last = ropePts[ropePts.length - 1];
          ropePts.push({ x: last.x, y: VIEW_HEIGHT + 80 }); // dangle past the bottom

          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.lineWidth = 3.5;
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(ropePts[0].x, ropePts[0].y);
          for (let i = 1; i < ropePts.length; i++) {
            ctx.lineTo(ropePts[i].x, ropePts[i].y);
          }
          ctx.stroke();
        }

        // Solve IK joints for limbs to create fluid bends
        // Hands extend upwards typically, knee flex sits down/outwards
        const shoulderLX = scrTorsoX - 12;
        const shoulderRX = scrTorsoX + 12;
        const shoulderY = scrTorsoY - 14;

        const hipLX = scrTorsoX - 9;
        const hipRX = scrTorsoX + 9;
        const hipY = scrTorsoY + 14;

        // Bending Joint calculations
        const elbowL = calculateJointBend({ x: shoulderLX, y: shoulderY }, { x: scrLHX, y: scrLHY }, -1);
        const elbowR = calculateJointBend({ x: shoulderRX, y: shoulderY }, { x: scrRHX, y: scrRHY }, 1);
        const kneeL = calculateJointBend({ x: hipLX, y: hipY }, { x: scrLFX, y: scrLFY }, -1, 42);
        const kneeR = calculateJointBend({ x: hipRX, y: hipY }, { x: scrRFX, y: scrRFY }, 1, 42);

        // Distinct color per limb for easy identification
        const limbColors = {
          leftHand:  '#60a5fa', // blue
          rightHand: '#fb923c', // orange
          leftFoot:  '#c084fc', // purple
          rightFoot: '#4ade80', // green
        };

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Draw Left Arm
        ctx.strokeStyle = limbColors.leftHand;
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(shoulderLX, shoulderY);
        ctx.lineTo(elbowL.x, elbowL.y);
        ctx.lineTo(scrLHX, scrLHY);
        ctx.stroke();

        // Draw Right Arm
        ctx.strokeStyle = limbColors.rightHand;
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(shoulderRX, shoulderY);
        ctx.lineTo(elbowR.x, elbowR.y);
        ctx.lineTo(scrRHX, scrRHY);
        ctx.stroke();

        // Draw Left Leg
        ctx.strokeStyle = limbColors.leftFoot;
        ctx.lineWidth = 11;
        ctx.beginPath();
        ctx.moveTo(hipLX, hipY);
        ctx.lineTo(kneeL.x, kneeL.y);
        ctx.lineTo(scrLFX, scrLFY);
        ctx.stroke();

        // Draw Right Leg
        ctx.strokeStyle = limbColors.rightFoot;
        ctx.lineWidth = 11;
        ctx.beginPath();
        ctx.moveTo(hipRX, hipY);
        ctx.lineTo(kneeR.x, kneeR.y);
        ctx.lineTo(scrRFX, scrRFY);
        ctx.stroke();

        // Core dynamic climber hip torso harness
        ctx.fillStyle = player.color;
        ctx.beginPath();
        // rounded tank-top torso
        ctx.roundRect(scrTorsoX - 14, scrTorsoY - 18, 28, 36, 6);
        ctx.fill();

        // Shorts/harness webbing
        ctx.fillStyle = '#1e293b'; // Slate dark grey harness
        ctx.fillRect(scrTorsoX - 15, scrTorsoY + 10, 30, 9);
        ctx.fillRect(scrTorsoX - 13, scrTorsoY + 15, 11, 4);
        ctx.fillRect(scrTorsoX + 2, scrTorsoY + 15, 11, 4);

        // Drawing Helmets / Head with sweat beads or shaking indicators!
        let headOffsetY = 0;
        let headOffsetX = 0;
        if (player.stamina < 30 && !player.isFalling && !player.hasFinished) {
          // shake head on low stamina!
          headOffsetX = (Math.random() * 3 - 1.5);
          headOffsetY = (Math.random() * 2 - 1);
        }

        ctx.fillStyle = player.color;
        ctx.beginPath();
        ctx.arc(scrTorsoX + headOffsetX, scrTorsoY - 26 + headOffsetY, 10, 0, Math.PI * 2);
        ctx.fill();

        // Draw elegant safety helmet helmet crown
        ctx.fillStyle = player.accentColor;
        ctx.beginPath();
        ctx.arc(scrTorsoX + headOffsetX, scrTorsoY - 29 + headOffsetY, 10, Math.PI, 0); // half arc helmet
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(scrTorsoX - 4 + headOffsetX, scrTorsoY - 33 + headOffsetY, 8, 3.5); // stripe on helmet

        // Is one of this player's limbs currently selected (clickable)?
        const selNow = selectedRef.current;
        const isSelected = (limb: LimbName) => selNow.player === player.id && selNow.limb === limb;
        const drawSelectionRing = (x: number, y: number, r: number) => {
          const pulse = 1 + Math.sin(Date.now() / 160) * 0.22;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(x, y, (r + 5) * pulse, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = player.color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, (r + 8) * pulse, 0, Math.PI * 2);
          ctx.stroke();
        };

        // Emoji icon per limb. Mirroring is anatomically correct: ✋ has the thumb
        // on the left (right hand, palm out); mirrored gives the left hand. 🦶
        // defaults to a left foot; mirrored gives the right foot.
        const drawLimbIcon = (icon: string, x: number, y: number, size: number, mirror: boolean) => {
          ctx.save();
          ctx.translate(x, y);
          if (mirror) ctx.scale(-1, 1);
          ctx.font = `${size}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(icon, 0, 1);
          ctx.restore();
        };

        // Draw a shoe PNG centered at (x,y); falls back to emoji until it loads.
        const drawShoe = (img: HTMLImageElement | null, x: number, y: number, w: number, mirror: boolean): boolean => {
          if (!img || !img.complete || !img.naturalWidth) return false;
          const h = w * (img.naturalHeight / img.naturalWidth);
          ctx.save();
          ctx.translate(x, y);
          if (mirror) ctx.scale(-1, 1);
          ctx.drawImage(img, -w / 2, -h / 2, w, h);
          ctx.restore();
          return true;
        };

        // Hand/foot end-caps (icons + selection rings). Defined here but drawn LAST,
        // so they always stay on top of the body, head, arms and legs.
        const drawLimbCaps = () => {
          // Hands
          [
            { x: scrLHX, y: scrLHY, color: limbColors.leftHand,  limb: 'leftHand'  as LimbName, mirror: false },
            { x: scrRHX, y: scrRHY, color: limbColors.rightHand, limb: 'rightHand' as LimbName, mirror: true  },
          ].forEach(({ x, y, color, limb, mirror }) => {
            if (isSelected(limb)) drawSelectionRing(x, y, 12);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, 12, 0, Math.PI * 2);
            ctx.fill();
            drawLimbIcon('✋', x, y, 17, mirror);
          });
          // Feet (climbing shoes)
          [
            { x: scrLFX, y: scrLFY, color: limbColors.leftFoot,  limb: 'leftFoot'  as LimbName, img: rightShoeImg.current, mirror: true  },
            { x: scrRFX, y: scrRFY, color: limbColors.rightFoot, limb: 'rightFoot' as LimbName, img: rightShoeImg.current, mirror: false },
          ].forEach(({ x, y, color, limb, img, mirror }) => {
            if (isSelected(limb)) drawSelectionRing(x, y, 13);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, 13, 0, Math.PI * 2);
            ctx.fill();
            if (!drawShoe(img, x, y, 32, mirror)) drawLimbIcon('🦶', x, y, 17, false);
          });
        };

        // (Reach indicator + yellow hold highlights are drawn earlier, before the
        // nails, so nails render on top of the highlights — see above.)

        // --- DRAW DYNAMIC OVERHEAD STAMINA BAR (Keeps eyes focused on wall!) ---
        if (!player.hasFinished) {
          const barY = scrTorsoY - 52 + headOffsetY;
          const barW = 44;
          const barH = 5.5;
          const fillW = barW * (player.stamina / 100);
          
          // Outer background
          ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
          ctx.fillRect(scrTorsoX - barW / 2, barY, barW, barH);
          
          // Stamina fill coloring (green -> yellow -> red)
          ctx.fillStyle = player.stamina > 45 ? '#22c55e' : player.stamina > 20 ? '#fbbf24' : '#ef4444';
          ctx.fillRect(scrTorsoX - barW / 2, barY, fillW, barH);

          // Flash border on critical panic levels
          if (player.stamina < 20 && Math.floor(now / 200) % 2 === 0) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.strokeRect(scrTorsoX - barW / 2, barY, barW, barH);
          }

          // Chalk bag, sitting just above the stamina bar: full at 100%, empty at
          // 0%, and creeping back up as it refills. It only turns solid white when
          // it is full, because that is the only point you can chalk up.
          const chalkY = barY - 5;
          const chalkH = 3;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
          ctx.fillRect(scrTorsoX - barW / 2, chalkY, barW, chalkH);
          ctx.fillStyle = player.chalk >= CHALK_REQUIRED ? '#ffffff' : 'rgba(255, 255, 255, 0.5)';
          ctx.fillRect(scrTorsoX - barW / 2, chalkY, barW * (player.chalk / 100), chalkH);

          // Thin blue tick above it while the 5-second grip buff is running
          if (player.chalkPowerTime > 0) {
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(scrTorsoX - barW / 2, chalkY - 2.5, barW * (player.chalkPowerTime / 5000), 1.5);
          }
        }

        // Draw Player Name Tags on chest or feet
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(player.name, scrTorsoX, scrTorsoY + 3);

        // (The nail-hammering animation is drawn as a top overlay after everything
        //  else — see drawNailPressOverlay below.)

        // (Height and chalk live in the ribbon above the wall — nothing is drawn
        //  over the route itself, so no holds are hidden behind a panel.)

        // Hands & feet icons are drawn LAST so they stay on the top layer
        drawLimbCaps();

        ctx.restore();
      };

      if (isSoloRender) {
        // Solo view: render only the local player's column at full canvas width
        const soloPlayer = lp === 'player1' ? p1 : p2;
        const opponentY = singlePlayerRef.current ? null : lp === 'player1' ? p2.y : p1.y;
        drawPlayerWall(soloPlayer, 0, opponentY);

        // Particles for the local player only
        particlesRef.current.forEach(pt => {
          const isLeftHalf = pt.x < halfW;
          const isMyParticle = lp === 'player1' ? isLeftHalf : !isLeftHalf;
          if (!isMyParticle) return;
          ctx.save();
          ctx.globalAlpha = pt.alpha;
          ctx.fillStyle = pt.color;
          ctx.beginPath();
          let cameraY = Math.max(0, soloPlayer.y - VIEW_HEIGHT * 0.45);
          cameraY = Math.min(WALL_HEIGHT - VIEW_HEIGHT, cameraY);
          const sY = VIEW_HEIGHT - (pt.y - cameraY);
          const sX = lp === 'player2' ? pt.x - halfW : pt.x;
          if (sY > 0 && sY < VIEW_HEIGHT && sX >= 0 && sX <= halfW) {
            ctx.arc(sX, sY, pt.size, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        });
      } else {
        // Split screen: draw both players
        drawPlayerWall(p1, 0, p2.y);

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(halfW, 0);
        ctx.lineTo(halfW, VIEW_HEIGHT);
        ctx.stroke();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.stroke();

        drawPlayerWall(p2, halfW, p1.y);

        // Countdown timer on divider
        const timeLeft = Math.max(0, TIME_LIMIT_MS - (now - startTimeRef.current));
        const mins = Math.floor(timeLeft / 60000);
        const secs = Math.floor((timeLeft % 60000) / 1000);
        const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
        const timerColor = timeLeft < 30000 ? '#ef4444' : timeLeft < 60000 ? '#fbbf24' : '#22d3ee';

        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.beginPath();
        (ctx as any).roundRect(halfW - 34, 8, 68, 28, 8);
        ctx.fill();
        ctx.strokeStyle = timerColor + '90';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        if (timeLeft < 30000 && Math.floor(now / 400) % 2 === 0) {
          ctx.fillStyle = timerColor + '18';
          ctx.beginPath();
          (ctx as any).roundRect(halfW - 34, 8, 68, 28, 8);
          ctx.fill();
        }

        ctx.fillStyle = timerColor;
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(timeStr, halfW, 27);

        // Particles for both halves
        particlesRef.current.forEach(pt => {
          ctx.save();
          ctx.globalAlpha = pt.alpha;
          ctx.fillStyle = pt.color;
          ctx.beginPath();
          const isLeftHalf = pt.x < halfW;
          const player = isLeftHalf ? p1 : p2;
          let cameraY = Math.max(0, player.y - VIEW_HEIGHT * 0.45);
          cameraY = Math.min(WALL_HEIGHT - VIEW_HEIGHT, cameraY);
          const sY = VIEW_HEIGHT - (pt.y - cameraY);
          if (sY > 0 && sY < VIEW_HEIGHT) {
            ctx.arc(pt.x, sY, pt.size, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        });
      }

      // --- NAIL-HAMMERING ANIMATION OVERLAY (drawn on top of EVERYTHING) ---
      const bpDraw = bodyPressRef.current;
      if (bpDraw) {
        const pl = bpDraw.player === 'player1' ? p1 : p2;
        // Which on-screen column is this player's?
        let colOffset: number | null = null;
        if (isSoloRender) {
          if (bpDraw.player === lp) colOffset = 0;
        } else {
          colOffset = bpDraw.player === 'player1' ? 0 : halfW;
        }
        if (pl && !pl.isFalling && !pl.hasFinished && colOffset !== null) {
          let cameraY = Math.max(0, pl.y - VIEW_HEIGHT * 0.45);
          cameraY = Math.min(WALL_HEIGHT - VIEW_HEIGHT, cameraY);
          const scrTorsoX = colOffset + pl.x;
          const scrTorsoY = VIEW_HEIGHT - (pl.y - cameraY);

          const elapsed = now - bpDraw.startTime;
          const prog = Math.min(1, elapsed / NAIL_HOLD_MS);

          // Progress ring around the climber
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(scrTorsoX, scrTorsoY, 30, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(scrTorsoX, scrTorsoY, 30, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
          ctx.stroke();

          // Hammer swing — only between NAIL_ANIM_START_MS and NAIL_HOLD_MS
          if (elapsed >= NAIL_ANIM_START_MS) {
            const swing = Math.abs(Math.sin((elapsed - NAIL_ANIM_START_MS) / 70));
            ctx.save();
            ctx.translate(scrTorsoX + 12, scrTorsoY - 6);
            ctx.rotate(-1.5 + swing * 1.2); // raise & smash
            ctx.strokeStyle = pl.color;
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(13, 0);
            ctx.stroke();
            ctx.strokeStyle = '#b45309';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(13, 0);
            ctx.lineTo(24, 0);
            ctx.stroke();
            ctx.fillStyle = '#475569';
            ctx.fillRect(22, -6, 8, 12);
            ctx.fillStyle = '#94a3b8';
            ctx.fillRect(22, -6, 8, 3);
            ctx.restore();

            // impact spark at the bottom of the swing
            if (swing < 0.12) {
              ctx.fillStyle = '#fde68a';
              for (let s = 0; s < 4; s++) {
                const a = (s / 4) * Math.PI * 2;
                ctx.beginPath();
                ctx.arc(scrTorsoX + 18 + Math.cos(a) * 5, scrTorsoY + 6 + Math.sin(a) * 5, 1.5, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }
        }
      }

      // Repeat loop
      if (gameRunningRef.current) {
        updatePhysics();
        rAFId = requestAnimationFrame(renderCanvas);
      }
    };

    // Begin looping
    rAFId = requestAnimationFrame(renderCanvas);

    return () => {
      cancelAnimationFrame(rAFId);
    };
  }, [gameState, settings]);

  const isSolo = localPlayer === 'player1' || localPlayer === 'player2';
  const canvasWidth = (isSolo ? CANVAS_WIDTH / 2 : CANVAS_WIDTH) * ZOOM;
  // Hug the canvas (plus p-3 padding and the 1px border) so the frame doesn't
  // stretch across the column and leave the wall floating in the middle.
  const frameWidth = canvasWidth + 26;

  return (
    <div
      className="flex flex-col items-center bg-slate-900 rounded-xl overflow-hidden p-1.5 sm:p-3 border border-slate-700/60 shadow-xl max-w-full"
      style={{ width: frameWidth }}
      id="climb-screen-frame"
    >
      {/* Realtime Stats Header Board */}
      <div className="w-full flex items-center justify-between gap-1 px-1.5 sm:px-3 py-1 bg-slate-950/70 rounded-lg mb-2 text-[11px] sm:text-[13px] md:text-[15.5px] font-mono select-none" id="stats-ribbon">
        {localPlayer !== 'player2' && (
          <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 min-w-0">
            <span className="text-emerald-400 font-bold truncate max-w-[72px] sm:max-w-none">P1 - {p1Name}</span>
            <div className="w-8 sm:w-16 md:w-24 h-2 bg-slate-800 rounded-full overflow-hidden shrink-0">
              <div className="h-full bg-emerald-500 transition-all duration-100" style={{ width: `${p1Stamina}%` }} />
            </div>
            <span className="text-slate-500">
              H <span className="text-slate-200 font-bold">{p1Height}m</span>
              <span className="text-slate-600">/{WALL_HEIGHT / 100}m</span>
            </span>
            <span className="text-slate-500">
              CHALK <span className={`font-bold ${p1Chalk >= CHALK_REQUIRED ? 'text-white' : 'text-slate-400'}`}>{p1Chalk}%</span>
            </span>
            <span className="text-slate-400">{(p1DisplayTime / 1000).toFixed(1)}s</span>
          </div>
        )}

        {/* Central countdown */}
        <div className="flex flex-col items-center leading-none shrink-0">
          <span className={`font-bold text-[15px] sm:text-[18px] ${timeRemaining < 30000 ? 'text-red-400 animate-pulse' : timeRemaining < 60000 ? 'text-amber-400' : 'text-sky-400'}`}>
            {Math.floor(timeRemaining / 60000)}:{Math.floor((timeRemaining % 60000) / 1000).toString().padStart(2, '0')}
          </span>
          <span className="text-[9px] sm:text-[11.5px] text-slate-500 uppercase tracking-wider">Time Left</span>
        </div>

        {localPlayer !== 'player1' && (
          <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 text-right min-w-0">
            <span className="text-slate-400">{(p2DisplayTime / 1000).toFixed(1)}s</span>
            <span className="text-slate-500">
              CHALK <span className={`font-bold ${p2Chalk >= CHALK_REQUIRED ? 'text-white' : 'text-slate-400'}`}>{p2Chalk}%</span>
            </span>
            <span className="text-slate-500">
              H <span className="text-slate-200 font-bold">{p2Height}m</span>
              <span className="text-slate-600">/{WALL_HEIGHT / 100}m</span>
            </span>
            <div className="w-8 sm:w-16 md:w-24 h-2 bg-slate-800 rounded-full overflow-hidden shrink-0">
              <div className="h-full bg-red-500 transition-all duration-100" style={{ width: `${p2Stamina}%` }} />
            </div>
            <span className="text-red-400 font-bold truncate max-w-[72px] sm:max-w-none">{p2Name} - P2</span>
          </div>
        )}
      </div>

      {/* Transient key feedback — sits above the wall, never on top of it */}
      <div className="w-full h-5 mb-1 flex items-center justify-center">
        {hint && (
          <span className="text-[13px] font-mono text-amber-300 bg-amber-950/40 border border-amber-500/30 rounded-full px-3 py-0.5">
            {hint}
          </span>
        )}
      </div>

      {/* Main Canvas Node */}
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={VIEW_HEIGHT}
        /* The width/height attributes stay at full resolution — they are the
           drawing buffer, so the wall keeps its detail on a high-DPI phone.
           max-w-full/h-auto only shrink the *displayed* size, letting a narrow
           screen scale the whole wall down instead of clipping it. Pointer
           coords are already normalised by rect.width/rect.height, so clicks
           stay accurate at any display size. */
        className="block max-w-full h-auto touch-none bg-slate-950 border border-slate-800 rounded-lg cursor-crosshair shadow-inner"
        id="gl-canvas-node"
      />

      {/* Quick Game Help Controls Footer */}
      <div className="w-full flex flex-col sm:flex-row justify-between items-center gap-2 px-2 pt-2 text-[13px] text-slate-400 font-mono" id="control-cheats">
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <span className="text-sky-400 font-bold">MOUSE:</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700 font-bold">Click</span><span>limb to select</span>
          <span className="text-slate-600">→</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700 font-bold">Click</span><span>hold to move</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">Selected:</span>
          <span className={`px-2 py-0.5 rounded font-bold border ${
            selectedUI.player === 'player1' ? 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40' : 'text-red-400 border-rose-500/40 bg-rose-950/40'
          }`}>
            {limbDisplayName(selectedUI.limb)}
          </span>
          <span className="text-slate-600">↻ auto-cycles LH→RH→RF→LF</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-bold">Space/Enter</span><span>Chalk</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 border border-slate-700 font-bold">2×tap body</span><span>Rock</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 border border-slate-700 font-bold">Hold body 2s</span><span>Nail</span>
        </div>
      </div>
    </div>
  );
};
