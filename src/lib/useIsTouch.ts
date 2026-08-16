/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

/**
 * True on phones and tablets, false on a machine with a mouse.
 *
 * Screen width would be a bad proxy — a narrow desktop window is still a mouse,
 * and a big tablet is still a finger. `pointer: coarse` asks about the input
 * device itself, which is the thing the instructions actually differ on. The
 * query is live, so a tablet with a keyboard case attached updates on the fly.
 */
export function useIsTouch(): boolean {
  const [touch, setTouch] = useState(
    () => typeof window !== 'undefined'
      && window.matchMedia?.('(hover: none) and (pointer: coarse)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(hover: none) and (pointer: coarse)');
    const onChange = () => setTouch(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return !!touch;
}

/** Verbs for the instructions, so one copy covers both input devices. */
export function usePointerWords() {
  const touch = useIsTouch();
  return touch
    ? {
        tap: 'Tap', taps: 'tap', doubleTap: 'Double-tap', doubleTaps: 'double-tap',
        hold: 'Press and hold your finger', holdLower: 'press and hold your finger',
        device: 'finger',
      }
    : {
        tap: 'Click', taps: 'click', doubleTap: 'Double-click', doubleTaps: 'double-click',
        hold: 'Hold the mouse button', holdLower: 'hold the mouse button',
        device: 'mouse',
      };
}
