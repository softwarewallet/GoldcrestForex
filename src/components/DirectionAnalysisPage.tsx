import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity, ArrowDownRight, ArrowUpRight, BarChart2, CheckCircle2,
  ChevronRight, Compass, Cpu, Database, Eye, Filter, RefreshCw,
  Scale, ShieldAlert, Sparkles, TrendingDown, TrendingUp, Zap
} from 'lucide-react';
import { QuantitativePredictionResult } from '../ml/direction/types';

export const DirectionAnalysisPage: React.FC = () => {
  const [selectedPair, setSelectedPair] = useState<string>('EUR/USD');
  const [horizon, setHorizon] = useState<string>('15M');
  const [analysis, setAnalysis] = useState<QuantitativePredictionResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchAnalysis = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/direction/analysis?pair=${selectedPair}&horizon=${horizon}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success && data.analysis) {
        setAnalysis(data.analysis);
      }
    } catch (err) {
      console.warn('Error fetching direction analysis:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedPair, horizon]);

  useEffect(() => {
    fetchAnalysis();
  }, [fetchAnalysis]);

  const pairs = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD', 'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'XAU/USD'];

  return (
    <div id="direction_analysis_page" className="space-y-4 font-mono text-slate-100">
      {/* Header & Pair Selector */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-950 border border-cyan-700 flex items-center justify-center shrink-0">
            <Compass className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-white">QUANTITATIVE DIRECTION & FUSION ENGINE</h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-700">
                PHASES 2–30
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Multi-framework independent component calculation, evidence conflict detection, and probability calibration.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={selectedPair}
            onChange={e => setSelectedPair(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 text-xs font-bold"
          >
            {pairs.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            {['5M', '15M', '1H', '4H'].map(h => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                className={`px-2.5 py-1 rounded font-bold transition text-xs ${
                  horizon === h ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {h}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={fetchAnalysis}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold transition flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>REFRESH</span>
          </button>
        </div>
      </div>

      {analysis && (
        <>
          {/* Main Direction Result Scorecard */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <div className="text-[10px] text-slate-500 uppercase font-bold">FINAL QUANTITATIVE DIRECTION</div>
              <div className="my-2 flex items-center gap-2">
                <span className={`text-2xl font-bold ${
                  analysis.finalDirection === 'BUY' ? 'text-emerald-400' :
                  analysis.finalDirection === 'SELL' ? 'text-rose-400' :
                  'text-amber-400'
                }`}>
                  {analysis.finalDirection}
                </span>
              </div>
              <div className="text-[10px] text-slate-400">
                Regime: <span className="text-white font-bold">{analysis.marketRegime}</span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <div className="text-[10px] text-slate-500 uppercase font-bold">PROBABILITY UP vs DOWN</div>
              <div className="my-2 flex items-center justify-between text-xs font-bold">
                <span className="text-emerald-400">UP: {(analysis.probabilityUp * 100).toFixed(1)}%</span>
                <span className="text-rose-400">DOWN: {(analysis.probabilityDown * 100).toFixed(1)}%</span>
              </div>
              <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden flex">
                <div className="bg-emerald-500 h-full" style={{ width: `${analysis.probabilityUp * 100}%` }} />
                <div className="bg-rose-500 h-full" style={{ width: `${analysis.probabilityDown * 100}%` }} />
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <div className="text-[10px] text-slate-500 uppercase font-bold">SIGNAL CONFLICT LEVEL</div>
              <div className="my-2 text-lg font-bold text-cyan-300">
                {(analysis.conflictRatio * 100).toFixed(0)}% Conflict
              </div>
              <div className="text-[10px] text-slate-400">
                Agreement: <span className="text-white font-bold">{(analysis.signalAgreement * 100).toFixed(0)}%</span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <div className="text-[10px] text-slate-500 uppercase font-bold">COST-ADJUSTED EXPECTED R</div>
              <div className="my-2 text-lg font-bold text-emerald-400">
                +{analysis.expectedR} R
              </div>
              <div className="text-[10px] text-slate-400">
                Spread Buffer: <span className="text-white font-bold">{analysis.costAdjustedSpreadPips} pips</span>
              </div>
            </div>
          </div>

          {/* Component Scorecards Grid */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span>Independent Component Breakdown (-1.0 to +1.0)</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(analysis.components).map(([name, comp]) => (
                <div key={name} className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-white">{name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      comp.dataQuality === 'AVAILABLE' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-900 text-slate-400'
                    }`}>
                      {comp.dataQuality}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className={comp.score > 0 ? 'text-emerald-400 font-bold' : comp.score < 0 ? 'text-rose-400 font-bold' : 'text-slate-400'}>
                      Score: {comp.score > 0 ? '+' : ''}{comp.score}
                    </span>
                    <span className="text-cyan-300 text-[10px]">Conf: {(comp.confidence * 100).toFixed(0)}%</span>
                  </div>

                  <p className="text-[10px] text-slate-400 line-clamp-2 mt-1">
                    {comp.explanation}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Champion vs Challenger Shadow Mode Comparison */}
          {analysis.championVsChallenger && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Scale className="w-4 h-4 text-amber-400" />
                <span>Champion (Existing Model) vs Challenger (Quantitative Direction Engine)</span>
              </h2>

              <div className="grid md:grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                  <div className="text-slate-500 text-[10px]">CHAMPION PRODUCTION MODEL</div>
                  <div className="text-white font-bold text-base">
                    {analysis.championVsChallenger.championDirection}
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    Probability: {(analysis.championVsChallenger.championProbability * 100).toFixed(1)}%
                  </div>
                </div>

                <div className="bg-slate-950 p-3 rounded-lg border border-cyan-900/60 space-y-1">
                  <div className="text-cyan-400 text-[10px]">CHALLENGER QUANTITATIVE ENGINE (SHADOW MODE)</div>
                  <div className="text-cyan-300 font-bold text-base">
                    {analysis.championVsChallenger.challengerDirection}
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    Probability UP: {(analysis.championVsChallenger.challengerProbability * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
