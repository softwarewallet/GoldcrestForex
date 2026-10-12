import React, { useState, useMemo } from 'react';
import {
  CalendarDays,
  Check,
  Copy,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
  Filter,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  Flame,
  BarChart2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Info
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  Cell,
  ReferenceLine
} from 'recharts';
import { TradeComparisonReport, RawTradeRecord } from '../services/tradeComparisonService';

export interface DayOfWeekPairPerformanceReportProps {
  report: TradeComparisonReport | null;
  fromDate: string;
  toDate: string;
  onSelectDatePreset?: (preset: 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'LAST_90_DAYS' | 'CURRENT_MONTH') => void;
  onFilterTradeTable?: (dayName: string, pair: string) => void;
}

interface DayMeta {
  index: number;
  name: string;
  short: string;
}

const DAYS_META: DayMeta[] = [
  { index: 1, name: 'Monday', short: 'Mon' },
  { index: 2, name: 'Tuesday', short: 'Tue' },
  { index: 3, name: 'Wednesday', short: 'Wed' },
  { index: 4, name: 'Thursday', short: 'Thu' },
  { index: 5, name: 'Friday', short: 'Fri' },
  { index: 0, name: 'Sunday', short: 'Sun' },
  { index: 6, name: 'Saturday', short: 'Sat' }
];

export interface ComputedPairDayEdge {
  pair: string;
  dayIndex: number;
  dayName: string;
  dayShort: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  netPnL: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  recommendation: 'ACTIVATE' | 'AVOID' | 'NEUTRAL';
  edgeReason: string;
}

export interface ComputedDaySummary {
  dayIndex: number;
  dayName: string;
  dayShort: string;
  isToday: boolean;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  netPnL: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  pairs: ComputedPairDayEdge[];
  recommendedPairs: ComputedPairDayEdge[];
  avoidPairs: ComputedPairDayEdge[];
  neutralPairs: ComputedPairDayEdge[];
  topPair: ComputedPairDayEdge | null;
  worstPair: ComputedPairDayEdge | null;
}

