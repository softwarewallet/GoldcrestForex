// ============================================================================
// MARTINGALE / RECOVERY STRATEGY SETTINGS PANEL (PHASE 43)
// ============================================================================

import React, { useState, useEffect } from 'react';
import { ShieldAlert, CheckCircle, Save, Sliders, Layers } from 'lucide-react';
import { getSystemConfig, updateSystemConfig, SystemConfig } from '../services/configService';
import { FOREX_PAIRS } from '../markets/forex/instruments';

export const MartingaleSettingsPanel: React.FC = () => {
  const [config, setConfig] = useState<SystemConfig['martingale']>(() => {
    return getSystemConfig().martingale || {
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
    };
  });

  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  const handleTogglePair = (symbol: string) => {
    const current = config.selectedPairs || [];
    const updated = current.includes(symbol)
      ? current.filter(p => p !== symbol)
      : [...current, symbol];
    setConfig(prev => ({ ...prev, selectedPairs: updated }));
  };

  const handleSave = async () => {
    await updateSystemConfig({ martingale: config });
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
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
