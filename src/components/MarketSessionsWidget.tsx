import React, { useState, useEffect } from 'react';
import { Globe, Clock, Activity, Sunrise, Sunset, Sun, ArrowUpRight } from 'lucide-react';
import { getForexSessionState } from '../markets/common/session';

export const MarketSessionsWidget: React.FC = () => {
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const forexState = getForexSessionState(now);

  const istTimeString = now.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const utcTimeString = now.toLocaleTimeString('en-US', {
    timeZone: 'UTC',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Calculate UTC hours for countdown and open/close status
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  const day = now.getUTCDay(); // 0 = Sun, 6 = Sat
  const isWeekend = (day === 6) || (day === 0 && utcHours < 21) || (day === 5 && utcHours >= 21);

  // Helper to format remaining seconds into hh:mm:ss or days/hours
  const formatCountdown = (targetUtcHour: number, isOpenNow: boolean) => {
    if (isWeekend) {
      if (day === 6 || (day === 0 && utcHours < 21)) {
        // Weekend closed -> opens Sunday 21:00 UTC
        const hoursUntilSundayOpen = ((21 - utcHours) + (day === 6 ? 24 : 0));
        const totalSecs = Math.max(0, Math.floor(hoursUntilSundayOpen * 3600));
        const d = Math.floor(totalSecs / 86400);
        const h = Math.floor((totalSecs % 86400) / 3600);
        const m = Math.floor((totalSecs % 3600) / 60);
        const s = totalSecs % 60;
        return `Opens in ${d > 0 ? `${d}d ` : ''}${h}h ${m}m ${s}s`;
      }
    }

    let diffHours = targetUtcHour - utcHours;
    if (diffHours < 0) diffHours += 24;

    const totalSecs = Math.max(0, Math.floor(diffHours * 3600));
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;

    return isOpenNow ? `Closes in ${h}h ${m}m ${s}s` : `Opens in ${h}h ${m}m ${s}s`;
  };

  const formatIstHours = (utcFloat: number) => {
    const istFloat = (utcFloat + 5.5) % 24;
    const h = Math.floor(istFloat);
    const m = Math.round((istFloat - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const sessions = [
    {
      name: 'Sydney Session',
      region: 'Australia / Pacific',
      openUtcFloat: 21.0,
      closeUtcFloat: 6.0,
      isOpen: forexState.sydney,
      icon: Sunrise,
      badgeColor: 'bg-indigo-950/60 border-indigo-700/50 text-indigo-300',
      description: 'Opens Asian trading day, high liquidity in AUD and NZD pairs.'
    },
    {
      name: 'Tokyo Session',
      region: 'Asia / Japan',
      openUtcFloat: 0.0,
      closeUtcFloat: 9.0,
      isOpen: forexState.tokyo,
      icon: Sun,
      badgeColor: 'bg-amber-950/60 border-amber-700/50 text-amber-300',
      description: 'Major Asian hub, heavy JPY and cross-currency volatility.'
    },
    {
      name: 'London Session',
      region: 'Europe / UK',
      openUtcFloat: 7.0,
      closeUtcFloat: 16.0,
      isOpen: forexState.london,
      icon: Activity,
      badgeColor: 'bg-blue-950/60 border-blue-700/50 text-blue-300',
      description: 'Global financial center, highest volume across GBP and EUR.'
    },
    {
      name: 'New York Session',
      region: 'Americas / USA',
      openUtcFloat: 12.0,
      closeUtcFloat: 21.0,
      isOpen: forexState.newYork,
      icon: Sunset,
      badgeColor: 'bg-emerald-950/60 border-emerald-700/50 text-emerald-300',
      description: 'North American trading powerhouse, heavy USD and CAD activity.'
    },
    {
      name: 'London / NY Overlap',
      region: 'Peak Global Liquidity',
      openUtcFloat: 12.0,
      closeUtcFloat: 16.0,
      isOpen: forexState.isLondonNyOverlap,
      icon: Globe,
      badgeColor: 'bg-purple-950/60 border-purple-700/50 text-purple-300',
      description: 'Highest volatility and tightest spreads of the trading day.'
    }
  ];

  return (
    <div id="market_sessions_view" className="p-0 space-y-6 text-slate-100 font-mono animate-fadeIn">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-[#0d1624] py-[5px] px-5 mb-[10px] rounded-xl border border-slate-800 shadow-xl">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2.5 text-white">
            <Globe className="w-6 h-6 text-cyan-400" />
            Market Sessions & Real-Time Timing Matrix
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Active Forex sessions, overlap windows, countdown timers, and IST time synchronization for global institutional trading.
          </p>
        </div>
        <div className="flex items-center gap-4 bg-[#07101a] px-4 py-2.5 rounded-lg border border-slate-700 text-xs shadow-inner">
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">IST Time (UTC+5:30)</div>
            <div className="text-sm font-bold text-cyan-300">{istTimeString} IST</div>
          </div>
          <div className="h-6 w-px bg-slate-700" />
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">UTC Time</div>
            <div className="text-sm font-bold text-slate-300">{utcTimeString} UTC</div>
          </div>
        </div>
      </div>

      {/* Active Session Status Bar */}
      <div className="bg-[#0b1320] border border-slate-800 rounded-xl py-[5px] px-4 mb-[10px] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-400 tracking-wider">Active Forex Sessions</div>
            <div className="text-sm font-bold text-emerald-300 mt-0.5">
              {forexState.activeSessions.join(' · ')}
            </div>
          </div>
        </div>
      </div>

      {/* Grid of Sessions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {sessions.map((session) => {
          const Icon = session.icon;
          const countdown = formatCountdown(session.closeUtcFloat, session.isOpen);
          const openUtcStr = `${String(session.openUtcFloat).padStart(2, '0')}:00`;
          const closeUtcStr = `${String(session.closeUtcFloat).padStart(2, '0')}:00`;
          const openIstStr = formatIstHours(session.openUtcFloat);
          const closeIstStr = formatIstHours(session.closeUtcFloat);

          return (
            <div
              key={session.name}
              className={`p-5 rounded-xl border transition-all duration-300 ${
                session.isOpen
                  ? 'bg-[#0e1929] border-cyan-500/40 shadow-[0_0_20px_rgba(6,182,212,0.12)]'
                  : 'bg-[#09101a] border-slate-800/80'
              } flex flex-col justify-between`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`p-2 rounded-lg border ${session.badgeColor}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-white">{session.name}</h3>
                      <span className="text-[10px] text-slate-400">{session.region}</span>
                    </div>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                    session.isOpen
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700'
                      : 'bg-slate-900 text-slate-400 border border-slate-700'
                  }`}>
                    {session.isOpen ? 'OPEN' : 'CLOSED'}
                  </span>
                </div>

                <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                  {session.description}
                </p>

                <div className="space-y-2 text-xs text-slate-300 mt-4 pt-3 border-t border-slate-800/80">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Hours (UTC):</span>
                    <span className="font-semibold text-slate-200">
                      {openUtcStr} - {closeUtcStr}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Hours (IST):</span>
                    <span className="font-semibold text-cyan-300">
                      {openIstStr} - {closeIstStr} IST
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Liquidity Depth:</span>
                    <span className={`font-semibold ${
                      session.name.includes('Overlap') ? 'text-purple-400' : session.isOpen ? 'text-cyan-400' : 'text-slate-400'
                    }`}>
                      {session.name.includes('Overlap') ? 'Maximum (Tier 1)' : session.isOpen ? 'High' : 'Low / Dormant'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Countdown:</span>
                <span className={`font-bold font-mono px-2 py-1 rounded ${
                  session.isOpen ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-800/60' : 'bg-slate-900 text-slate-400 border border-slate-800'
                }`}>
                  {countdown}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
