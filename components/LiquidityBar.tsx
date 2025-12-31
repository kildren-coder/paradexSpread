import React from 'react';

interface LiquidityBarProps {
  bidSize: number;
  askSize: number;
  totalUsd: number;
}

export const LiquidityBar: React.FC<LiquidityBarProps> = ({ bidSize, askSize, totalUsd }) => {
  const total = bidSize + askSize;
  const bidPct = total > 0 ? (bidSize / total) * 100 : 50;
  
  // Format very small or large numbers
  const formatNum = (num: number) => {
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toFixed(2);
  };

  const formatUsd = (num: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
  };

  return (
    <div className="flex flex-col w-full max-w-[200px]">
      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
        <span className="text-emerald-400 font-mono">{formatNum(bidSize)}</span>
        <span className="font-semibold text-slate-500">{formatUsd(totalUsd)}</span>
        <span className="text-rose-400 font-mono">{formatNum(askSize)}</span>
      </div>
      <div className="flex h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
        <div 
          className="bg-emerald-500 h-full transition-all duration-300" 
          style={{ width: `${bidPct}%` }} 
        />
        <div 
          className="bg-rose-500 h-full transition-all duration-300 flex-1" 
        />
      </div>
    </div>
  );
};