export const DayOfWeekPairPerformanceReport: React.FC<DayOfWeekPairPerformanceReportProps> = ({
  report,
  fromDate,
  toDate,
  onSelectDatePreset
}) => {
  const [selectedDayFilter, setSelectedDayFilter] = useState<number | null>(null); // null = all days
  const [searchPairQuery, setSearchPairQuery] = useState<string>('');
  const [recommendationFilter, setRecommendationFilter] = useState<'ALL' | 'ACTIVATE' | 'AVOID'>('ALL');
  const [matrixMetric, setMatrixMetric] = useState<'PNL' | 'WIN_RATE' | 'TRADES'>('PNL');
  const [copiedSchedule, setCopiedSchedule] = useState<boolean>(false);
  const [sortField, setSortField] = useState<'netPnL' | 'winRate' | 'totalTrades' | 'pair' | 'dayName'>('netPnL');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  const todayDayIndex = new Date().getDay();

  // Compute multi-dimensional Day x Pair analytics
  const { allUniquePairs, daysSummary, flatPairDayEdges, todaySummary } = useMemo(() => {
    const raw: RawTradeRecord[] = report?.rawTrades || [];

    const pairSet = new Set<string>();
    raw.forEach(t => {
      if (t.symbol) pairSet.add(t.symbol);
    });
    const uniquePairs = Array.from(pairSet).sort();

    const flatEdges: ComputedPairDayEdge[] = [];

    const days: ComputedDaySummary[] = DAYS_META.map(dayMeta => {
      const dayTrades = raw.filter(t => new Date(t.timestamp).getDay() === dayMeta.index);
      let wins = 0;
      let losses = 0;
      let grossProfit = 0;
      let grossLoss = 0;
      let netPnL = 0;

      const pairMap = new Map<string, RawTradeRecord[]>();
      for (const t of dayTrades) {
        netPnL += t.pnl;
        if (t.pnl > 0.0001) {
          wins++;
          grossProfit += t.pnl;
        } else if (t.pnl < -0.0001) {
          losses++;
          grossLoss += Math.abs(t.pnl);
        }
        if (!pairMap.has(t.symbol)) pairMap.set(t.symbol, []);
        pairMap.get(t.symbol)!.push(t);
      }

      const total = dayTrades.length;
      const winRate = total > 0 ? (wins / total) * 100 : 0;
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.99 : 0;

      const pairsList: ComputedPairDayEdge[] = Array.from(pairMap.entries()).map(([pair, pTrades]) => {
        let pWins = 0;
        let pLosses = 0;
        let pGrossProfit = 0;
        let pGrossLoss = 0;
        let pNet = 0;

        for (const pt of pTrades) {
          pNet += pt.pnl;
          if (pt.pnl > 0.0001) {
            pWins++;
            pGrossProfit += pt.pnl;
          } else if (pt.pnl < -0.0001) {
            pLosses++;
            pGrossLoss += Math.abs(pt.pnl);
          }
        }

        const pTotal = pTrades.length;
        const pWinRate = pTotal > 0 ? (pWins / pTotal) * 100 : 0;
        const pPF = pGrossLoss > 0 ? pGrossProfit / pGrossLoss : pGrossProfit > 0 ? 99.99 : 0;
        const avgWin = pWins > 0 ? pGrossProfit / pWins : 0;
        const avgLoss = pLosses > 0 ? pGrossLoss / pLosses : 0;

        let recommendation: 'ACTIVATE' | 'AVOID' | 'NEUTRAL' = 'NEUTRAL';
        let edgeReason = 'Balanced performance or low sample size';

        if (pNet > 0 && pWinRate >= 50) {
          recommendation = 'ACTIVATE';
          edgeReason = `High Edge: +$${pNet.toFixed(2)} (${pWinRate.toFixed(1)}% win rate across ${pTotal} trades)`;
        } else if (pNet < 0 || (pTotal >= 2 && pWinRate < 40)) {
          recommendation = 'AVOID';
          edgeReason = `Drawdown Risk: -$${Math.abs(pNet).toFixed(2)} (${pWinRate.toFixed(1)}% win rate across ${pTotal} trades)`;
        }

        const edgeObj: ComputedPairDayEdge = {
          pair,
          dayIndex: dayMeta.index,
          dayName: dayMeta.name,
          dayShort: dayMeta.short,
          totalTrades: pTotal,
          winningTrades: pWins,
          losingTrades: pLosses,
          winRate: Math.round(pWinRate * 10) / 10,
          netPnL: Math.round(pNet * 100) / 100,
          grossProfit: Math.round(pGrossProfit * 100) / 100,
          grossLoss: Math.round(pGrossLoss * 100) / 100,
          profitFactor: Math.round(pPF * 100) / 100,
          avgWin: Math.round(avgWin * 100) / 100,
          avgLoss: Math.round(avgLoss * 100) / 100,
          recommendation,
          edgeReason
        };

        flatEdges.push(edgeObj);
        return edgeObj;
      });

      pairsList.sort((a, b) => b.netPnL - a.netPnL);

      const recommendedPairs = pairsList.filter(p => p.recommendation === 'ACTIVATE');
      const avoidPairs = pairsList.filter(p => p.recommendation === 'AVOID');
      const neutralPairs = pairsList.filter(p => p.recommendation === 'NEUTRAL');

      return {
        dayIndex: dayMeta.index,
        dayName: dayMeta.name,
        dayShort: dayMeta.short,
        isToday: dayMeta.index === todayDayIndex,
        totalTrades: total,
        winningTrades: wins,
        losingTrades: losses,
        winRate: Math.round(winRate * 10) / 10,
        netPnL: Math.round(netPnL * 100) / 100,
        grossProfit: Math.round(grossProfit * 100) / 100,
        grossLoss: Math.round(grossLoss * 100) / 100,
        profitFactor: Math.round(profitFactor * 100) / 100,
        pairs: pairsList,
        recommendedPairs,
        avoidPairs,
        neutralPairs,
        topPair: pairsList.length > 0 && pairsList[0].netPnL > 0 ? pairsList[0] : null,
        worstPair: pairsList.length > 0 && pairsList[pairsList.length - 1].netPnL < 0 ? pairsList[pairsList.length - 1] : null
      };
    });

    // Keep primary trading days (Mon - Fri) and any weekend day with trades
    const activeDays = days.filter(d => (d.dayIndex >= 1 && d.dayIndex <= 5) || d.totalTrades > 0);
    const todayMatch = days.find(d => d.isToday) || null;

    return {
      allUniquePairs: uniquePairs,
      daysSummary: activeDays,
      flatPairDayEdges: flatEdges,
      todaySummary: todayMatch
    };
  }, [report, todayDayIndex]);

  // Filtered & sorted pairs list for the detailed table
  const filteredPairRows = useMemo(() => {
    let rows = [...flatPairDayEdges];

    if (selectedDayFilter !== null) {
      rows = rows.filter(r => r.dayIndex === selectedDayFilter);
    }

    if (searchPairQuery.trim()) {
      const q = searchPairQuery.trim().toLowerCase();
      rows = rows.filter(r => r.pair.toLowerCase().includes(q) || r.dayName.toLowerCase().includes(q));
    }

    if (recommendationFilter !== 'ALL') {
      rows = rows.filter(r => r.recommendation === recommendationFilter);
    }

    rows.sort((a, b) => {
      let vA: any = a[sortField];
      let vB: any = b[sortField];
      if (typeof vA === 'string') {
        return sortAsc ? vA.localeCompare(vB) : vB.localeCompare(vA);
      }
      return sortAsc ? vA - vB : vB - vA;
    });

    return rows;
  }, [flatPairDayEdges, selectedDayFilter, searchPairQuery, recommendationFilter, sortField, sortAsc]);

  // Copy structured schedule for bot or operator activation
  const handleCopySchedule = () => {
    if (!daysSummary.length) return;
    const lines = [
      '================================================================',
      'GOLDCREST FINMAN — WEEKLY PAIR ACTIVATION SCHEDULE',
      `Analysis Window: ${fromDate} to ${toDate}`,
      '================================================================'
    ];

    for (const d of daysSummary) {
      lines.push('');
      lines.push(`▶ ${d.dayName.toUpperCase()} (Net P&L: ${d.netPnL >= 0 ? '+' : ''}$${d.netPnL.toFixed(2)} | Win Rate: ${d.winRate}%)`);
      if (d.recommendedPairs.length > 0) {
        lines.push(`  [✓ ACTIVATE THESE PAIRS]:`);
        d.recommendedPairs.forEach(p => {
          lines.push(`    • ${p.pair}: +$${p.netPnL.toFixed(2)} (${p.winRate}% Win Rate, ${p.totalTrades} Trades, PF: ${p.profitFactor})`);
        });
      } else {
        lines.push('  [✓ ACTIVATE THESE PAIRS]: No strong positive edge identified.');
      }

      if (d.avoidPairs.length > 0) {
        lines.push(`  [✗ AVOID / DEACTIVATE]:`);
        d.avoidPairs.forEach(p => {
          lines.push(`    • ${p.pair}: -$${Math.abs(p.netPnL).toFixed(2)} (${p.winRate}% Win Rate, ${p.totalTrades} Trades)`);
        });
      }
    }

    lines.push('\nOperational Directive: Disable pairs on days marked AVOID to prevent systematic drawdown.');

    void navigator.clipboard.writeText(lines.join('\n'));
    setCopiedSchedule(true);
    setTimeout(() => setCopiedSchedule(false), 3000);
  };

  // Export CSV
  const handleExportMatrixCsv = () => {
    if (!daysSummary.length) return;
    const lines = [
      'Goldcrest Finman Quantitative Terminal - Day-of-Week Pair Profitability & Activation Report',
      `Analysis Window: ${fromDate} to ${toDate}`,
      '',
      'Day of Week,Pair,Recommendation,Win Rate %,Total Trades,Wins,Losses,Net P&L (USD),Profit Factor,Avg Win (USD),Avg Loss (USD),Direct Reasoning'
    ];

    for (const d of daysSummary) {
      for (const p of d.pairs) {
        lines.push(
          `"${d.dayName}","${p.pair}","${p.recommendation}",${p.winRate}%,${p.totalTrades},${p.winningTrades},${p.losingTrades},${p.netPnL},${p.profitFactor},${p.avgWin},${p.avgLoss},"${p.edgeReason.replace(/"/g, '""')}"`
        );
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `goldcrest-day-of-week-pair-schedule-${fromDate}-${toDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  // Check if date window is short (e.g. 1 or 2 days)
  const isShortWindow = useMemo(() => {
    const fromMs = new Date(`${fromDate}T00:00:00`).getTime();
    const toMs = new Date(`${toDate}T23:59:59`).getTime();
    return toMs - fromMs <= 3 * 24 * 3600 * 1000;
  }, [fromDate, toDate]);

  return (
    <div className="space-y-6">
      {/* Short Window Guidance Banner */}
      {isShortWindow && (
        <div className="p-4 rounded-xl border border-cyan-800/80 bg-cyan-950/40 text-cyan-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            <Info className="w-5 h-5 text-cyan-400 shrink-0" />
            <div>
              <span className="font-bold">Multi-Week Analysis Recommended:</span> You are currently viewing a short timeframe ({fromDate === toDate ? fromDate : `${fromDate} to ${toDate}`}). For maximum statistical confidence across every day of the week, switch to a wider window.
            </div>
          </div>
          {onSelectDatePreset && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => onSelectDatePreset('LAST_30_DAYS')}
                className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-bold text-[11px] transition shadow"
              >
                Analyze Last 30 Days
              </button>
              <button
                type="button"
                onClick={() => onSelectDatePreset('LAST_90_DAYS')}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-700 rounded font-bold text-[11px] transition"
              >
                Last 90 Days
              </button>
            </div>
          )}
        </div>
      )}

      {/* Header & Directive Summary */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-emerald-950/80 border border-emerald-800 flex items-center justify-center text-emerald-400">
                <CalendarDays className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span>Day-of-Week Pair Profitability & Activation Strategy</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                    QUANTITATIVE EDGE MATRIX
                  </span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5 font-mono">
                  Identifies which specific pairs deliver statistical profits per weekday so you can activate only high-probability pairs each day.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopySchedule}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-800 bg-cyan-950/70 hover:bg-cyan-900 text-cyan-300 text-xs font-bold transition shadow"
            >
              {copiedSchedule ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSchedule ? 'COPIED TO CLIPBOARD!' : 'COPY WEEKLY SCHEDULE'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportMatrixCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-800 bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 text-xs font-bold transition shadow"
            >
              <Download className="w-3.5 h-3.5" />
              <span>EXPORT SCHEDULE CSV</span>
            </button>
          </div>
        </div>

        {/* Today's Real-Time Trading Directive Callout */}
        {todaySummary && (
          <div className="mt-4 p-4 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-950/30 via-slate-950 to-amber-950/20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-300 font-mono">
                    TODAY'S OPERATIONAL DIRECTIVE · {todaySummary.dayName.toUpperCase()}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    (Historical Net P&L: {todaySummary.netPnL >= 0 ? '+' : ''}${todaySummary.netPnL.toFixed(2)} · Win Rate: {todaySummary.winRate}%)
                  </span>
                </div>
                <div className="text-xs text-slate-300 flex flex-wrap items-center gap-2 font-mono">
                  <span>Recommended to ACTIVATE:</span>
                  {todaySummary.recommendedPairs.length > 0 ? (
                    todaySummary.recommendedPairs.map(p => (
                      <span key={p.pair} className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-300 font-bold text-[11px]">
                        ✓ {p.pair} (+${p.netPnL.toFixed(2)})
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-400 italic">No pairs meet aggressive edge criteria today</span>
                  )}

                  {todaySummary.avoidPairs.length > 0 && (
                    <>
                      <span className="text-slate-500 mx-1">|</span>
                      <span>AVOID / DEACTIVATE:</span>
                      {todaySummary.avoidPairs.map(p => (
                        <span key={p.pair} className="px-2 py-0.5 rounded bg-rose-950 border border-rose-800 text-rose-300 font-bold text-[11px]">
                          ✗ {p.pair} (-${Math.abs(p.netPnL).toFixed(2)})
                        </span>
                      ))}
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedDayFilter(selectedDayFilter === todaySummary.dayIndex ? null : todaySummary.dayIndex)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap border ${
                  selectedDayFilter === todaySummary.dayIndex
                    ? 'bg-amber-500 text-slate-950 border-amber-400'
                    : 'bg-amber-950/60 text-amber-300 border-amber-800/80 hover:bg-amber-900/60'
                }`}
              >
                {selectedDayFilter === todaySummary.dayIndex ? 'VIEWING TODAY ONLY' : `FILTER TODAY (${todaySummary.dayShort})`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 5-Day Weekly Strategy Cards (Monday to Friday) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {daysSummary.map(d => {
          const isSelected = selectedDayFilter === d.dayIndex;
          const isProfitable = d.netPnL >= 0;

          return (
            <div
              key={d.dayIndex}
              onClick={() => setSelectedDayFilter(isSelected ? null : d.dayIndex)}
              className={`rounded-xl p-4 transition-all cursor-pointer border flex flex-col justify-between ${
                isSelected
                  ? 'bg-slate-800/90 border-cyan-500 shadow-lg shadow-cyan-950/40 ring-1 ring-cyan-500'
                  : 'bg-slate-900 border-slate-800 hover:border-slate-700 hover:bg-slate-850'
              }`}
            >
              <div>
                {/* Header */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-sm text-white">{d.dayName}</span>
                    {d.isToday && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-bold font-mono">
                        TODAY
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">
                    {d.totalTrades} Trades
                  </span>
                </div>

                {/* Day Net PnL & Win Rate */}
                <div className="mt-3 flex items-baseline justify-between font-mono">
                  <div>
                    <div className="text-[10px] uppercase text-slate-500">Net Profit</div>
                    <div className={`text-base font-bold ${isProfitable ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isProfitable ? '+' : ''}${d.netPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase text-slate-500">Win Rate</div>
                    <div className="text-sm font-bold text-slate-200">
                      {d.winRate.toFixed(1)}%
                    </div>
                  </div>
                </div>

                {/* Activation Directive */}
                <div className="mt-3.5 space-y-2 pt-2 border-t border-slate-800/60 font-mono text-[11px]">
                  {/* Pairs to Activate */}
                  <div>
                    <div className="text-[10px] uppercase font-bold text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>ACTIVATE PAIRS:</span>
                    </div>
                    {d.recommendedPairs.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {d.recommendedPairs.map(p => (
                          <span
                            key={p.pair}
                            className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-300 font-bold text-[10px]"
                            title={`${p.pair}: +$${p.netPnL.toFixed(2)} (${p.winRate}% win rate across ${p.totalTrades} trades)`}
                          >
                            {p.pair}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-500 italic mt-0.5">No high edge pairs</div>
                    )}
                  </div>

                  {/* Pairs to Avoid */}
                  <div>
                    <div className="text-[10px] uppercase font-bold text-rose-400 flex items-center gap-1">
                      <XCircle className="w-3 h-3 text-rose-400" />
                      <span>AVOID / DEACTIVATE:</span>
                    </div>
                    {d.avoidPairs.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {d.avoidPairs.map(p => (
                          <span
                            key={p.pair}
                            className="px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-800 text-rose-300 font-bold text-[10px]"
                            title={`${p.pair}: -$${Math.abs(p.netPnL).toFixed(2)} (${p.winRate}% win rate)`}
                          >
                            {p.pair}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-500 italic mt-0.5">No pairs to avoid</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Card Footer Toggle Indicator */}
              <div className="mt-4 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>{isSelected ? '✓ Filter Applied' : 'Click to inspect'}</span>
                {d.profitFactor > 0 && <span>PF: {d.profitFactor.toFixed(2)}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Visual Chart: Net P&L and Win Rate by Day of Week */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-cyan-400" />
              <span>Net Profit & Win Rate Distribution by Day of Week</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">
              Green bars represent net profitable days; red bars highlight systematic drawdown days where pair filtering is crucial.
            </p>
          </div>
          <span className="text-[10px] font-mono text-slate-500">
            Recharts Financial Visualization
          </span>
        </div>

        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daysSummary} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="dayName" stroke="#64748b" tick={{ fontSize: 11, fontFamily: 'monospace' }} />
              <YAxis
                yAxisId="pnl"
                stroke="#64748b"
                tick={{ fontSize: 11, fontFamily: 'monospace' }}
                tickFormatter={(val: number) => `$${val}`}
              />
              <YAxis
                yAxisId="winRate"
                orientation="right"
                stroke="#38bdf8"
                domain={[0, 100]}
                tick={{ fontSize: 11, fontFamily: 'monospace' }}
                tickFormatter={(val: number) => `${val}%`}
              />
              <ReferenceLine yAxisId="pnl" y={0} stroke="#475569" strokeDasharray="3 3" />
              <Tooltip
                contentStyle={{ backgroundColor: '#020617', borderColor: '#334155', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
                formatter={(val: any, name: string) => [
                  name === 'Win Rate' ? `${Number(val).toFixed(1)}%` : `$${Number(val).toFixed(2)}`,
                  name
                ]}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px', fontFamily: 'monospace' }} />
              <Bar yAxisId="pnl" dataKey="netPnL" name="Net P&L ($)" radius={[4, 4, 0, 0]}>
                {daysSummary.map(entry => (
                  <Cell
                    key={`cell-${entry.dayIndex}`}
                    fill={entry.netPnL >= 0 ? '#10b981' : '#f43f5e'}
                  />
                ))}
              </Bar>
              <Line
                yAxisId="winRate"
                type="monotone"
                dataKey="winRate"
                name="Win Rate (%)"
                stroke="#38bdf8"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#38bdf8' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Day-of-Week x Pair Profitability Matrix Heatmap */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Day-of-Week x Currency Pair Profitability Matrix
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Heatmap showing exact performance per pair across each day of the week. Hover over cells for detailed stats or click to filter.
            </p>
          </div>

          {/* Metric Switcher */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
            <button
              type="button"
              onClick={() => setMatrixMetric('PNL')}
              className={`px-2.5 py-1 rounded transition text-[11px] font-bold ${
                matrixMetric === 'PNL' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              NET P&L ($)
            </button>
            <button
              type="button"
              onClick={() => setMatrixMetric('WIN_RATE')}
              className={`px-2.5 py-1 rounded transition text-[11px] font-bold ${
                matrixMetric === 'WIN_RATE' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              WIN RATE (%)
            </button>
            <button
              type="button"
              onClick={() => setMatrixMetric('TRADES')}
              className={`px-2.5 py-1 rounded transition text-[11px] font-bold ${
                matrixMetric === 'TRADES' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              TRADE COUNT
            </button>
          </div>
        </div>

        {allUniquePairs.length === 0 ? (
          <div className="text-center py-10 text-slate-500 font-mono text-xs">
            No trades recorded for matrix compilation in this date range.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-center text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950 text-[10px] text-slate-400 uppercase">
                  <th className="py-2.5 px-3 text-left min-w-[120px] sticky left-0 bg-slate-950 z-10 border-r border-slate-800">
                    DAY OF WEEK
                  </th>
                  {allUniquePairs.map(pair => (
                    <th key={pair} className="py-2.5 px-3 min-w-[105px]">
                      {pair}
                    </th>
                  ))}
                  <th className="py-2.5 px-3 text-right min-w-[110px] bg-slate-950/80 border-l border-slate-800">
                    DAY TOTAL
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {daysSummary.map(d => (
                  <tr key={d.dayIndex} className="hover:bg-slate-800/30 transition">
                    {/* Day Column */}
                    <td className="py-2.5 px-3 text-left font-bold text-white sticky left-0 bg-slate-900 z-10 border-r border-slate-800">
                      <div className="flex items-center justify-between">
                        <span>{d.dayName}</span>
                        {d.isToday && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500 text-slate-950 font-black">
                            TODAY
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Pair Cells */}
                    {allUniquePairs.map(pair => {
                      const edge = d.pairs.find(p => p.pair === pair);

                      if (!edge || edge.totalTrades === 0) {
                        return (
                          <td key={pair} className="py-2 px-2 text-slate-600 bg-slate-950/40">
                            —
                          </td>
                        );
                      }

                      const isProfit = edge.netPnL > 0;
                      const isLoss = edge.netPnL < 0;

                      // Color coding according to edge
                      let bgClass = 'bg-slate-900 text-slate-300';
                      if (isProfit && edge.netPnL >= 100) {
                        bgClass = 'bg-emerald-950/90 text-emerald-300 border border-emerald-700/60 font-bold';
                      } else if (isProfit) {
                        bgClass = 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40';
                      } else if (isLoss && edge.netPnL <= -100) {
                        bgClass = 'bg-rose-950/90 text-rose-300 border border-rose-700/60 font-bold';
                      } else if (isLoss) {
                        bgClass = 'bg-rose-950/60 text-rose-400 border border-rose-800/40';
                      }

                      return (
                        <td
                          key={pair}
                          onClick={() => {
                            setSelectedDayFilter(d.dayIndex);
                            setSearchPairQuery(pair);
                          }}
                          className={`py-2 px-2 cursor-pointer transition hover:scale-105 ${bgClass}`}
                          title={`${d.dayName} · ${pair}\nNet P&L: ${isProfit ? '+' : ''}$${edge.netPnL.toFixed(2)}\nWin Rate: ${edge.winRate}%\nTrades: ${edge.totalTrades} (${edge.winningTrades}W / ${edge.losingTrades}L)\nDirective: ${edge.recommendation}`}
                        >
                          <div className="text-[11px] leading-tight">
                            {matrixMetric === 'PNL' && (
                              <span>{isProfit ? '+' : ''}${Math.round(edge.netPnL)}</span>
                            )}
                            {matrixMetric === 'WIN_RATE' && (
                              <span>{edge.winRate.toFixed(0)}%</span>
                            )}
                            {matrixMetric === 'TRADES' && (
                              <span>{edge.totalTrades} ({edge.winningTrades}W)</span>
                            )}
                          </div>
                          <div className="text-[9px] opacity-75">
                            {edge.recommendation === 'ACTIVATE' ? '✓ ACTIVATE' : edge.recommendation === 'AVOID' ? '✗ AVOID' : 'NEUTRAL'}
                          </div>
                        </td>
                      );
                    })}

                    {/* Day Total Cell */}
                    <td className={`py-2 px-3 text-right font-bold border-l border-slate-800 bg-slate-950/60 ${
                      d.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {d.netPnL >= 0 ? '+' : ''}${d.netPnL.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detailed Actionable Schedule Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
        {/* Table Filters Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Pair Activation Schedule & Statistical Edge Drilldown</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Individual pair behavior per day of week with concrete actionable recommendations.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Day Filter Pills */}
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 p-1 rounded-lg text-xs font-mono">
              <button
                type="button"
                onClick={() => setSelectedDayFilter(null)}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition ${
                  selectedDayFilter === null ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ALL DAYS
              </button>
              {daysSummary.map(d => (
                <button
                  key={d.dayIndex}
                  type="button"
                  onClick={() => setSelectedDayFilter(d.dayIndex)}
                  className={`px-2 py-1 rounded text-[11px] font-semibold transition ${
                    selectedDayFilter === d.dayIndex ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {d.dayShort}
                </button>
              ))}
            </div>

            {/* Recommendation Filter */}
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 p-1 rounded-lg text-xs font-mono">
              <button
                type="button"
                onClick={() => setRecommendationFilter('ALL')}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition ${
                  recommendationFilter === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ALL
              </button>
              <button
                type="button"
                onClick={() => setRecommendationFilter('ACTIVATE')}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition ${
                  recommendationFilter === 'ACTIVATE' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ACTIVATE ONLY
              </button>
              <button
                type="button"
                onClick={() => setRecommendationFilter('AVOID')}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition ${
                  recommendationFilter === 'AVOID' ? 'bg-rose-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                AVOID ONLY
              </button>
            </div>

            {/* Pair Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchPairQuery}
                onChange={e => setSearchPairQuery(e.target.value)}
                placeholder="Search Pair / Day..."
                className="pl-8 pr-3 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 outline-none focus:border-cyan-600 w-36 sm:w-44"
              />
            </div>
          </div>
        </div>

        {/* Schedule Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400 font-bold bg-slate-950/60 font-mono">
                <th className="py-2.5 px-3 cursor-pointer" onClick={() => toggleSort('dayName')}>
                  <span>DAY {sortField === 'dayName' && (sortAsc ? '▲' : '▼')}</span>
                </th>
                <th className="py-2.5 px-3 cursor-pointer" onClick={() => toggleSort('pair')}>
                  <span>PAIR {sortField === 'pair' && (sortAsc ? '▲' : '▼')}</span>
                </th>
                <th className="py-2.5 px-3 text-center">ACTION DIRECTIVE</th>
                <th className="py-2.5 px-3 text-right cursor-pointer" onClick={() => toggleSort('totalTrades')}>
                  <span>TOTAL TRADES {sortField === 'totalTrades' && (sortAsc ? '▲' : '▼')}</span>
                </th>
                <th className="py-2.5 px-3 cursor-pointer min-w-[130px]" onClick={() => toggleSort('winRate')}>
                  <span>SUCCESS % {sortField === 'winRate' && (sortAsc ? '▲' : '▼')}</span>
                </th>
                <th className="py-2.5 px-3 text-right cursor-pointer" onClick={() => toggleSort('netPnL')}>
                  <span>NET P&L {sortField === 'netPnL' && (sortAsc ? '▲' : '▼')}</span>
                </th>
                <th className="py-2.5 px-3 text-right">PROFIT FACTOR</th>
                <th className="py-2.5 px-3 text-right">AVG WIN / LOSS</th>
                <th className="py-2.5 px-3">QUANTITATIVE REASONING</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {filteredPairRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-slate-500">
                    No day/pair combinations match your current filters.
                  </td>
                </tr>
              ) : (
                filteredPairRows.map((row, idx) => {
                  const isProfit = row.netPnL >= 0;

                  return (
                    <tr key={`${row.dayIndex}-${row.pair}-${idx}`} className="hover:bg-slate-800/40 transition">
                      <td className="py-2.5 px-3 font-bold text-white whitespace-nowrap">
                        {row.dayName}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-cyan-300 whitespace-nowrap">
                        {row.pair}
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        {row.recommendation === 'ACTIVATE' ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-300 font-bold text-[10px]">
                            ✓ ACTIVATE
                          </span>
                        ) : row.recommendation === 'AVOID' ? (
                          <span className="px-2 py-0.5 rounded bg-rose-950 border border-rose-800 text-rose-300 font-bold text-[10px]">
                            ✗ AVOID
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">
                            NEUTRAL
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300 font-semibold">
                        {row.totalTrades} <span className="text-slate-500 text-[10px]">({row.winningTrades}W / {row.losingTrades}L)</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-100 min-w-[38px]">{row.winRate.toFixed(1)}%</span>
                          <div className="flex-1 bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                            <div
                              className={`h-full transition-all ${
                                row.winRate >= 60 ? 'bg-emerald-500' : row.winRate >= 45 ? 'bg-cyan-500' : 'bg-rose-500'
                              }`}
                              style={{ width: `${Math.min(100, Math.max(0, row.winRate))}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className={`py-2.5 px-3 text-right font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isProfit ? '+' : ''}${row.netPnL.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">
                        {row.profitFactor > 0 ? row.profitFactor.toFixed(2) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-400 text-[10px]">
                        <span className="text-emerald-400">+${row.avgWin.toFixed(2)}</span> / <span className="text-rose-400">-${row.avgLoss.toFixed(2)}</span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-300 text-[10px]">
                        {row.edgeReason}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
