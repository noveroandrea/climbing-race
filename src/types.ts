/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type HoldType = 'jug' | 'crimp' | 'sloper' | 'volume';

export interface Hold {
  id: string;
  x: number; // 0 to 100 representing percentage of wall width
  y: number; // 0 to wall_height in pixels
  type: HoldType;
  color: string;
  size: number;
  shapePoints: { x: number; y: number }[]; // custom offsets for unique poly shapes
}

export interface ClimberLimb {
  x: number;
  y: number;
  holdId: string | null;
  targetX: number;
  targetY: number;
  lerpFactor: number;
}

export interface Climber {
  id: 'player1' | 'player2';
  name: string;
  color: string; // Hex or CSS color
  accentColor: string;
  x: number; // Current hip X
  y: number; // Current hip Y
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  stamina: number;
  maxStamina: number;
  chalk: number; // 0 to 100
  chalkPowerTime: number; // duration in ms remaining for chalk multiplier
  isFalling: boolean;
  score: number;
  climbTime: number; // ms
  
  // Hand and foot states
  leftHand: ClimberLimb;
  rightHand: ClimberLimb;
  leftFoot: ClimberLimb;
  rightFoot: ClimberLimb;
  
  // Last solid hold height for reset or checkpoint
  checkpointY: number;
  hasFinished: boolean;

  // True while the climber is still standing on the ground floor (not yet hanging)
  grounded: boolean;
}

export interface GameSettings {
  wallHeight: number; // total scroll height
  difficulty: 'easy' | 'medium' | 'hard';
  mode: 'split' | 'shared'; // split screen (identical routes) or shared wall
  gravity: number;
  seed: string;
  timeLimitMs?: number; // defaults to 3 minutes when omitted
  /** Which of the four walls — decides how the panels are painted (see climbs.ts) */
  climb?: number;
}

/** Height reached by each climber, in metres, when the round ended. */
export interface FinalHeights {
  p1: number;
  p2: number;
}

/** Subset of Climber state that is serialized and sent over the socket at ~20 fps. */
export interface SerializedClimberState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  stamina: number;
  chalk: number;
  chalkPowerTime: number;
  isFalling: boolean;
  hasFinished: boolean;
  leftHand: ClimberLimb;
  rightHand: ClimberLimb;
  leftFoot: ClimberLimb;
  rightFoot: ClimberLimb;
}
