import React, { useState } from 'react';
import {
  Bell, BookOpen, CandlestickChart, ChevronDown, ChevronRight,
  Grid2X2, ListChecks, Settings, Sparkles, Activity, History as HistoryIcon, Database, Globe
} from 'lucide-react';
import { ForexSessionState } from '../markets/common/types';

interface GlobalAppShellProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  children: React.ReactNode;
  header: React.ReactNode;
  forexSessions?: ForexSessionState;
}

const nav = [
  { id: 'market_watch', label: 'Market Watch', icon: Activity },
  { id: 'trading', label: 'Positions', icon: CandlestickChart },
  { id: 'control_center', label: 'Orders', icon: ListChecks },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'signals', label: 'Strategy', icon: Sparkles },
  { id: 'pnl', label: 'Reports', icon: BookOpen },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'settings', label: 'Settings', icon: Settings }
];

export const GlobalAppShell: React.FC<GlobalAppShellProps> = ({
  activeTab, setActiveTab, children, header, forexSessions
}) => {
  const [dashboardOpen, setDashboardOpen] = useState(true);
  const isDashboard = activeTab === 'forex_terminal';

  const fxOpen = forexSessions ? (forexSessions.activeSessions.length > 0 && !forexSessions.activeSessions.includes('CLOSED (WEEKEND)')) : true;

  return (
    <div className="min-h-screen bg-[#03070d] text-slate-100">
      {header}

      <aside
        id="global_fixed_sidebar"
        className="fixed top-[126px] bottom-9 left-0 z-[60] w-[242px] border-r border-slate-800/80 bg-[#02070d] flex flex-col"
      >
        <nav className="flex-1 overflow-y-auto px-3 pt-2 pb-3">
          <button
            type="button"
            onClick={() => {
              setDashboardOpen(v => !v);
              setActiveTab('forex_terminal');
            }}
            className={`w-full h-[40px] flex items-center gap-3 px-4 rounded-lg border transition text-left ${
              isDashboard
                ? 'bg-[#092345] border-blue-700/70 text-white shadow-[0_0_18px_rgba(30,100,210,0.18)]'
                : 'bg-transparent border-transparent text-slate-300 hover:bg-slate-900/70'
            }`}
          >
            <Grid2X2 className="w-[18px] h-[18px] text-blue-400" />
            <span className="flex-1 text-sm font-semibold">Forex Terminal</span>
            {dashboardOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
          </button>

          {dashboardOpen && (
            <div className="mt-0 mb-1 pl-10 pr-2 space-y-[-4px]">
              <button
                type="button"
                onClick={() => setActiveTab('forex_terminal')}
                className={`w-full py-0.5 text-left text-sm transition ${
                  activeTab === 'forex_terminal' ? 'text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="mr-2 text-slate-600">-</span>FX Majors & Crosses
              </button>
            </div>
          )}

          <div className="space-y-[-4px] mt-1">
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
          <div className="rounded-xl bg-[#07101b] border border-slate-800/80 p-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[#12366d] border border-blue-500/40 flex items-center justify-center text-white font-semibold">G</div>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate text-slate-100">Goldcrest Trader</div>
                <div className="text-[11px] text-slate-400">cTrader Live Connected</div>
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
        className="fixed bottom-0 left-0 right-0 z-[70] h-9 border-t border-slate-800 bg-[#020c18] px-10 flex items-center gap-10 text-[12px] font-mono overflow-hidden"
      >
        <div className="flex items-center gap-2 whitespace-nowrap min-w-[200px]">
          <span className="text-slate-400">EUR/USD</span>
          <span className="text-emerald-400 font-semibold">1.08450</span>
          <span className="text-emerald-400">▲ +0.12%</span>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap min-w-[200px]">
          <span className="text-slate-400">GBP/USD</span>
          <span className="text-emerald-400 font-semibold">1.26820</span>
          <span className="text-emerald-400">▲ +0.08%</span>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap min-w-[200px]">
          <span className="text-slate-400">USD/JPY</span>
          <span className="text-rose-400 font-semibold">154.210</span>
          <span className="text-rose-400">▼ -0.15%</span>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap min-w-[200px]">
          <span className="text-slate-400">XAU/USD</span>
          <span className="text-emerald-400 font-semibold">2,684.50</span>
          <span className="text-emerald-400">▲ +0.45%</span>
        </div>
        <div className="ml-auto flex items-center gap-2 whitespace-nowrap">
          <Globe className="w-3.5 h-3.5 text-slate-400" />
          <span className={`w-2 h-2 rounded-full ${
            fxOpen ? 'bg-emerald-500' : 'bg-slate-500'
          }`} />
          <span className={fxOpen ? 'text-emerald-400' : 'text-slate-400'}>
            {fxOpen ? 'Forex Market 24/5 Open' : 'Forex Weekend Closed'}
          </span>
        </div>
      </footer>
    </div>
  );
};
