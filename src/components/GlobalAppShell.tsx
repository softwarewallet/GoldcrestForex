import React, { useEffect, useState } from 'react';
import {
  Bell, BookOpen, CandlestickChart,
  ListChecks, Settings, Sparkles, Activity, History as HistoryIcon, Database, BarChart2, Eye, Compass, Zap, Sliders, Target,
  Wrench, ChevronDown, ChevronRight
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

interface NavItem {
  id: string;
  label: string;
  icon: any;
}

interface NavGroup {
  id: string;
  label: string;
  icon: any;
  items: NavItem[];
}

type NavEntry = NavItem | NavGroup;

const toolsSubItems: NavItem[] = [
  { id: 'shadow_mode', label: 'Shadow Mode', icon: Eye },
  { id: 'forensics', label: 'Forensics', icon: Sparkles },
  { id: 'direction_analysis', label: 'Direction', icon: Compass },
  { id: 'native_indicators', label: 'Native Ind', icon: Zap },
  { id: 'dynamic_exits', label: 'Dynamic Exits', icon: Sliders },
  { id: 'short_tp', label: 'Short TP (1-5p)', icon: Target }
];

const nav: NavEntry[] = [
  { id: 'market_watch', label: 'Market Watch', icon: Activity },
  { id: 'trading', label: 'Cockpit', icon: CandlestickChart },
  { id: 'control_center', label: 'Control Center', icon: ListChecks },
  {
    id: 'tools',
    label: 'Tools',
    icon: Wrench,
    items: toolsSubItems
  },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'database', label: 'Database', icon: Database },
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
  dailyProfitTargetUsd: number;
  remainingTargetUsd: number;
  formattedRemainingTarget: string;
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
    formattedNetPnL: '$0.00',
    dailyProfitTargetUsd: 500,
    remainingTargetUsd: 500,
    formattedRemainingTarget: '$500.00'
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

        const pendingTrades = Number(summaryData?.pendingTrades !== undefined ? summaryData.pendingTrades : positionsCount);
        const winningTrades = Number(summaryData?.winningTrades || 0);
        const losingTrades = Number(summaryData?.losingTrades || 0);
        const totalTrades = Number(summaryData?.totalTrades !== undefined ? summaryData.totalTrades : (winningTrades + losingTrades + pendingTrades));
        const realizedPnL = Number(summaryData?.realizedPnL || 0);
        const netPnL = Number(summaryData?.netPnL !== undefined ? summaryData.netPnL : (realizedPnL + positionsUnrealizedPnL));
        const formattedNetPnL = summaryData?.formattedNetPnL || `${netPnL >= 0 ? '+' : '-'}$${Math.abs(netPnL).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const dailyProfitTargetUsd = Number(summaryData?.dailyProfitTargetUsd ?? 500);
        const remainingTargetUsd = Number(summaryData?.remainingTargetUsd !== undefined ? summaryData.remainingTargetUsd : (dailyProfitTargetUsd - netPnL));
        const formattedRemainingTarget = summaryData?.formattedRemainingTarget || `${remainingTargetUsd >= 0 ? '$' : '-$'}${Math.abs(remainingTargetUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        if (mounted) {
          setTodayTrades({
            totalTrades,
            winningTrades,
            losingTrades,
            pendingTrades,
            netPnL,
            formattedNetPnL,
            dailyProfitTargetUsd,
            remainingTargetUsd,
            formattedRemainingTarget
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

  const isToolsActive = toolsSubItems.some(sub => sub.id === activeTab);
  const [toolsOpen, setToolsOpen] = useState<boolean>(isToolsActive);

  // Automatically expand Tools when an active tool is selected
  useEffect(() => {
    if (isToolsActive) {
      setToolsOpen(true);
    }
  }, [isToolsActive]);

  return (
    <div className="min-h-screen bg-[#03070d] text-slate-100">
      {header}

      <aside
        id="global_fixed_sidebar"
        className="fixed top-[126px] bottom-9 left-0 z-[60] w-[242px] border-r border-slate-800/80 bg-[#02070d] flex flex-col"
      >
        <nav className="flex-1 overflow-y-auto px-3 pt-2 pb-3">
          <div className="space-y-1">
            {nav.map(item => {
              // Check if item has a sub-menu
              if ('items' in item && item.items) {
                const Icon = item.icon;
                const isGroupActive = item.items.some(sub => sub.id === activeTab);
                return (
                  <div key={item.id} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => setToolsOpen(!toolsOpen)}
                      className={`w-full h-[40px] flex items-center justify-between px-4 rounded-lg text-sm transition text-left ${
                        isGroupActive
                          ? 'bg-slate-900/80 border border-slate-700/80 text-white'
                          : 'border border-transparent text-slate-300 hover:text-white hover:bg-slate-900/60'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className={`w-[18px] h-[18px] ${
                          isGroupActive ? 'text-amber-400' : 'text-slate-400'
                        }`} />
                        <span className="font-medium">{item.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60">
                          {item.items.length}
                        </span>
                        {toolsOpen ? (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                    </button>

                    {/* Sub-menu items */}
                    {toolsOpen && (
                      <div className="ml-3 pl-3 border-l border-slate-800/80 space-y-1 py-0.5">
                        {item.items.map(subItem => {
                          const SubIcon = subItem.icon;
                          const isSubSelected = activeTab === subItem.id;
                          return (
                            <button
                              key={subItem.id}
                              type="button"
                              onClick={() => setActiveTab(subItem.id)}
                              className={`w-full h-[36px] flex items-center gap-2.5 px-3 rounded-lg text-[13px] transition text-left ${
                                isSubSelected
                                  ? 'bg-slate-900 border border-slate-700 text-white font-medium shadow-sm'
                                  : 'border border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
                              }`}
                            >
                              <SubIcon className={`w-4 h-4 ${
                                isSubSelected ? 'text-amber-300' : 'text-slate-500'
                              }`} />
                              <span className="truncate">{subItem.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

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

        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-slate-400 uppercase text-[11px] tracking-wide">Remaining Target:</span>
          <span className={`font-bold ${todayTrades.remainingTargetUsd <= 0 ? 'text-emerald-400' : 'text-cyan-300'}`}>
            {todayTrades.formattedRemainingTarget}
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
