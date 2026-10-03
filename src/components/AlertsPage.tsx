import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Calendar,
  Clock,
  TrendingUp,
  TrendingDown,
  BarChart2,
  RefreshCw,
  Download,
  Award,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Sparkles,
  Zap,
  Sliders,
  ChevronDown,
  ChevronUp,
  Search,
  Layers,
  Flame,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
  HelpCircle,
  Compass,
  FileSpreadsheet
} from 'lucide-react';
import { PairPerformance, HourlyPerformance, TradeComparisonReport, RawTradeRecord } from '../services/tradeComparisonService';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, Cell } from 'recharts';

type DatePreset = 'YESTERDAY' | 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'CURRENT_MONTH' | 'PREVIOUS_MONTH';
type PairSortField = 'totalPnL' | 'totalTrades' | 'winRate' | 'profitFactor' | 'pair';

const pad = (n: number) => String(n).padStart(2, '0');

function formatDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getYesterdayBounds(): { from: string; to: string } {
  const now = new Date();
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const s = formatDateInput(y);
  return { from: s, to: s };
}

function getPresetBounds(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  switch (preset) {
    case 'YESTERDAY': {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const s = formatDateInput(y);
      return { from: s, to: s };
    }
    case 'TODAY': {
      const s = formatDateInput(now);
      return { from: s, to: s };
    }
    case 'LAST_7_DAYS': {
      const past = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      return { from: formatDateInput(past), to: formatDateInput(now) };
    }
    case 'LAST_30_DAYS': {
      const past = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      return { from: formatDateInput(past), to: formatDateInput(now) };
    }
    case 'CURRENT_MONTH': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: formatDateInput(first), to: formatDateInput(last) };
    }
    case 'PREVIOUS_MONTH': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: formatDateInput(first), to: formatDateInput(last) };
    }
  }
}

