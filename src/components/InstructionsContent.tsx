/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, Hammer, MousePointerClick, Zap, Target } from 'lucide-react';
import { HoldSwatch, SwatchKind } from './HoldSwatch';

const HOLDS: { kind: SwatchKind; name: string; tone: string; border: string; text: string }[] = [
  {
    kind: 'jug',
    name: 'Jug',
    tone: 'bg-emerald-950/40',
    border: 'border-emerald-500/20',
    text: 'Big and secure. Both hands on jugs recovers stamina — and all four limbs on jugs is the only way to hammer a nail.',
  },
  {
    kind: 'crimp',
    name: 'Crimp',
    tone: 'bg-rose-950/40',
    border: 'border-rose-500/20',
    text: 'Tiny sharp edges. Stamina drains about 4× faster while you hang on one.',
  },
  {
    kind: 'sloper',
    name: 'Sloper',
    tone: 'bg-blue-950/40',
    border: 'border-blue-500/20',
    text: 'Rounded and slippery. Steady stamina drain — move past them quickly.',
  },
  {
    kind: 'volume',
    name: 'Volume',
    tone: 'bg-amber-950/40',
    border: 'border-amber-500/20',
    text: 'Big plywood blocks. Excellent anchors for long reaches, and they cap the top-out ledge.',
  },
];

const QUICK_HOLDS: { kind: SwatchKind; name: string; note: string; color: string }[] = [
  { kind: 'jug',    name: 'Jug',    note: 'safe · rest · nail here', color: 'text-emerald-400' },
  { kind: 'crimp',  name: 'Crimp',  note: 'drains 4×',               color: 'text-rose-400' },
  { kind: 'sloper', name: 'Sloper', note: 'slippery',                color: 'text-sky-400' },
  { kind: 'volume', name: 'Volume', note: 'big reach',               color: 'text-amber-400' },
  { kind: 'rock',   name: 'Rock',   note: 'you placed it',           color: 'text-stone-400' },
];

/**
 * The cheat-sheet that sits beside the wall while you climb. Deliberately thin —
 * the full briefing lives behind the "How to Climb" button in the header.
 */
export const QuickGuide: React.FC = () => (
  <div className="space-y-3.5">

    {/* The one thing people forget */}
    <div className="rounded-xl border-2 border-amber-400/60 bg-amber-500/15 px-3 py-2.5 text-center">
      <p className="text-[23.5px] sm:text-[26px] font-black leading-tight tracking-tight text-amber-200 font-sans uppercase">
        Don't forget to put nails!!
      </p>
      <p className="text-[13.5px] text-amber-100/75 mt-1 leading-snug">
        Hold your body 2s on four green jugs. Without one, a fall goes all the way down.
      </p>
    </div>

    {/* Holds at a glance */}
    <div className="grid grid-cols-5 gap-1.5">
      {QUICK_HOLDS.map(h => (
        <div key={h.kind} className="flex flex-col items-center gap-1 text-center">
          <HoldSwatch kind={h.kind} size="sm" />
          <span className={`text-[12.5px] font-bold leading-none ${h.color}`}>{h.name}</span>
          <span className="text-[11px] text-slate-500 leading-tight">{h.note}</span>
        </div>
      ))}
    </div>

    {/* Four rules */}
    <dl className="text-[14.5px] leading-snug divide-y divide-slate-800/80 border-y border-slate-800/80">
      <div className="flex gap-2 py-1.5">
        <dt className="shrink-0 w-24 font-mono text-[12.5px] text-sky-400 pt-px">CLICK · CLICK</dt>
        <dd className="text-slate-400">Click to select another limb, then click to select a hold.</dd>
      </div>
      <div className="flex gap-2 py-1.5">
        <dt className="shrink-0 w-24 font-mono text-[12.5px] text-sky-400 pt-px">SPACE · BAG</dt>
        <dd className="text-slate-400">
          Chalk — the key, or the bag button on the top right of the wall. Needs{' '}
          <strong className="text-slate-200">70%</strong>, drains <strong className="text-slate-200">70%</strong>.
        </dd>
      </div>
      <div className="flex gap-2 py-1.5">
        <dt className="shrink-0 w-24 font-mono text-[12.5px] text-amber-400 pt-px">HOLD BODY 2s</dt>
        <dd className="text-slate-400">Hammer a nail — your fall stops here.</dd>
      </div>
      <div className="flex gap-2 py-1.5">
        <dt className="shrink-0 w-24 font-mono text-[12.5px] text-rose-400 pt-px">2× TAP BODY</dt>
        <dd className="text-slate-400">New rock to ease the climb, <strong className="text-rose-300">but you fall to your last nail.</strong> <strong className="text-slate-200">Jump start.</strong></dd>
      </div>
    </dl>

    <p className="text-[13px] text-slate-600 text-center">Full rules: “How to Climb”, top right.</p>
  </div>
);

/**
 * The full how-to-climb briefing, shown in the pop-up modal.
 */
