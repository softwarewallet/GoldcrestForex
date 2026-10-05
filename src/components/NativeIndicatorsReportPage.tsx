import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity, ArrowDownRight, ArrowUpRight, BarChart2, CheckCircle2,
  ChevronRight, Compass, Cpu, Database, Eye, Filter, RefreshCw,
  Scale, ShieldAlert, Sparkles, TrendingDown, TrendingUp, Zap
} from 'lucide-react';
import { NativeMTFMatrixResult, NativeInternalComparisonRecord } from '../services/cTraderNativeIndicatorService';

export const NativeIndicatorsReportPage: React.FC = () => {
  const [selectedPair, setSelectedPair] = useState<string>('EUR/USD');
  const [snapshot, setSnapshot] = useState<Record<string, any>>({});
  const [mtfMatrix, setMtfMatrix] = useState<NativeMTFMatrixResult | null>(null);
  const [comparison, setComparison] = useState<NativeInternalComparisonRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [snapRes, mtfRes, compRes] = await Promise.all([
        fetch(`/api/native-indicators/snapshot?pair=${selectedPair}&timeframe=15M`, { cache: 'no-store' }),
        fetch(`/api/native-indicators/mtf?pair=${selectedPair}`, { cache: 'no-store' }),
        fetch(`/api/native-indicators/comparison?pair=${selectedPair}`, { cache: 'no-store' })
      ]);

      const snapData = await snapRes.json();
      const mtfData = await mtfRes.json();
      const compData = await compRes.json();

      if (snapData.success) setSnapshot(snapData.indicators || {});
      if (mtfData.success) setMtfMatrix(mtfData.mtfMatrix);
      if (compData.success) setComparison(compData.comparison);
    } catch (err) {
      console.warn('Error fetching native indicators:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedPair]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const pairs = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD', 'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'XAU/USD'];

  return (
    <div id="native_indicators_page" className="space-y-4 font-mono text-slate-100">
      {/* Header & Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-950 border border-purple-700 flex items-center justify-center shrink-0">
            <Zap className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-white">cTRADER NATIVE INDICATOR INTELLIGENCE</h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-700">
                RESEARCH / SHADOW MODE
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Native cTrader indicator calculation streaming, cross-verification, and multi-timeframe matrix validation.
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

          <button
            type="button"
            onClick={fetchData}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold transition flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>REFRESH</span>
          </button>
        </div>
      </div>

      {/* Native Indicator Snapshot Cards */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Activity className="w-4 h-4 text-purple-400" />
          <span>cTrader Native Indicator Snapshot (Source: CTRADER_NATIVE)</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {Object.entries(snapshot).map(([name, ind]: [string, any]) => (
            <div key={name} className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-bold text-white">{name}</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-950 text-purple-300 border border-purple-800">
                  {ind.dataQuality}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Raw:</span>
                <span className="text-white font-bold">
                  {typeof ind.rawValue === 'object' ? JSON.stringify(ind.rawValue) : Number(ind.rawValue).toFixed(4)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Normalized:</span>
                <span className="text-cyan-300 font-bold">{ind.normalizedValue}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Native Multi-Timeframe Matrix */}
      {mtfMatrix && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-cyan-400" />
            <span>Native Multi-Timeframe Matrix ({mtfMatrix.pair})</span>
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {mtfMatrix.timeframes.map(tf => (
              <div key={tf} className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                <div className="text-slate-400 font-bold">{tf}</div>
                <div className="text-xs text-emerald-400 font-bold">Bullish Evidence: {mtfMatrix.nativeBullishEvidence}</div>
                <div className="text-xs text-rose-400 font-bold">Conflict: {(mtfMatrix.nativeConflictScore * 100).toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Native vs Internal Calculation Comparison */}
      {comparison && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Scale className="w-4 h-4 text-amber-400" />
            <span>Native vs Internal Calculation Comparison</span>
          </h2>

          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 grid sm:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-slate-500 text-[10px]">INDICATOR</div>
              <div className="text-white font-bold mt-0.5">{comparison.indicator}</div>
            </div>
            <div>
              <div className="text-slate-500 text-[10px]">NATIVE VALUE</div>
              <div className="text-purple-300 font-bold mt-0.5">{comparison.nativeValue}</div>
            </div>
            <div>
              <div className="text-slate-500 text-[10px]">INTERNAL VALUE</div>
              <div className="text-cyan-300 font-bold mt-0.5">{comparison.internalValue}</div>
            </div>
            <div>
              <div className="text-slate-500 text-[10px]">CLASSIFICATION</div>
              <div className={`font-bold mt-0.5 ${comparison.classification === 'MATCH' ? 'text-emerald-400' : 'text-amber-400'}`}>
                {comparison.classification} ({comparison.relativeDifference}%)
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
