// ============================================================================
// MARTINGALE / RECOVERY STRATEGY SETTINGS PANEL (PHASE 43)
// ============================================================================

import React, { useState, useEffect } from 'react';
import { ShieldAlert, CheckCircle, Save, Sliders, Layers } from 'lucide-react';
import { FOREX_PAIRS } from '../markets/forex/instruments';

export interface MartingaleConfig {
  enabled: boolean;
  scope: 'ALL' | 'SELECTED';
  selectedPairs: string[];
  adverseTriggerPips: number;
  volumeMultiplier: number;
  maxRecoveryLevels: number;
  maximumVolume: number;
  dynamicTP: boolean;
  stopLoss: boolean;
  resetAfterProfit: boolean;
  maximumBasketDrawdownPct: number;
  maximumMarginUtilizationPct: number;
  maximumRecoveryDurationMin: number;
}

export const MartingaleSettingsPanel: React.FC = () => {
  const [config, setConfig] = useState<MartingaleConfig>({
    enabled: false,
    scope: 'ALL',
    selectedPairs: [],
    adverseTriggerPips: 5.0,
    volumeMultiplier: 2.0,
    maxRecoveryLevels: 5,
    maximumVolume: 50.0,
    dynamicTP: true,
    stopLoss: false,
    resetAfterProfit: true,
    maximumBasketDrawdownPct: 15.0,
    maximumMarginUtilizationPct: 50.0,
    maximumRecoveryDurationMin: 120
  });

  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [activeSequences, setActiveSequences] = useState<any[]>([]);

  useEffect(() => {
    let active = true;
    const loadConfig = async () => {
      try {
        const res = await fetch('/api/config', { cache: 'no-store' });
        if (res.ok && active) {
          const systemConfig = await res.json();
          if (systemConfig.martingale) {
            setConfig(systemConfig.martingale);
          }
        }
      } catch (err) {
        console.error('Failed to load martingale config:', err);
      }
    };
    
    const loadSequences = async () => {
      try {
        const res = await fetch('/api/martingale/sequences');
        if (res.ok && active) {
          const data = await res.json();
          setActiveSequences(data);
        }
      } catch (err) {
        console.error('Failed to load active sequences:', err);
      }
    };

    loadConfig();
    loadSequences();
    const interval = setInterval(loadSequences, 5000);
    
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const handleTogglePair = (symbol: string) => {
    const current = config.selectedPairs || [];
    const updated = current.includes(symbol)
      ? current.filter(p => p !== symbol)
      : [...current, symbol];
    setConfig(prev => ({ ...prev, selectedPairs: updated }));
  };

  const handleSave = async () => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ martingale: config })
      });
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error('Failed to save martingale config:', err);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6 text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-400 font-semibold text-xs uppercase font-mono">
            <Layers className="w-4 h-4" />
            <span>PHASE 43 — SINGLE-POSITION DYNAMIC RECOVERY STRATEGY</span>
          </div>
          <h2 className="text-xl font-bold text-white mt-1">Martingale / Recovery Strategy</h2>
          <p className="text-xs text-slate-400">
            Single-position volume modification & dynamic TP recalculation on adverse price movement. Maintain one position anchor per sequence.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
            className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
              config.enabled
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            {config.enabled ? 'MARTINGALE: ENABLED' : 'MARTINGALE: OFF (DISABLED)'}
          </button>
        </div>
      </div>

      {/* Scope Controls */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-300">Apply Recovery Strategy To:</h3>
        <div className="flex items-center gap-6 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="martingaleScope"
              checked={config.scope === 'ALL'}
              onChange={() => setConfig(prev => ({ ...prev, scope: 'ALL' }))}
              className="text-indigo-600 focus:ring-indigo-500"
            />
            <span>( ) All Forex Pairs</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="martingaleScope"
              checked={config.scope === 'SELECTED'}
              onChange={() => setConfig(prev => ({ ...prev, scope: 'SELECTED' }))}
              className="text-indigo-600 focus:ring-indigo-500"
            />
            <span>( ) Selected Pairs</span>
          </label>
        </div>

        {/* Selected Pairs Checklist */}
        {config.scope === 'SELECTED' && (
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="text-xs text-slate-400 font-semibold uppercase font-mono">
              Configured Forex Working Universe:
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 text-xs">
              {FOREX_PAIRS.map(pair => {
                const isChecked = (config.selectedPairs || []).includes(pair.symbol);
                return (
                  <label
                    key={pair.symbol}
                    className={`flex items-center justify-between p-2 rounded border cursor-pointer transition ${
                      isChecked ? 'bg-indigo-950/50 border-indigo-500/60 text-indigo-300' : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    <span>{pair.symbol}</span>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleTogglePair(pair.symbol)}
                      className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Numeric Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <label className="text-xs text-slate-400 font-medium">Adverse Trigger (Pips)</label>
          <input
            type="number"
            step="0.5"
            min="1.0"
            value={config.adverseTriggerPips}
            onChange={(e) => setConfig(prev => ({ ...prev, adverseTriggerPips: Math.max(1, parseFloat(e.target.value) || 5.0) }))}
            className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <label className="text-xs text-slate-400 font-medium">Volume Multiplier</label>
          <input
            type="number"
            step="0.1"
            min="1.1"
            max="5.0"
            value={config.volumeMultiplier}
            onChange={(e) => setConfig(prev => ({ ...prev, volumeMultiplier: Math.max(1.1, parseFloat(e.target.value) || 2.0) }))}
            className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <label className="text-xs text-slate-400 font-medium">Max Recovery Levels</label>
          <input
            type="number"
            step="1"
            min="1"
            max="10"
            value={config.maxRecoveryLevels}
            onChange={(e) => setConfig(prev => ({ ...prev, maxRecoveryLevels: Math.max(1, parseInt(e.target.value, 10) || 5) }))}
            className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <label className="text-xs text-slate-400 font-medium">Max Position Volume</label>
          <input
            type="number"
            step="1.0"
            min="1.0"
            value={config.maximumVolume}
            onChange={(e) => setConfig(prev => ({ ...prev, maximumVolume: Math.max(1.0, parseFloat(e.target.value) || 50.0) }))}
            className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <label className="text-xs text-slate-400 font-medium">Max Recovery Duration (Min)</label>
          <input
            type="number"
            step="10"
            min="10"
            value={config.maximumRecoveryDurationMin}
            onChange={(e) => setConfig(prev => ({ ...prev, maximumRecoveryDurationMin: Math.max(10, parseInt(e.target.value, 10) || 120) }))}
            className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <label className="text-xs text-slate-400 font-medium">Max Basket Drawdown (%)</label>
          <input
            type="number"
            step="1.0"
            min="1.0"
            max="50.0"
            value={config.maximumBasketDrawdownPct}
            onChange={(e) => setConfig(prev => ({ ...prev, maximumBasketDrawdownPct: Math.max(1.0, parseFloat(e.target.value) || 15.0) }))}
            className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>
      
      {/* Active Sequences Grid */}
      {activeSequences.length > 0 && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <Layers className="w-4 h-4 text-indigo-400" />
            <h3>Active Recovery Sequences ({activeSequences.length})</h3>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
            <table className="w-full text-left text-[11px] font-mono">
              <thead className="bg-slate-900/50 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2.5">ID / Pair</th>
                  <th className="px-3 py-2.5">Side</th>
                  <th className="px-3 py-2.5">Level</th>
                  <th className="px-3 py-2.5">Volume</th>
                  <th className="px-3 py-2.5">Avg Entry</th>
                  <th className="px-3 py-2.5">Next Trigger</th>
                  <th className="px-3 py-2.5">Current TP</th>
                  <th className="px-3 py-2.5">Last Recovery</th>
                  <th className="px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {activeSequences.map(seq => (
                  <tr key={seq.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-3 py-2.5">
                      <div className="text-white font-bold">{seq.pair}</div>
                      <div className="text-[9px] text-slate-500">#{seq.positionId}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded ${seq.direction === 'BUY' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-rose-900/40 text-rose-400'}`}>
                        {seq.direction}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">Lvl {seq.recoveryLevel}</td>
                    <td className="px-3 py-2.5 text-slate-300">
                      {seq.currentVolume >= 500
                        ? `${(seq.currentVolume / 100000).toFixed(2)} lots`
                        : `${seq.currentVolume.toFixed(2)} lots`}
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">{seq.currentAverageEntry.toFixed(seq.pair.includes('JPY') ? 3 : 5)}</td>
                    <td className={`px-3 py-2.5 font-bold ${seq.direction === 'BUY' ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {seq.nextTriggerPrice.toFixed(seq.pair.includes('JPY') ? 3 : 5)}
                    </td>
                    <td className="px-3 py-2.5 text-emerald-400 font-bold">{seq.currentDynamicTP.toFixed(seq.pair.includes('JPY') ? 3 : 5)}</td>
                    <td className="px-3 py-2.5 text-[10px] text-slate-400">
                      {seq.lastRecoveryAt ? new Date(seq.lastRecoveryAt).toLocaleTimeString() : 'Initial'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] uppercase font-bold ${
                        seq.status === 'WAITING_NEXT_TRIGGER' ? 'bg-blue-900/40 text-blue-400' :
                        seq.status === 'RECOVERY_SUBMITTED' ? 'bg-amber-900/40 text-amber-400 animate-pulse' :
                        seq.status === 'TP_MODIFICATION_PENDING' ? 'bg-indigo-900/40 text-indigo-400 animate-pulse' :
                        'bg-slate-800 text-slate-400'
                      }`}>
                        {seq.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer / Save Button */}
      <div className="flex items-center justify-between border-t border-slate-800 pt-4">
        <div className="text-xs text-slate-400 flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <span>No Stop Loss on managed position. Overall risk safety controls remain active.</span>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs uppercase font-mono px-5 py-2.5 rounded-lg transition-all shadow-md"
        >
          <Save className="w-4 h-4" />
          <span>Save Martingale Settings</span>
        </button>
      </div>

      {saveSuccess && (
        <div className="bg-emerald-950/60 border border-emerald-500/50 text-emerald-300 text-xs rounded-lg p-3 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span>Martingale settings saved successfully and persisted across system restarts.</span>
        </div>
      )}
    </div>
  );
};
