/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Mountain, TrendingDown } from 'lucide-react';
import { CLIMBS } from '../climbs';
import { sectionGreenShare, sectionHoldCount } from '../utils';

interface Props {
  value: number;
  onPick: (climb: number) => void;
  disabled?: boolean;
  /** Four small buttons instead of four cards, for inline use in a form. */
  compact?: boolean;
}

export const ClimbPicker: React.FC<Props> = ({ value, onPick, disabled = false, compact = false }) => {
  if (compact) {
    return (
      <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800/80">
        {CLIMBS.map(c => (
          <button
            key={c.id}
            disabled={disabled}
            onClick={() => onPick(c.id)}
            className={`px-2 py-1.5 text-left rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              value === c.id ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="block text-[11px] font-mono uppercase tracking-wider opacity-70">Climb {c.id}</span>
            <span className="block text-[13px] font-bold tracking-tight truncate">{c.name}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {CLIMBS.map(c => (
        <button
          key={c.id}
          disabled={disabled}
          onClick={() => onPick(c.id)}
          className={`text-left p-4 rounded-2xl border transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            value === c.id
              ? 'bg-emerald-950/40 border-emerald-400/60 shadow-lg shadow-emerald-500/5'
              : 'bg-slate-950/70 border-slate-800 hover:border-slate-600'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Mountain className={`w-4 h-4 shrink-0 ${value === c.id ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span className="font-mono text-[11.5px] uppercase tracking-wider text-slate-500">Climb {c.id}</span>
            <span className="ml-auto font-mono text-[11.5px] text-slate-500">200m</span>
          </div>
          <span className="block font-bold text-[18px] text-white font-sans leading-tight">{c.name}</span>
          <span className="block text-[13.5px] text-slate-400 leading-snug mt-0.5">{c.blurb}</span>
        </button>
      ))}
    </div>
  );
};

/**
 * What every wall does to you on the way up. The numbers come straight from the
 * generator, so this cannot drift away from the route you actually get.
 */
export const ClimbRamp: React.FC = () => {
  const rows = [0, 1, 2, 3, 4, 8];
  return (
    <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4">
      <h3 className="text-[12.5px] uppercase tracking-wider text-slate-400 font-bold mb-2.5 flex items-center gap-1.5 font-sans">
        <TrendingDown className="w-3.5 h-3.5 text-amber-400" />
        Every wall gets harder as you climb
      </h3>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {rows.map(s => (
          <div key={s} className="shrink-0 px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-center min-w-[74px]">
            <div className="font-mono text-[11.5px] text-slate-500">{s * 5}–{s * 5 + 5}m</div>
            <div className="font-mono text-[15.5px] font-extrabold text-emerald-400">
              {Math.round(sectionGreenShare(s) * 100)}%
            </div>
            <div className="font-mono text-[11.5px] text-slate-400">{sectionHoldCount(s)} holds</div>
          </div>
        ))}
        <div className="shrink-0 px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-center min-w-[74px]">
          <div className="font-mono text-[11.5px] text-slate-500">50m+</div>
          <div className="font-mono text-[15.5px] font-extrabold text-rose-400">50%</div>
          <div className="font-mono text-[11.5px] text-slate-400">10 holds</div>
        </div>
      </div>
      <p className="text-[13px] text-slate-500 mt-2 leading-snug">
        Every 5m the wall loses 5% of its green jugs and two of its holds, until it settles at half
        green and ten holds per section. 200m to the top — the route never repeats before then.
      </p>
    </div>
  );
};
