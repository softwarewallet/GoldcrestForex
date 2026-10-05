// ============================================================================
// DYNAMIC EXIT ANALYSIS UI COMPONENT (PHASE 41)
// ============================================================================

import React, { useState } from 'react';
import { Sliders, CheckCircle, AlertTriangle, ArrowRight, Shield, Activity, Target } from 'lucide-react';
import { DynamicExitEngine } from '../ml/exits/dynamicExitEngine';
import { DynamicExitRecommendation } from '../ml/exits/types';

export const DynamicExitAnalysisPage: React.FC = () => {
  const [selectedPair, setSelectedPair] = useState<string>('EUR/USD');
  const [direction, setDirection] = useState<'UP' | 'DOWN'>('UP');

  const mockInput = {
    pair: selectedPair,
    direction: direction,
    horizon: '15M' as const,
    currentBid: 1.0850,
    currentAsk: 1.0851,
    spreadPips: 1.0,
    atrPips: 12.0,
    probabilityUp: direction === 'UP' ? 0.72 : 0.28,
    probabilityDown: direction === 'DOWN' ? 0.72 : 0.28,
    confidence: 0.72,
    nearestSupportPips: 18.0,
    nearestResistancePips: 11.0,
    regime: 'TRENDING_BULLISH'
  };

  const dynamicRec: DynamicExitRecommendation = DynamicExitEngine.calculateDynamicExit(mockInput);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm">
            <Sliders className="w-4 h-4" />
            <span>PHASE 41 — PREDICTION-BASED DYNAMIC EXIT ENGINE</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mt-1">
            Dynamic TP/SL Exit Analysis & Shadow Benchmark
          </h1>
          <p className="text-sm text-slate-400">
            Replaces fixed TP/SL assumptions with prediction-aware, probability-adjusted, cost-aware dynamic exit optimization.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedPair}
            onChange={(e) => setSelectedPair(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="EUR/USD">EUR/USD</option>
            <option value="GBP/USD">GBP/USD</option>
            <option value="USD/JPY">USD/JPY</option>
            <option value="EUR/GBP">EUR/GBP</option>
          </select>

          <button
            onClick={() => setDirection(d => d === 'UP' ? 'DOWN' : 'UP')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              direction === 'UP' ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/40' : 'bg-rose-600/20 text-rose-400 border border-rose-500/40'
            }`}
          >
            Direction: {direction === 'UP' ? 'BUY (UP)' : 'SELL (DOWN)'}
          </button>
        </div>
      </div>

      {/* Comparison Cards: Current Fixed vs Prediction-Aware Dynamic Exits */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Current Fixed Exit Model */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-300 flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-400" />
              <span>Current Exit Model (Fixed 10 Pips)</span>
            </h3>
            <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700">BASELINE</span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-xs text-slate-400">Target Distance (TP)</div>
              <div className="text-lg font-bold text-slate-200">10.0 pips</div>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-xs text-slate-400">Stop Distance (SL)</div>
              <div className="text-lg font-bold text-slate-200">10.0 pips</div>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-xs text-slate-400">Target Reach Prob</div>
              <div className="text-lg font-bold text-amber-400">58.0%</div>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-xs text-slate-400">Expected Net R</div>
              <div className="text-lg font-bold text-slate-300">+0.38 R</div>
            </div>
          </div>

          <div className="text-xs text-slate-400 bg-amber-950/20 border border-amber-800/40 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              Risk of Near-Target Reversal: Fixed 10 pip TP crosses structural resistance at 11 pips, causing reversals at +9.5 pips.
            </span>
          </div>
        </div>

        {/* Prediction-Aware Dynamic Exit Engine */}
        <div className="bg-slate-900/60 border border-indigo-500/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-indigo-300 flex items-center gap-2">
              <Target className="w-4 h-4 text-indigo-400" />
              <span>Dynamic Exit Engine (Prediction-Aware)</span>
            </h3>
            <span className="text-xs bg-indigo-950/80 text-indigo-300 px-2 py-0.5 rounded border border-indigo-700/50">CHALLENGER</span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-slate-950 p-3 rounded-lg border border-indigo-900/40">
              <div className="text-xs text-slate-400">Dynamic TP Distance</div>
              <div className="text-lg font-bold text-indigo-400">{dynamicRec.tpDistancePips} pips</div>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-indigo-900/40">
              <div className="text-xs text-slate-400">Dynamic SL Distance</div>
              <div className="text-lg font-bold text-rose-400">{dynamicRec.slDistancePips} pips</div>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-indigo-900/40">
              <div className="text-xs text-slate-400">Target Reach Prob</div>
              <div className="text-lg font-bold text-emerald-400">{(dynamicRec.tpProbability * 100).toFixed(0)}%</div>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-indigo-900/40">
              <div className="text-xs text-slate-400">Expected Net R</div>
              <div className="text-lg font-bold text-emerald-400">+{dynamicRec.expectedNetR} R</div>
            </div>
          </div>

          <div className="text-xs text-emerald-300 bg-emerald-950/20 border border-emerald-800/40 rounded-lg p-3 flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>{dynamicRec.exitConfidenceReason}</span>
          </div>
        </div>
      </div>

      {/* Candidate Pool Optimization Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
        <h3 className="font-semibold text-slate-200">
          Evaluated Exit Candidate Pool ({dynamicRec.candidatePool.length} Candidates Evaluated)
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase font-mono">
              <tr>
                <th className="p-3">TP Multiplier</th>
                <th className="p-3">SL Multiplier</th>
                <th className="p-3">TP Pips</th>
                <th className="p-3">SL Pips</th>
                <th className="p-3">R:R Ratio</th>
                <th className="p-3">P(TP Reach)</th>
                <th className="p-3">P(SL Hit)</th>
                <th className="p-3">Expected Net R</th>
                <th className="p-3">Selection</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {dynamicRec.candidatePool.slice(0, 8).map((cand, idx) => (
                <tr key={idx} className={idx === 0 ? 'bg-indigo-950/30 border-l-2 border-indigo-500 font-medium' : ''}>
                  <td className="p-3">{cand.tpMultiplier}x ATR</td>
                  <td className="p-3">{cand.slMultiplier}x ATR</td>
                  <td className="p-3 text-indigo-400">{cand.tpDistancePips} pips</td>
                  <td className="p-3 text-rose-400">{cand.slDistancePips} pips</td>
                  <td className="p-3">{cand.rrRatio}:1</td>
                  <td className="p-3 text-emerald-400">{(cand.tpProbability * 100).toFixed(0)}%</td>
                  <td className="p-3 text-rose-400">{(cand.slProbability * 100).toFixed(0)}%</td>
                  <td className={`p-3 font-bold ${cand.expectedNetR > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    +{cand.expectedNetR} R
                  </td>
                  <td className="p-3">
                    {idx === 0 ? (
                      <span className="bg-indigo-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">OPTIMAL</span>
                    ) : (
                      <span className="text-slate-500">Evaluated</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
