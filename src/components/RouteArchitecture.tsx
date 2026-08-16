/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Settings, Timer } from 'lucide-react';
import { RoomSettings } from '../net';

interface Props {
  settings: RoomSettings;
  /** Host in the lobby, or anyone filling in the create-game form. */
  editable: boolean;
  onChange: (patch: Partial<RoomSettings>) => void;
  /** The "set by host" badge — only meaningful once a room exists. */
  showHostBadge?: boolean;
  className?: string;
}

export const randomSeed = () =>
  `ROUTE_${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

/**
 * Difficulty / height / seed picker. Used twice: as a card in the lobby's left
 * column, and inline in the create-game form so the host chooses the route
 * before the room exists.
 */
export const RouteArchitecture: React.FC<Props> = ({
  settings,
  editable,
  onChange,
  showHostBadge = false,
  className = 'bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl',
}) => (
  <div className={className}>
    <h3 className="text-[15.5px] uppercase tracking-wider text-slate-400 font-bold mb-3.5 flex items-center gap-1.5 font-sans">
      <Settings className="w-3.5 h-3.5 text-sky-400" />
      Route Architecture
      {showHostBadge && (
        <span className="ml-auto text-[11.5px] font-mono text-amber-400/80 border border-amber-500/20 rounded px-1">
          set by host
        </span>
      )}
    </h3>

    <div className="space-y-4 text-[15.5px] font-sans">
      {/* Difficulty */}
      <div>
        <label className="text-slate-400 block mb-1.5 font-medium">Gym Grade Route</label>
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800/80">
          {(['easy', 'medium', 'hard'] as const).map(d => (
            <button
              key={d}
              disabled={!editable}
              onClick={() => onChange({ difficulty: d })}
              className={`py-1 text-center font-bold tracking-tight rounded-lg uppercase text-[12.5px] transition-all cursor-pointer ${
                settings.difficulty === d ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Target height */}
      <div>
        <div className="flex justify-between items-center mb-1.5 text-slate-400">
          <label className="font-medium">Target Height</label>
          <span className="font-mono text-sky-400 font-bold">{settings.wallHeight / 100}m</span>
        </div>
        <div className="grid grid-cols-4 gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800/80">
          {([1000, 2000, 3000, 4000] as const).map(h => (
            <button
              key={h}
              disabled={!editable}
              onClick={() => onChange({ wallHeight: h })}
              className={`py-1 text-center font-bold tracking-tight rounded-lg text-[12.5px] transition-all cursor-pointer ${
                settings.wallHeight === h ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            >
              {h / 100}m
            </button>
          ))}
        </div>
      </div>

      {/* Time limit */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-950/60 rounded-xl border border-slate-800">
        <div className="flex items-center gap-1.5 text-slate-400">
          <Timer className="w-3.5 h-3.5 text-sky-400" />
          <span className="font-medium">Time Limit</span>
        </div>
        <span className="font-mono text-sky-400 font-bold">3:00</span>
      </div>

      {/* Seed */}
      <div>
        <div className="flex justify-between items-center mb-1">
          <label className="text-slate-400 font-medium">Route Seed</label>
          {editable && (
            <button
              onClick={() => onChange({ seed: randomSeed() })}
              className="text-[13px] text-sky-400 hover:text-sky-300 transition-all font-semibold uppercase shrink-0"
            >
              Reseed
            </button>
          )}
        </div>
        <input
          type="text"
          value={settings.seed}
          disabled={!editable}
          onChange={e => onChange({ seed: e.target.value.replace(/\s+/g, '_').substring(0, 16) })}
          className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700/60 rounded-xl px-3 py-1.5 font-mono text-[15.5px] text-sky-300 tracking-wide font-bold outline-none focus:border-sky-500 uppercase disabled:opacity-60 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  </div>
);
