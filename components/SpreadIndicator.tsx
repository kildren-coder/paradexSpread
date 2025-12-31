import React from 'react';
import { SpreadStatus } from '../types';

interface Props {
  spreadPct: number;
  spreadBasisPoints: number;
}

export const SpreadIndicator: React.FC<Props> = ({ spreadPct, spreadBasisPoints }) => {
  let status = SpreadStatus.WIDE;
  let colorClass = "text-slate-500 bg-slate-900 border-slate-700";
  let label = "WIDE";

  if (spreadPct <= 0.00001) { // 0.001%
    status = SpreadStatus.ULTRA_TIGHT;
    colorClass = "text-emerald-400 bg-emerald-950/30 border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.2)]";
    label = "PRIME";
  } else if (spreadPct <= 0.0001) { // 0.01%
    status = SpreadStatus.TIGHT;
    colorClass = "text-blue-400 bg-blue-950/30 border-blue-500/50";
    label = "TIGHT";
  } else {
    status = SpreadStatus.NORMAL;
    colorClass = "text-yellow-500 bg-yellow-950/20 border-yellow-700/50";
    label = "FAIR";
  }

  if (spreadPct > 0.0005) {
    colorClass = "text-slate-400 bg-slate-800 border-slate-700 opacity-50";
    label = "WIDE";
  }

  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded border ${colorClass} transition-colors duration-300`}>
      <div className={`w-1.5 h-1.5 rounded-full ${status === SpreadStatus.ULTRA_TIGHT ? 'bg-emerald-400 animate-pulse' : 'bg-current'}`}></div>
      <div className="flex flex-col leading-none">
        <span className="font-mono font-bold text-sm">
          {(spreadPct * 100).toFixed(4)}%
        </span>
        <span className="text-[9px] opacity-80 uppercase tracking-wider">{label}</span>
      </div>
    </div>
  );
};
