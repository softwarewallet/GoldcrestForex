import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3,
  Calendar, CheckCircle2, ChevronRight, Clock, Database, Download,
  Eye, FileText, Filter, HelpCircle, Layers, RefreshCw, Search,
  ShieldAlert, Sparkles, TrendingDown, TrendingUp, XCircle, Zap
} from 'lucide-react';
import {
  FullForensicPredictionItem,
  DailyPredictionMetrics,
  PerformanceBreakdownGroup,
  ConfidenceCalibrationBucket,
  RollingDriftMetrics
} from '../ml/forensics/types';

export const PredictionForensicsPage: React.FC = () => {
  const [timeRange, setTimeRange] = useState<string>('7D');
  const [activeTab, setActiveTab] = useState<'GRID' | 'CALIBRATION' | 'BREAKDOWN' | 'DRIFT'>('GRID');
  const [summary, setSummary] = useState<DailyPredictionMetrics | null>(null);
  const [gridItems, setGridItems] = useState<FullForensicPredictionItem[]>([]);
  const [calibration, setCalibration] = useState<ConfidenceCalibrationBucket[]>([]);
  const [breakdown, setBreakdown] = useState<PerformanceBreakdownGroup[]>([]);
  const [breakdownDim, setBreakdownDim] = useState<string>('pair');
  const [drift, setDrift] = useState<RollingDriftMetrics | null>(null);
  const [selectedPrediction, setSelectedPrediction] = useState<FullForensicPredictionItem | null>(null);

  // Filters for Grid
  const [filterPair, setFilterPair] = useState<string>('ALL');
  const [filterRegime, setFilterRegime] = useState<string>('ALL');
  const [filterSession, setFilterSession] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(true);
  const [evaluating, setEvaluating] = useState<boolean>(false);

  const fetchForensicsData = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, gridRes, calRes, breakRes, driftRes] = await Promise.all([
        fetch(`/api/forensics/summary?range=${timeRange}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/forensics/grid?pair=${filterPair}&regime=${filterRegime}&session=${filterSession}&limit=100`, { cache: 'no-store' }).catch(() => null),
        fetch('/api/forensics/calibration', { cache: 'no-store' }).catch(() => null),
        fetch(`/api/forensics/breakdown?dimension=${breakdownDim}`, { cache: 'no-store' }).catch(() => null),
        fetch('/api/forensics/rolling-drift?window=50', { cache: 'no-store' }).catch(() => null)
      ]);

      if (sumRes?.ok) {
        const d = await sumRes.json();
        if (d.success) setSummary(d.summary);
      }
      if (gridRes?.ok) {
        const d = await gridRes.json();
        if (d.success) setGridItems(d.items || []);
      }
      if (calRes?.ok) {
        const d = await calRes.json();
        if (d.success) setCalibration(d.calibration || []);
      }
      if (breakRes?.ok) {
        const d = await breakRes.json();
        if (d.success) setBreakdown(d.breakdown || []);
      }
      if (driftRes?.ok) {
        const d = await driftRes.json();
        if (d.success) setDrift(d.drift || null);
      }
    } catch (err) {
      console.warn('Error fetching forensics data:', err);
    } finally {
      setLoading(false);
    }
  }, [timeRange, filterPair, filterRegime, filterSession, breakdownDim]);

  useEffect(() => {
    fetchForensicsData();
  }, [fetchForensicsData]);

  const handleEvaluateOutcomes = async () => {
    setEvaluating(true);
    try {
      await fetch('/api/forensics/evaluate-outcomes', { method: 'POST' });
      await fetchForensicsData();
    } catch (e) {
      console.warn('Evaluation failed:', e);
    } finally {
      setEvaluating(false);
    }
  };

  const handleDownloadReport = (format: 'markdown' | 'json' | 'csv') => {
    const url =
      format === 'markdown' ? '/api/forensics/report/markdown' :
      format === 'json' ? '/api/forensics/report/json' :
      '/api/forensics/export/csv';
    window.open(url, '_blank');
  };

  const filteredGrid = gridItems.filter(item => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.snapshot.predictionId.toLowerCase().includes(q) ||
      item.snapshot.pair.toLowerCase().includes(q) ||
      item.snapshot.marketRegime.toLowerCase().includes(q) ||
      (item.outcome?.actualOutcome || '').toLowerCase().includes(q) ||
      (item.forensics?.primaryFailureReason || '').toLowerCase().includes(q)
    );
  });

  return (
    <div id="prediction_forensics_page" className="space-y-4 font-mono text-slate-100">
      {/* Top Header & Range Switcher */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-950 border border-cyan-700 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-white">
                  PREDICTION FORENSICS & ACCURACY INTELLIGENCE
                </h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-700">
                  AUDIT & DIAGNOSTICS
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700">
                  IMMUTABLE SNAPSHOTS
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Objective empirical measurement of model predictions vs forward price evolution, excursion metrics, calibration, and root-cause failure attribution.
              </p>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Time Window Switcher */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
              {['TODAY', 'YESTERDAY', '7D', '30D', '90D'].map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setTimeRange(r)}
                  className={`px-2.5 py-1 rounded font-bold transition ${
                    timeRange === r ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleEvaluateOutcomes}
              disabled={evaluating}
              className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold transition flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${evaluating ? 'animate-spin' : ''}`} />
              <span>{evaluating ? 'EVALUATING…' : 'RESOLVE OUTCOMES'}</span>
            </button>

            {/* Export Dropdown */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleDownloadReport('markdown')}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold transition flex items-center gap-1"
                title="Download AI Markdown Report"
              >
                <FileText className="w-3.5 h-3.5 text-cyan-400" />
                <span>MD</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownloadReport('json')}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold transition flex items-center gap-1"
                title="Download JSON Report"
              >
                <Database className="w-3.5 h-3.5 text-amber-400" />
                <span>JSON</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownloadReport('csv')}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold transition flex items-center gap-1"
                title="Export CSV"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>CSV</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Top Key Metrics KPI Scorecards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] text-slate-500 uppercase font-bold">TOTAL RECORDED</div>
          <div className="text-xl font-bold text-white mt-1">
            {summary?.totalPredictions ?? 0}
          </div>
          <div className="text-[9px] text-slate-400 mt-0.5">
            Resolved: {summary?.completedPredictions ?? 0} · In-Flight: {summary?.pendingPredictions ?? 0}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] text-slate-500 uppercase font-bold">DIRECTION ACCURACY</div>
          <div className={`text-xl font-bold mt-1 ${
            (summary?.accuracyPct || 0) >= 55 ? 'text-emerald-400' : 'text-amber-400'
          }`}>
            {summary?.accuracyPct !== undefined ? `${summary.accuracyPct}%` : '—'}
          </div>
          <div className="text-[9px] text-slate-400 mt-0.5">
            Correct: {summary?.correctPredictions ?? 0} / {summary?.completedPredictions ?? 0}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] text-slate-500 uppercase font-bold">OUTCOME PATHS</div>
          <div className="text-base font-bold text-cyan-300 mt-1 flex items-center gap-1.5">
            <span className="text-emerald-400 font-bold">{summary?.tpFirstCount ?? 0} TP</span>
            <span className="text-slate-600">/</span>
            <span className="text-rose-400 font-bold">{summary?.slFirstCount ?? 0} SL</span>
          </div>
          <div className="text-[9px] text-slate-400 mt-0.5">
            Time Exit: {summary?.timeExitCount ?? 0}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] text-slate-500 uppercase font-bold">AVG REALIZED R</div>
          <div className={`text-xl font-bold mt-1 ${
            (summary?.avgRealizedR || 0) > 0 ? 'text-emerald-400' : 'text-rose-400'
          }`}>
            {(summary?.avgRealizedR || 0) > 0 ? '+' : ''}{summary?.avgRealizedR ?? 0} R
          </div>
          <div className="text-[9px] text-slate-400 mt-0.5">
            Expected: +{summary?.avgExpectedR ?? 0} R
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] text-slate-500 uppercase font-bold">REALIZED PROFIT FACTOR</div>
          <div className={`text-xl font-bold mt-1 ${
            (summary?.realizedProfitFactor || 1) >= 1.2 ? 'text-emerald-400' : 'text-amber-400'
          }`}>
            {summary?.realizedProfitFactor ?? 1.0}
          </div>
          <div className="text-[9px] text-slate-400 mt-0.5">
            Net R Win / Loss Ratio
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] text-slate-500 uppercase font-bold">BRIER SCORE (ECE)</div>
          <div className="text-xl font-bold text-cyan-300 mt-1">
            {summary?.brierScore ?? 0.21}
          </div>
          <div className="text-[9px] text-slate-400 mt-0.5">
            Calibration Error: {((summary?.calibrationError || 0) * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Main View Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-xl p-2 px-3">
        <div className="flex items-center gap-1.5 text-xs overflow-x-auto">
          {[
            { id: 'GRID', label: 'PREDICTION FORENSICS GRID', icon: Database },
            { id: 'CALIBRATION', label: 'CONFIDENCE CALIBRATION', icon: BarChart3 },
            { id: 'BREAKDOWN', label: 'DIMENSIONAL BREAKDOWNS', icon: Layers },
            { id: 'DRIFT', label: 'ROLLING DRIFT & FAILURE AUDIT', icon: Activity }
          ].map(tab => {
            const Icon = tab.icon;
            const isSel = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition whitespace-nowrap ${
                  isSel ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {activeTab === 'GRID' && (
          <div className="flex items-center gap-2 text-[11px]">
            <div className="relative">
              <Search className="w-3 h-3 text-slate-500 absolute left-2 top-2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search ID, pair, failure..."
                className="bg-slate-950 border border-slate-800 rounded pl-7 pr-2 py-1 text-slate-200 text-[11px] w-44 outline-none focus:border-cyan-600"
              />
            </div>

            <select
              value={filterPair}
              onChange={e => setFilterPair(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-300 text-[11px]"
            >
              <option value="ALL">All Pairs</option>
              {['EUR/USD','GBP/USD','USD/JPY','USD/CHF','AUD/USD','USD/CAD','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY','XAU/USD'].map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>

            <select
              value={filterRegime}
              onChange={e => setFilterRegime(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-300 text-[11px]"
            >
              <option value="ALL">All Regimes</option>
              {['TREND_UP','TREND_DOWN','RANGE','BREAKOUT','MEAN_REVERSION','HIGH_VOLATILITY','LOW_VOLATILITY','TRANSITION'].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        )}

        {activeTab === 'BREAKDOWN' && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-slate-500">GROUP BY:</span>
            <select
              value={breakdownDim}
              onChange={e => setBreakdownDim(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-300 text-[11px]"
            >
              <option value="pair">Currency Pair</option>
              <option value="predicted_direction">Direction (BUY / SELL)</option>
              <option value="market_regime">Market Regime</option>
              <option value="session">Trading Session</option>
              <option value="news_risk">News Risk Tier</option>
              <option value="model_version">Model Version</option>
            </select>
          </div>
        )}
      </div>

      {/* Tab 1: Prediction Forensics Grid */}
      {activeTab === 'GRID' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500 text-[10px] uppercase">
                  <th className="py-2.5 px-3">Date / ID</th>
                  <th className="py-2.5 px-3">Pair & Horizon</th>
                  <th className="py-2.5 px-3">Direction</th>
                  <th className="py-2.5 px-3">Confidence & EV</th>
                  <th className="py-2.5 px-3">Plan (Entry/SL/TP)</th>
                  <th className="py-2.5 px-3">Regime & News</th>
                  <th className="py-2.5 px-3">Outcome</th>
                  <th className="py-2.5 px-3">Realized R</th>
                  <th className="py-2.5 px-3">Excursion (MAE/MFE)</th>
                  <th className="py-2.5 px-3 text-right">Diagnosis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-[11px]">
                {filteredGrid.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-500">
                      {loading ? 'Loading forensic snapshots...' : 'No forensic records match the active criteria.'}
                    </td>
                  </tr>
                ) : (
                  filteredGrid.map(item => {
                    const s = item.snapshot;
                    const o = item.outcome;
                    const f = item.forensics;
                    const isBuy = s.predictedDirection === 'BUY';
                    const isSell = s.predictedDirection === 'SELL';
                    const isWin = o?.isTradeWon;
                    const isLoss = o?.actualOutcome === 'SL_FIRST' || (o?.actualRealizedR || 0) < 0;

                    return (
                      <tr
                        key={s.predictionId}
                        onClick={() => setSelectedPrediction(item)}
                        className="hover:bg-slate-950/80 cursor-pointer transition"
                      >
                        <td className="py-2.5 px-3">
                          <div className="text-slate-300 font-bold">
                            {new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          <div className="text-[9px] text-slate-600 font-mono truncate max-w-[80px]">
                            {s.predictionId.slice(0, 8)}…
                          </div>
                        </td>

                        <td className="py-2.5 px-3">
                          <div className="text-white font-bold">{s.pair}</div>
                          <div className="text-[10px] text-slate-500">{s.horizon} · {s.session}</div>
                        </td>

                        <td className="py-2.5 px-3">
                          <span className={`font-bold flex items-center gap-1 ${
                            isBuy ? 'text-emerald-400' : isSell ? 'text-rose-400' : 'text-slate-400'
                          }`}>
                            {isBuy ? <ArrowUpRight className="w-3.5 h-3.5" /> : isSell ? <ArrowDownRight className="w-3.5 h-3.5" /> : null}
                            {s.predictedDirection}
                          </span>
                        </td>

                        <td className="py-2.5 px-3">
                          <div className="text-white font-bold">{(s.confidenceScore * 100).toFixed(1)}%</div>
                          <div className="text-[10px] text-cyan-400">+{s.expectedR} R</div>
                        </td>

                        <td className="py-2.5 px-3 text-[10px]">
                          <div>E: <span className="text-slate-300 font-bold">{s.predictedEntry.toFixed(s.pair.includes('JPY') ? 3 : 5)}</span></div>
                          <div>SL: <span className="text-rose-400">{s.predictedStopLoss.toFixed(s.pair.includes('JPY') ? 3 : 5)}</span> · TP: <span className="text-emerald-400">{s.predictedTakeProfit.toFixed(s.pair.includes('JPY') ? 3 : 5)}</span></div>
                        </td>

                        <td className="py-2.5 px-3 text-[10px]">
                          <div className="text-slate-200 font-bold">{s.marketRegime}</div>
                          <div className={s.highImpactNews ? 'text-rose-400 font-bold' : 'text-slate-400'}>
                            News: {s.newsRisk}
                          </div>
                        </td>

                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            o?.actualOutcome === 'TP_FIRST' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
                            o?.actualOutcome === 'SL_FIRST' ? 'bg-rose-950 text-rose-300 border border-rose-800' :
                            o?.actualOutcome === 'TIME_EXIT' ? 'bg-slate-950 text-amber-300 border border-amber-800' :
                            'bg-slate-950 text-slate-400'
                          }`}>
                            {o?.actualOutcome || 'PENDING'}
                          </span>
                        </td>

                        <td className="py-2.5 px-3">
                          <span className={`font-bold ${
                            (o?.actualRealizedR || 0) > 0 ? 'text-emerald-400' : (o?.actualRealizedR || 0) < 0 ? 'text-rose-400' : 'text-slate-400'
                          }`}>
                            {o?.actualRealizedR !== undefined ? `${o.actualRealizedR > 0 ? '+' : ''}${o.actualRealizedR} R` : '—'}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 text-[10px]">
                          <div className="text-rose-400">MAE: -{o?.maePips || 0} p</div>
                          <div className="text-emerald-400">MFE: +{o?.mfePips || 0} p</div>
                        </td>

                        <td className="py-2.5 px-3 text-right">
                          <span className={`text-[10px] font-bold ${
                            f?.primaryFailureReason && f.primaryFailureReason !== 'UNKNOWN_FAILURE' ? 'text-rose-400' : 'text-slate-400'
                          }`}>
                            {f?.primaryFailureReason || 'NORMAL'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Confidence Calibration */}
      {activeTab === 'CALIBRATION' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-white">Empirical Probability Calibration & Reliability (Phase 9)</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Evaluates whether predicted model probabilities match actual observed win rates across discretized confidence tiers.
            </p>
          </div>

          <div className="grid md:grid-cols-5 gap-3">
            {calibration.map(b => (
              <div
                key={b.bucketName}
                className={`bg-slate-950 border rounded-xl p-3.5 space-y-2 ${
                  b.status === 'OVERCONFIDENT' ? 'border-rose-700/80 bg-rose-950/10' :
                  b.status === 'CALIBRATED' ? 'border-emerald-700/80 bg-emerald-950/10' :
                  'border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-white">{b.bucketName}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                    b.status === 'CALIBRATED' ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' :
                    b.status === 'OVERCONFIDENT' ? 'bg-rose-950 text-rose-300 border border-rose-700' :
                    'bg-slate-900 text-slate-400 border border-slate-800'
                  }`}>
                    {b.status}
                  </span>
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Sample Size:</span>
                    <span className="text-white font-bold">{b.predictionsCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Mean Predicted:</span>
                    <span className="text-cyan-300 font-bold">{(b.avgPredictedProbability * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Actual Accuracy:</span>
                    <span className="text-emerald-400 font-bold">{(b.actualSuccessRate * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Calibration Error:</span>
                    <span className={b.calibrationError > 0.10 ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                      {(b.calibrationError * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Dimensional Breakdowns */}
      {activeTab === 'BREAKDOWN' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500 text-[10px] uppercase">
                  <th className="py-2.5 px-3">Segment ({breakdownDim})</th>
                  <th className="py-2.5 px-3">Predictions</th>
                  <th className="py-2.5 px-3">Resolved</th>
                  <th className="py-2.5 px-3">Accuracy</th>
                  <th className="py-2.5 px-3">Avg Confidence</th>
                  <th className="py-2.5 px-3">Avg Realized R</th>
                  <th className="py-2.5 px-3">Profit Factor</th>
                  <th className="py-2.5 px-3">TP / SL / Time</th>
                  <th className="py-2.5 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-[11px]">
                {breakdown.map(g => (
                  <tr key={g.groupKey} className="hover:bg-slate-950/60">
                    <td className="py-2.5 px-3 font-bold text-white">{g.groupKey}</td>
                    <td className="py-2.5 px-3 text-slate-300">{g.totalPredictions}</td>
                    <td className="py-2.5 px-3 text-slate-300">{g.completedCount}</td>
                    <td className="py-2.5 px-3">
                      <span className={`font-bold ${g.accuracyPct >= 55 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {g.accuracyPct}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-cyan-300">{g.avgConfidencePct}%</td>
                    <td className="py-2.5 px-3">
                      <span className={`font-bold ${g.avgRealizedR > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {g.avgRealizedR > 0 ? '+' : ''}{g.avgRealizedR} R
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-bold text-white">{g.profitFactor}</td>
                    <td className="py-2.5 px-3 text-slate-400 text-[10px]">
                      {g.tpFirstCount} TP · {g.slFirstCount} SL · {g.timeExitCount} T
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        g.warningFlag ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-slate-950 text-emerald-400'
                      }`}>
                        {g.warningFlag || 'HEALTHY'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Rolling Drift & Failure Audit */}
      {activeTab === 'DRIFT' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 text-xs">
            <h3 className="font-bold text-white flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-cyan-400" />
              <span>Rolling Prediction Accuracy Drift (Window = 50)</span>
            </h3>
            {drift?.isDrifting && (
              <div className="bg-rose-950/40 border border-rose-800 rounded-lg p-3 text-rose-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{drift.driftWarningMessage}</span>
              </div>
            )}
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2">
              <div className="text-slate-400 text-[11px]">Historical Rolling Accuracy Windows:</div>
              <div className="flex flex-wrap gap-2">
                {drift?.accuracyTrend?.map((acc, idx) => (
                  <span
                    key={idx}
                    className={`px-2 py-1 rounded text-xs font-bold border ${
                      acc >= 55 ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-rose-950 text-rose-300 border-rose-800'
                    }`}
                  >
                    W{idx + 1}: {acc}%
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 text-xs">
            <h3 className="font-bold text-white flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span>Root Cause Failure Categories</span>
            </h3>
            <div className="space-y-2 bg-slate-950 p-3 rounded-lg border border-slate-800 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-400">Direction Failure (Immediate reversal):</span>
                <span className="text-white font-bold">Standard Structural Invalidation</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Entry Timing (Hit +0.4R then reversed):</span>
                <span className="text-amber-400 font-bold">Trailing Stop Optimization Candidate</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Regime Transition Whipsaw:</span>
                <span className="text-rose-400 font-bold">Transition Filter Gate</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">High-Impact News Reversal:</span>
                <span className="text-rose-400 font-bold">Economic News Buffer</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Forensic Inspection Modal / Drawer */}
      {selectedPrediction && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b1320] border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="text-xs text-slate-400 font-mono">INDIVIDUAL PREDICTION FORENSIC AUDIT</div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2 mt-0.5">
                  <span>{selectedPrediction.snapshot.pair} ({selectedPrediction.snapshot.horizon})</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    selectedPrediction.snapshot.predictedDirection === 'BUY' ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'bg-rose-950 text-rose-300 border border-rose-700'
                  }`}>
                    {selectedPrediction.snapshot.predictedDirection}
                  </span>
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPrediction(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            {/* Snapshot Details */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <div className="text-slate-500 text-[10px]">CONFIDENCE</div>
                <div className="text-white font-bold mt-0.5">{(selectedPrediction.snapshot.confidenceScore * 100).toFixed(1)}%</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <div className="text-slate-500 text-[10px]">EXPECTED R</div>
                <div className="text-cyan-300 font-bold mt-0.5">+{selectedPrediction.snapshot.expectedR} R</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <div className="text-slate-500 text-[10px]">ACTUAL OUTCOME</div>
                <div className="text-emerald-400 font-bold mt-0.5">{selectedPrediction.outcome?.actualOutcome || 'PENDING'}</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <div className="text-slate-500 text-[10px]">REALIZED R</div>
                <div className="text-white font-bold mt-0.5">{selectedPrediction.outcome?.actualRealizedR ?? '—'} R</div>
              </div>
            </div>

            {/* Diagnostic Failure Audit */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
              <div className="text-slate-400 text-xs font-bold uppercase flex items-center justify-between">
                <span>DIAGNOSTIC ROOT CAUSE ATTRIBUTION</span>
                <span className="text-rose-400">{selectedPrediction.forensics?.primaryFailureReason || 'UNKNOWN_FAILURE'}</span>
              </div>
              <div className="text-[11px] text-slate-300 space-y-1">
                {selectedPrediction.forensics?.evidenceSummary?.map((ev, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className="text-cyan-400 font-bold">•</span>
                    <span>{ev}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Technical Feature Snapshot Matrix */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2 text-[11px]">
              <div className="text-slate-400 text-xs font-bold uppercase">EXACT NUMERICAL FEATURE SNAPSHOT AT T</div>
              <div className="grid grid-cols-3 gap-2 text-slate-300">
                <div>RSI (14): <b className="text-white">{selectedPrediction.features.rsi?.toFixed(1)}</b></div>
                <div>MACD Hist: <b className="text-white">{selectedPrediction.features.macdHistogram?.toFixed(4)}</b></div>
                <div>ATR Pips: <b className="text-white">{selectedPrediction.snapshot.atrPips} pips</b></div>
                <div>MTF Alignment: <b className="text-white">{selectedPrediction.features.mtfAlignment}</b></div>
                <div>Spread At Entry: <b className="text-white">{selectedPrediction.snapshot.spreadAtPrediction} pips</b></div>
                <div>Market Regime: <b className="text-white">{selectedPrediction.snapshot.marketRegime}</b></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
