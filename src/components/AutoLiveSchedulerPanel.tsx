import React, { useState, useEffect } from 'react';
import {
  Clock,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Moon,
  Zap,
  Save,
  Plus,
  Trash2,
  Calendar,
  Sparkles,
  ChevronRight,
  Info
} from 'lucide-react';
import {
  parseTimeToMinutes,
  formatMinutesTo12Hour,
  formatMinutesTo24Hour,
  isTimeInWindow,
  getWindowDurationMinutes,
  formatDurationMinutes,
  RiskWindowItem,
  AutoLiveSchedulerConfig,
  SchedulerEvaluationResult,
  normalizeSchedulerConfig,
  evaluateAutoLiveScheduler,
  DEFAULT_RISK_WINDOWS
} from '../services/schedulerUtils';

interface AutoLiveSchedulerPanelProps {
  initialConfig?: AutoLiveSchedulerConfig;
  currentStatus?: SchedulerEvaluationResult | null;
  autoLiveState?: string;
  onSaved?: () => void;
  compact?: boolean;
}

const PRESET_WINDOWS: Array<{ name: string; startTime: string; endTime: string; description: string }> = [
  {
    name: 'Asian Rollover / Spread Widening',
    startTime: '22:00',
    endTime: '05:00',
    description: 'Overnight low-liquidity rollover hours where spreads spike.'
  },
  {
    name: 'US High-Impact News (CPI / NFP)',
    startTime: '12:30',
    endTime: '14:30',
    description: 'High volatility release window with severe slippage.'
  },
  {
    name: 'London Fix Volatility',
    startTime: '15:45',
    endTime: '16:30',
    description: '4:00 PM London fix algorithmic rebalancing order spikes.'
  },
  {
    name: 'European Pre-Market Illiquidity',
    startTime: '06:00',
    endTime: '07:30',
    description: 'Thin order book prior to Frankfurt and London trading opening.'
  }
];

