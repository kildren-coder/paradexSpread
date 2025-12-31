import React, { useEffect, useState, useMemo } from 'react';
import { Activity, ArrowUpRight, Filter, Info, ShieldCheck, Zap } from 'lucide-react';
import { paradexService } from './services/paradexService';
import { MarketTicker } from './types';
import { SpreadIndicator } from './components/SpreadIndicator';
import { LiquidityBar } from './components/LiquidityBar';

const App: React.FC = () => {
  const [markets, setMarkets] = useState<MarketTicker[]>([]);
  const [filterTightOnly, setFilterTightOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = paradexService.subscribe((data) => {
      setMarkets(data);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const sortedMarkets = useMemo(() => {
    let data = [...markets];
    
    // Sort by spread percentage (ascending - tightest first)
    data.sort((a, b) => a.spreadPct - b.spreadPct);

    if (filterTightOnly) {
      // Show only spreads <= 0.005% for the filter view
      data = data.filter(m => m.spreadPct <= 0.00005);
    }
    
    return data;
  }, [markets, filterTightOnly]);

  const bestMarket = sortedMarkets[0];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
              <Zap className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Paradex <span className="text-emerald-400">Scanner</span></h1>
              <p className="text-xs text-slate-500 flex items-center gap-1">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                Live Market Data
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setFilterTightOnly(!filterTightOnly)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                filterTightOnly 
                  ? 'bg-emerald-500 text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.4)]' 
                  : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
              }`}
            >
              <Filter className="w-4 h-4" />
              {filterTightOnly ? 'Showing Prime Only' : 'Show All Markets'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        
        {/* Hero / Stats Area */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Stat 1: Best Spread */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <ShieldCheck className="w-24 h-24 text-emerald-500" />
            </div>
            <h3 className="text-slate-500 text-sm font-medium mb-2">Tightest Market Spread</h3>
            {bestMarket ? (
              <div>
                <div className="text-3xl font-bold text-white mb-1">{bestMarket.symbol}</div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <span className="text-2xl font-mono">{(bestMarket.spreadPct * 100).toFixed(4)}%</span>
                  <span className="text-xs px-1.5 py-0.5 bg-emerald-500/10 rounded border border-emerald-500/20">PRIME</span>
                </div>
              </div>
            ) : (
              <div className="animate-pulse h-16 bg-slate-800 rounded"></div>
            )}
          </div>

          {/* Stat 2: Opportunity */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 relative overflow-hidden">
            <h3 className="text-slate-500 text-sm font-medium mb-2">Zero-Spread Liquidity</h3>
             {bestMarket ? (
              <div>
                 <div className="text-3xl font-bold text-white mb-1">
                   {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
                     markets.reduce((acc, m) => m.spreadPct <= 0.00001 ? acc + m.liquidityInTightRange.totalUsd : acc, 0)
                   )}
                 </div>
                 <p className="text-sm text-slate-400">Available instantly @ ≤ 0.001% spread</p>
              </div>
             ) : (
               <div className="animate-pulse h-16 bg-slate-800 rounded"></div>
             )}
          </div>

          {/* Stat 3: Info */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 rounded-xl p-6 text-sm text-slate-300">
            <div className="flex items-center gap-2 mb-3 text-white font-medium">
              <Info className="w-5 h-5 text-blue-400" />
              How it works
            </div>
            <p className="opacity-80 leading-relaxed">
              Scanning for <span className="text-emerald-400 font-bold">Ultra-Tight Spreads (0-0.001%)</span> via <span className="text-white">Paradex WebSocket</span>. 
              Liquidity depth is calculated by aggregating real-time order book volume strictly within 1 basis point deviation from the mid-price.
            </p>
          </div>
        </div>

        {/* Main Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950/50 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                  <th className="p-4 font-medium">Market</th>
                  <th className="p-4 font-medium">Price (USD)</th>
                  <th className="p-4 font-medium">Spread %</th>
                  <th className="p-4 font-medium">Spread (Abs)</th>
                  <th className="p-4 font-medium">
                    <div className="flex items-center gap-1">
                       Depth @ 0.001%
                       <span className="text-[10px] normal-case tracking-normal text-slate-600 bg-slate-800 px-1 rounded">Bid / Ask</span>
                    </div>
                  </th>
                  <th className="p-4 font-medium text-right">Est. USD Depth</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="p-4"><div className="h-4 w-24 bg-slate-800 rounded"></div></td>
                      <td className="p-4"><div className="h-4 w-16 bg-slate-800 rounded"></div></td>
                      <td className="p-4"><div className="h-8 w-32 bg-slate-800 rounded"></div></td>
                      <td className="p-4"><div className="h-4 w-12 bg-slate-800 rounded"></div></td>
                      <td className="p-4"><div className="h-4 w-40 bg-slate-800 rounded"></div></td>
                      <td className="p-4"><div className="h-4 w-20 bg-slate-800 ml-auto rounded"></div></td>
                    </tr>
                  ))
                ) : sortedMarkets.length === 0 ? (
                   <tr>
                     <td colSpan={6} className="p-12 text-center text-slate-500">
                       No markets match the current criteria.
                     </td>
                   </tr>
                ) : (
                  sortedMarkets.map((market) => (
                    <tr 
                      key={market.symbol} 
                      className="group hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="p-4">
                        <div className="font-bold text-white flex items-center gap-2">
                          <div className={`w-1 h-8 rounded-full ${market.spreadPct <= 0.00001 ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-slate-700'}`}></div>
                          {market.symbol.replace('-PERP', '')}
                          <span className="text-[10px] text-slate-500 font-normal px-1 border border-slate-700 rounded">PERP</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="font-mono text-slate-300">
                          {market.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="p-4">
                        <SpreadIndicator spreadPct={market.spreadPct} spreadBasisPoints={market.spreadPct * 10000} />
                      </td>
                      <td className="p-4 font-mono text-sm text-slate-500">
                        {market.spread.toFixed(4)}
                      </td>
                      <td className="p-4">
                        <div className="opacity-80 group-hover:opacity-100 transition-opacity">
                          <LiquidityBar 
                            bidSize={market.liquidityInTightRange.bidSide} 
                            askSize={market.liquidityInTightRange.askSide}
                            totalUsd={market.liquidityInTightRange.totalUsd}
                          />
                        </div>
                      </td>
                      <td className="p-4 text-right font-mono font-medium text-slate-300">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(market.liquidityInTightRange.totalUsd)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="bg-slate-950 p-3 text-center text-xs text-slate-600 border-t border-slate-800">
            Note: "Depth @ 0.001%" represents aggregated volume within ±0.001% of the mid-price. 
            Data source: Paradex WebSocket API.
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;