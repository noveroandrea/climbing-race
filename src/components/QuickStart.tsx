/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { MousePointerClick, Pointer } from 'lucide-react';
import { HoldSwatch } from './HoldSwatch';
import { useIsTouch, usePointerWords } from '../lib/useIsTouch';

/**
 * The short version of the rules. It opens over the menu on arrival and then
 * gets out of the way for good: "OK, got it" closes it, and the only way back
 * in is the How to Play button in the header. Nothing about it lives in the
 * page any more — a card the reader has already read is just something to
 * scroll past on every visit to the menu.
 */
export const QuickStart: React.FC<{ onDismiss: () => void; onFullRules: () => void }> = ({ onDismiss, onFullRules }) => {
  const touch = useIsTouch();
  const w = usePointerWords();

  const moves: [string, React.ReactNode][] = [
    [w.tap, <>a hold to move the selected limb there. {w.tap} a hand or foot to select a different one.</>],
    ['No crossing:', <>a foot <strong className="text-sky-300">never goes above your lowest hand</strong>, and a hand
      never goes below your highest foot — that is the flat edge cutting off the reach arc. To get a foot higher,
      move a hand up first.</>],
    [w.doubleTap, <>your body for a new rock above your head — but you <strong className="text-rose-300">fall while placing it</strong>.</>],
    [w.hold, <>on your body for 2s to hammer a nail. Future falls stop there instead of the ground.</>],
    [`${w.tap} the chalk bag`, <>(top right of the wall) to make your energy last: for{' '}
      <strong className="text-sky-300">5 seconds your stamina drains 55% slower</strong>. It does not refill the bar —
      only resting on green jugs does that.</>],
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-fade-in"
      id="quickstart-modal"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-sky-500/25 shadow-2xl rounded-2xl p-5 sm:p-6 relative"
      >
        <div className="absolute -top-10 -right-8 w-40 h-40 bg-sky-500/10 blur-3xl rounded-full pointer-events-none" />

        <div className="relative flex items-center gap-2 mb-3">
          {touch
            ? <Pointer className="w-5 h-5 text-sky-400 shrink-0" />
            : <MousePointerClick className="w-5 h-5 text-sky-400 shrink-0" />}
          <h2 className="text-[20px] sm:text-[23.5px] font-bold font-sans tracking-tight text-white">How to play</h2>
          <span className="ml-auto text-[11.5px] font-mono uppercase tracking-wider text-sky-400/80 border border-sky-500/25 rounded px-1.5 py-0.5">
            {touch ? 'touch' : 'mouse'}
          </span>
        </div>

        {/* What you do */}
        <ul className="relative space-y-1.5 text-[14.5px] sm:text-[15.5px] text-slate-300 font-sans leading-snug">
          {moves.map(([verb, rest], i) => (
            <li key={i} className="flex gap-2">
              <span className="text-sky-500/60 shrink-0">•</span>
              <span><strong className="text-white">{verb}</strong> {rest}</span>
            </li>
          ))}
        </ul>

        {/* The green holds */}
        <div className="relative mt-3 flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-950/25 px-3 py-2">
          <HoldSwatch kind="jug" size="sm" />
          <p className="text-[14px] sm:text-[14.5px] text-slate-300 leading-snug">
            <strong className="text-emerald-300">Green jugs are the safe holds</strong> — solid, barely tiring, and the
            only ones you can hammer a nail from (all four limbs on green).
          </p>
        </div>

        {/* Volumes take two limbs */}
        <div className="relative mt-2 flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-950/25 px-3 py-2">
          <HoldSwatch kind="volume" size="sm" />
          <p className="text-[14px] sm:text-[14.5px] text-slate-300 leading-snug">
            <strong className="text-amber-300">A big yellow volume takes two limbs</strong> — a hand and a foot, both
            hands or both feet. Every other hold takes one.
          </p>
        </div>

        {/* The two bars above the climber's head */}
        <div className="relative mt-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5">
          <p className="text-[12.5px] uppercase tracking-wider font-bold text-slate-500 font-sans mb-2">
            The bars above your climber
          </p>
          <div className="space-y-2 text-[14px] sm:text-[14.5px] text-slate-300 leading-snug font-sans">
            <div className="flex items-center gap-2.5">
              <span className="w-11 h-2 rounded-sm bg-slate-800 overflow-hidden shrink-0">
                <span className="block h-full w-2/3 bg-emerald-500" />
              </span>
              <span>
                <strong className="text-white">Stamina</strong> — green, then{' '}
                <span className="text-amber-400">amber</span>, then <span className="text-rose-400">red</span>. At zero
                you fall. Resting both hands on green jugs winds it back up.
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-11 h-1.5 rounded-sm bg-slate-800 overflow-hidden shrink-0">
                <span className="block h-full w-full bg-white" />
              </span>
              <span>
                <strong className="text-white">Chalk</strong> — the thin one. It has to be full before you can chalk up
                and one dip empties it, so you get a dip roughly every 23s of hanging steady.
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onDismiss}
          className="relative mt-4 w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold font-sans rounded-xl text-[15.5px] tracking-wide transition-all shadow-lg active:scale-95 cursor-pointer"
          id="quickstart-ok-btn"
        >
          OK, got it
        </button>
        <button
          onClick={onFullRules}
          className="relative mt-2 w-full py-2 text-[13.5px] font-medium text-slate-400 hover:text-sky-300 font-sans transition-colors cursor-pointer"
        >
          Read the full rules
        </button>
      </motion.div>
    </div>
  );
};
