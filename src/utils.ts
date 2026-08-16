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

export function generateHoldsForWall(
  wallHeight: number,
  canvasWidth: number,
  difficulty: 'easy' | 'medium' | 'hard',
  seed: string
): Hold[] {
  const rng = createRandom(seed);
  const holds: Hold[] = [];
  
  // Set parameters based on difficulty
  let maxReach = 110;
  let minDistance = 50;
  let crimpProbability = 0.15;
  let sloperProbability = 0.15;
  let volumeProbability = 0.05;
  
  if (difficulty === 'easy') {
    maxReach = 130;
    minDistance = 45;
    crimpProbability = 0.05;
    sloperProbability = 0.05;
    volumeProbability = 0.1;
  } else if (difficulty === 'hard') {
    maxReach = 95;
    minDistance = 60;
    crimpProbability = 0.35;
    sloperProbability = 0.30;
    volumeProbability = 0.02;
  }

  // Helper to add a hold with collision checking (don't overlap too closely)
  function tryAddHold(x: number, y: number, type: HoldType): boolean {
    // Keep padding from wall sides
    if (x < 40 || x > canvasWidth - 40) return false;
    
    // Check overlapping
    for (const hold of holds) {
      const dx = hold.x - x;
      const dy = hold.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDistance) {
        return false;
      }
    }
    
    const size = type === 'volume' ? 36 + rng() * 12 : type === 'jug' ? 18 + rng() * 6 : type === 'sloper' ? 20 + rng() * 5 : 12 + rng() * 4;
    const colors = getHoldColor(rng, type);
    
    holds.push({
      id: `hold_${holds.length}_${Math.floor(rng() * 1000000)}`,
      x,
      y,
      type,
      color: colors.color,
      size,
      shapePoints: generateBlobShape(rng, size, type),
    });
    
    return true;
  }

  // --- 1. Generous Starting Layer (at the bottom, y is in gym height coords, where y=0 is ground and y=wallHeight is finish)
  // Let's generate base shelf holds for feet and hands
  for (let x = 60; x < canvasWidth - 40; x += 65) {
    tryAddHold(x, 150 + (rng() * 30 - 15), 'jug'); // main starting holds
    tryAddHold(x + 20, 50 + (rng() * 20), 'jug');  // standard low starter footholds
  }

  // --- 2. Iterative Reachable Generation Upwards
  // We advance in bands from y = 150 up to wallHeight
  let currentY = 150;
  
  while (currentY < wallHeight - 120) {
    // Determine step size for next layer
    const verticalStep = 60 + rng() * 35; // step up by roughly 60-95px
    currentY += verticalStep;
    
    // In each vertical band, generate 2-4 holds across the width
    const density = difficulty === 'hard' ? 2 : 3;
    const sectorWidth = canvasWidth / density;
    
    for (let s = 0; s < density; s++) {
      // Find coordinates in this sector
      const sectorXStart = s * sectorWidth + 40;
      const sectorXEnd = (s + 1) * sectorWidth - 40;
      const hx = sectorXStart + rng() * (sectorXEnd - sectorXStart);
      const hy = currentY + (rng() * 30 - 15);
      
      // Select hold type based on weights
      const roll = rng();
      let selectedType: HoldType = 'jug';
      if (roll < crimpProbability) {
        selectedType = 'crimp';
      } else if (roll < crimpProbability + sloperProbability) {
        selectedType = 'sloper';
      } else if (roll < crimpProbability + sloperProbability + volumeProbability) {
        selectedType = 'volume';
      }
      
      tryAddHold(hx, hy, selectedType);
    }
    
    // Ensure climbing paths don't get completely isolated dead ends.
    // If there is any band with 0 holds, force spawn a secure Jug.
    const holdsInBand = holds.filter(h => Math.abs(h.y - currentY) < 40);
    if (holdsInBand.length === 0) {
      tryAddHold(canvasWidth / 2 + (rng() * 100 - 50), currentY, 'jug');
    }
  }

  // --- 3. Finish Ledge System at the top
  // Create a beautiful heavy bar or giant chains at the top of the wall representing the top-out chain!
  const finalTopY = wallHeight - 80;
  // A set of giant blue/purple volumes or jugs
  for (let x = 80; x < canvasWidth - 40; x += 120) {
    tryAddHold(x, finalTopY, 'volume');
    tryAddHold(x + 40, finalTopY + 20, 'jug');
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
