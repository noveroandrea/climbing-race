/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect } from 'react';
import { HoldType } from '../types';
import {
  createRandom,
  generateBlobShape,
  getHoldColor,
  ROCK_COLOR,
  ROCK_SIZE,
  ROCK_SHAPE,
} from '../utils';

/** 'rock' is not a gym hold — it's the stone a climber slaps on mid-route. */
export type SwatchKind = HoldType | 'rock';

interface HoldSwatchProps {
  kind: SwatchKind;
  /** 'sm' is the quick-reference strip; 'md' is the full briefing. */
  size?: 'sm' | 'md';
}

/** Box in CSS pixels, and how much the wall-unit drawing is shrunk to fit it. */
const BOX = {
  md: { w: 88, h: 72, scale: 1, labels: true },
  sm: { w: 54, h: 44, scale: 0.55, labels: false },
} as const;

/** Sizes the wall generator actually produces, so relative scale stays honest. */
const SIZE: Record<HoldType, number> = { jug: 20, crimp: 14, sloper: 22, volume: 40 };

/**
 * One hold, painted with the same geometry, palette and lighting the wall uses —
 * a fixed seed per type keeps the swatch stable between renders.
 */
export const HoldSwatch: React.FC<HoldSwatchProps> = ({ kind, size = 'md' }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const box = BOX[size];

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = box.w * dpr;
    canvas.height = box.h * dpr;
    // Draw in wall units, then shrink the whole thing into the box
    const s = dpr * box.scale;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const BOX_W = box.w / box.scale;
    const BOX_H = box.h / box.scale;
    ctx.clearRect(0, 0, BOX_W, BOX_H);

    const holdType: HoldType = kind === 'rock' ? 'crimp' : kind;
    const points = kind === 'rock'
      ? ROCK_SHAPE
      : generateBlobShape(createRandom(`swatch_${kind}`), SIZE[holdType], holdType);
    const color = kind === 'rock' ? ROCK_COLOR : getHoldColor(() => 0, holdType).color;

    const cx = BOX_W / 2;
    const cy = BOX_H / 2;
    const trace = (dx: number, dy: number) => {
      ctx.beginPath();
      ctx.moveTo(cx + points[0].x + dx, cy + points[0].y + dy);
      for (let i = 1; i < points.length; i++) ctx.lineTo(cx + points[i].x + dx, cy + points[i].y + dy);
      ctx.closePath();
    };

    // Relief shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    trace(4, 4);
    ctx.fill();

    // Body
    ctx.fillStyle = color;
    trace(0, 0);
    ctx.fill();

    // Lit edge along the first segment
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx + points[0].x, cy + points[0].y);
    ctx.lineTo(cx + points[1].x, cy + points[1].y);
    ctx.stroke();

    // Grip labels, exactly as they appear on the wall (too small to read when shrunk)
    if (box.labels) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 8px system-ui';
      if (holdType === 'crimp') {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillText('CRIMP', cx, cy + 3);
      } else if (holdType === 'sloper') {
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillText('SLIP', cx, cy + 3);
      }
    }
  }, [kind, box]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      // Sat on the plywood wall colour, so the holds read as they do in the gym
      style={{ width: box.w, height: box.h, background: '#dbc3a7' }}
      className="shrink-0 rounded-lg border border-black/20"
    />
  );
};
