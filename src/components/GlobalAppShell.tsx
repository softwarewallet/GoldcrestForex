import React, { useEffect, useState } from 'react';
import {
  Bell, BookOpen, CandlestickChart,
  ListChecks, Settings, Sparkles, Activity, History as HistoryIcon, Database, BarChart2, Eye
} from 'lucide-react';
import { ForexSessionState, IndianSessionState } from '../markets/common/types';

interface GlobalAppShellProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  children: React.ReactNode;
  header: React.ReactNode;
  forexPairs?: any[];
  forexSessions?: ForexSessionState;
  indianSession?: IndianSessionState;
  indianUnderlyings?: any[];
}

const nav = [
  { id: 'market_watch', label: 'Market Watch', icon: Activity },
  { id: 'trading', label: 'Cockpit', icon: CandlestickChart },
  { id: 'shadow_mode', label: 'Shadow Mode', icon: Eye },
  { id: 'forensics', label: 'Forensics', icon: Sparkles },
  { id: 'control_center', label: 'Control Center', icon: ListChecks },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'signals', label: 'Strategy', icon: Sparkles },
  { id: 'pnl', label: 'Reports', icon: BookOpen },
  { id: 'alerts', label: 'Analytics', icon: BarChart2 },
  { id: 'settings', label: 'Settings', icon: Settings }
];

interface TodayTradesSummary {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  pendingTrades: number;
  netPnL: number;
  formattedNetPnL: string;
}

export const GlobalAppShell: React.FC<GlobalAppShellProps> = ({
  activeTab,
  setActiveTab,
  children,
  header
}) => {
  const [todayTrades, setTodayTrades] = useState<TodayTradesSummary>({
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    pendingTrades: 0,
    netPnL: 0,
    formattedNetPnL: '$0.00'
  });

  useEffect(() => {
    let mounted = true;
    const fetchTodaySummary = async () => {
      try {
        const [summaryRes, positionsRes, ordersRes] = await Promise.all([
          fetch('/api/brokers/today-trades-summary', { cache: 'no-store' }).catch(() => null),
          fetch('/api/brokers/positions', { cache: 'no-store' }).catch(() => null),
          fetch('/api/brokers/orders', { cache: 'no-store' }).catch(() => null)
        ]);

        let summaryData: any = null;
        if (summaryRes?.ok) {
          summaryData = await summaryRes.json().catch(() => null);
        }

        let positionsCount = 0;
        let positionsUnrealizedPnL = 0;
        if (positionsRes?.ok) {
          const positions = await positionsRes.json().catch(() => []);
          if (Array.isArray(positions)) {
            positionsCount = positions.length;
            positionsUnrealizedPnL = positions.reduce((acc, p) => acc + (Number(p.unrealizedPnL ?? p.unrealizedPnl ?? 0) || 0), 0);
          }
        }

        let ordersCount = 0;
        if (ordersRes?.ok) {
          const orders = await ordersRes.json().catch(() => []);
          if (Array.isArray(orders)) {
            ordersCount = orders.length;
          }
        }

        const pendingTrades = Math.max(
          Number(summaryData?.pendingTrades || 0),
          positionsCount + ordersCount
        );

        const winningTrades = Number(summaryData?.winningTrades || 0);
        const losingTrades = Number(summaryData?.losingTrades || 0);
        const totalTrades = Number(summaryData?.totalTrades !== undefined ? summaryData.totalTrades : (winningTrades + losingTrades));
        const realizedPnL = Number(summaryData?.realizedPnL || 0);
        const netPnL = Number(summaryData?.netPnL !== undefined ? summaryData.netPnL : (realizedPnL + positionsUnrealizedPnL));
        const formattedNetPnL = summaryData?.formattedNetPnL || `${netPnL >= 0 ? '+' : '-'}$${Math.abs(netPnL).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        if (mounted) {
          setTodayTrades({
            totalTrades,
            winningTrades,
            losingTrades,
            pendingTrades,
            netPnL,
            formattedNetPnL
          });
        }
      } catch {
        // Silent background fallback
      }
    };

    void fetchTodaySummary();
    const interval = window.setInterval(() => void fetchTodaySummary(), 4000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const todayDateStr = new Date().toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <div className="min-h-screen bg-[#03070d] text-slate-100">
      {header}

      <aside
        id="global_fixed_sidebar"
        className="fixed top-[126px] bottom-9 left-0 z-[60] w-[242px] border-r border-slate-800/80 bg-[#02070d] flex flex-col"
      >
        <nav className="flex-1 overflow-y-auto px-3 pt-2 pb-3">
          <div className="space-y-[-4px]">
            {nav.map(item => {
              const Icon = item.icon;
              const selected = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full h-[40px] flex items-center gap-3 px-4 rounded-lg text-sm transition text-left ${
                    selected
                      ? 'bg-slate-900 border border-slate-700 text-white'
                      : 'border border-transparent text-slate-300 hover:text-white hover:bg-slate-900/60'
                  }`}
                >
                  <Icon className={`w-[18px] h-[18px] ${
                    selected ? 'text-slate-200' : 'text-slate-400'
                  }`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="px-3 pb-3 shrink-0">
          <div className="rounded-xl bg-[#07101b] border border-slate-800/80 px-3 py-[5px]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[#12366d] border border-blue-500/40 flex items-center justify-center text-white font-semibold">R</div>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate text-slate-100">Raajan P Sharrma</div>
                <div className="text-[11px] text-slate-400">Administrator</div>
              </div>
            </div>
            <button type="button" className="mt-2 ml-1 text-[11px] text-slate-300 hover:text-white">Logout</button>
          </div>
        </div>
      </aside>

      <main
        id="global_app_content"
        className="ml-[242px] min-h-screen pt-[126px] pb-9 bg-[#03070d] text-slate-100"
      >
        {children}
      </main>

      <footer
        id="global_fixed_footer"
        className="fixed bottom-0 left-0 right-0 z-[70] h-9 border-t border-slate-800 bg-[#020c18] px-6 sm:px-10 flex items-center gap-6 sm:gap-10 text-[12px] font-mono overflow-x-auto select-none"
      >
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-slate-400 uppercase text-[11px] tracking-wide">Total Trades:</span>
          <span className="text-white font-bold">{todayTrades.totalTrades}</span>
        </div>

        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-slate-400 uppercase text-[11px] tracking-wide">Winning Trades:</span>
          <span className="text-emerald-400 font-bold">{todayTrades.winningTrades}</span>
        </div>

        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-slate-400 uppercase text-[11px] tracking-wide">Loose Trades:</span>
          <span className="text-rose-400 font-bold">{todayTrades.losingTrades}</span>
        </div>

        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-slate-400 uppercase text-[11px] tracking-wide">Pending Trades:</span>
          <span className="text-amber-400 font-bold">{todayTrades.pendingTrades}</span>
        </div>

        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-slate-400 uppercase text-[11px] tracking-wide">Today's Net P&L:</span>
          <span className={`font-bold ${todayTrades.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {todayTrades.formattedNetPnL}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2 whitespace-nowrap pl-4 text-[11px] text-slate-500 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>TODAY: {todayDateStr}</span>
        </div>
      </footer>
    </div>
  );
};
