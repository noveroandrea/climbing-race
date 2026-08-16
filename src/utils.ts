/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hold, HoldType } from './types';

// Simple seedable random number generator (Mulberry32)
export function createRandom(seedStr: string) {
  let h = 1540483477;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  
  return function() {
    let t = h += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate organic polygon offset points for realistic looking climbing holds
export function generateBlobShape(rng: () => number, size: number, type: HoldType): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const numPoints = type === 'volume' ? 3 + Math.floor(rng() * 3) : 6 + Math.floor(rng() * 4);
  
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    // Vary the radius to make it jagged/organic
    let radiusVar = 0.8 + rng() * 0.4;
    
    // Customize shape styles according to hold types
    if (type === 'crimp') {
      // Flatter, wide holds
      const flatX = Math.cos(angle);
      const flatY = Math.sin(angle) * 0.45;
      const r = Math.sqrt(flatX * flatX + flatY * flatY);
      points.push({
        x: (flatX / r) * size * (0.8 + rng() * 0.3),
        y: (flatY / r) * size * (0.8 + rng() * 0.3),
      });
    } else if (type === 'sloper') {
      // Rounder, bulkier circular holds
      points.push({
        x: Math.cos(angle) * size * (0.95 + rng() * 0.1),
        y: Math.sin(angle) * size * (0.95 + rng() * 0.1),
      });
    } else {
      // Jugs and Volumes: irregular
      points.push({
        x: Math.cos(angle) * size * radiusVar,
        y: Math.sin(angle) * size * radiusVar,
      });
    }
  }
  return points;
}

// Get standard styling colors for holds
export function getHoldColor(rng: () => number, type: HoldType): { color: string; accent: string } {
  switch (type) {
    case 'jug':
      // Lime / bright green
      return { color: '#22c55e', accent: '#4ade80' };
    case 'crimp':
      // Red / bright pink
      return { color: '#ef4444', accent: '#f87171' };
    case 'sloper':
      // Vibrant blue / sky
      return { color: '#3b82f6', accent: '#60a5fa' };
    case 'volume':
      // Cool grey or neon yellow highlight
      return { color: '#f59e0b', accent: '#fbbf24' }; // Amber/yellow
    default:
      return { color: '#a855f7', accent: '#c084fc' }; // Purple
  }
}

// The grey rock a climber slaps onto the wall — a fixed shape, so it reads as
// improvised rather than as one of the gym's moulded holds.
export const ROCK_COLOR = '#78716c';
export const ROCK_SIZE = 16;
export const ROCK_SHAPE: { x: number; y: number }[] = [
  { x: -20, y: -5 },
  { x: -12, y: -10 },
  { x:   0, y: -13 },
  { x:  12, y: -10 },
  { x:  20, y:  -5 },
  { x:  16, y:   4 },
  { x:   0, y:   8 },
  { x: -16, y:   4 },
];

// ── Route shape ──────────────────────────────────────────────────────────────
// 100px of wall is 1 metre. A route is one 200m block that never repeats inside
// itself; anything taller simply stacks that block again.

export const PX_PER_METRE = 100;
export const SECTION_HEIGHT = 5 * PX_PER_METRE;        // the wall is tuned in 5m sections
export const CLIMB_BLOCK_HEIGHT = 200 * PX_PER_METRE;  // 200m before the pattern repeats
export const SECTIONS_PER_BLOCK = CLIMB_BLOCK_HEIGHT / SECTION_HEIGHT;

/**
 * The route profile, section by section, each covering 5m.
 *
 * Green jugs fall away fast at first — eight points a section — and then five
 * at a time once they are down to two thirds of the wall, settling at half.
 * Holds thin out alongside them, two a section and then one. Green is the
 * restful, nail-friendly hold, so this is what makes the wall bite up high.
 *
 * The two run to their own floors rather than in lockstep: from 80%, steps of
 * eight overshoot 66% (80 → 72 → 64), so green stops at 66 and starts stepping
 * by five, while holds still need a third step of two to reach 14.
 *
 * Both hold their last value for the rest of the 200m.
 */
const GREEN_PERCENT = [80, 72, 66, 61, 56, 51, 50];
const HOLD_COUNT = [20, 18, 16, 14, 13, 12, 11, 10];

