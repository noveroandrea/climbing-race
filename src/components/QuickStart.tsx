/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { Hammer, MousePointerClick, Pointer, Sparkles, Mountain } from 'lucide-react';
import { useIsTouch, usePointerWords } from '../lib/useIsTouch';

const STORAGE_KEY = 'gripRace.quickStartDismissed';

/**
 * Whether the quick-start card should still be on the menu. Read once at mount —
 * a stored "yes" survives reloads, so the card is a first-visit thing, not a
 * banner you dismiss forever every time.
 */
export function useQuickStart(): [boolean, () => void] {
  const [show, setShow] = React.useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== '1';
    } catch {
      return true; // private mode / storage blocked — showing it is the safe miss
    }
  });

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* nothing to do */ }
  };

  return [show, dismiss];
}

/**
 * The four-line version of the rules, on the menu above "Pick your climb".
 * Anything longer lives behind "How to Climb" in the header.
 */
export const QuickStart: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => {
  const touch = useIsTouch();
  const w = usePointerWords();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-900 border border-sky-500/25 shadow-2xl rounded-2xl p-5 sm:p-6 relative overflow-hidden"
    >
      <div className="absolute -top-10 -right-8 w-40 h-40 bg-sky-500/10 blur-3xl rounded-full pointer-events-none" />

      <div className="relative flex items-center gap-2 mb-3">
        {touch
          ? <Pointer className="w-5 h-5 text-sky-400 shrink-0" />
          : <MousePointerClick className="w-5 h-5 text-sky-400 shrink-0" />}
        <h2 className="text-[20px] sm:text-[23.5px] font-bold font-sans tracking-tight text-white">
          How to play
        </h2>
        <span className="ml-auto text-[11.5px] font-mono uppercase tracking-wider text-sky-400/80 border border-sky-500/25 rounded px-1.5 py-0.5">
          {touch ? 'touch' : 'mouse'}
        </span>
      </div>

      <ul className="relative space-y-2 text-[14.5px] sm:text-[15.5px] text-slate-300 font-sans leading-snug">
        <li className="flex gap-2.5">
          <Mountain className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-white">{w.tap} a hand or foot</strong>, then {w.taps} a highlighted hold to
            move it there. Climb to the top before the clock runs out.
          </span>
        </li>
        <li className="flex gap-2.5">
          <Hammer className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-amber-200">{w.hold} on your body for 2 seconds</strong>{' '}
            with all four limbs on green jugs to hammer a nail — it catches your next fall. Forget it and you drop
            all the way down.
          </span>
        </li>
        <li className="flex gap-2.5">
          <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-white">Chalk up</strong> with the bag button on the top right of the wall
            {touch ? '' : ' (or the Space key)'} to slow your grip drain.
          </span>
        </li>
      </ul>

      <button
        onClick={onDismiss}
        className="relative mt-4 w-full sm:w-auto sm:px-6 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-[15.5px] font-bold text-slate-200 font-sans transition-all active:scale-95 cursor-pointer"
      >
        I got it
      </button>
      <p className="relative text-[12.5px] text-slate-500 mt-2 font-sans">
        The full rules stay under “How to Climb”, top right.
      </p>
    </motion.div>
  );
};
