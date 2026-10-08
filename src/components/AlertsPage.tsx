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
  FileSpreadsheet,
  ShieldAlert,
  Timer,
  Copy,
  Check,
  Info,
  Server,
  Cpu,
  ShieldCheck
} from 'lucide-react';
import { PairPerformance, HourlyPerformance, TradeComparisonReport, RawTradeRecord } from '../services/tradeComparisonService';
import { ExecutionLatencyRecord, ExecutionLatencySummaryStats } from '../services/executionLatencyAuditService';
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

type ReportViewMode = 'ANALYTICS' | 'LEDGER' | 'EXECUTION_LATENCY';

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
  const [heatmapMode, setHeatmapMode] = useState<'ALL' | 'LOSSES' | 'WINS'>('ALL');
  const [reportViewMode, setReportViewMode] = useState<ReportViewMode>('ANALYTICS');
  const [liveAccountBalance, setLiveAccountBalance] = useState<number | null>(null);

  // Auto Live Execution Latency & Audit State
  const [latencyStats, setLatencyStats] = useState<ExecutionLatencySummaryStats | null>(null);
  const [latencyAudits, setLatencyAudits] = useState<ExecutionLatencyRecord[]>([]);
  const [latencyLoading, setLatencyLoading] = useState<boolean>(false);
  const [latencyPairFilter, setLatencyPairFilter] = useState<string>('ALL');
  const [latencyStatusFilter, setLatencyStatusFilter] = useState<string>('ALL');
  const [copiedJsonNotification, setCopiedJsonNotification] = useState<boolean>(false);
  const [selectedAuditRecord, setSelectedAuditRecord] = useState<ExecutionLatencyRecord | null>(null);

  // Fetch live account balance from broker API / database
  useEffect(() => {
    const fetchBrokerBalance = async () => {
      try {
        const res = await fetch('/api/brokers/status', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.activeAccount && typeof data.activeAccount.balance === 'number') {
            setLiveAccountBalance(data.activeAccount.balance);
          } else if (Array.isArray(data.brokers)) {
            const connectedBroker = data.brokers.find((b: any) => b.account && typeof b.account.balance === 'number');
            if (connectedBroker) {
              setLiveAccountBalance(connectedBroker.account.balance);
            }
          }
        }
      } catch {}
    };
    void fetchBrokerBalance();
  }, []);

  // Ledger daily breakdown (excluding weekends) - returns empty array if no trades available
  const ledgerDailyRows = useMemo(() => {
    if (!report || !report.rawTrades || report.rawTrades.length === 0) return [];
    
    const daysMap: Record<string, {
      dateStr: string;
      timestamp: number;
      trades: RawTradeRecord[];
      winningTrades: number;
      losingTrades: number;
      grossProfit: number;
      grossLoss: number;
      netPnL: number;
    }> = {};

    for (const t of report.rawTrades) {
      const d = new Date(t.timestamp);
      const dayOfWeek = d.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue; // Exclude weekends as requested
      }

      const dateStr = formatDateInput(d);
      if (!daysMap[dateStr]) {
        daysMap[dateStr] = {
          dateStr,
          timestamp: new Date(`${dateStr}T00:00:00`).getTime(),
          trades: [],
          winningTrades: 0,
          losingTrades: 0,
          grossProfit: 0,
          grossLoss: 0,
          netPnL: 0
        };
      }
      daysMap[dateStr].trades.push(t);
      daysMap[dateStr].netPnL += t.pnl;
      if (t.pnl > 0) {
        daysMap[dateStr].winningTrades += 1;
        daysMap[dateStr].grossProfit += t.pnl;
      } else if (t.pnl < 0) {
        daysMap[dateStr].losingTrades += 1;
        daysMap[dateStr].grossLoss += t.pnl;
      }
    }

    const sortedDays = Object.values(daysMap).sort((a, b) => a.timestamp - b.timestamp);
    if (sortedDays.length === 0) return [];

    // Anchor opening balance to live broker API account balance if available, otherwise null (never show dummy fallback)
    let runningBalance: number | null = liveAccountBalance !== null ? (liveAccountBalance - (report?.totalNetPnL || 0)) : null;
    const ledgerRows = sortedDays.map(day => {
      const openingBalance = runningBalance;
      const closingBalance = openingBalance !== null ? openingBalance + day.netPnL : null;
      const returnPct = (openingBalance !== null && openingBalance > 0) ? (day.netPnL / openingBalance) * 100 : null;
      if (runningBalance !== null && closingBalance !== null) {
        runningBalance = closingBalance;
      }

      return {
        ...day,
        openingBalance,
        closingBalance,
        returnPct,
        totalTrades: day.trades.length
      };
    });

    return ledgerRows;
  }, [report, liveAccountBalance]);

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

  const handleExportLedgerCsv = () => {
    if (!ledgerDailyRows || ledgerDailyRows.length === 0) return;
    const lines: string[] = [];
    lines.push('DAILY ACCOUNT LEDGER (WEEKENDS EXCLUDED)');
    lines.push(`Date Range: ${fromDate} to ${toDate}`);
    lines.push('');
    lines.push('Date,Opening Balance,Total Trades,Winning Trades,Winning Profit,Losing Trades,Total Loss,Net P&L,Closing Balance,Return %');
    for (const r of ledgerDailyRows) {
      const openStr = r.openingBalance !== null ? `$${r.openingBalance.toFixed(2)}` : 'N/A';
      const closeStr = r.closingBalance !== null ? `$${r.closingBalance.toFixed(2)}` : 'N/A';
      const retStr = r.returnPct !== null ? `${r.returnPct.toFixed(2)}%` : 'N/A';
      lines.push(`"${r.dateStr}",${openStr},${r.totalTrades},${r.winningTrades},$${r.grossProfit.toFixed(2)},${r.losingTrades},$${r.grossLoss.toFixed(2)},$${r.netPnL.toFixed(2)},${closeStr},${retStr}`);
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `daily-account-ledger-${fromDate}-to-${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fetchLatencyReport = useCallback(async () => {
    setLatencyLoading(true);
    try {
      const fromMs = new Date(fromDate + 'T00:00:00').getTime();
      const toMs = new Date(toDate + 'T23:59:59.999').getTime();
      const pairParam = latencyPairFilter !== 'ALL' ? `&pair=${encodeURIComponent(latencyPairFilter)}` : '';
      const statusParam = latencyStatusFilter !== 'ALL' ? `&status=${encodeURIComponent(latencyStatusFilter)}` : '';
      const res = await fetch(`/api/brokers/execution-latency?from=${fromMs}&to=${toMs}${pairParam}${statusParam}&limit=100`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.stats) setLatencyStats(data.stats);
        if (Array.isArray(data.audits)) setLatencyAudits(data.audits);
      }
    } catch (e) {
      console.error('Failed to fetch latency report:', e);
    } finally {
      setLatencyLoading(false);
    }
  }, [fromDate, toDate, latencyPairFilter, latencyStatusFilter]);

  useEffect(() => {
    if (reportViewMode === 'EXECUTION_LATENCY') {
      void fetchLatencyReport();
    }
  }, [reportViewMode, fetchLatencyReport]);

  const handleCopyLatencyJson = () => {
    if (!latencyAudits || latencyAudits.length === 0) return;
    const payload = JSON.stringify({
      reportTitle: 'Auto Live Order Execution Latency Audit',
      dateRange: `${fromDate} to ${toDate}`,
      summary: latencyStats,
      auditRecords: latencyAudits
    }, null, 2);
    void navigator.clipboard.writeText(payload);
    setCopiedJsonNotification(true);
    setTimeout(() => setCopiedJsonNotification(false), 3000);
  };

  const handleExportLatencyCsv = () => {
    if (!latencyAudits || latencyAudits.length === 0) return;
    const lines: string[] = [];
    lines.push('AUTO LIVE ORDER EXECUTION LATENCY AUDIT REPORT');
    lines.push(`Date Range: ${fromDate} to ${toDate}`);
    if (latencyStats) {
      lines.push(`Total Transactions: ${latencyStats.totalTransactions}, Executed: ${latencyStats.executedCount}, Avg Total Latency: ${latencyStats.avgTotalDurationMs}ms (${(latencyStats.avgTotalDurationMs / 1000).toFixed(2)}s), Slowest Stage: ${latencyStats.slowestStage}`);
    }
    lines.push('');
    lines.push('Timestamp,Date,Pair,Side,Status,Total_Latency_ms,Total_Latency_sec,Scan_Duration_ms,Analysis_Duration_ms,Safety_Gate_ms,Broker_Submission_ms,Broker_Order_Id,Quantity,Entry_Price,Take_Profit,Stop_Loss,Signal_Id');
    for (const a of latencyAudits) {
      lines.push(`"${new Date(a.timestamp).toISOString()}","${a.date}","${a.pair}","${a.side}","${a.status}",${a.totalDurationMs},${(a.totalDurationMs / 1000).toFixed(3)},${a.scanDurationMs},${a.analysisDurationMs},${a.safetyGateDurationMs},${a.brokerSubmissionDurationMs},"${a.brokerOrderId || ''}",${a.quantity || ''},${a.entryPrice || ''},${a.takeProfit || ''},${a.stopLoss || ''},"${a.signalId || ''}"`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `auto-execution-latency-${fromDate}-to-${toDate}.csv`);
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
      <div style={{ paddingTop: '5px', paddingBottom: '5px', marginBottom: '5px' }} className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
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
        <div style={{ paddingTop: '5px', marginTop: '5px' }} className="mt-5 pt-4 border-t border-slate-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
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

        {/* View Mode Switcher: Analytics vs Ledger */}
        <div style={{ paddingTop: '5px', marginTop: '5px' }} className="mt-4 pt-3 border-t border-slate-800/80 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReportViewMode('ANALYTICS')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
              reportViewMode === 'ANALYTICS'
                ? 'bg-cyan-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <BarChart2 className="w-4 h-4" />
            <span>ANALYTICS & CHARTS</span>
          </button>
          <button
            type="button"
            onClick={() => setReportViewMode('LEDGER')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
              reportViewMode === 'LEDGER'
                ? 'bg-cyan-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>DAILY ACCOUNT LEDGER (WEEKENDS EXCLUDED)</span>
          </button>
          <button
            type="button"
            onClick={() => setReportViewMode('EXECUTION_LATENCY')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
              reportViewMode === 'EXECUTION_LATENCY'
                ? 'bg-amber-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Timer className="w-4 h-4 text-amber-300" />
            <span>ORDER EXECUTION LATENCY & AUDIT</span>
            {latencyAudits.length > 0 && (
              <span className="px-1.5 py-0.2 text-[10px] bg-amber-950 text-amber-300 border border-amber-800 rounded-full font-mono">
                {latencyAudits.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-rose-800 bg-rose-950/40 text-rose-300 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {reportViewMode === 'LEDGER' ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-cyan-400" />
                <h2 className="text-base font-bold text-white uppercase tracking-wider">
                  Daily Account Ledger (Business Days Only · Weekends Excluded)
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Day-by-day financial ledger tracking opening balance, trade counts, winning profit, total losses, net P&L, closing balance, and daily return %. Saturdays and Sundays are excluded.
              </p>
            </div>

            <button
              type="button"
              onClick={handleExportLedgerCsv}
              disabled={ledgerDailyRows.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-emerald-800 bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 text-xs font-bold disabled:opacity-40"
            >
              <Download className="w-4 h-4" />
              <span>EXPORT LEDGER CSV</span>
            </button>
          </div>

          {/* Ledger Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] text-slate-400 bg-slate-950 uppercase">
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3 text-right">Opening Balance</th>
                  <th className="py-3 px-3 text-center">Total Trades</th>
                  <th className="py-3 px-3 text-center">Wins / Losses</th>
                  <th className="py-3 px-3 text-right">Winning Profit</th>
                  <th className="py-3 px-3 text-right">Total Loss</th>
                  <th className="py-3 px-3 text-right">Net P&L</th>
                  <th className="py-3 px-3 text-right">Closing Balance</th>
                  <th className="py-3 px-3 text-right">Return %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {ledgerDailyRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-10 text-slate-500">
                      No trading activity recorded for the selected business days range.
                    </td>
                  </tr>
                ) : (
                  ledgerDailyRows.map((r, idx) => {
                    const isPositive = r.netPnL >= 0;
                    return (
                      <tr key={idx} className="hover:bg-slate-950/50 transition">
                        <td className="py-3 px-3 font-bold text-white whitespace-nowrap">
                          {r.dateStr}
                        </td>
                        <td className="py-3 px-3 text-right text-slate-300">
                          {r.openingBalance !== null
                            ? `$${r.openingBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : <span className="text-slate-500 italic">Live Balance Pending</span>}
                        </td>
                        <td className="py-3 px-3 text-center font-bold text-cyan-300">
                          {r.totalTrades}
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <span className="text-emerald-400 font-bold">{r.winningTrades}W</span>
                          <span className="text-slate-600 mx-1">·</span>
                          <span className="text-rose-400 font-bold">{r.losingTrades}L</span>
                        </td>
                        <td className="py-3 px-3 text-right text-emerald-400 font-semibold">
                          +${r.grossProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-3 text-right text-rose-400 font-semibold">
                          -${Math.abs(r.grossLoss).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className={`py-3 px-3 text-right font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isPositive ? '+' : ''}${r.netPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-white">
                          {r.closingBalance !== null
                            ? `$${r.closingBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : <span className="text-slate-500 italic">Live Balance Pending</span>}
                        </td>
                        <td className={`py-3 px-3 text-right font-bold ${r.returnPct !== null && r.returnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {r.returnPct !== null ? `${r.returnPct >= 0 ? '+' : ''}${r.returnPct.toFixed(2)}%` : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {ledgerDailyRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-700 bg-slate-950 text-[11px] font-bold">
                    <td className="py-3 px-3 text-white uppercase">Ledger Summary</td>
                    <td className="py-3 px-3 text-right text-slate-300">
                      {ledgerDailyRows[0]?.openingBalance !== null
                        ? `$${ledgerDailyRows[0]?.openingBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : <span className="text-slate-500 italic">Live Balance Pending</span>}
                    </td>
                    <td className="py-3 px-3 text-center text-cyan-300">
                      {ledgerDailyRows.reduce((acc, r) => acc + r.totalTrades, 0)}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="text-emerald-400">{ledgerDailyRows.reduce((acc, r) => acc + r.winningTrades, 0)}W</span>
                      <span className="text-slate-600 mx-1">·</span>
                      <span className="text-rose-400">{ledgerDailyRows.reduce((acc, r) => acc + r.losingTrades, 0)}L</span>
                    </td>
                    <td className="py-3 px-3 text-right text-emerald-400">
                      +${ledgerDailyRows.reduce((acc, r) => acc + r.grossProfit, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-3 text-right text-rose-400">
                      -${Math.abs(ledgerDailyRows.reduce((acc, r) => acc + r.grossLoss, 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className={`py-3 px-3 text-right ${netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {netPnL >= 0 ? '+' : ''}${netPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-3 text-right text-white">
                      {ledgerDailyRows[ledgerDailyRows.length - 1]?.closingBalance !== null
                        ? `$${ledgerDailyRows[ledgerDailyRows.length - 1]?.closingBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : <span className="text-slate-500 italic">Live Balance Pending</span>}
                    </td>
                    <td className={`py-3 px-3 text-right ${netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ledgerDailyRows[0]?.openingBalance !== null && ledgerDailyRows[0]?.openingBalance > 0
                        ? `${netPnL >= 0 ? '+' : ''}${((netPnL / ledgerDailyRows[0].openingBalance) * 100).toFixed(2)}%`
                        : '—'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      ) : reportViewMode === 'EXECUTION_LATENCY' ? (
        <div className="space-y-5">
          {/* Top Header Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <Timer className="w-5 h-5 text-amber-400" />
                  <h2 className="text-base font-bold text-white uppercase tracking-wider">
                    AUTO LIVE ORDER EXECUTION LATENCY & AUDIT
                  </h2>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Full cycle telemetry and milestone timestamps from <strong className="text-cyan-300">SCANNING MARKET</strong> to <strong className="text-emerald-300">TRADE EXECUTED</strong> for bottleneck identification and system latency optimization.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Status Filter */}
                <select
                  value={latencyStatusFilter}
                  onChange={e => setLatencyStatusFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="EXECUTED">Executed Only</option>
                  <option value="BLOCKED">Blocked Only</option>
                </select>

                {/* Pair Filter */}
                <select
                  value={latencyPairFilter}
                  onChange={e => setLatencyPairFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none"
                >
                  <option value="ALL">All Currency Pairs</option>
                  <option value="EUR/USD">EUR/USD</option>
                  <option value="GBP/USD">GBP/USD</option>
                  <option value="USD/JPY">USD/JPY</option>
                  <option value="AUD/USD">AUD/USD</option>
                  <option value="USD/CAD">USD/CAD</option>
                  <option value="USD/CHF">USD/CHF</option>
                  <option value="NZD/USD">NZD/USD</option>
                </select>

                {/* Copy JSON Button */}
                <button
                  type="button"
                  onClick={handleCopyLatencyJson}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white shadow"
                  title="Copy formatted JSON data of all recorded transactions to provide for system improvement"
                >
                  {copiedJsonNotification ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedJsonNotification ? 'COPIED TO CLIPBOARD!' : 'COPY AUDIT JSON'}</span>
                </button>

                {/* Export CSV Button */}
                <button
                  type="button"
                  onClick={handleExportLatencyCsv}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>EXPORT CSV</span>
                </button>

                {/* Refresh Button */}
                <button
                  type="button"
                  onClick={() => void fetchLatencyReport()}
                  disabled={latencyLoading}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${latencyLoading ? 'animate-spin text-cyan-400' : ''}`} />
                  <span>REFRESH</span>
                </button>
              </div>
            </div>

            {/* KPI Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* Avg Total Latency */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <div className="text-[10px] uppercase text-amber-400 font-bold flex items-center justify-between">
                  <span>TOTAL CYCLE (AVG)</span>
                  <Timer className="w-3 h-3 text-amber-400" />
                </div>
                <div className="text-xl font-bold text-white mt-1">
                  {latencyStats ? `${latencyStats.avgTotalDurationMs.toLocaleString()} ms` : '—'}
                </div>
                <div className="text-[10px] text-amber-400/90 mt-0.5">
                  {latencyStats ? `${(latencyStats.avgTotalDurationMs / 1000).toFixed(2)}s · Min ${latencyStats.minTotalDurationMs}ms` : '—'}
                </div>
              </div>

              {/* Market Scanning */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <div className="text-[10px] uppercase text-cyan-400 font-bold flex items-center justify-between">
                  <span>1. MARKET SCAN</span>
                  <Search className="w-3 h-3 text-cyan-400" />
                </div>
                <div className="text-xl font-bold text-cyan-300 mt-1">
                  {latencyStats ? `${latencyStats.avgScanDurationMs} ms` : '—'}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Quotes & cycle inputs</div>
              </div>

              {/* Signal & ML Analysis */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <div className="text-[10px] uppercase text-blue-400 font-bold flex items-center justify-between">
                  <span>2. ML ANALYSIS</span>
                  <Cpu className="w-3 h-3 text-blue-400" />
                </div>
                <div className="text-xl font-bold text-blue-300 mt-1">
                  {latencyStats ? `${latencyStats.avgAnalysisDurationMs} ms` : '—'}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Signals & short-TP</div>
              </div>

              {/* Safety & Readiness */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <div className="text-[10px] uppercase text-purple-400 font-bold flex items-center justify-between">
                  <span>3. SAFETY GATES</span>
                  <ShieldCheck className="w-3 h-3 text-purple-400" />
                </div>
                <div className="text-xl font-bold text-purple-300 mt-1">
                  {latencyStats ? `${latencyStats.avgSafetyGateDurationMs} ms` : '—'}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Exposure & limits</div>
              </div>

              {/* Broker Roundtrip */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <div className="text-[10px] uppercase text-rose-400 font-bold flex items-center justify-between">
                  <span>4. BROKER ROUNDTRIP</span>
                  <Server className="w-3 h-3 text-rose-400" />
                </div>
                <div className="text-xl font-bold text-rose-300 mt-1">
                  {latencyStats ? `${latencyStats.avgBrokerSubmissionDurationMs} ms` : '—'}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">cTrader WebSocket API</div>
              </div>

              {/* Bottleneck Callout */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <div className="text-[10px] uppercase text-slate-400 font-bold flex items-center justify-between">
                  <span>BOTTLENECK STAGE</span>
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                </div>
                <div className="text-xs font-bold text-amber-300 mt-1.5 truncate">
                  {latencyStats?.slowestStage || 'N/A'}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Consumes majority of latency</div>
              </div>
            </div>

            {/* Stage Latency Distribution Visual Stack */}
            {latencyStats && latencyStats.avgTotalDurationMs > 0 && (
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                    Average Stage Timing Breakdown (% of total cycle):
                  </span>
                  <span className="font-mono text-slate-400 text-[11px]">
                    Total: {latencyStats.avgTotalDurationMs} ms (100%)
                  </span>
                </div>
                <div className="w-full h-4 bg-slate-900 rounded-full flex overflow-hidden border border-slate-800">
                  <div
                    style={{ width: `${Math.max(4, (latencyStats.avgScanDurationMs / latencyStats.avgTotalDurationMs) * 100)}%` }}
                    className="bg-cyan-500 hover:bg-cyan-400 transition"
                    title={`Market Scan: ${latencyStats.avgScanDurationMs}ms (${Math.round((latencyStats.avgScanDurationMs / latencyStats.avgTotalDurationMs) * 100)}%)`}
                  />
                  <div
                    style={{ width: `${Math.max(4, (latencyStats.avgAnalysisDurationMs / latencyStats.avgTotalDurationMs) * 100)}%` }}
                    className="bg-blue-500 hover:bg-blue-400 transition"
                    title={`ML Analysis: ${latencyStats.avgAnalysisDurationMs}ms (${Math.round((latencyStats.avgAnalysisDurationMs / latencyStats.avgTotalDurationMs) * 100)}%)`}
                  />
                  <div
                    style={{ width: `${Math.max(4, (latencyStats.avgSafetyGateDurationMs / latencyStats.avgTotalDurationMs) * 100)}%` }}
                    className="bg-purple-500 hover:bg-purple-400 transition"
                    title={`Safety Gates: ${latencyStats.avgSafetyGateDurationMs}ms (${Math.round((latencyStats.avgSafetyGateDurationMs / latencyStats.avgTotalDurationMs) * 100)}%)`}
                  />
                  <div
                    style={{ width: `${Math.max(4, (latencyStats.avgBrokerSubmissionDurationMs / latencyStats.avgTotalDurationMs) * 100)}%` }}
                    className="bg-rose-500 hover:bg-rose-400 transition"
                    title={`Broker Roundtrip: ${latencyStats.avgBrokerSubmissionDurationMs}ms (${Math.round((latencyStats.avgBrokerSubmissionDurationMs / latencyStats.avgTotalDurationMs) * 100)}%)`}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-400 pt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500" />
                    <span>Market Scan ({Math.round((latencyStats.avgScanDurationMs / latencyStats.avgTotalDurationMs) * 100)}%)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" />
                    <span>ML Analysis ({Math.round((latencyStats.avgAnalysisDurationMs / latencyStats.avgTotalDurationMs) * 100)}%)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-purple-500" />
                    <span>Safety Gates ({Math.round((latencyStats.avgSafetyGateDurationMs / latencyStats.avgTotalDurationMs) * 100)}%)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
                    <span>Broker API Roundtrip ({Math.round((latencyStats.avgBrokerSubmissionDurationMs / latencyStats.avgTotalDurationMs) * 100)}%)</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Comparative Transaction Stage Chart */}
          {latencyAudits.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Recent Orders Latency Breakdown (Stage Stacked MS)
                  </h3>
                </div>
                <span className="text-xs text-slate-400">
                  Showing last {Math.min(latencyAudits.length, 12)} transactions
                </span>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={latencyAudits.slice(0, 12).reverse().map((a, i) => ({
                      label: `#${i + 1} ${a.pair} (${a.side})`,
                      scan: a.scanDurationMs,
                      analysis: a.analysisDurationMs,
                      safety: a.safetyGateDurationMs,
                      broker: a.brokerSubmissionDurationMs,
                      total: a.totalDurationMs
                    }))}
                    margin={{ top: 10, right: 10, left: -10, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" />
                    <YAxis stroke="#64748b" tick={{ fontSize: 10 }} unit="ms" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.5rem', fontSize: '11px' }}
                      formatter={(val: any, name: string) => [`${val} ms`, name]}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                    <Bar dataKey="scan" name="1. Market Scan" stackId="a" fill="#06b6d4" />
                    <Bar dataKey="analysis" name="2. ML Analysis" stackId="a" fill="#3b82f6" />
                    <Bar dataKey="safety" name="3. Safety Gates" stackId="a" fill="#a855f7" />
                    <Bar dataKey="broker" name="4. Broker API" stackId="a" fill="#f43f5e" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Audit Records Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Order Telemetry Audit Records ({latencyAudits.length} Records)
                </h3>
              </div>
              <span className="text-xs text-slate-400">
                Sorted by most recent execution first
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase tracking-wider bg-slate-950/60 font-semibold">
                    <th className="py-2.5 px-3 text-left">Time</th>
                    <th className="py-2.5 px-3 text-left">Pair</th>
                    <th className="py-2.5 px-3 text-center">Side</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                    <th className="py-2.5 px-3 text-right">Total Latency</th>
                    <th className="py-2.5 px-3 text-right">Scan</th>
                    <th className="py-2.5 px-3 text-right">ML Analysis</th>
                    <th className="py-2.5 px-3 text-right">Safety Gates</th>
                    <th className="py-2.5 px-3 text-right">Broker Roundtrip</th>
                    <th className="py-2.5 px-3 text-right">Fill Price</th>
                    <th className="py-2.5 px-3 text-center">Broker Order ID</th>
                    <th className="py-2.5 px-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {latencyAudits.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-8 text-center text-slate-500">
                        No execution latency audits found for the selected filter and date range.
                      </td>
                    </tr>
                  ) : (
                    latencyAudits.map((a) => {
                      const d = new Date(a.timestamp);
                      const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                      const isExecuted = a.status === 'EXECUTED';
                      const latencyColor = a.totalDurationMs < 1500
                        ? 'text-emerald-400'
                        : a.totalDurationMs < 3000
                          ? 'text-amber-400'
                          : 'text-rose-400';

                      return (
                        <tr key={a.id} className="hover:bg-slate-800/40 transition">
                          <td className="py-2.5 px-3 text-slate-300">
                            {timeStr} <span className="text-[10px] text-slate-500 font-sans">{a.date}</span>
                          </td>
                          <td className="py-2.5 px-3 font-bold text-white font-sans">
                            {a.pair}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${a.side === 'BUY' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-rose-950 text-rose-300 border border-rose-800'}`}>
                              {a.side}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isExecuted ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-950 text-amber-300 border border-amber-800'}`}>
                              {a.status}
                            </span>
                          </td>
                          <td className={`py-2.5 px-3 text-right font-bold ${latencyColor}`}>
                            {(a.totalDurationMs / 1000).toFixed(2)}s <span className="text-[10px] text-slate-500">({a.totalDurationMs}ms)</span>
                          </td>
                          <td className="py-2.5 px-3 text-right text-cyan-300">
                            {a.scanDurationMs} ms
                          </td>
                          <td className="py-2.5 px-3 text-right text-blue-300">
                            {a.analysisDurationMs} ms
                          </td>
                          <td className="py-2.5 px-3 text-right text-purple-300">
                            {a.safetyGateDurationMs} ms
                          </td>
                          <td className="py-2.5 px-3 text-right text-rose-300">
                            {a.brokerSubmissionDurationMs} ms
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-200">
                            {a.entryPrice ? a.entryPrice.toFixed(5) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-center text-slate-400 text-[11px] truncate max-w-[120px]" title={a.brokerOrderId}>
                            {a.brokerOrderId || '—'}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => setSelectedAuditRecord(a)}
                              className="px-2 py-1 rounded bg-slate-950 hover:bg-slate-800 text-[10px] text-cyan-400 border border-slate-800 transition"
                            >
                              Details
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Details Modal */}
          {selectedAuditRecord && (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-5 space-y-4 shadow-2xl">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Timer className="w-5 h-5 text-amber-400" />
                    <h3 className="text-sm font-bold text-white uppercase">
                      Execution Latency Telemetry Details
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedAuditRecord(null)}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
                  >
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div><span className="text-slate-500">Pair:</span> <span className="font-bold text-white">{selectedAuditRecord.pair}</span></div>
                  <div><span className="text-slate-500">Direction:</span> <span className="font-bold text-cyan-300">{selectedAuditRecord.side}</span></div>
                  <div><span className="text-slate-500">Status:</span> <span className="font-bold text-emerald-400">{selectedAuditRecord.status}</span></div>
                  <div><span className="text-slate-500">Total Latency:</span> <span className="font-bold text-amber-300">{selectedAuditRecord.totalDurationMs} ms ({(selectedAuditRecord.totalDurationMs / 1000).toFixed(3)}s)</span></div>
                  <div><span className="text-slate-500">Broker Order ID:</span> <span className="font-mono text-slate-300">{selectedAuditRecord.brokerOrderId || 'N/A'}</span></div>
                  <div><span className="text-slate-500">Execution Price:</span> <span className="font-mono text-slate-300">{selectedAuditRecord.entryPrice || 'N/A'}</span></div>
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Milestone Breakdown Timestamps & Latency:
                  </div>
                  <div className="space-y-1.5 text-xs font-mono bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-cyan-400">1. Market Data & News Scan:</span>
                      <span className="text-white font-bold">{selectedAuditRecord.scanDurationMs} ms</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-blue-400">2. Technical & ML Prediction Analysis:</span>
                      <span className="text-white font-bold">{selectedAuditRecord.analysisDurationMs} ms</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-purple-400">3. Sizing & Safety Readiness Gates:</span>
                      <span className="text-white font-bold">{selectedAuditRecord.safetyGateDurationMs} ms</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-rose-400">4. Broker WebSocket Submission & Fill:</span>
                      <span className="text-white font-bold">{selectedAuditRecord.brokerSubmissionDurationMs} ms</span>
                    </div>
                    <div className="flex justify-between py-1 text-amber-300 font-bold">
                      <span>Total Time from Scan to Trade Executed:</span>
                      <span>{selectedAuditRecord.totalDurationMs} ms</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Raw Telemetry JSON:
                  </div>
                  <pre className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-[10px] text-slate-300 overflow-x-auto max-h-40 font-mono">
                    {JSON.stringify(selectedAuditRecord, null, 2)}
                  </pre>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(JSON.stringify(selectedAuditRecord, null, 2));
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedAuditRecord(null)}
                    className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Top Level Summary Cards */}
      <div style={{ marginBottom: '10px' }} className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div style={{ paddingTop: '5px', paddingBottom: '5px' }} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] uppercase text-slate-500 font-bold">TOTAL TRADES</div>
          <div className="text-xl font-bold text-white mt-1">{totalTrades}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{report ? `${report.fromDateStr} to ${report.toDateStr}` : '—'}</div>
        </div>

        <div style={{ paddingTop: '5px', paddingBottom: '5px' }} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] uppercase text-emerald-400 font-bold flex items-center justify-between">
            <span>WINNING TRADES</span>
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-400 mt-1">{winningTrades}</div>
          <div className="text-[10px] text-emerald-500/80 mt-0.5">{totalTrades > 0 ? `${((winningTrades / totalTrades) * 100).toFixed(1)}% of total` : '0%'}</div>
        </div>

        <div style={{ paddingTop: '5px', paddingBottom: '5px' }} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] uppercase text-rose-400 font-bold flex items-center justify-between">
            <span>LOOSE TRADES</span>
            <XCircle className="w-3 h-3 text-rose-400" />
          </div>
          <div className="text-xl font-bold text-rose-400 mt-1">{losingTrades}</div>
          <div className="text-[10px] text-rose-500/80 mt-0.5">{totalTrades > 0 ? `${((losingTrades / totalTrades) * 100).toFixed(1)}% of total` : '0%'}</div>
        </div>

        <div style={{ paddingTop: '5px', paddingBottom: '5px' }} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] uppercase text-cyan-400 font-bold">SUCCESS % (WIN RATE)</div>
          <div className="text-xl font-bold text-cyan-300 mt-1">{winRate.toFixed(1)}%</div>
          <div className="w-full bg-slate-950 rounded-full h-1.5 mt-1.5 overflow-hidden border border-slate-800">
            <div className="bg-cyan-500 h-full transition-all" style={{ width: `${Math.min(100, Math.max(0, winRate))}%` }} />
          </div>
        </div>

        <div style={{ paddingTop: '5px', paddingBottom: '5px' }} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[10px] uppercase text-slate-400 font-bold">TOTAL NET P&L</div>
          <div className={`text-xl font-bold mt-1 ${netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {netPnL >= 0 ? '+' : ''}${netPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">PF: {profitFactor > 0 ? profitFactor.toFixed(2) : '—'}</div>
        </div>

        <div style={{ paddingTop: '5px', paddingBottom: '5px' }} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
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
        <div style={{ paddingTop: '5px', paddingBottom: '5px', marginBottom: '10px' }} className="bg-slate-900/90 border border-cyan-900/70 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-bold text-white mb-3">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>Quantitative Edge Insights & Strategy Recommendations</span>
          </div>

          <div style={{ marginBottom: '5px' }} className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
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

          <div style={{ marginBottom: '5px' }} className="space-y-1.5 text-xs text-slate-300 bg-slate-950/70 p-3.5 rounded-lg border border-slate-800">
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

      {/* Advanced Quantitative Risk Metrics & Session Attribution Hub */}
      {report?.riskMetrics && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <span>Advanced Quantitative Risk & Session Attribution Hub</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <div className="text-[10px] uppercase text-slate-500 font-bold">EXPECTANCY / TRADE</div>
              <div className={`text-base font-bold mt-1 ${report.riskMetrics.expectancyPerTrade >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {report.riskMetrics.expectancyPerTrade >= 0 ? '+' : ''}${report.riskMetrics.expectancyPerTrade.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Average edge per execution</div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <div className="text-[10px] uppercase text-slate-500 font-bold">KELLY CRITERION SIZING</div>
              <div className="text-base font-bold text-cyan-300 mt-1">
                {report.riskMetrics.kellyCriterionPct.toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Optimal capital allocation</div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <div className="text-[10px] uppercase text-slate-500 font-bold">VALUE AT RISK (VaR 95%)</div>
              <div className="text-base font-bold text-rose-400 mt-1">
                ${Math.abs(report.riskMetrics.valueAtRisk95).toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">95th percentile tail loss</div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <div className="text-[10px] uppercase text-slate-500 font-bold">MAX DRAWDOWN</div>
              <div className="text-base font-bold text-rose-400 mt-1">
                -${report.riskMetrics.maxDrawdown.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Peak-to-trough drop</div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <div className="text-[10px] uppercase text-slate-500 font-bold">RECOVERY FACTOR</div>
              <div className="text-base font-bold text-emerald-400 mt-1">
                {report.riskMetrics.recoveryFactor.toFixed(2)}x
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Net PnL / Max Drawdown</div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <div className="text-[10px] uppercase text-slate-500 font-bold">PAYOFF RATIO</div>
              <div className="text-base font-bold text-amber-300 mt-1">
                {report.riskMetrics.payoffRatio.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Avg Win / Avg Loss</div>
            </div>
          </div>

          {report?.sessionAttribution && report.sessionAttribution.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-800">
              <div className="text-xs font-bold text-slate-300 uppercase mb-3">
                Global Market Session Attribution (UTC)
              </div>
              <div className="grid md:grid-cols-3 gap-3">
                {report.sessionAttribution.map((sess, idx) => {
                  const isPos = sess.netPnL >= 0;
                  return (
                    <div key={idx} className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">{sess.sessionName}</span>
                        <span className="text-[10px] text-slate-500 font-mono">{sess.timeRange}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-slate-400">{sess.totalTrades} trades ({sess.winRate}% win)</span>
                        <span className={`font-bold ${isPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isPos ? '+' : ''}${sess.netPnL.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-bold text-white uppercase">Pair vs Hour Trade Density & Profitability Heatmap</h2>
          </div>

          {/* Heatmap View Mode Switcher */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
            <button
              onClick={() => setHeatmapMode('ALL')}
              className={`px-2.5 py-1 rounded transition text-[11px] font-bold ${
                heatmapMode === 'ALL'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ALL TRADES (DENSITY)
            </button>
            <button
              onClick={() => setHeatmapMode('LOSSES')}
              className={`px-2.5 py-1 rounded transition text-[11px] font-bold ${
                heatmapMode === 'LOSSES'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              LOSS TRADES ONLY ({report?.losingTrades || 0})
            </button>
            <button
              onClick={() => setHeatmapMode('WINS')}
              className={`px-2.5 py-1 rounded transition text-[11px] font-bold ${
                heatmapMode === 'WINS'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              WIN TRADES ONLY ({report?.winningTrades || 0})
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-400 mb-4">
          Visualize trade concentration and performance density across 24 hours for each traded pair. Toggle modes above to isolate all 31 loss trades or 340 win trades by exact execution hour.
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
                  const hourCounts = Array.from({ length: 24 }, () => ({ count: 0, pnl: 0, wins: 0, losses: 0 }));
                  for (const t of pairTrades) {
                    const hr = new Date(t.timestamp).getHours();
                    if (hr >= 0 && hr < 24) {
                      hourCounts[hr].count += 1;
                      hourCounts[hr].pnl += t.pnl;
                      if (t.pnl < 0) {
                        hourCounts[hr].losses += 1;
                      } else {
                        hourCounts[hr].wins += 1;
                      }
                    }
                  }

                  return (
                    <tr key={p.pair} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 font-bold text-white whitespace-nowrap flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-cyan-400" />
                        <span>{p.pair}</span>
                      </td>
                      {hourCounts.map((cell, h) => {
                        let displayCount = cell.count;
                        let hasActivity = cell.count > 0;
                        let bgClass = 'bg-slate-950/60 text-slate-600 border border-slate-800/50';

                        if (heatmapMode === 'LOSSES') {
                          displayCount = cell.losses;
                          hasActivity = cell.losses > 0;
                          if (hasActivity) {
                            bgClass = cell.losses >= 3
                              ? 'bg-rose-600 text-white font-bold shadow-sm'
                              : 'bg-rose-950 text-rose-300 border border-rose-800 font-semibold';
                          }
                        } else if (heatmapMode === 'WINS') {
                          displayCount = cell.wins;
                          hasActivity = cell.wins > 0;
                          if (hasActivity) {
                            bgClass = cell.wins >= 3
                              ? 'bg-emerald-600 text-white font-bold shadow-sm'
                              : 'bg-emerald-950 text-emerald-300 border border-emerald-800 font-semibold';
                          }
                        } else {
                          // ALL TRADES (Density)
                          const isProfitable = cell.pnl > 0;
                          const isLoss = cell.pnl < 0;

                          if (hasActivity) {
                            if (isProfitable) {
                              bgClass = cell.count >= 3
                                ? 'bg-emerald-600 text-white font-bold shadow-sm'
                                : 'bg-emerald-950 text-emerald-300 border border-emerald-800';
                            } else if (isLoss) {
                              bgClass = cell.count >= 3
                                ? 'bg-rose-600 text-white font-bold shadow-sm'
                                : 'bg-rose-950 text-rose-300 border border-rose-800';
                            } else {
                              bgClass = 'bg-slate-800 text-slate-200';
                            }
                          }
                        }

                        return (
                          <td key={h} className="py-1 px-1 text-center">
                            <div
                              title={`${p.pair} @ ${pad(h)}:00 — ${cell.count} Trades (${cell.wins} Wins, ${cell.losses} Losses) | Net P&L: ${cell.pnl >= 0 ? '+' : ''}$${cell.pnl.toFixed(2)}`}
                              className={`h-8 rounded flex flex-col items-center justify-center cursor-default transition ${bgClass}`}
                            >
                              <span className="text-[10px] leading-none">{hasActivity ? displayCount : '·'}</span>
                              {heatmapMode === 'ALL' && cell.losses > 0 && cell.wins > 0 && (
                                <span className="text-[8px] text-rose-300/80 leading-none mt-0.5">-{cell.losses}L</span>
                              )}
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
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-600" /> Drawdown Hour / Loss Focus</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-950 border border-slate-800" /> Zero Activity</span>
          </div>
          <span>Hover over cells for precise Win/Loss count and Net P&L</span>
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
      </>
      )}
    </div>
  );
};