const atSection = (steps: number[], index: number) =>
  steps[Math.min(Math.max(0, Math.floor(index)), steps.length - 1)];

/** Share of holds that are green jugs in the section starting at `index * 5m`. */
export const sectionGreenShare = (index: number) => atSection(GREEN_PERCENT, index) / 100;

/** How many holds that same section gets. */
export const sectionHoldCount = (index: number) => atSection(HOLD_COUNT, index);

/** First section where neither number moves again — where the wall stops getting harder. */
export const SETTLES_AT_SECTION = Math.max(GREEN_PERCENT.length, HOLD_COUNT.length) - 1;

interface Tuning {
  crimp: number;
  sloper: number;
  volume: number;
}

// How the non-green share is split. Green is fixed by height, so difficulty only
// decides what the rest of the wall is made of.
const TUNING: Record<'easy' | 'medium' | 'hard', Tuning> = {
  easy:   { crimp: 0.25, sloper: 0.25, volume: 0.50 },
  medium: { crimp: 0.40, sloper: 0.40, volume: 0.20 },
  hard:   { crimp: 0.50, sloper: 0.45, volume: 0.05 },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * One 200m block. Holds are laid out in rows rather than scattered, because the
 * counts above get thin near the top and a climber has to be able to reach the
 * next hold from the last one — each row is placed within arm's span of the row
 * below it.
 */
function generateBlock(
  rng: () => number,
  canvasWidth: number,
  difficulty: 'easy' | 'medium' | 'hard',
): Hold[] {
  const mix = TUNING[difficulty];
  const holds: Hold[] = [];
  const minX = 40;
  const maxX = canvasWidth - 40;
  const midX = (minX + maxX) / 2;

  const addHold = (x: number, y: number, type: HoldType) => {
    const size = type === 'volume' ? 36 + rng() * 12
      : type === 'jug' ? 18 + rng() * 6
      : type === 'sloper' ? 20 + rng() * 5
      : 12 + rng() * 4;
    holds.push({
      id: `hold_${holds.length}_${Math.floor(rng() * 1000000)}`,
      x, y, type,
      color: getHoldColor(rng, type).color,
      size,
      shapePoints: generateBlobShape(rng, size, type),
    });
  };

  // The green share is a promise, not a probability: a section of 26 holds at
  // 80% gets exactly 21 jugs, shuffled through the rest rather than rolled per
  // hold (which drifts far enough to make one section easier than the one below).
  const sectionTypes = (count: number, greenShare: number): HoldType[] => {
    const list: HoldType[] = [];
    const jugs = Math.round(count * greenShare);
    for (let i = 0; i < jugs; i++) list.push('jug');
    while (list.length < count) {
      const roll = rng() * (mix.crimp + mix.sloper + mix.volume);
      list.push(roll < mix.crimp ? 'crimp' : roll < mix.crimp + mix.sloper ? 'sloper' : 'volume');
    }
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };

  // Where the previous row sat, so the next one stays within reach of it
  let anchorX = midX;

  for (let section = 0; section < SECTIONS_PER_BLOCK; section++) {
    const count = sectionHoldCount(section);
    const baseY = section * SECTION_HEIGHT;
    const types = sectionTypes(count, sectionGreenShare(section));
    let cursor = 0;
    // Starting-shelf holds have to be jugs, so they take one out of the section's
    // own green quota instead of being added on top of it.
    const takeType = (forceJug: boolean): HoldType => {
      if (forceJug) {
        const swap = types.indexOf('jug', cursor);
        if (swap >= 0) [types[cursor], types[swap]] = [types[swap], types[cursor]];
        else types[cursor] = 'jug';
      }
      return types[cursor++];
    };

    // ~60px between rows, which is comfortably inside the 150px reach
    const rows = Math.min(8, count);
    const rowH = SECTION_HEIGHT / rows;

    // Spread the section's holds over its rows, handing the remainder out at
    // random so the extra hold isn't always on the same row of every section.
    const perRow = Array.from({ length: rows }, () => Math.floor(count / rows));
    const order = perRow.map((_, r) => r);
    for (let i = order.length - 1; i > 0; i--) {          // Fisher-Yates
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let extra = 0; extra < count % rows; extra++) perRow[order[extra]]++;

    for (let r = 0; r < rows; r++) {
      const k = perRow[r];
      if (k === 0) continue;
      const rowY = baseY + r * rowH + rowH * (0.3 + rng() * 0.4);

      // The bottom of the wall is the starting shelf: full width, all jugs.
      const isStart = rowY < 190;
      const span = isStart ? maxX - minX : Math.max(200, k * 90);
      const lo = clamp(anchorX - span / 2, minX, maxX - span);
      const slot = span / k;

      let sum = 0;
      for (let i = 0; i < k; i++) {
        // A few jitters per slot, keeping whichever sits furthest from its
        // neighbours — planned rows still collide now and then.
        let bestX = lo + slot * (i + 0.5);
        let bestGap = -1;
        for (let attempt = 0; attempt < 5; attempt++) {
          const x = clamp(lo + slot * (i + 0.5) + (rng() - 0.5) * slot * 0.6, minX, maxX);
          let gap = Infinity;
          for (const h of holds) {
            if (Math.abs(h.y - rowY) > 90) continue;
            gap = Math.min(gap, Math.hypot(h.x - x, h.y - rowY));
          }
          if (gap > bestGap) { bestGap = gap; bestX = x; }
          if (gap >= 48) break;
        }
        addHold(bestX, rowY, takeType(isStart));
        sum += bestX;
      }
      anchorX = sum / k;
    }
  }

  return holds;
}

export function generateHoldsForWall(
  wallHeight: number,
  canvasWidth: number,
  difficulty: 'easy' | 'medium' | 'hard',
  seed: string
): Hold[] {
  const rng = createRandom(seed);
  const block = generateBlock(rng, canvasWidth, difficulty);
  const holds = block.filter(h => h.y < wallHeight - 140);

  // Past 200m the same block starts over — nobody has a clock long enough to
  // get there, but the wall should not simply run out of holds if they do.
  for (let tile = 1; tile * CLIMB_BLOCK_HEIGHT < wallHeight; tile++) {
    const offset = tile * CLIMB_BLOCK_HEIGHT;
    for (const h of block) {
      if (h.y + offset >= wallHeight - 140) break;
      holds.push({ ...h, id: `${h.id}_r${tile}`, y: h.y + offset });
    }
  }

  // Finish ledge: heavy volumes and jugs marking the top-out chain
  const finalTopY = wallHeight - 80;
  for (let x = 80; x < canvasWidth - 40; x += 120) {
    const size = 36 + rng() * 12;
    holds.push({
      id: `hold_top_${x}`, x, y: finalTopY, type: 'volume',
      color: getHoldColor(rng, 'volume').color, size,
      shapePoints: generateBlobShape(rng, size, 'volume'),
    });
    const jugSize = 18 + rng() * 6;
    holds.push({
      id: `hold_top_jug_${x}`, x: x + 40, y: finalTopY + 20, type: 'jug',
      color: getHoldColor(rng, 'jug').color, size: jugSize,
      shapePoints: generateBlobShape(rng, jugSize, 'jug'),
    });
  }

  // Sort holds so they render from bottom to top nicely
  return holds.sort((a, b) => b.y - a.y);
}

// Calculate elbows or knees bend point using midpoints & offsets (custom Inverse Kinematics)
export function calculateJointBend(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bendDir: number, // 1 or -1
  maxLimbLen = 38
): { x: number; y: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  // Midpoint
  const mx = start.x + dx * 0.5;
  const my = start.y + dy * 0.5;
  
  if (dist >= maxLimbLen) {
    // Leg/arm is fully straight
    return { x: mx, y: my };
  }
  
  // Perpendicular vector
  const px = -dy / (dist || 1);
  const py = dx / (dist || 1);
  
  // How much to bend
  const bendDistance = Math.sqrt(Math.max(0, (maxLimbLen * maxLimbLen) / 4 - (dist * dist) / 4));
  
  // Apply bend direction offset
  return {
    x: mx + px * bendDistance * bendDir,
    y: my + py * bendDistance * bendDir,
  };
}

// Distance solver helper
export function getDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}
