import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart2,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  FileSpreadsheet,
  Filter,
  Layers,
  PieChart,
  RefreshCw,
  Search,
  Shield,
  TrendingDown,
  TrendingUp,
  Wallet,
  XCircle,
  Percent,
  Sparkles,
  Info
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine
} from 'recharts';

type DatePreset = 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'CURRENT_MONTH' | 'PREVIOUS_MONTH';
type CurrencyDisplay = 'USD' | 'INR';

interface RawTradeRecord {
  id: string;
  broker: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  timestamp: number;
  pnl: number;
  commission: number;
  status: string;
}

interface OpenPositionRecord {
  id?: string;
  positionId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL?: number;
  unrealizedPnl?: number;
  currency?: string;
  openedAt?: number;
}

interface ChartTimePoint {
  timeLabel: string;
  timestamp: number;
  equity: number;
  realizedPnL: number;
  unrealizedPnL: number;
  netPnL: number;
  tradePnL?: number;
  symbol?: string;
  side?: string;
  type: 'START' | 'TRADE' | 'LIVE_NOW';
  drawdown: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

function formatDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getPresetBounds(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  switch (preset) {
    case 'TODAY': {
      const s = formatDateInput(now);
      return { from: s, to: s };
    }
    case 'YESTERDAY': {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const s = formatDateInput(y);
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

export const PnLAccountingPage: React.FC = () => {
  const [preset, setPreset] = useState<DatePreset>('TODAY');
  const initialBounds = useMemo(() => getPresetBounds('TODAY'), []);
  const [fromDate, setFromDate] = useState<string>(initialBounds.from);
  const [toDate, setToDate] = useState<string>(initialBounds.to);

  const [currency, setCurrency] = useState<CurrencyDisplay>('USD');
  const [usdInrRate, setUsdInrRate] = useState<number>(86.5);

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Authoritative data states
  const [rawTrades, setRawTrades] = useState<RawTradeRecord[]>([]);
  const [openPositions, setOpenPositions] = useState<OpenPositionRecord[]>([]);
  const [accountBalance, setAccountBalance] = useState<number>(10000);
  const [accountEquity, setAccountEquity] = useState<number>(10000);
  const [totalRealizedPnL, setTotalRealizedPnL] = useState<number>(0);
  const [totalUnrealizedPnL, setTotalUnrealizedPnL] = useState<number>(0);
  const [lastSyncTime, setLastSyncTime] = useState<number>(Date.now());

  // Chart Visibility Toggles
  const [showEquityCurve, setShowEquityCurve] = useState<boolean>(true);
  const [showRealizedPnL, setShowRealizedPnL] = useState<boolean>(true);
  const [showUnrealizedPnL, setShowUnrealizedPnL] = useState<boolean>(true);
  const [showNetPnL, setShowNetPnL] = useState<boolean>(true);
  const [chartMode, setChartMode] = useState<'COMBINED' | 'EQUITY_FOCUS' | 'PNL_FOCUS'>('COMBINED');

  // Sub Tab Navigation
  const [activeSubTab, setActiveSubTab] = useState<'PERFORMANCE' | 'POSITIONS' | 'LEDGER'>('PERFORMANCE');
  const [tradeSearch, setTradeSearch] = useState<string>('');

  // Fetch FX rates
  useEffect(() => {
    fetch('/api/governance/accounting/fx-rates')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        const rate = Number(data?.pairs?.USD_INR?.rate);
        if (Number.isFinite(rate) && rate > 0) {
          setUsdInrRate(rate);
        }
      })
      .catch(() => {});
  }, []);

  // Main data fetch function
  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setRefreshing(true);
    setError(null);

    try {
      const fromMs = new Date(`${fromDate}T00:00:00`).getTime();
      const toMs = new Date(`${toDate}T23:59:59.999`).getTime();

      const [tradeCompRes, positionsRes, statusRes, todaySummaryRes] = await Promise.all([
        fetch(`/api/brokers/trade-comparison?from=${fromMs}&to=${toMs}`, { cache: 'no-store' }).catch(() => null),
        fetch('/api/brokers/positions', { cache: 'no-store' }).catch(() => null),
        fetch('/api/brokers/status', { cache: 'no-store' }).catch(() => null),
        fetch('/api/brokers/today-trades-summary', { cache: 'no-store' }).catch(() => null)
      ]);

      let tradesList: RawTradeRecord[] = [];
      if (tradeCompRes?.ok) {
        const compData = await tradeCompRes.json().catch(() => null);
        if (Array.isArray(compData?.rawTrades)) {
          tradesList = compData.rawTrades;
        }
      }

      let posList: OpenPositionRecord[] = [];
      let totalFloatingUnrealized = 0;
      if (positionsRes?.ok) {
        const posData = await positionsRes.json().catch(() => []);
        if (Array.isArray(posData)) {
          posList = posData;
          totalFloatingUnrealized = posList.reduce((acc, p) => {
            const val = Number(p.unrealizedPnL ?? p.unrealizedPnl ?? 0);
            return acc + (Number.isFinite(val) ? val : 0);
          }, 0);
        }
      }

      let balanceVal = 10000;
      let equityVal = 10000;
      if (statusRes?.ok) {
        const statusData = await statusRes.json().catch(() => null);
        if (statusData?.activeAccount) {
          if (typeof statusData.activeAccount.balance === 'number') balanceVal = statusData.activeAccount.balance;
          if (typeof statusData.activeAccount.equity === 'number') equityVal = statusData.activeAccount.equity;
        } else if (Array.isArray(statusData?.brokers)) {
          const connected = statusData.brokers.find((b: any) => b.account && typeof b.account.balance === 'number');
          if (connected) {
            balanceVal = connected.account.balance;
            equityVal = connected.account.equity || balanceVal;
          }
        }
      }

      if (todaySummaryRes?.ok && preset === 'TODAY') {
        const summary = await todaySummaryRes.json().catch(() => null);
        if (summary && typeof summary.realizedPnL === 'number') {
          // If summary reports more accurate realized PnL for today
          setTotalRealizedPnL(summary.realizedPnL);
        }
      } else {
        const realizedSum = tradesList.reduce((acc, t) => acc + (Number(t.pnl) || 0), 0);
        setTotalRealizedPnL(realizedSum);
      }

      setRawTrades(tradesList);
      setOpenPositions(posList);
      setAccountBalance(balanceVal);
      setAccountEquity(equityVal || (balanceVal + totalFloatingUnrealized));
      setTotalUnrealizedPnL(totalFloatingUnrealized);
      setLastSyncTime(Date.now());
    } catch (err: any) {
      console.error('Failed to load PnL / Accounting data:', err);
      setError(err?.message || 'Failed to retrieve authoritative PnL accounting telemetry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fromDate, toDate, preset]);

  useEffect(() => {
    void fetchData();
    const timer = setInterval(() => void fetchData(true), 15000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const handleApplyPreset = (p: DatePreset) => {
    setPreset(p);
    const bounds = getPresetBounds(p);
    setFromDate(bounds.from);
    setToDate(bounds.to);
  };

  // Currency multiplier
  const fxMultiplier = currency === 'INR' ? usdInrRate : 1;
  const currencySymbol = currency === 'INR' ? '₹' : '$';

  const formatMoney = (val: number | null | undefined, forceDecimals = 2) => {
    if (val === null || val === undefined || !Number.isFinite(val)) return '—';
    const converted = val * fxMultiplier;
    const sign = converted < 0 ? '-' : '';
    const abs = Math.abs(converted);
    return `${sign}${currencySymbol}${abs.toLocaleString(undefined, {
      minimumFractionDigits: forceDecimals,
      maximumFractionDigits: forceDecimals
    })}`;
  };

  // Performance calculations
  const totalNetPnL = totalRealizedPnL + totalUnrealizedPnL;
  const winningTrades = rawTrades.filter(t => (t.pnl || 0) > 0.0001);
  const losingTrades = rawTrades.filter(t => (t.pnl || 0) < -0.0001);
  const grossProfit = winningTrades.reduce((acc, t) => acc + t.pnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((acc, t) => acc + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.9 : 0;
  const winRate = rawTrades.length > 0 ? (winningTrades.length / rawTrades.length) * 100 : 0;

  // Starting balance anchor
  const startingEquityAnchor = useMemo(() => {
    // If account balance is known, subtract current period's total net PnL to get baseline
    const base = accountBalance - totalRealizedPnL;
    return base > 0 ? base : accountBalance;
  }, [accountBalance, totalRealizedPnL]);

  // Construct High-Fidelity Time Series for Recharts
  const chartData: ChartTimePoint[] = useMemo(() => {
    const points: ChartTimePoint[] = [];

    const fromTs = new Date(`${fromDate}T00:00:00`).getTime();
    const toTs = new Date(`${toDate}T23:59:59.999`).getTime();

    // 1. Initial starting point at beginning of period
    let runningRealized = 0;
    let peakEquity = startingEquityAnchor;

    const startLabel = fromDate === toDate
      ? '00:00'
      : new Date(fromTs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    points.push({
      timeLabel: startLabel,
      timestamp: fromTs,
      equity: Number(startingEquityAnchor.toFixed(2)),
      realizedPnL: 0,
      unrealizedPnL: 0,
      netPnL: 0,
      type: 'START',
      drawdown: 0
    });

    // Sort trades chronologically
    const sortedTrades = [...rawTrades].sort((a, b) => a.timestamp - b.timestamp);

    for (const trade of sortedTrades) {
      runningRealized += Number(trade.pnl || 0);
      const currentEq = startingEquityAnchor + runningRealized;
      if (currentEq > peakEquity) {
        peakEquity = currentEq;
      }
      const dd = peakEquity - currentEq;

      const dateObj = new Date(trade.timestamp);
      const timeStr = fromDate === toDate
        ? `${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`
        : `${dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;

      points.push({
        timeLabel: timeStr,
        timestamp: trade.timestamp,
        equity: Number(currentEq.toFixed(2)),
        realizedPnL: Number(runningRealized.toFixed(2)),
        unrealizedPnL: 0, // Closed trade has 0 floating unrealized
        netPnL: Number(runningRealized.toFixed(2)),
        tradePnL: Number((trade.pnl || 0).toFixed(2)),
        symbol: trade.symbol,
        side: trade.side,
        type: 'TRADE',
        drawdown: Number(dd.toFixed(2))
      });
    }

    // 2. Final current live point (incorporating live open positions unrealized PnL)
    const now = Date.now();
    const liveTimeStr = fromDate === toDate
      ? `${pad(new Date(now).getHours())}:${pad(new Date(now).getMinutes())} (LIVE)`
      : `${new Date(now).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} LIVE`;

    const liveTotalNet = runningRealized + totalUnrealizedPnL;
    const liveEquity = startingEquityAnchor + liveTotalNet;
    if (liveEquity > peakEquity) {
      peakEquity = liveEquity;
    }
    const liveDd = peakEquity - liveEquity;

    points.push({
      timeLabel: liveTimeStr,
      timestamp: now,
      equity: Number(liveEquity.toFixed(2)),
      realizedPnL: Number(runningRealized.toFixed(2)),
      unrealizedPnL: Number(totalUnrealizedPnL.toFixed(2)),
      netPnL: Number(liveTotalNet.toFixed(2)),
      type: 'LIVE_NOW',
      drawdown: Number(liveDd.toFixed(2))
    });

    // If there were no intermediate trades and only START and LIVE, add a middle checkpoint
    if (points.length === 2 && fromDate === toDate) {
      const midTs = fromTs + (now - fromTs) / 2;
      const midTimeStr = `${pad(new Date(midTs).getHours())}:${pad(new Date(midTs).getMinutes())}`;
      points.splice(1, 0, {
        timeLabel: midTimeStr,
        timestamp: midTs,
        equity: Number(startingEquityAnchor.toFixed(2)),
        realizedPnL: 0,
        unrealizedPnL: 0,
        netPnL: 0,
        type: 'START',
        drawdown: 0
      });
    }

    return points;
  }, [rawTrades, startingEquityAnchor, totalUnrealizedPnL, fromDate, toDate]);

  // Peak Equity and Max Drawdown calculation
  const { peakEquityVal, maxDrawdownVal, maxDrawdownPct } = useMemo(() => {
    let peak = startingEquityAnchor;
    let maxDd = 0;
    for (const pt of chartData) {
      if (pt.equity > peak) peak = pt.equity;
      const dd = peak - pt.equity;
      if (dd > maxDd) maxDd = dd;
    }
    const pct = peak > 0 ? (maxDd / peak) * 100 : 0;
    return { peakEquityVal: peak, maxDrawdownVal: maxDd, maxDrawdownPct: pct };
  }, [chartData, startingEquityAnchor]);

  // Export CSV
  const handleExportCsv = () => {
    const lines = [
      'Goldcrest Finman Quantitative Terminal - Trade Performance & Accounting Report',
      `Period: ${fromDate} to ${toDate}`,
      `Currency: ${currency} (USD/INR Rate: ${usdInrRate})`,
      `Account Balance: ${accountBalance}, Account Equity: ${accountEquity}`,
      `Total Realized P&L: ${totalRealizedPnL}, Total Unrealized P&L: ${totalUnrealizedPnL}, Net P&L: ${totalNetPnL}`,
      '',
      '--- CLOSED TRADES ---',
      'ID,Broker,Symbol,Direction,Entry Price,Exit Price,Volume,Timestamp,Date Time,PnL (USD),Commission'
    ];

    for (const t of rawTrades) {
      const dateStr = new Date(t.timestamp).toISOString();
      lines.push(
        `"${t.id}","${t.broker}","${t.symbol}","${t.side}",${t.entryPrice},${t.exitPrice},${t.quantity},${t.timestamp},"${dateStr}",${t.pnl},${t.commission}`
      );
    }

    lines.push('', '--- OPEN POSITIONS (FLOATING UNREALIZED) ---');
    lines.push('Symbol,Side,Quantity,Entry Price,Current Price,Unrealized PnL (USD)');
    for (const p of openPositions) {
      lines.push(
        `"${p.symbol}","${p.side}",${p.quantity},${p.entryPrice},${p.currentPrice},${p.unrealizedPnL ?? p.unrealizedPnl ?? 0}`
      );
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `trade-performance-accounting-${fromDate}-${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered raw trades for table
  const filteredTrades = useMemo(() => {
    const q = tradeSearch.trim().toLowerCase();
    if (!q) return rawTrades;
    return rawTrades.filter(
      t =>
        t.symbol.toLowerCase().includes(q) ||
        t.side.toLowerCase().includes(q) ||
        t.broker.toLowerCase().includes(q)
    );
  }, [rawTrades, tradeSearch]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Page Header Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-emerald-950/60 border border-emerald-800 flex items-center justify-center text-emerald-400">
                <DollarSign className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
                  <span>Trade Performance & Accounting</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/80 font-mono">
                    LIVE RECONCILED
                  </span>
                </h1>
                <p className="text-xs text-slate-400 mt-0.5 font-mono">
                  Multi-Currency Equity Dynamics · Realized vs. Floating Unrealized PnL · Intraday Continuous Tracker
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Currency Selector */}
            <div className="flex items-center rounded-lg bg-slate-950 border border-slate-800 p-1 font-mono text-xs">
              <button
                type="button"
                onClick={() => setCurrency('USD')}
                className={`px-2.5 py-1 rounded transition ${
                  currency === 'USD' ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                USD ($)
              </button>
              <button
                type="button"
                onClick={() => setCurrency('INR')}
                className={`px-2.5 py-1 rounded transition ${
                  currency === 'INR' ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                INR (₹)
              </button>
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={() => void fetchData(false)}
              disabled={refreshing}
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
              title="Refresh trade history and balance telemetry"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-emerald-400' : 'text-slate-400'}`} />
              <span>{refreshing ? 'Syncing...' : 'Sync Data'}</span>
            </button>

            {/* Export CSV */}
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-lg border border-emerald-800 bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Date Filters Row */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'CURRENT_MONTH', 'PREVIOUS_MONTH'] as DatePreset[]).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => handleApplyPreset(p)}
                className={`px-2.5 py-1 rounded-md font-medium transition text-[11px] ${
                  preset === p
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {p.replace(/_/g, ' ')}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 text-[11px] font-mono">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={fromDate}
                onChange={e => {
                  setFromDate(e.target.value);
                  setPreset('TODAY');
                }}
                className="bg-transparent text-white outline-none cursor-pointer"
              />
              <span className="text-slate-500">to</span>
              <input
                type="date"
                value={toDate}
                onChange={e => {
                  setToDate(e.target.value);
                  setPreset('TODAY');
                }}
                className="bg-transparent text-white outline-none cursor-pointer"
              />
            </div>
            <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
              Updated: {new Date(lastSyncTime).toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Current Equity */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 relative overflow-hidden">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center justify-between">
            <span>Account Equity</span>
            <Wallet className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-lg font-bold text-white mt-1 font-mono">
            {formatMoney(accountEquity)}
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-0.5 flex items-center gap-1">
            <span>Balance:</span>
            <span className="text-slate-300 font-semibold">{formatMoney(accountBalance)}</span>
          </div>
          <div className="absolute top-0 right-0 h-1 w-12 bg-cyan-500 rounded-bl" />
        </div>

        {/* Realized PnL */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 relative overflow-hidden">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center justify-between">
            <span>Realized P&L</span>
            {totalRealizedPnL >= 0 ? (
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
            )}
          </div>
          <div
            className={`text-lg font-bold mt-1 font-mono ${
              totalRealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {totalRealizedPnL >= 0 ? '+' : ''}
            {formatMoney(totalRealizedPnL)}
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
            {winningTrades.length} Wins · {losingTrades.length} Losses
          </div>
          <div
            className={`absolute top-0 right-0 h-1 w-12 rounded-bl ${
              totalRealizedPnL >= 0 ? 'bg-emerald-500' : 'bg-rose-500'
            }`}
          />
        </div>

        {/* Unrealized PnL (Floating) */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 relative overflow-hidden">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center justify-between">
            <span>Unrealized P&L</span>
            <Activity className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div
            className={`text-lg font-bold mt-1 font-mono ${
              totalUnrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {totalUnrealizedPnL >= 0 ? '+' : ''}
            {formatMoney(totalUnrealizedPnL)}
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
            {openPositions.length} Active Positions
          </div>
          <div className="absolute top-0 right-0 h-1 w-12 bg-amber-500 rounded-bl" />
        </div>

        {/* Net Combined PnL */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 relative overflow-hidden">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center justify-between">
            <span>Net Total P&L</span>
            <Layers className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div
            className={`text-lg font-bold mt-1 font-mono ${
              totalNetPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {totalNetPnL >= 0 ? '+' : ''}
            {formatMoney(totalNetPnL)}
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
            Realized + Floating
          </div>
          <div
            className={`absolute top-0 right-0 h-1 w-12 rounded-bl ${
              totalNetPnL >= 0 ? 'bg-emerald-500' : 'bg-rose-500'
            }`}
          />
        </div>

        {/* Win Rate & Profit Factor */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 relative overflow-hidden">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center justify-between">
            <span>Win Rate</span>
            <Percent className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-lg font-bold text-purple-300 mt-1 font-mono">
            {winRate.toFixed(1)}%
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
            Profit Factor: <b className="text-slate-200">{profitFactor.toFixed(2)}</b>
          </div>
          <div className="absolute top-0 right-0 h-1 w-12 bg-purple-500 rounded-bl" />
        </div>

        {/* Peak & Max Drawdown */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 relative overflow-hidden">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center justify-between">
            <span>Max Drawdown</span>
            <Shield className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-lg font-bold text-amber-400 mt-1 font-mono">
            {maxDrawdownPct.toFixed(2)}%
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
            Peak: {formatMoney(peakEquityVal, 0)}
          </div>
          <div className="absolute top-0 right-0 h-1 w-12 bg-amber-500 rounded-bl" />
        </div>
      </div>

      {/* Main Trade Performance Recharts Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
        {/* Chart Header & Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-bold text-white uppercase tracking-wider">
                Trade Performance & Equity Dynamics
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">
              Continuous visualization of Account Equity curve, Cumulative Realized P&L, and Floating Unrealized P&L over time.
            </p>
          </div>

          {/* Visibility Checkboxes & Mode Switcher */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {/* Toggles */}
            <label className="flex items-center gap-1.5 text-cyan-300 font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showEquityCurve}
                onChange={e => setShowEquityCurve(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0 cursor-pointer"
              />
              <span>Equity Curve</span>
            </label>

            <label className="flex items-center gap-1.5 text-emerald-400 font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showRealizedPnL}
                onChange={e => setShowRealizedPnL(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-0 cursor-pointer"
              />
              <span>Realized P&L</span>
            </label>

            <label className="flex items-center gap-1.5 text-amber-400 font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showUnrealizedPnL}
                onChange={e => setShowUnrealizedPnL(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-0 cursor-pointer"
              />
              <span>Unrealized (Floating)</span>
            </label>

            <label className="flex items-center gap-1.5 text-blue-400 font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showNetPnL}
                onChange={e => setShowNetPnL(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-blue-500 focus:ring-0 cursor-pointer"
              />
              <span>Net Total P&L</span>
            </label>
          </div>
        </div>

        {/* Recharts Chart Area */}
        <div className="h-[380px] w-full pt-2">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center space-y-2 text-slate-400 font-mono text-xs">
              <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
              <span>Compiling Trade Performance Timeline...</span>
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 font-mono text-xs space-y-1">
              <Info className="w-6 h-6 text-slate-600" />
              <span>No trade executions or active floating positions recorded for this range.</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 15, right: 20, left: 10, bottom: 10 }}>
                <defs>
                  {/* Equity Gradient */}
                  <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>

                  {/* Realized Gradient */}
                  <linearGradient id="realizedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>

                  {/* Unrealized Gradient */}
                  <linearGradient id="unrealizedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                
                <XAxis
                  dataKey="timeLabel"
                  stroke="#64748b"
                  tick={{ fontSize: 11, fontFamily: 'monospace' }}
                  tickLine={false}
                />

                {/* Left Y-Axis for Equity ($ / ₹) */}
                <YAxis
                  yAxisId="equityAxis"
                  stroke="#38bdf8"
                  domain={['dataMin - 100', 'dataMax + 100']}
                  tick={{ fontSize: 11, fontFamily: 'monospace' }}
                  tickFormatter={(val: number) => `${currencySymbol}${Math.round(val * fxMultiplier).toLocaleString()}`}
                  tickLine={false}
                  width={75}
                />

                {/* Right Y-Axis for Cumulative PnL ($ / ₹) */}
                <YAxis
                  yAxisId="pnlAxis"
                  orientation="right"
                  stroke="#10b981"
                  tick={{ fontSize: 11, fontFamily: 'monospace' }}
                  tickFormatter={(val: number) => `${currencySymbol}${Math.round(val * fxMultiplier).toLocaleString()}`}
                  tickLine={false}
                  width={70}
                />

                {/* Baseline reference at starting equity */}
                <ReferenceLine
                  yAxisId="equityAxis"
                  y={startingEquityAnchor}
                  stroke="#475569"
                  strokeDasharray="4 4"
                  label={{
                    value: `Baseline (${currencySymbol}${Math.round(startingEquityAnchor * fxMultiplier)})`,
                    fill: '#64748b',
                    fontSize: 10,
                    position: 'insideBottomLeft'
                  }}
                />

                {/* Zero reference on PnL axis */}
                <ReferenceLine yAxisId="pnlAxis" y={0} stroke="#334155" strokeDasharray="2 2" />

                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || !payload.length) return null;
                    const data = payload[0].payload as ChartTimePoint;
                    return (
                      <div className="bg-[#020617] border border-slate-700/80 rounded-lg p-3 shadow-2xl text-xs font-mono min-w-[240px]">
                        <div className="text-cyan-400 font-bold border-b border-slate-800 pb-1.5 mb-2 flex items-center justify-between">
                          <span>{label}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                            {data.type}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">Account Equity:</span>
                            <span className="text-white font-bold">{formatMoney(data.equity)}</span>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-emerald-400">Realized P&L:</span>
                            <span className={data.realizedPnL >= 0 ? 'text-emerald-300 font-bold' : 'text-rose-400 font-bold'}>
                              {data.realizedPnL >= 0 ? '+' : ''}{formatMoney(data.realizedPnL)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-amber-400">Unrealized P&L:</span>
                            <span className={data.unrealizedPnL >= 0 ? 'text-emerald-300 font-bold' : 'text-rose-400 font-bold'}>
                              {data.unrealizedPnL >= 0 ? '+' : ''}{formatMoney(data.unrealizedPnL)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between border-t border-slate-800/80 pt-1 mt-1">
                            <span className="text-blue-400 font-semibold">Net Total P&L:</span>
                            <span className={data.netPnL >= 0 ? 'text-emerald-300 font-bold' : 'text-rose-400 font-bold'}>
                              {data.netPnL >= 0 ? '+' : ''}{formatMoney(data.netPnL)}
                            </span>
                          </div>

                          {data.tradePnL !== undefined && (
                            <div className="border-t border-slate-800/80 pt-1 mt-1 text-[11px] text-slate-300">
                              <span className="text-slate-400">Trade: </span>
                              <b className="text-cyan-300">{data.symbol}</b> ({data.side}) ·{' '}
                              <b className={data.tradePnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                {data.tradePnL >= 0 ? '+' : ''}{formatMoney(data.tradePnL)}
                              </b>
                            </div>
                          )}

                          {data.drawdown > 0 && (
                            <div className="text-[10px] text-amber-500 pt-0.5">
                              Drawdown from peak: -{formatMoney(data.drawdown)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }}
                />

                <Legend
                  wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingTop: '10px' }}
                />

                {/* 1. Equity Curve */}
                {showEquityCurve && (
                  <Area
                    yAxisId="equityAxis"
                    type="monotone"
                    dataKey="equity"
                    name={`Equity Curve (${currency})`}
                    stroke="#06b6d4"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#equityGradient)"
                    dot={{ r: 3, fill: '#06b6d4' }}
                    activeDot={{ r: 6, fill: '#38bdf8' }}
                  />
                )}

                {/* 2. Realized PnL */}
                {showRealizedPnL && (
                  <Line
                    yAxisId="pnlAxis"
                    type="monotone"
                    dataKey="realizedPnL"
                    name={`Realized P&L (${currency})`}
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={{ r: 2.5, fill: '#10b981' }}
                  />
                )}

                {/* 3. Unrealized Floating PnL */}
                {showUnrealizedPnL && (
                  <Line
                    yAxisId="pnlAxis"
                    type="monotone"
                    dataKey="unrealizedPnL"
                    name={`Unrealized P&L (${currency})`}
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    dot={{ r: 4, fill: '#f59e0b' }}
                  />
                )}

                {/* 4. Net Total PnL */}
                {showNetPnL && (
                  <Line
                    yAxisId="pnlAxis"
                    type="monotone"
                    dataKey="netPnL"
                    name={`Net Total P&L (${currency})`}
                    stroke="#3b82f6"
                    strokeWidth={1.8}
                    dot={{ r: 2, fill: '#3b82f6' }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Detail Breakdown Tabs (Performance vs Open Positions vs Accounting Ledger) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveSubTab('PERFORMANCE')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                activeSubTab === 'PERFORMANCE'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <BarChart2 className="w-4 h-4" />
              <span>CLOSED TRADES & REALIZED P&L ({rawTrades.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab('POSITIONS')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                activeSubTab === 'POSITIONS'
                  ? 'bg-amber-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>ACTIVE POSITIONS & FLOATING P&L ({openPositions.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab('LEDGER')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                activeSubTab === 'LEDGER'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>DAILY FINANCIAL LEDGER</span>
            </button>
          </div>

          {activeSubTab === 'PERFORMANCE' && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={tradeSearch}
                onChange={e => setTradeSearch(e.target.value)}
                placeholder="Search symbol, BUY/SELL..."
                className="pl-8 pr-3 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 outline-none focus:border-slate-700 font-mono w-48 sm:w-60"
              />
            </div>
          )}
        </div>

        {/* Tab 1: Closed Trades List */}
        {activeSubTab === 'PERFORMANCE' && (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] text-slate-400 bg-slate-950 uppercase">
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3">Broker</th>
                    <th className="py-2.5 px-3 text-center">Direction</th>
                    <th className="py-2.5 px-3 text-right">Entry Price</th>
                    <th className="py-2.5 px-3 text-right">Exit Price</th>
                    <th className="py-2.5 px-3 text-right">Quantity</th>
                    <th className="py-2.5 px-3 text-right">Realized P&L ({currency})</th>
                    <th className="py-2.5 px-3 text-right">Execution Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredTrades.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-500">
                        No closed trade records match the current filter or date range.
                      </td>
                    </tr>
                  ) : (
                    filteredTrades.map(trade => {
                      const isProfit = (trade.pnl || 0) >= 0;
                      return (
                        <tr key={trade.id} className="hover:bg-slate-800/40 transition">
                          <td className="py-2.5 px-3 font-bold text-white flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                            <span>{trade.symbol}</span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">{trade.broker}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                trade.side === 'BUY'
                                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                                  : 'bg-rose-950/80 text-rose-300 border border-rose-800'
                              }`}
                            >
                              {trade.side}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-300">
                            {trade.entryPrice > 0 ? trade.entryPrice.toFixed(5) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-300">
                            {trade.exitPrice > 0 ? trade.exitPrice.toFixed(5) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-300 font-semibold">
                            {trade.quantity}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right font-bold ${
                              isProfit ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {isProfit ? '+' : ''}
                            {formatMoney(trade.pnl)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-400 text-[11px]">
                            {new Date(trade.timestamp).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit'
                            })}
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

        {/* Tab 2: Active Positions & Floating P&L */}
        {activeSubTab === 'POSITIONS' && (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] text-slate-400 bg-slate-950 uppercase">
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3 text-center">Side</th>
                    <th className="py-2.5 px-3 text-right">Quantity / Lots</th>
                    <th className="py-2.5 px-3 text-right">Entry Price</th>
                    <th className="py-2.5 px-3 text-right">Live Price</th>
                    <th className="py-2.5 px-3 text-right">Floating Unrealized P&L ({currency})</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {openPositions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500">
                        No in-flight open positions. All positions are flat.
                      </td>
                    </tr>
                  ) : (
                    openPositions.map((pos, idx) => {
                      const uPnl = Number(pos.unrealizedPnL ?? pos.unrealizedPnl ?? 0);
                      const isProfit = uPnl >= 0;
                      return (
                        <tr key={pos.id || pos.positionId || idx} className="hover:bg-slate-800/40 transition">
                          <td className="py-2.5 px-3 font-bold text-white flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                            <span>{pos.symbol}</span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                pos.side === 'BUY'
                                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                                  : 'bg-rose-950/80 text-rose-300 border border-rose-800'
                              }`}
                            >
                              {pos.side}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-300">{pos.quantity}</td>
                          <td className="py-2.5 px-3 text-right text-slate-300">
                            {pos.entryPrice ? pos.entryPrice.toFixed(5) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-cyan-300 font-semibold">
                            {pos.currentPrice ? pos.currentPrice.toFixed(5) : '—'}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right font-bold ${
                              isProfit ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {isProfit ? '+' : ''}
                            {formatMoney(uPnl)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className="px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800 text-[10px] font-bold">
                              OPEN
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

        {/* Tab 3: Daily Financial Ledger */}
        {activeSubTab === 'LEDGER' && (
          <div className="space-y-4">
            <div className="text-xs text-slate-400">
              Aggregated daily performance ledger tracking opening equity, gross wins, losses, and ending balance.
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] text-slate-400 bg-slate-950 uppercase">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3 text-center">Trades</th>
                    <th className="py-2.5 px-3 text-center">Wins / Losses</th>
                    <th className="py-2.5 px-3 text-right">Gross Profit</th>
                    <th className="py-2.5 px-3 text-right">Gross Loss</th>
                    <th className="py-2.5 px-3 text-right">Net P&L ({currency})</th>
                    <th className="py-2.5 px-3 text-right">Win %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  <tr className="hover:bg-slate-800/40 transition">
                    <td className="py-2.5 px-3 font-bold text-white">{fromDate} to {toDate}</td>
                    <td className="py-2.5 px-3 text-center text-slate-300">{rawTrades.length}</td>
                    <td className="py-2.5 px-3 text-center text-slate-300">
                      {winningTrades.length} / {losingTrades.length}
                    </td>
                    <td className="py-2.5 px-3 text-right text-emerald-400 font-semibold">
                      +{formatMoney(grossProfit)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-rose-400 font-semibold">
                      -{formatMoney(grossLoss)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-bold ${
                        totalRealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {totalRealizedPnL >= 0 ? '+' : ''}
                      {formatMoney(totalRealizedPnL)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-purple-300 font-bold">
                      {winRate.toFixed(1)}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
