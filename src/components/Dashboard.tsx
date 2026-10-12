import React from 'react';
import { 
  LayoutDashboard, 
  Globe, 
  Target, 
  Zap, 
  ShieldCheck, 
  Clock 
} from 'lucide-react';
import { ForexDashboard } from './ForexDashboard';
import { TradingSignal, Candle } from '../markets/common/types';

import { ConnectionHealthWidget } from './ConnectionHealthWidget';

interface DashboardProps {
  forexPairs: any[];
  indianUnderlyings?: any[];
  candlesMap: Record<string, Candle[]>;
  onSelectSignal: (signal: TradingSignal) => void;
  onEnsureCandles: (symbol: string) => Promise<void>;
  initialOptionSymbol?: string;
  environment?: string;
}

export const Dashboard: React.FC<DashboardProps> = ({
  forexPairs,
  candlesMap,
  onSelectSignal,
  onEnsureCandles,
  environment = 'LIVE'
}) => {
  // Compute summary stats for G10 Forex pairs & 3-Step Pullback Bounce Strategy
  const activeForexSignalsCount = forexPairs.filter(p => {
    const dir = String(p.signal?.direction || p.direction || '').toUpperCase();
    return p.signal && (p.signal.status === 'ACTIVE' || ['BUY', 'SELL', 'TRADE_BUY', 'TRADE_SELL'].includes(dir));
  }).length;
  const readyBounceCount = forexPairs.filter(p => {
    const state = p.bounceStrategy?.setupState || p.signal?.bounceStrategy?.setupState || p.signal?.setupState || p.setupState;
    return state === 'READY_TO_ENTER';
  }).length;

  return (
    <div id="unified_dashboard_view" className="space-y-6">
      {/* Top Executive Dashboard KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono" style={{ marginBottom: '0px' }}>
        <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-sm flex items-center justify-between" style={{ padding: '5px 16px', marginBottom: '10px' }}>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Forex Dashboard Engine</div>
            <div className="text-lg font-bold text-slate-100 mt-1 flex items-center space-x-2">
              <span>G10 FX Terminal</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            </div>
            <div className="text-[11px] text-emerald-400 mt-0.5">3-Step 5M 50 EMA Strategy Active</div>
          </div>
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
            <LayoutDashboard className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-sm flex items-center justify-between" style={{ padding: '5px 16px', marginBottom: '10px' }}>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Ready Setups (5M EMA)</div>
            <div className="font-bold text-slate-100 mt-1">
              {readyBounceCount} <span style={{ fontSize: '16px' }} className="font-normal text-slate-400">/ {forexPairs.length} Pairs</span>
            </div>
            <div className="text-[11px] text-sky-400 mt-0.5">Strict Trend & Rejection Filter</div>
          </div>
          <div className="p-3 bg-sky-500/10 border border-sky-500/20 rounded-lg text-sky-400">
            <Target className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-sm flex items-center justify-between" style={{ padding: '5px 16px', marginBottom: '10px' }}>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Active Forex Signals</div>
            <div className="text-xl font-bold text-slate-100 mt-1">
              {activeForexSignalsCount} <span className="text-xs font-normal text-slate-400">Signals</span>
            </div>
            <div className="text-slate-400 mt-0.5" style={{ fontSize: '9px' }}>Automated Execution Ready</div>
          </div>
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400">
            <Zap className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-sm flex items-center justify-between" style={{ padding: '5px 16px', marginBottom: '10px' }}>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Risk Environment</div>
            <div className="text-xl font-bold text-emerald-400 mt-1">
              {environment}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">Live Broker Routing Connected</div>
          </div>
          <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg text-purple-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Dashboard Header Bar */}
      <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-4 shadow-md font-mono" style={{ marginBottom: '8px', paddingTop: '5px', paddingBottom: '5px' }}>
        <div className="flex items-center space-x-2 text-xs font-bold text-slate-200">
          <Globe className="w-4 h-4 text-emerald-400" />
          <span>G10 FOREX MARKETS & 3-STEP PULLBACK BOUNCE PROTOCOL</span>
        </div>
        <div className="hidden sm:flex items-center space-x-2 text-[11px] text-slate-400">
          <Clock className="w-3.5 h-3.5 text-emerald-400" />
          <span>Multi-Timeframe 5M/15M/1H Engine</span>
        </div>
      </div>

      {/* Forex Dashboard Main View */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 transition-all duration-200">
          <ForexDashboard
            pairs={forexPairs}
            onSelectSignal={onSelectSignal}
            candlesMap={candlesMap}
            onEnsureCandles={onEnsureCandles}
            environment={environment}
          />
        </div>
        <div className="lg:col-span-1">
          <ConnectionHealthWidget />
        </div>
      </div>
    </div>
  );
};