export const InstructionsContent: React.FC = () => (
  <div className="space-y-4">

    {/* ── The one thing people forget ─────────────────────────────────────── */}
    <div className="relative overflow-hidden rounded-2xl border-2 border-amber-400/60 bg-gradient-to-br from-amber-500/20 via-amber-600/10 to-orange-500/15 p-4 text-center">
      <div className="absolute -top-8 -right-6 w-28 h-28 bg-amber-400/20 blur-2xl rounded-full pointer-events-none" />
      <Hammer className="w-7 h-7 text-amber-300 mx-auto mb-1.5" />
      <p className="relative text-[26px] sm:text-[31px] font-black leading-tight tracking-tight text-amber-200 font-sans uppercase">
        Don't forget to put nails!!
      </p>
      <p className="relative text-[14.5px] text-amber-100/80 mt-1.5 leading-snug">
        Hold the mouse on your climber's body for <strong className="text-amber-200">2 seconds</strong> to hammer one in.
        It needs all four limbs on green jugs. A nail catches you when you fall past it — without one you drop all the way
        to the mats.
      </p>
    </div>

    {/* ── Basic control ───────────────────────────────────────────────────── */}
    <section>
      <h3 className="text-[13px] uppercase tracking-wider font-bold text-sky-300 mb-2 font-sans flex items-center gap-1.5">
        <MousePointerClick className="w-3.5 h-3.5" /> Moving
      </h3>
      <p className="text-[15px] text-slate-300 leading-relaxed">
        Click a hand or foot to select it, then click a highlighted hold to move it there. Selection auto-cycles
        clockwise: <span className="font-mono text-slate-200">LH → RH → RF → LF</span>. Only holds inside the yellow
        reach arc are within range.
      </p>
    </section>

    {/* ── Hold key, drawn exactly like the wall ───────────────────────────── */}
    <section>
      <h3 className="text-[13px] uppercase tracking-wider font-bold text-sky-300 mb-2 font-sans">
        The holds on your wall
      </h3>
      <div className="space-y-2">
        {HOLDS.map(h => (
          <div key={h.kind} className={`flex items-center gap-3 p-2 rounded-xl border ${h.tone} ${h.border}`}>
            <HoldSwatch kind={h.kind} />
            <div className="min-w-0">
              <h4 className="text-[15px] font-bold text-slate-100">{h.name}</h4>
              <p className="text-[13.5px] text-slate-400 leading-snug">{h.text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>

    {/* ── The rock trade-off ──────────────────────────────────────────────── */}
    <section>
      <h3 className="text-[13px] uppercase tracking-wider font-bold text-rose-400 mb-2 font-sans flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5" /> Placing a rock
      </h3>
      <div className="flex items-start gap-3 p-3 rounded-xl border border-rose-500/30 bg-rose-950/30">
        <HoldSwatch kind="rock" />
        <div className="min-w-0 text-[14.5px] leading-relaxed text-slate-300">
          <p>
            <strong className="text-slate-100">Double-tap your climber's body</strong> to slam a new rock into the wall
            about a metre above you. It's there to <strong className="text-emerald-300">ease your climb</strong> — an
            extra hold exactly where the route gave you none.
          </p>
          <p className="mt-1.5 text-rose-200">
            <strong>But it costs you:</strong> the effort rips you off the wall and your climber
            <strong> falls immediately — down to your last nail.</strong> If you haven't hammered one in, you fall all
            the way to the crash mats and start again from the bottom.
          </p>
        </div>
      </div>
    </section>

    {/* ── Everything else ─────────────────────────────────────────────────── */}
    <section>
      <h3 className="text-[13px] uppercase tracking-wider font-bold text-sky-300 mb-2 font-sans">Staying on the wall</h3>
      <ul className="text-[14.5px] space-y-2 text-slate-300">
        <li className="flex gap-2">
          <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-slate-100">Don't skip footholds.</strong> Climbing on arms alone (campusing) burns
            stamina fast — step your feet up as you go.
          </span>
        </li>
        <li className="flex gap-2">
          <Target className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-slate-100">Chalk up</strong> with{' '}
            <kbd className="px-1 text-slate-100 bg-slate-800 rounded font-mono text-[13px]">Space</kbd> — or tap the{' '}
            <strong className="text-sky-300">chalk bag button on the top right of the wall</strong>, which is the way
            to do it on a phone — to halve your grip drain for 5 seconds and claw back some stamina.{' '}
            <strong className="text-sky-300">Your chalk must be at 70% to use it, and one use drains 70%</strong> —
            leaving the bag empty. It refills slowly (~3%/s) only while you hang steady with your feet on the wall,
            so you get one dip roughly every 23 seconds. Spend it wisely.
          </span>
        </li>
        <li className="flex gap-2">
          <Hammer className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-slate-100">Nail as you go.</strong> Every nail is a checkpoint — the higher your
            last one, the less a fall costs you.
          </span>
        </li>
      </ul>
    </section>
  </div>
);