export const AlertsPage: React.FC = () => {
  const initial = getYesterdayBounds();
  const [preset, setPreset] = useState<DatePreset>('YESTERDAY');
  const [fromDate, setFromDate] = useState<string>(initial.from);
  const [toDate, setToDate] = useState<string>(initial.to);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<TradeComparisonReport | null>(null);

  // Sorting & Filtering for Pair Breakdown
  const [pairSortField, setPairSortField] = useState<PairSortField>('totalPnL');
  const [pairSortAsc, setPairSortAsc] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [showRawTrades, setShowRawTrades] = useState<boolean>(false);

  const fetchReport = useCallback(async (fromStr: string, toStr: string) => {
    setLoading(true);
    setError(null);
    try {
      const fromMs = new Date(`${fromStr}T00:00:00`).getTime();
      const toMs = new Date(`${toStr}T23:59:59.999`).getTime();

      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
        throw new Error('Please select a valid date range.');
      }

      const res = await fetch(`/api/brokers/trade-comparison?from=${fromMs}&to=${toMs}`, { cache: 'no-store' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to fetch trade comparison data.');
      }

      const data: TradeComparisonReport = await res.json();
      setReport(data);
    } catch (err: any) {
      setError(err.message || 'Error loading trade comparison report.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchReport(fromDate, toDate);
  }, [fetchReport, fromDate, toDate]);

  const handleApplyPreset = (p: DatePreset) => {
    setPreset(p);
    const bounds = getPresetBounds(p);
    setFromDate(bounds.from);
    setToDate(bounds.to);
  };

  // Filtered & Sorted Pair Breakdown
  const filteredPairs = useMemo(() => {
    if (!report?.pairBreakdown) return [];
    let list = report.pairBreakdown;

    if (searchQuery.trim()) {
      const q = searchQuery.toUpperCase().trim();
      list = list.filter(p => p.pair.toUpperCase().includes(q));
    }

    return list.slice().sort((a, b) => {
      let valA: any = a[pairSortField];
      let valB: any = b[pairSortField];

      if (typeof valA === 'string') {
        return pairSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return pairSortAsc ? valA - valB : valB - valA;
    });
  }, [report, pairSortField, pairSortAsc, searchQuery]);

  const toggleSort = (field: PairSortField) => {
    if (pairSortField === field) {
      setPairSortAsc(!pairSortAsc);
    } else {
      setPairSortField(field);
      setPairSortAsc(false);
    }
  };

  // Filter raw trades for selected hour (if active)
  const filteredRawTrades = useMemo(() => {
    if (!report?.rawTrades) return [];
    if (selectedHour === null) return report.rawTrades;
    return report.rawTrades.filter(t => {
      const h = new Date(t.timestamp).getHours();
      return h === selectedHour;
    });
  }, [report, selectedHour]);

  // Export CSV Helper
  const handleExportCsv = () => {
    if (!report) return;
    const lines: string[] = [];
    lines.push('TRADE COMPARISON & STRATEGY REPORT');
    lines.push(`Date Range: ${fromDate} to ${toDate}`);
    lines.push(`Total Trades: ${report.totalTrades}, Win Rate: ${report.overallWinRate}%, Total Net P&L: $${report.totalNetPnL}`);
    lines.push('');
    lines.push('PAIR BREAKDOWN');
    lines.push('Pair,Total Trades,Winning Trades,Loose Trades,Success %,Total Net P&L,Profit Factor,Buy Win %,Sell Win %,Avg Win,Avg Loss');
    for (const p of report.pairBreakdown) {
      lines.push(`"${p.pair}",${p.totalTrades},${p.winningTrades},${p.losingTrades},${p.winRate}%,$${p.totalPnL},${p.profitFactor},${p.buyWinRate}%,${p.sellWinRate}%,$${p.avgWin},$${p.avgLoss}`);
    }
    lines.push('');
    lines.push('HOURLY 24-HOUR BREAKDOWN');
    lines.push('Hour,Total Trades,Winning Trades,Loose Trades,Win Rate %,Net P&L,Status,Top Pair');
    for (const h of report.hourlyBreakdown) {
      lines.push(`"${h.hourLabel}",${h.totalTrades},${h.winningTrades},${h.losingTrades},${h.winRate}%,$${h.netPnL},${h.favorable ? 'FAVORABLE' : 'DRAWDOWN/NEUTRAL'},"${h.topPair || 'None'}"`);
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `trade-comparison-${fromDate}-to-${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalTrades = report?.totalTrades || 0;
  const winningTrades = report?.winningTrades || 0;
  const losingTrades = report?.losingTrades || 0;
  const netPnL = report?.totalNetPnL || 0;
  const winRate = report?.overallWinRate || 0;
  const profitFactor = report?.overallProfitFactor || 0;

  const intradaySeries = useMemo(() => {
    const trades = [...(report?.rawTrades || [])].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    let running = 0;
    const series: Array<{ timeLabel: string; cumulativePnL: number; tradeId: string; pnl: number }> = [];
    
    series.push({ timeLabel: '00:00', cumulativePnL: 0, tradeId: 'start', pnl: 0 });

    for (const t of trades) {
      running += t.pnl;
      const d = new Date(t.timestamp);
      const timeLabel = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      series.push({
        timeLabel,
        cumulativePnL: Number(running.toFixed(2)),
        tradeId: t.id,
        pnl: t.pnl
      });
    }

    if (series.length === 1) {
      series.push({ timeLabel: '12:00', cumulativePnL: 0, tradeId: 'mid', pnl: 0 });
      series.push({ timeLabel: '23:59', cumulativePnL: 0, tradeId: 'end', pnl: 0 });
    }

    return series;
  }, [report]);

  return (
    <div id="trade_comparison_analytics_hub" className="space-y-5 font-mono text-slate-100">
      {/* Top Filter & Control Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <Compass className="w-5 h-5 text-cyan-400" />
              <h1 className="text-base font-bold text-white uppercase tracking-wider">
                Trade Comparison & Strategy Edge Analytics
              </h1>
              <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[10px] font-bold">
                REAL BROKER & DATABASE TRADES
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Compare asset profitability, 24-hour hourly win rates, and pinpoint favorable golden execution windows.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void fetchReport(fromDate, toDate)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-200 text-xs font-bold disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
              <span>REFRESH</span>
            </button>
            <button
              onClick={handleExportCsv}
              disabled={!report || totalTrades === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-800 bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 text-xs font-bold disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              <span>EXPORT CSV</span>
            </button>
          </div>
        </div>

        {/* Date Presets & Custom Pickers */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[10px] uppercase text-slate-500 mr-1 hidden sm:inline">PRESETS:</span>
            {[
              { id: 'YESTERDAY', label: 'Yesterday (Default)' },
              { id: 'TODAY', label: 'Today' },
              { id: 'LAST_7_DAYS', label: 'Last 7 Days' },
              { id: 'LAST_30_DAYS', label: 'Last 30 Days' },
              { id: 'CURRENT_MONTH', label: 'This Month' },
              { id: 'PREVIOUS_MONTH', label: 'Previous Month' }
            ].map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleApplyPreset(p.id as DatePreset)}
                className={`px-2.5 py-1.5 rounded text-[11px] font-semibold transition ${
                  preset === p.id && fromDate === getPresetBounds(p.id as DatePreset).from && toDate === getPresetBounds(p.id as DatePreset).to
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1 rounded-lg">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span>FROM</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  className="bg-transparent text-white text-xs font-mono outline-none cursor-pointer"
                />
              </label>
              <span className="text-slate-600">→</span>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span>TO</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  className="bg-transparent text-white text-xs font-mono outline-none cursor-pointer"
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-rose-800 bg-rose-950/40 text-rose-300 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Top Level Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] uppercase text-slate-500 font-bold">TOTAL TRADES</div>
          <div className="text-xl font-bold text-white mt-1">{totalTrades}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{report ? `${report.fromDateStr} to ${report.toDateStr}` : '—'}</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] uppercase text-emerald-400 font-bold flex items-center justify-between">
            <span>WINNING TRADES</span>
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-400 mt-1">{winningTrades}</div>
          <div className="text-[10px] text-emerald-500/80 mt-0.5">{totalTrades > 0 ? `${((winningTrades / totalTrades) * 100).toFixed(1)}% of total` : '0%'}</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] uppercase text-rose-400 font-bold flex items-center justify-between">
            <span>LOOSE TRADES</span>
            <XCircle className="w-3 h-3 text-rose-400" />
          </div>
          <div className="text-xl font-bold text-rose-400 mt-1">{losingTrades}</div>
          <div className="text-[10px] text-rose-500/80 mt-0.5">{totalTrades > 0 ? `${((losingTrades / totalTrades) * 100).toFixed(1)}% of total` : '0%'}</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] uppercase text-cyan-400 font-bold">SUCCESS % (WIN RATE)</div>
          <div className="text-xl font-bold text-cyan-300 mt-1">{winRate.toFixed(1)}%</div>
          <div className="w-full bg-slate-950 rounded-full h-1.5 mt-1.5 overflow-hidden border border-slate-800">
            <div className="bg-cyan-500 h-full transition-all" style={{ width: `${Math.min(100, Math.max(0, winRate))}%` }} />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] uppercase text-slate-400 font-bold">TOTAL NET P&L</div>
          <div className={`text-xl font-bold mt-1 ${netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {netPnL >= 0 ? '+' : ''}${netPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">PF: {profitFactor > 0 ? profitFactor.toFixed(2) : '—'}</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] uppercase text-amber-400 font-bold flex items-center justify-between">
            <span>PEAK EDGE WINDOW</span>
            <Clock className="w-3 h-3 text-amber-400" />
          </div>
          <div className="text-sm font-bold text-amber-300 mt-1 truncate">
            {report?.insights?.goldenHours?.[0]?.label || 'Pending Data'}
          </div>
          <div className="text-[10px] text-amber-400/80 mt-0.5">
            {report?.insights?.goldenHours?.[0] ? `${report.insights.goldenHours[0].winRate}% win rate` : '24h range'}
          </div>
        </div>
      </div>

      {/* Strategic Insights & Planning Suggestions Box */}
      {report && (
        <div className="bg-slate-900/90 border border-cyan-900/70 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-bold text-white mb-3">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>Quantitative Edge Insights & Strategy Recommendations</span>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <div className="text-[10px] uppercase text-slate-500 font-bold">TOP PROFITABLE PAIR</div>
              <div className="text-sm font-bold text-emerald-400 mt-1">
                {report.insights.bestPerformingPair || 'None yet'}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Highest verified edge</div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <div className="text-[10px] uppercase text-slate-500 font-bold">DRAWDOWN DRAG ASSET</div>
              <div className="text-sm font-bold text-rose-400 mt-1">
                {report.insights.worstPerformingPair || 'None (All Positive/Neutral)'}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Review margin or stop loss</div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <div className="text-[10px] uppercase text-slate-500 font-bold">GOLDEN 24H WINDOWS</div>
              <div className="text-xs font-bold text-amber-300 mt-1">
                {report.insights.goldenHours.length > 0
                  ? report.insights.goldenHours.map(g => g.label.split(' ')[0]).join(', ')
                  : 'Requires active trades'}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">High probability setups</div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <div className="text-[10px] uppercase text-slate-500 font-bold">MOST ACTIVE SYMBOL</div>
              <div className="text-sm font-bold text-cyan-300 mt-1">
                {report.insights.mostActivePair || 'None'}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Primary volume driver</div>
            </div>
          </div>

          <div className="space-y-1.5 text-xs text-slate-300 bg-slate-950/70 p-3.5 rounded-lg border border-slate-800">
            <div className="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-1">
              ACTIONABLE STRATEGY PROPOSALS FOR THIS DATE RANGE:
            </div>
            {report.insights.recommendations.map((rec, idx) => (
              <div key={idx} className="flex items-start gap-2 text-slate-300 leading-relaxed">
                <span className="text-cyan-400 mt-0.5">▪</span>
                <span>{rec}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 24-Hour Time Distribution & Edge Matrix */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold text-white uppercase">24-Hour Hourly Edge Comparison</h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Identify which specific hours of the day generate the highest win rate and positive expectancy.
            </p>
          </div>
          {selectedHour !== null && (
            <button
              onClick={() => setSelectedHour(null)}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-bold"
            >
              RESET HOURLY FILTER ({pad(selectedHour)}:00)
            </button>
          )}
        </div>

        {/* Real-Time Net P&L Intraday Line Chart */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 mb-4 mt-3">
          <div className="text-xs font-bold text-slate-300 uppercase mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              <span>Today's Net P&L Fluctuations & Intraday Equity Curve</span>
            </span>
            <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[9px] font-bold animate-pulse">
              REAL-TIME STREAMING TRACKER
            </span>
          </div>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={intradaySeries}
                margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="timeLabel" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#020617', borderColor: '#334155', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
                  formatter={(val: any) => [`$${Number(val).toFixed(2)}`, 'Cumulative Net P&L']}
                  labelStyle={{ color: '#38bdf8', fontWeight: 'bold' }}
                />
                <Line
                  type="monotone"
                  dataKey="cumulativePnL"
                  name="Net P&L"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#38bdf8' }}
                  activeDot={{ r: 6, fill: '#10b981' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recharts Hourly Win/Loss & PnL Distribution Chart */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 mb-4 mt-3">
          <div className="text-xs font-bold text-slate-300 uppercase mb-3 flex items-center justify-between">
            <span>Win / Loss Distribution Across 24 Hours</span>
            <span className="text-[10px] text-slate-500 font-mono">Recharts Analytics Visualization</span>
          </div>
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={report?.hourlyBreakdown || []}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                onClick={(e: any) => {
                  if (e && e.activePayload && e.activePayload[0]) {
                    const h = e.activePayload[0].payload.hour;
                    setSelectedHour(selectedHour === h ? null : h);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="hourLabel" stroke="#64748b" tick={{ fontSize: 10 }} interval={1} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#020617', borderColor: '#334155', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
                  formatter={(value: any, name: string) => [
                    name === 'winningTrades' ? `${value} Wins` : name === 'losingTrades' ? `${value} Losses` : `$${Number(value).toFixed(2)}`,
                    name === 'winningTrades' ? 'Winning Trades' : name === 'losingTrades' ? 'Losing Trades' : 'Net P&L'
                  ]}
                  labelStyle={{ color: '#38bdf8', fontWeight: 'bold' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Bar dataKey="winningTrades" name="Winning Trades" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="losingTrades" name="Losing Trades" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 24-Hour Timeline Bar Chart Grid */}
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-2 mt-3">
          {report?.hourlyBreakdown?.map((h) => {
            const isSel = selectedHour === h.hour;
            const hasTrades = h.totalTrades > 0;
            const isFav = h.favorable;
            const isLoss = hasTrades && h.netPnL < 0;

            return (
              <div
                key={h.hour}
                onClick={() => setSelectedHour(isSel ? null : h.hour)}
                className={`cursor-pointer p-2.5 rounded-lg border text-center transition flex flex-col justify-between min-h-[110px] ${
                  isSel
                    ? 'border-cyan-400 bg-cyan-950/60 ring-1 ring-cyan-400'
                    : isFav
                    ? 'border-emerald-800 bg-emerald-950/30 hover:border-emerald-600'
                    : isLoss
                    ? 'border-rose-900 bg-rose-950/30 hover:border-rose-700'
                    : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                }`}
              >
                <div className="text-[11px] font-bold text-slate-300">
                  {pad(h.hour)}:00
                </div>

                <div className="my-1.5">
                  <div className="text-xs font-bold text-white">
                    {h.totalTrades} <span className="text-[9px] font-normal text-slate-400">trd</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {h.winningTrades}W · {h.losingTrades}L
                  </div>
                  <div className={`text-[10px] font-bold mt-1 ${
                    h.netPnL > 0 ? 'text-emerald-400' : h.netPnL < 0 ? 'text-rose-400' : 'text-slate-500'
                  }`}>
                    {h.netPnL !== 0 ? `${h.netPnL > 0 ? '+' : ''}$${Math.abs(h.netPnL).toFixed(0)}` : '$0'}
                  </div>
                </div>

                <div className="text-[9px] font-mono mt-auto">
                  {hasTrades ? (
                    <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${
                      h.winRate >= 60
                        ? 'bg-emerald-900/60 text-emerald-300'
                        : h.winRate >= 40
                        ? 'bg-amber-900/60 text-amber-300'
                        : 'bg-rose-900/60 text-rose-300'
                    }`}>
                      {h.winRate.toFixed(0)}% WIN
                    </span>
                  ) : (
                    <span className="text-slate-600">IDLE</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between text-[10px] text-slate-500 font-mono">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-emerald-900 border border-emerald-700" /> Favorable Hour (Win Rate ≥ 50% & Net P&L &gt; 0)</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-rose-900 border border-rose-700" /> Drawdown Hour</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-slate-950 border border-slate-800" /> Low/No Activity</span>
          </div>
          <span>Times shown in Terminal Server Time</span>
        </div>
      </div>

      {/* Pair vs Hour Trade Density Heatmap */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <Flame className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-bold text-white uppercase">Pair vs Hour Trade Density & Profitability Heatmap</h2>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Visualize trade concentration and performance density across 24 hours for each traded pair to identify optimal execution windows.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px] font-mono">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] text-slate-400 bg-slate-950">
                <th className="py-2.5 px-3 min-w-[100px]">PAIR / HOUR</th>
                {Array.from({ length: 24 }).map((_, h) => (
                  <th key={h} className="py-2.5 px-1.5 text-center text-[10px]">{pad(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {!report?.pairBreakdown || report.pairBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={25} className="text-center py-6 text-slate-500">
                    No active pair data for heatmap.
                  </td>
                </tr>
              ) : (
                report.pairBreakdown.map(p => {
                  const pairTrades = (report.rawTrades || []).filter(t => t.symbol === p.pair);
                  const hourCounts = Array.from({ length: 24 }, () => ({ count: 0, pnl: 0 }));
                  for (const t of pairTrades) {
                    const hr = new Date(t.timestamp).getHours();
                    if (hr >= 0 && hr < 24) {
                      hourCounts[hr].count += 1;
                      hourCounts[hr].pnl += t.pnl;
                    }
                  }

                  return (
                    <tr key={p.pair} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 font-bold text-white whitespace-nowrap flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-cyan-400" />
                        <span>{p.pair}</span>
                      </td>
                      {hourCounts.map((cell, h) => {
                        const hasActivity = cell.count > 0;
                        const isProfitable = cell.pnl > 0;
                        const isLoss = cell.pnl < 0;

                        let bgClass = 'bg-slate-950/60 text-slate-600 border border-slate-800/50';
                        if (hasActivity) {
                          if (isProfitable) {
                            bgClass = cell.count >= 3 ? 'bg-emerald-600 text-white font-bold shadow-sm' : 'bg-emerald-950 text-emerald-300 border border-emerald-800';
                          } else if (isLoss) {
                            bgClass = cell.count >= 3 ? 'bg-rose-600 text-white font-bold shadow-sm' : 'bg-rose-950 text-rose-300 border border-rose-800';
                          } else {
                            bgClass = 'bg-slate-800 text-slate-200';
                          }
                        }

                        return (
                          <td key={h} className="py-1 px-1 text-center">
                            <div
                              title={`${p.pair} @ ${pad(h)}:00 — Trades: ${cell.count}, Net P&L: $${cell.pnl.toFixed(2)}`}
                              className={`h-8 rounded flex flex-col items-center justify-center cursor-default transition ${bgClass}`}
                            >
                              <span className="text-[10px] leading-none">{hasActivity ? cell.count : '·'}</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between text-[10px] text-slate-500 font-mono">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-600" /> High Profitable Density</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-950 border border-emerald-800" /> Mild Profit</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-600" /> High Drawdown Density</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-950 border border-slate-800" /> Zero Activity</span>
          </div>
          <span>Hover over cells for precise volume and P&L details</span>
        </div>
      </div>

      {/* Pair-by-Pair Performance Breakdown Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-bold text-white uppercase">Pair-by-Pair Trade Performance & Success %</h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Detailed statistics showing total trades, win/loss counts, success percentage, and net P&L per instrument.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search Pair / Symbol..."
                className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 outline-none focus:border-cyan-600"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400 font-bold bg-slate-950/60">
                <th className="py-2.5 px-3 cursor-pointer" onClick={() => toggleSort('pair')}>
                  <span className="flex items-center gap-1">PAIR / INSTRUMENT {pairSortField === 'pair' && (pairSortAsc ? '▲' : '▼')}</span>
                </th>
                <th className="py-2.5 px-3 text-right cursor-pointer" onClick={() => toggleSort('totalTrades')}>
                  <span className="flex items-center justify-end gap-1">TOTAL TRADES {pairSortField === 'totalTrades' && (pairSortAsc ? '▲' : '▼')}</span>
                </th>
                <th className="py-2.5 px-3 text-right text-emerald-400">WIN TRADES</th>
                <th className="py-2.5 px-3 text-right text-rose-400">LOOSE TRADES</th>
                <th className="py-2.5 px-3 cursor-pointer min-w-[140px]" onClick={() => toggleSort('winRate')}>
                  <span className="flex items-center gap-1">SUCCESS % {pairSortField === 'winRate' && (pairSortAsc ? '▲' : '▼')}</span>
                </th>
                <th className="py-2.5 px-3 text-right cursor-pointer" onClick={() => toggleSort('totalPnL')}>
                  <span className="flex items-center justify-end gap-1">TOTAL NET P&L {pairSortField === 'totalPnL' && (pairSortAsc ? '▲' : '▼')}</span>
                </th>
                <th className="py-2.5 px-3 text-right cursor-pointer" onClick={() => toggleSort('profitFactor')}>
                  <span className="flex items-center justify-end gap-1">PROFIT FACTOR {pairSortField === 'profitFactor' && (pairSortAsc ? '▲' : '▼')}</span>
                </th>
                <th className="py-2.5 px-3 text-center">LONG vs SHORT EDGE</th>
                <th className="py-2.5 px-3 text-right">AVG WIN / LOSS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filteredPairs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-slate-500 text-xs">
                    {loading ? 'Analyzing database trades...' : 'No trades found for this date range and search filter.'}
                  </td>
                </tr>
              ) : (
                filteredPairs.map(p => {
                  const isProfitable = p.totalPnL >= 0;
                  return (
                    <tr key={p.pair} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-3 font-bold text-white flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-cyan-400" />
                        <span>{p.pair}</span>
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-slate-200">
                        {p.totalTrades}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-emerald-400">
                        {p.winningTrades}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-rose-400">
                        {p.losingTrades}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-100 min-w-[42px]">{p.winRate.toFixed(1)}%</span>
                          <div className="flex-1 bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                            <div
                              className={`h-full transition-all ${
                                p.winRate >= 60 ? 'bg-emerald-500' : p.winRate >= 45 ? 'bg-cyan-500' : 'bg-rose-500'
                              }`}
                              style={{ width: `${Math.min(100, Math.max(0, p.winRate))}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className={`py-3 px-3 text-right font-bold ${isProfitable ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {p.totalPnL >= 0 ? '+' : ''}${p.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-slate-300">
                        {p.profitFactor > 0 ? p.profitFactor.toFixed(2) : '—'}
                      </td>
                      <td className="py-3 px-3 text-center text-[10px]">
                        <span className="text-emerald-300">BUY: {p.buyWinRate}%</span>
                        <span className="text-slate-600 mx-1">|</span>
                        <span className="text-cyan-300">SELL: {p.sellWinRate}%</span>
                      </td>
                      <td className="py-3 px-3 text-right text-[10px] text-slate-400">
                        <span className="text-emerald-400">+${p.avgWin.toFixed(2)}</span> / <span className="text-rose-400">-${p.avgLoss.toFixed(2)}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Raw Trades Drilldown Accordion */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowRawTrades(!showRawTrades)}
          className="w-full px-5 py-3.5 flex items-center justify-between bg-slate-950/60 hover:bg-slate-950 transition text-left text-xs font-bold text-slate-300"
        >
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-cyan-400" />
            <span>Sample Executions Drilldown ({filteredRawTrades.length} Trade Records)</span>
            {selectedHour !== null && (
              <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[10px]">
                Hour {pad(selectedHour)}:00 filtered
              </span>
            )}
          </div>
          {showRawTrades ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {showRawTrades && (
          <div className="p-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400 font-bold bg-slate-950">
                  <th className="py-2 px-3">TIME</th>
                  <th className="py-2 px-3">PAIR</th>
                  <th className="py-2 px-3">SIDE</th>
                  <th className="py-2 px-3 text-right">ENTRY</th>
                  <th className="py-2 px-3 text-right">EXIT</th>
                  <th className="py-2 px-3 text-right">SIZE</th>
                  <th className="py-2 px-3 text-right">NET P&L</th>
                  <th className="py-2 px-3 text-right">STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono text-[11px]">
                {filteredRawTrades.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-6 text-slate-500">
                      No raw trades found in this timeframe.
                    </td>
                  </tr>
                ) : (
                  filteredRawTrades.map((t, idx) => (
                    <tr key={t.id || idx} className="hover:bg-slate-800/30">
                      <td className="py-2 px-3 text-slate-400">
                        {new Date(t.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2 px-3 font-bold text-white">{t.symbol}</td>
                      <td className={`py-2 px-3 font-bold ${t.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {t.side}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-300">
                        {t.entryPrice > 0 ? t.entryPrice.toFixed(5) : '—'}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-300">
                        {t.exitPrice > 0 ? t.exitPrice.toFixed(5) : '—'}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-300">{t.quantity.toLocaleString()}</td>
                      <td className={`py-2 px-3 text-right font-bold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          t.pnl > 0
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : t.pnl < 0
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : 'bg-slate-800 text-slate-400'
                        }`}>
                          {t.pnl > 0 ? 'WIN' : t.pnl < 0 ? 'LOSS' : 'EVEN'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
