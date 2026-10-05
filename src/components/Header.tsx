import React from 'react';
import { Activity, AlertOctagon, Database, Globe, RefreshCw, ShieldAlert } from 'lucide-react';
import { ForexSessionState, IndianSessionState } from '../markets/common/types';
import { BrokerType, TradingEnvironment } from '../brokers/types';
import { BalanceDisplay } from './BalanceDisplay';
import gfLogo from '../assets/GF_logo.png';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  forexSessions: ForexSessionState;
  indianSession: IndianSessionState;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenDiagnostics: () => void;
  environment: TradingEnvironment;
  onRequestEnvironmentChange: (env: TradingEnvironment) => void;
  selectedBroker: BrokerType;
  maskedAccount?: string;
  autoTradingStatus?: { state?: string; autonomousPermission?: boolean } | null;
  isEmergencyHalted: boolean;
  onToggleKillSwitch: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  forexSessions,
  indianSession,
  onRefresh,
  isRefreshing,
  onOpenDiagnostics,
  environment,
  maskedAccount = '****',
  autoTradingStatus,
  isEmergencyHalted,
  onToggleKillSwitch
}) => {
  const isLive = true;
  const activeArea =
    activeTab === 'market_watch' ? 'MARKET WATCH' :
    activeTab === 'shadow_mode' ? 'SHADOW MODE' :
    activeTab === 'forensics' ? 'PREDICTION FORENSICS' :
    activeTab === 'direction_analysis' ? 'QUANTITATIVE DIRECTION' :
    activeTab === 'native_indicators' ? 'cTRADER NATIVE INDICATORS' :
    activeTab === 'control_center' ? 'CONTROL CENTER' :
    activeTab === 'history' ? 'HISTORY' :
    activeTab === 'trading' ? 'COCKPIT' :
    activeTab === 'database' ? 'DATABASE' :
    activeTab === 'signals' ? 'STRATEGY' :
    activeTab === 'research' ? 'BACKTEST' :
    activeTab === 'pnl' ? 'REPORTS' :
    activeTab === 'alerts' || activeTab === 'analytics' ? 'ANALYTICS' :
    activeTab === 'settings' ? 'SETTINGS' : 'MARKET WATCH';

  const fxOpen = forexSessions.activeSessions.length > 0 && !forexSessions.activeSessions.includes('CLOSED (WEEKEND)');
  const fxLabel = forexSessions.activeSessions.length ? forexSessions.activeSessions.join(' / ') : 'CLOSED (WEEKEND)';
  const nseOpen = indianSession.isOpen;

  return (
    <header
      id="main_terminal_header"
      className="fixed top-0 left-0 right-0 z-[80] h-[126px] bg-[#07101a] border-b border-slate-800 text-slate-100 select-none shadow-xl"
    >
      <div
        id="global_telemetry_bar"
        className="h-7 bg-[#020711] border-b border-slate-800/80 px-4 flex items-center justify-between gap-3 text-[10px] font-mono overflow-hidden"
      >
        <div className="flex items-center gap-3 whitespace-nowrap min-w-0">
          <span>ACTIVE AREA: <b className="text-slate-200">{activeArea}</b></span>
          <span className="text-slate-700">|</span>
          <span>BROKER: <b className="text-slate-200">cTrader</b></span>
          <span className="text-slate-700">|</span>
          <span>ENVIRONMENT: <b className="text-rose-400">LIVE</b></span>
          <span className="text-slate-700">|</span>
          <span>EXECUTION: <b className={autoTradingStatus?.autonomousPermission ? 'text-emerald-400' : 'text-amber-400'}>
            {autoTradingStatus?.autonomousPermission ? 'AUTO-LIVE (RUNNING)' : 'AUTO-READINESS (GATED)'}
          </b></span>
          <span className="text-slate-700">|</span>
          <span>DATA: <b className="text-emerald-400">FRESH (LIVE)</b></span>
          <span className="text-slate-700">|</span>
          <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            CLOCK: <b className="text-emerald-300">1S REALTIME</b>
          </span>
        </div>
        <div className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded border font-bold ${
          isEmergencyHalted
            ? 'bg-rose-600 border-rose-400 text-white animate-pulse'
            : isLive
              ? 'bg-rose-950/70 border-rose-700 text-rose-300'
              : 'bg-amber-950/70 border-amber-700 text-amber-300'
        }`}>
          <ShieldAlert className="w-3 h-3" />
          <span>{isEmergencyHalted ? 'TRADING HALTED' : isLive ? 'LIVE TRADING' : environment + ' MODE'}</span>
          <span>({maskedAccount})</span>
        </div>
      </div>

      <div className="h-[99px] px-4 flex items-center gap-3 overflow-hidden">
        <div className="flex items-center min-w-[260px] max-w-[300px] shrink-0">
          <img
            src={gfLogo}
            alt="Goldcrest Finman"
            className="h-[54px] w-auto max-w-[280px] object-contain select-none"
          />
        </div>

        <div className="shrink-0">
          <BalanceDisplay environment="LIVE" />
        </div>

        <div className="flex flex-col justify-center min-w-[210px] shrink-0">
          <div
            id="header_fx_session_badge"
            className={`h-8 flex items-center gap-1.5 px-2.5 rounded border text-[10px] font-mono ${
              fxOpen ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            <Globe className={`w-3 h-3 ${fxOpen ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span className="text-slate-400 font-semibold">FX:</span>
            <span className={`w-2 h-2 rounded-full ${fxOpen ? 'bg-emerald-500' : 'bg-slate-500'}`} />
            <span className="truncate">{fxLabel}</span>
          </div>
        </div>

        {/* Sacred Blessings & Prosperity Center: Lord Ganesha & Goddess Lakshmi, Swastik, Om, Shubh Labh */}
        <div
          id="header_sacred_blessings"
          title="Shri Ganesh Lakshmi Blessings & Prosperity · 卐 ॐ शुभ लाभ 卐"
          className="mx-auto flex items-center gap-3 px-3 py-1.5 rounded-xl border border-amber-500/35 bg-gradient-to-r from-amber-950/30 via-slate-900/90 to-amber-950/30 shadow-[0_0_16px_rgba(245,158,11,0.12)] transition hover:border-amber-400/60 shrink-0"
        >
          {/* Left Auspicious Wing: Swastik & Shubh */}
          <div className="flex flex-col items-center justify-center text-center select-none shrink-0 pr-1.5 border-r border-amber-500/25">
            <span className="text-amber-400 text-sm font-bold leading-none">卐</span>
            <span className="text-amber-300 font-serif font-black text-xs tracking-wider mt-0.5">शुभ</span>
            <span className="text-[8px] text-amber-500/90 uppercase font-mono tracking-tighter">SHUBH</span>
          </div>

          {/* Central Sacred Divine Artwork: Lord Ganesha & Goddess Lakshmi */}
          <div className="relative shrink-0 flex items-center">
            <img
              src="/src/assets/images/ganesh_lakshmi_banner_1791176799073.jpg"
              alt="Lord Ganesha and Goddess Lakshmi - Blessings and Prosperity"
              referrerPolicy="no-referrer"
              className="h-[60px] w-auto max-w-[170px] sm:max-w-[210px] md:max-w-[240px] object-cover rounded-lg border border-amber-500/50 shadow-md transition-transform duration-300 hover:scale-[1.02]"
            />
            <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-amber-400/20 pointer-events-none" />
          </div>

          {/* Right Auspicious Wing: Labh & Om */}
          <div className="flex flex-col items-center justify-center text-center select-none shrink-0 pl-1.5 border-l border-amber-500/25">
            <span className="text-amber-400 text-sm font-bold leading-none">ॐ</span>
            <span className="text-amber-300 font-serif font-black text-xs tracking-wider mt-0.5">लाभ</span>
            <span className="text-[8px] text-amber-500/90 uppercase font-mono tracking-tighter">LABH</span>
          </div>

          {/* Blessings & Prosperity Title */}
          <div className="hidden xl:flex flex-col justify-center select-none pl-1">
            <div className="flex items-center gap-1 text-[11px] font-bold text-amber-300 font-serif whitespace-nowrap">
              <span>श्री गणेश · महालक्ष्मी</span>
            </div>
            <div className="text-[9px] text-amber-400/90 font-mono tracking-wide whitespace-nowrap">
              Blessings & Prosperity
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            id="btn_emergency_stop"
            onClick={onToggleKillSwitch}
            title={isEmergencyHalted ? 'Resume trading' : 'Emergency stop'}
            className={`w-9 h-9 rounded border flex items-center justify-center transition ${
              isEmergencyHalted ? 'bg-rose-600 border-rose-400 text-white animate-pulse' : 'bg-rose-950/40 border-rose-800 text-rose-300 hover:bg-rose-900/60'
            }`}
          >
            <AlertOctagon className="w-4 h-4" />
          </button>
          <button
            id="btn_terminal_refresh"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh quotes and signals"
            className="w-9 h-9 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 flex items-center justify-center"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-emerald-400' : 'text-slate-300'}`} />
          </button>
          <button
            id="btn_open_diagnostics"
            onClick={onOpenDiagnostics}
            title="SQLite database and system diagnostics"
            className="w-9 h-9 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 flex items-center justify-center"
          >
            <Database className="w-4 h-4 text-cyan-400" />
          </button>
        </div>
      </div>
    </header>
  );
};
