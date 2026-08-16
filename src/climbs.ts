/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CLIMB_BLOCK_HEIGHT } from './utils';

/**
 * The gym has four walls. They are all 200m of the same escalating route shape
 * — green holds thinning out and holds getting sparser every 5m — and differ
 * only in where the holds actually sit, which the seed decides.
 *
 * Each wall keeps its own Hall of Fame, so a score is only ever compared with
 * runs on the same route. Climb 1 is the wall everything before today was
 * climbed on, which is why every existing score belongs to it.
 */
export interface Climb {
  id: number;
  name: string;
  seed: string;
  blurb: string;
}

export const CLIMBS: readonly Climb[] = [
  { id: 1, name: 'Home Wall',     seed: 'SOLO_FIXED_01',  blurb: 'The original route — every score set before today was set here.' },
  { id: 2, name: 'Slate Quarry',  seed: 'CLIMB_02_SLATE', blurb: 'Same rules, a wall nobody has a record on yet.' },
  { id: 3, name: 'The Prow',      seed: 'CLIMB_03_PROW',  blurb: 'Holds wander further off the line — commit early.' },
  { id: 4, name: 'Night Session', seed: 'CLIMB_04_NIGHT', blurb: 'The last wall of the evening. Nothing is handed to you.' },
] as const;

export const CLIMB_HEIGHT = CLIMB_BLOCK_HEIGHT; // 200m, in wall pixels

export const climbById = (id: number): Climb =>
  CLIMBS.find(c => c.id === id) ?? CLIMBS[0];
