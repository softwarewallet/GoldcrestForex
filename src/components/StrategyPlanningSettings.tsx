import React, { useState, useEffect } from 'react';
import { Sparkles, CheckCircle2, ShieldAlert, Sliders, ToggleLeft, ToggleRight, Zap } from 'lucide-react';

export interface StrategyConfig {
  id: string;
  name: string;
  category: string;
  description: string;
  enabled: boolean;
  maxLotSize: number;
  stopLossPips: number;
  takeProfitPips: number;
  recommendedHours: string;
}

const DEFAULT_STRATEGIES: StrategyConfig[] = [
  {
    id: 'london_breakout',
    name: 'London Breakout Momentum',
    category: 'Breakout / Volatility',
    description: 'Capitalizes on volatility expansion during European market open (07:00 - 10:00 UTC) with automated trailing stop-loss.',
    enabled: true,
    maxLotSize: 1.0,
    stopLossPips: 25,
    takeProfitPips: 50,
    recommendedHours: '07:00 - 10:00 UTC'
  },
  {
    id: 'ny_overlap_trend',
    name: 'New York Overlap Trend Following',
    category: 'Trend / Session Overlap',
    description: 'Trades major pairs and gold during US/London liquidity overlap (12:00 - 16:00 UTC) with moving average trend confirmation.',
    enabled: true,
    maxLotSize: 2.0,
    stopLossPips: 30,
    takeProfitPips: 75,
    recommendedHours: '12:00 - 16:00 UTC'
  },
  {
    id: 'asian_mean_reversion',
    name: 'Asian Session Range Reversion',
    category: 'Mean Reversion',
    description: 'Fades early session liquidity extremes during Asian hours (00:00 - 05:00 UTC) on USD/JPY and AUD/USD.',
    enabled: false,
    maxLotSize: 0.5,
    stopLossPips: 20,
    takeProfitPips: 30,
    recommendedHours: '00:00 - 05:00 UTC'
  },
  {
    id: 'news_volatility_gate',
    name: 'High-Impact News Volatility Gate',
    category: 'Risk Management',
    description: 'Automatically pauses execution or restricts size 15 minutes before tier-1 macro announcements (FOMC, NFP, CPI).',
    enabled: true,
    maxLotSize: 0.5,
    stopLossPips: 15,
    takeProfitPips: 30,
    recommendedHours: 'All Sessions'
  },
  {
    id: 'dynamic_pip_scalper',
    name: 'Dynamic ATR Pip-Target Scalper',
    category: 'Scalping',
    description: 'Calculates dynamic take-profit and stop-loss targets based on current 1-minute Average True Range (ATR) volatility.',
    enabled: false,
    maxLotSize: 1.5,
    stopLossPips: 10,
    takeProfitPips: 20,
    recommendedHours: '08:00 - 20:00 UTC'
  }
];

export const StrategyPlanningSettings: React.FC = () => {
  const [strategies, setStrategies] = useState<StrategyConfig[]>(() => {
    try {
      const saved = localStorage.getItem('goldcrest_strategy_planning_configs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_STRATEGIES;
  });

  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('goldcrest_strategy_planning_configs', JSON.stringify(strategies));
    } catch {}
  }, [strategies]);

  const handleToggle = (id: string) => {
    setStrategies(prev =>
      prev.map(s => {
        if (s.id === id) {
          const updatedState = !s.enabled;
          setMessage(`Strategy "${s.name}" is now ${updatedState ? 'ENABLED' : 'DISABLED'}.`);
          setTimeout(() => setMessage(null), 3000);
          return { ...s, enabled: updatedState };
        }
        return s;
      })
    );
  };

  const handleParamChange = (id: string, field: keyof StrategyConfig, value: any) => {
    setStrategies(prev =>
      prev.map(s => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  return (
    <div className="space-y-4 font-mono text-slate-100">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Pre-Configured Trading Strategies & Planning Planner
            </h3>
          </div>
          <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[10px] font-bold">
            {strategies.filter(s => s.enabled).length} OF {strategies.length} ACTIVE
          </span>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Enable or disable pre-configured algorithmic strategy templates. Active strategies feed into automated trade execution gating and quantitative time-window edge planning.
        </p>

        {message && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{message}</span>
          </div>
        )}

        <div className="space-y-3">
          {strategies.map(strat => (
            <div
              key={strat.id}
              className={`p-4 rounded-xl border transition ${
                strat.enabled
                  ? 'bg-slate-950 border-cyan-900/80 shadow-sm'
                  : 'bg-slate-950/40 border-slate-800/80 opacity-75'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${strat.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                    <h4 className="text-sm font-bold text-white">{strat.name}</h4>
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400 font-semibold">
                      {strat.category}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-3xl">
                    {strat.description}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggle(strat.id)}
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold text-xs border transition ${
                      strat.enabled
                        ? 'bg-emerald-600 border-emerald-500 text-white shadow'
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {strat.enabled ? <ToggleRight className="w-4 h-4 text-white" /> : <ToggleLeft className="w-4 h-4 text-slate-400" />}
                    <span>{strat.enabled ? 'ACTIVE' : 'DISABLED'}</span>
                  </button>
                </div>
              </div>

              {/* Parameters Bar */}
              <div className="mt-4 pt-3 border-t border-slate-800/80 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] uppercase text-slate-500 font-bold mb-1">Recommended Hours</label>
                  <div className="text-slate-200 font-semibold">{strat.recommendedHours}</div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase text-slate-500 font-bold mb-1">Max Lot Size</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="10.0"
                    value={strat.maxLotSize}
                    onChange={e => handleParamChange(strat.id, 'maxLotSize', Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-white font-mono text-xs outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase text-slate-500 font-bold mb-1">Stop Loss (Pips)</label>
                  <input
                    type="number"
                    min="5"
                    max="200"
                    value={strat.stopLossPips}
                    onChange={e => handleParamChange(strat.id, 'stopLossPips', Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-white font-mono text-xs outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase text-slate-500 font-bold mb-1">Take Profit (Pips)</label>
                  <input
                    type="number"
                    min="5"
                    max="500"
                    value={strat.takeProfitPips}
                    onChange={e => handleParamChange(strat.id, 'takeProfitPips', Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-white font-mono text-xs outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
