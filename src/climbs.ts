/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CLIMB_BLOCK_HEIGHT } from './utils';

/**
 * The gym has four walls. They are all 200m of the same escalating route shape
 * — green holds thinning out and holds getting sparser every 5m — and differ
 * only in where the holds actually sit, which the seed decides, and in how the
 * wall behind them is painted.
 *
 * Each wall keeps its own Hall of Fame, so a score is only ever compared with
 * runs on the same route. Climb 1 is the wall everything before today was
 * climbed on, which is why every existing score belongs to it.
 */
export interface WallTheme {
  /** Panel face */
  wall: string;
  /** Joint lines between panels */
  panel: string;
  /** Bolt holes */
  bolt: string;
  /** Crash mat, its edge, and the lettering on it */
  mat: string;
  matEdge: string;
  matInk: string;
  /** Painted over the whole column, after the holds — night falls on everything */
  dim?: string;
  /** Salewa eagles sprayed on the panels */
  logos?: boolean;
}

export interface Climb {
  id: number;
  name: string;
  seed: string;
  blurb: string;
  theme: WallTheme;
}

export const CLIMBS: readonly Climb[] = [
  {
    id: 1,
    name: 'Home Wall',
    seed: 'SOLO_FIXED_01',
    blurb: 'Warm plywood, the way the gym has always looked.',
    theme: {
      wall: '#dbc3a7', panel: '#c49f76', bolt: '#8c603b',
      mat: '#0f766e', matEdge: '#115e59', matInk: '#2dd4bf',
    },
  },
  {
    id: 2,
    name: 'Slate Quarry',
    seed: 'CLIMB_02_SLATE',
    blurb: 'Cold grey stone. Nobody has a record on it yet.',
    theme: {
      wall: '#5b6673', panel: '#3f4854', bolt: '#232a33',
      mat: '#334155', matEdge: '#1e293b', matInk: '#94a3b8',
    },
  },
  {
    id: 3,
    name: 'Salewa Cube',
    // Redrawn, and picked out of two dozen draws for the kindest one: it goes
    // furthest on holds alone before you have to start placing rocks.
    seed: 'SALEWA_CUBE_17',
    blurb: 'The sponsored box — eagles on every panel, holds all over the place.',
    theme: {
      wall: '#e7ebf0', panel: '#c3ccd8', bolt: '#94a3b8',
      mat: '#b91c1c', matEdge: '#7f1d1d', matInk: '#fecaca',
      logos: true,
    },
  },
  {
    id: 4,
    name: 'Night Session',
    seed: 'CLIMB_04_NIGHT',
    blurb: 'Lights out, last wall of the evening. Nothing is handed to you.',
    theme: {
      wall: '#141d33', panel: '#0b1120', bolt: '#05070f',
      mat: '#0b3b3a', matEdge: '#052e2b', matInk: '#0d9488',
      dim: 'rgba(2, 6, 23, 0.42)',
    },
  },
] as const;

export const CLIMB_HEIGHT = CLIMB_BLOCK_HEIGHT; // 200m, in wall pixels

export const climbById = (id: number): Climb =>
  CLIMBS.find(c => c.id === id) ?? CLIMBS[0];

export const themeFor = (id: number | undefined): WallTheme => climbById(id ?? 1).theme;
