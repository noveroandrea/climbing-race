/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { HelpCircle } from 'lucide-react';
import { InstructionsContent } from './InstructionsContent';

interface InstructionsModalProps {
  onClose: () => void;
}

export const InstructionsModal: React.FC<InstructionsModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-fade-in" id="rules-modal">
      <div className="w-full max-w-xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl text-slate-100 shadow-2xl relative overflow-hidden" id="rules-panel">

        {/* Subtle glow background */}
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-500 via-sky-500 to-rose-500" />

        <div className="flex items-center gap-2 px-6 pt-6 pb-4 shrink-0">
          <HelpCircle className="w-6 h-6 text-sky-400" />
          <h2 className="text-[26px] font-bold font-sans tracking-tight">How to Climb</h2>
        </div>

        <div className="px-6 overflow-y-auto flex-1">
          <InstructionsContent />
        </div>

        <div className="p-6 pt-4 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold font-sans rounded-xl tracking-wide transition-all shadow-lg active:scale-95 cursor-pointer"
            id="rules-ok-btn"
          >
            Got it, let's climb!
          </button>
        </div>
      </div>
    </div>
  );
};