export const AutoLiveSchedulerPanel: React.FC<AutoLiveSchedulerPanelProps> = ({
  initialConfig,
  currentStatus,
  autoLiveState,
  onSaved,
  compact = false
}) => {
  const normalizedInitial = normalizeSchedulerConfig(initialConfig);

  const [enabled, setEnabled] = useState<boolean>(normalizedInitial.enabled);
  const [timezone, setTimezone] = useState<'LOCAL' | 'UTC'>(normalizedInitial.timezone);
  const [windows, setWindows] = useState<RiskWindowItem[]>(normalizedInitial.windows);

  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Live real-time clock tick
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch authoritative config on mount and on settings update event to keep multiple instances in sync
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('/api/config', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.autoLiveScheduler) {
            const norm = normalizeSchedulerConfig(data.autoLiveScheduler);
            setEnabled(norm.enabled);
            setTimezone(norm.timezone);
            setWindows(norm.windows);
          }
        }
      } catch {}
    };

    void fetchConfig();
    const handleSettingsUpdated = () => { void fetchConfig(); };
    window.addEventListener('goldcrest:settings-updated', handleSettingsUpdated);
    window.addEventListener('focus', handleSettingsUpdated);
    return () => {
      window.removeEventListener('goldcrest:settings-updated', handleSettingsUpdated);
      window.removeEventListener('focus', handleSettingsUpdated);
    };
  }, []);

  // Client-side live evaluation
  const liveConfig: AutoLiveSchedulerConfig = {
    enabled,
    timezone,
    windows
  };
  const liveEvaluation = evaluateAutoLiveScheduler(liveConfig, now);

  const currentMinutes = timezone === 'UTC'
    ? now.getUTCHours() * 60 + now.getUTCMinutes()
    : now.getHours() * 60 + now.getMinutes();

  const localTimeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const utcTimeStr = now.toUTCString().slice(17, 25) + ' UTC';

  // Add new blank window
  const handleAddWindow = () => {
    const newId = `window-${Date.now()}`;
    const newWindow: RiskWindowItem = {
      id: newId,
      name: `Risk Window #${windows.length + 1}`,
      enabled: true,
      startTime: '12:30',
      endTime: '14:00'
    };
    setWindows(prev => [...prev, newWindow]);
    setSaveMessage({ text: 'Added new risk window. Click "Save & Apply Schedule" to commit.', type: 'success' });
  };

  // Add preset window
  const handleAddPreset = (preset: typeof PRESET_WINDOWS[0]) => {
    const newId = `window-${Date.now()}`;
    const newWindow: RiskWindowItem = {
      id: newId,
      name: preset.name,
      enabled: true,
      startTime: preset.startTime,
      endTime: preset.endTime
    };
    setWindows(prev => [...prev, newWindow]);
    setSaveMessage({ text: `Added preset "${preset.name}". Click "Save & Apply Schedule" to commit.`, type: 'success' });
  };

  // Update specific window
  const handleUpdateWindow = (id: string, updates: Partial<RiskWindowItem>) => {
    setWindows(prev =>
      prev.map(w => (w.id === id ? { ...w, ...updates } : w))
    );
  };

  // Remove window
  const handleRemoveWindow = (id: string) => {
    if (windows.length <= 1) {
      // Don't leave zero windows, just disable it or replace
      setWindows([
        {
          id: `window-${Date.now()}`,
          name: 'Primary Risk Window',
          enabled: false,
          startTime: '22:00',
          endTime: '05:00'
        }
      ]);
    } else {
      setWindows(prev => prev.filter(w => w.id !== id));
    }
    setSaveMessage({ text: 'Window removed. Click "Save & Apply Schedule" to commit.', type: 'success' });
  };

  // Instantly toggle and commit master scheduler state
  const handleToggleEnabled = async () => {
    const nextEnabled = !enabled;
    setEnabled(nextEnabled);
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const payloadConfig: AutoLiveSchedulerConfig = {
        enabled: nextEnabled,
        timezone,
        windows,
        startTime: windows[0]?.startTime || '22:00',
        endTime: windows[0]?.endTime || '05:00'
      };

      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoLiveScheduler: payloadConfig
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to toggle scheduler.');
      }

      setSaveMessage({
        text: `Scheduler ${nextEnabled ? 'ARMED & ENABLED' : 'DISABLED'}. Synchronized across Cockpit & Settings.`,
        type: 'success'
      });

      window.dispatchEvent(new CustomEvent('goldcrest:settings-updated'));
      onSaved?.();
    } catch (err: any) {
      setEnabled(!nextEnabled); // Rollback on failure
      setSaveMessage({
        text: err.message || 'Failed to toggle scheduler.',
        type: 'error'
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Save changes
  const handleSave = async () => {
    // Validate window times
    for (const w of windows) {
      const sMin = parseTimeToMinutes(w.startTime);
      const eMin = parseTimeToMinutes(w.endTime);
      if (sMin < 0 || eMin < 0) {
        setSaveMessage({ text: `Invalid time format in window "${w.name}". Use HH:mm format (e.g. 22:00).`, type: 'error' });
        return;
      }
    }

    setIsSaving(true);
    setSaveMessage(null);

    try {
      const payloadConfig: AutoLiveSchedulerConfig = {
        enabled,
        timezone,
        windows,
        startTime: windows[0]?.startTime || '22:00',
        endTime: windows[0]?.endTime || '05:00'
      };

      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoLiveScheduler: payloadConfig
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save scheduler configuration.');
      }

      setSaveMessage({
        text: `Scheduler updated: ${enabled ? 'ARMED' : 'DISABLED'} with ${windows.length} risk blackout window(s). Saved to SQLite & broadcast to Auto Live.`,
        type: 'success'
      });

      window.dispatchEvent(new CustomEvent('goldcrest:settings-updated'));
      onSaved?.();
    } catch (err: any) {
      setSaveMessage({
        text: err.message || 'Failed to save scheduler configuration.',
        type: 'error'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const isSystemCurrentlyPausedBySchedule = autoLiveState === 'PAUSED_SCHEDULE' || liveEvaluation.inRiskWindow;
  const activeWindowsCount = windows.filter(w => w.enabled).length;

  return (
    <div className="bg-slate-900 border border-amber-900/40 rounded-xl p-5 shadow-xl space-y-5">
      {/* Header bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-start gap-3">
          <div className={`p-2.5 rounded-xl border mt-0.5 ${
            isSystemCurrentlyPausedBySchedule
              ? 'bg-amber-950/80 border-amber-500 text-amber-300 animate-pulse'
              : enabled
              ? 'bg-emerald-950/60 border-emerald-600 text-emerald-400'
              : 'bg-slate-950 border-slate-800 text-slate-500'
          }`}>
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-wide">
                Auto Live Risk Blackout Scheduler
              </h2>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border ${
                isSystemCurrentlyPausedBySchedule
                  ? 'bg-amber-950 border-amber-500 text-amber-300 animate-pulse'
                  : enabled
                  ? 'bg-emerald-950 border-emerald-600 text-emerald-300'
                  : 'bg-slate-950 border-slate-700 text-slate-400'
              }`}>
                {isSystemCurrentlyPausedBySchedule
                  ? 'PAUSED (IN RISK BLACKOUT)'
                  : enabled
                  ? `ARMED (${activeWindowsCount} WINDOW${activeWindowsCount === 1 ? '' : 'S'} ACTIVE)`
                  : 'SCHEDULER DISABLED'}
              </span>
              <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-800">
                MULTIPLE WINDOWS SUPPORTED
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Configurable blackout time windows where trades historically face adverse conditions or high losses.
              Auto Live automatically <span className="text-amber-300 font-semibold">pauses</span> order execution during these windows and{' '}
              <span className="text-emerald-300 font-semibold">automatically restarts</span> once each window expires.
            </p>
          </div>
        </div>

        {/* Master Toggle & Clock */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs">
            <span className="text-slate-500">CLOCK:</span>
            <span className="text-cyan-300 font-bold">
              {timezone === 'UTC' ? utcTimeStr : localTimeStr}
            </span>
          </div>

          <button
            type="button"
            onClick={handleToggleEnabled}
            disabled={isSaving}
            className={`px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2 border transition ${
              enabled
                ? 'bg-amber-950/70 hover:bg-amber-900 border-amber-500 text-amber-200'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
            } ${isSaving ? 'opacity-70 cursor-wait' : ''}`}
          >
            <div className={`w-2.5 h-2.5 rounded-full ${enabled ? 'bg-amber-400 animate-pulse' : 'bg-slate-500'}`} />
            {isSaving ? 'UPDATING...' : enabled ? 'SCHEDULER: ENABLED' : 'SCHEDULER: DISABLED'}
          </button>
        </div>
      </div>

      {/* Real-time Status Card */}
      <div className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono text-xs ${
        isSystemCurrentlyPausedBySchedule
          ? 'bg-amber-950/40 border-amber-600/70 text-amber-200'
          : enabled
          ? 'bg-slate-950 border-emerald-900/60 text-slate-300'
          : 'bg-slate-950/60 border-slate-800 text-slate-400'
      }`}>
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-bold text-sm">
            {isSystemCurrentlyPausedBySchedule ? (
              <>
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span className="text-amber-300">ACTIVE RISK BLACKOUT IN PROGRESS</span>
              </>
            ) : enabled ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-300">TRADING PERMITTED (OUTSIDE BLACKOUT WINDOWS)</span>
              </>
            ) : (
              <>
                <Info className="w-4 h-4 text-slate-500" />
                <span className="text-slate-400">SCHEDULER IS CURRENTLY DISABLED</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-400">
            {liveEvaluation.message}
          </div>
        </div>

        {enabled && (
          <div className="flex items-center gap-3 shrink-0">
            <div className="px-3 py-2 rounded-lg bg-slate-900/90 border border-slate-800 text-right">
              <div className="text-[10px] text-slate-500 uppercase">
                {liveEvaluation.nextTransitionType === 'RESUME' ? 'Auto-Resumes In' : 'Next Pause In'}
              </div>
              <div className="text-base font-black text-cyan-300">
                {liveEvaluation.timeUntilNextTransitionFormatted || '—'}
              </div>
              <div className="text-[10px] text-slate-400">
                at {liveEvaluation.nextTransitionTime12}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Timezone Selector & Header Tools */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/70 p-3 rounded-lg border border-slate-800">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-slate-400 font-bold">Reference Timezone:</span>
          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-xs font-mono">
            <button
              type="button"
              onClick={() => setTimezone('LOCAL')}
              className={`px-3 py-1 rounded-md font-bold transition ${
                timezone === 'LOCAL' ? 'bg-cyan-950 text-cyan-300 border border-cyan-700' : 'text-slate-400 hover:text-white'
              }`}
            >
              Local Time ({Intl.DateTimeFormat().resolvedOptions().timeZone})
            </button>
            <button
              type="button"
              onClick={() => setTimezone('UTC')}
              className={`px-3 py-1 rounded-md font-bold transition ${
                timezone === 'UTC' ? 'bg-cyan-950 text-cyan-300 border border-cyan-700' : 'text-slate-400 hover:text-white'
              }`}
            >
              UTC (Broker Standard)
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAddWindow}
            className="px-3 py-1.5 rounded-lg border border-cyan-700 bg-cyan-950 text-cyan-300 hover:bg-cyan-900 text-xs font-mono font-bold flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Custom Window
          </button>
        </div>
      </div>

      {/* 24-Hour Visual Density Bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
          <span>24-Hour Schedule Timeline (00:00 – 24:00 {timezone})</span>
          <span className="text-cyan-400">Current Time: {liveEvaluation.currentTime24} ({liveEvaluation.currentTime12})</span>
        </div>
        <div className="relative h-7 bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
          {/* Hour markers & grid lines */}
          <div className="absolute inset-0 flex pointer-events-none">
            {Array.from({ length: 24 }).map((_, hour) => (
              <div key={hour} className="flex-1 border-r border-slate-800/50 relative">
                {hour % 3 === 0 && (
                  <span className="absolute bottom-0.5 left-1 text-[8px] font-mono text-slate-500 select-none">
                    {hour}h
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Blackout Window Overlay Bars */}
          {windows.map(w => {
            if (!w.enabled) return null;
            const sMin = parseTimeToMinutes(w.startTime);
            const eMin = parseTimeToMinutes(w.endTime);
            if (sMin < 0 || eMin < 0 || sMin === eMin) return null;

            const renderSegments: Array<{ leftPct: number; widthPct: number }> = [];
            if (sMin < eMin) {
              renderSegments.push({
                leftPct: (sMin / 1440) * 100,
                widthPct: ((eMin - sMin) / 1440) * 100
              });
            } else {
              // Overnight window spanning midnight
              renderSegments.push({
                leftPct: (sMin / 1440) * 100,
                widthPct: ((1440 - sMin) / 1440) * 100
              });
              renderSegments.push({
                leftPct: 0,
                widthPct: (eMin / 1440) * 100
              });
            }

            return renderSegments.map((seg, sIdx) => (
              <div
                key={`${w.id}-${sIdx}`}
                title={`Blackout Window: ${w.name} (${w.startTime} – ${w.endTime}) ${enabled ? '[Active]' : '[Preview - Scheduler Disabled]'}`}
                style={{
                  left: `${seg.leftPct}%`,
                  width: `${seg.widthPct}%`
                }}
                className={`absolute top-0 bottom-0 z-10 flex items-center justify-center overflow-hidden border-x ${
                  enabled
                    ? 'bg-gradient-to-r from-rose-600 via-red-600 to-rose-700 opacity-95 border-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.6)]'
                    : 'bg-gradient-to-r from-amber-700/80 via-amber-600/80 to-amber-700/80 opacity-80 border-amber-400/80 shadow-[0_0_8px_rgba(245,158,11,0.4)]'
                }`}
              >
                <span className="text-[9px] font-mono font-bold text-white px-1 truncate select-none drop-shadow">
                  {w.name} ({w.startTime}–{w.endTime}) {!enabled ? '[Preview]' : ''}
                </span>
              </div>
            ));
          })}

          {/* Current Time Indicator needle */}
          <div
            title={`Current Time: ${liveEvaluation.currentTime12}`}
            style={{ left: `${(currentMinutes / 1440) * 100}%` }}
            className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 z-20 shadow-[0_0_10px_#22d3ee]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono text-slate-500 pt-0.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-600 border border-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.5)]" />
            <span className="text-slate-300 font-bold">Blackout Window Active (Red Bar)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-600 border border-amber-400" />
            <span className="text-slate-400">Blackout Window Preview (Scheduler Disabled)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-950 border border-slate-800" />
            <span>Normal Execution Active</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_4px_#22d3ee]" />
            <span>Current Time Needle</span>
          </div>
        </div>
      </div>

      {/* Configured Windows List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider">
            Configured Risk Windows ({windows.length})
          </div>
          <span className="text-[10px] font-mono text-slate-500">
            Click toggle to enable/disable individual windows
          </span>
        </div>

        <div className="space-y-2.5">
          {windows.map((w, index) => {
            const evaluated = liveEvaluation.windows.find(ew => ew.id === w.id);
            const isCurrentlyActive = Boolean(evaluated?.isActiveNow && enabled);
            const sMin = parseTimeToMinutes(w.startTime);
            const eMin = parseTimeToMinutes(w.endTime);
            const isValid = sMin >= 0 && eMin >= 0;
            const s12 = isValid ? formatMinutesTo12Hour(sMin) : '--:--';
            const e12 = isValid ? formatMinutesTo12Hour(eMin) : '--:--';
            const durationMins = isValid ? getWindowDurationMinutes(sMin, eMin) : 0;
            const durationStr = formatDurationMinutes(durationMins);
            const spansMidnight = isValid && sMin > eMin;

            return (
              <div
                key={w.id}
                className={`p-3.5 rounded-xl border transition ${
                  isCurrentlyActive
                    ? 'bg-amber-950/50 border-amber-500/80 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
                    : w.enabled && enabled
                    ? 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                    : 'bg-slate-950/30 border-slate-800/60 opacity-60'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  {/* Left: Window Label & Toggle */}
                  <div className="flex items-center gap-3 flex-1 min-w-[240px]">
                    <button
                      type="button"
                      onClick={() => handleUpdateWindow(w.id, { enabled: !w.enabled })}
                      title={w.enabled ? 'Click to disable window' : 'Click to enable window'}
                      className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 transition ${
                        w.enabled
                          ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                          : 'bg-slate-900 border-slate-800 text-slate-500'
                      }`}
                    >
                      <div className={`w-2.5 h-2.5 rounded-full ${w.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                    </button>

                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={w.name}
                          onChange={e => handleUpdateWindow(w.id, { name: e.target.value })}
                          placeholder="Window Name"
                          className="bg-transparent border-b border-transparent hover:border-slate-700 focus:border-cyan-500 focus:outline-none text-xs font-bold text-white font-mono px-1 py-0.5 w-full max-w-sm"
                        />
                        {isCurrentlyActive && (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono bg-amber-950 text-amber-300 border border-amber-600 animate-pulse whitespace-nowrap">
                            ACTIVE NOW
                          </span>
                        )}
                        {!w.enabled && (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono bg-slate-900 text-slate-500 border border-slate-800 whitespace-nowrap">
                            PAUSED / OFF
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 px-1 mt-0.5 flex items-center gap-2">
                        <span>Window #{index + 1}</span>
                        <span>•</span>
                        <span>{durationStr} duration</span>
                        {spansMidnight && (
                          <>
                            <span>•</span>
                            <span className="text-amber-400">Overnight (spans midnight)</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Middle: Start & End Time Pickers */}
                  <div className="flex items-center gap-2 sm:gap-4 shrink-0 font-mono text-xs">
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-slate-500 uppercase">Start Time</div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="time"
                          value={w.startTime}
                          onChange={e => handleUpdateWindow(w.id, { startTime: e.target.value })}
                          className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none"
                        />
                        <span className="text-[10px] text-cyan-300 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 whitespace-nowrap">
                          {s12}
                        </span>
                      </div>
                    </div>

                    <span className="text-slate-600 font-bold pt-3">to</span>

                    <div className="space-y-0.5">
                      <div className="text-[10px] text-slate-500 uppercase">End Time</div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="time"
                          value={w.endTime}
                          onChange={e => handleUpdateWindow(w.id, { endTime: e.target.value })}
                          className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none"
                        />
                        <span className="text-[10px] text-cyan-300 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 whitespace-nowrap">
                          {e12}
                        </span>
                      </div>
                    </div>

                    {/* Delete button */}
                    <div className="pt-3">
                      <button
                        type="button"
                        onClick={() => handleRemoveWindow(w.id)}
                        title="Remove this window"
                        className="p-1.5 rounded-lg border border-slate-800 hover:border-rose-800 bg-slate-900 hover:bg-rose-950 text-slate-500 hover:text-rose-300 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recommended Presets Drawer */}
      <div className="space-y-2 pt-1 border-t border-slate-800/60">
        <div className="text-[11px] font-mono text-slate-400 font-bold flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>Quick Market Risk Presets (Click to Add as Additional Window):</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {PRESET_WINDOWS.map((preset, pIdx) => (
            <button
              key={pIdx}
              type="button"
              onClick={() => handleAddPreset(preset)}
              className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-900 hover:border-cyan-700 text-left transition group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 group-hover:text-cyan-300">
                  {preset.name}
                </span>
                <Plus className="w-3 h-3 text-slate-500 group-hover:text-cyan-400" />
              </div>
              <div className="text-[10px] font-mono text-cyan-400 font-semibold mt-1">
                {preset.startTime} – {preset.endTime} ({formatMinutesTo12Hour(parseTimeToMinutes(preset.startTime))} – {formatMinutesTo12Hour(parseTimeToMinutes(preset.endTime))})
              </div>
              <div className="text-[9px] text-slate-500 mt-1 line-clamp-1">
                {preset.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Save Action & Feedback Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-800">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold font-mono tracking-wider flex items-center gap-2 shadow-lg transition"
          >
            <Save className="w-4 h-4" />
            {isSaving ? 'SAVING SCHEDULE…' : `SAVE & APPLY SCHEDULE (${windows.length} WINDOWS)`}
          </button>
        </div>

        {saveMessage && (
          <div className={`px-3 py-1.5 rounded-lg text-xs font-mono border ${
            saveMessage.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
              : 'bg-rose-950/80 border-rose-600 text-rose-300'
          }`}>
            {saveMessage.text}
          </div>
        )}
      </div>
    </div>
  );
};
