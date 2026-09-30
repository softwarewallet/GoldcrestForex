import React, { useEffect, useState } from 'react';
import { Server, ShieldCheck, RefreshCw, CheckCircle2, XCircle, Lock, Database, DollarSign, Sliders } from 'lucide-react';
import { BrokerCredentialStatus, BrokerType, TradingEnvironment, ConnectionTestResult } from '../brokers/types';

interface BrokerSettingsPanelProps {
  currentEnvironment: TradingEnvironment;
  selectedBroker?: BrokerType;
  onEnvironmentChange: (env: TradingEnvironment) => void;
  onBrokerSelect?: (broker: BrokerType) => void;
  onRefreshGlobal?: () => void;
}

type LiveForm = Record<string, string>;

const emptyCTrader: LiveForm = { clientId: '', clientSecret: '', accessToken: '', accountId: '' };

interface BrokerCredentialFieldProps {
  broker: 'CTRADER';
  name: string;
  label: string;
  secret?: boolean;
  value: string;
  onChange: (broker: 'CTRADER', name: string, value: string) => void;
  inputClass: string;
}

const BrokerCredentialField: React.FC<BrokerCredentialFieldProps> = React.memo(({
  broker,
  name,
  label,
  secret = false,
  value,
  onChange,
  inputClass
}) => (
  <label className="block space-y-1">
    <span className="text-[10px] uppercase text-slate-500 font-mono">{label}</span>
    <input
      className={inputClass}
      type={secret ? 'password' : 'text'}
      value={value}
      onChange={e => onChange(broker, name, e.target.value)}
      autoComplete="off"
    />
  </label>
));

export const BrokerSettingsPanel: React.FC<BrokerSettingsPanelProps> = ({
  onRefreshGlobal
}) => {
  const [statuses, setStatuses] = useState<BrokerCredentialStatus[]>([]);
  const [results, setResults] = useState<Record<string, ConnectionTestResult | null>>({});
  const [forms, setForms] = useState<Record<'CTRADER', LiveForm>>({
    CTRADER: { ...emptyCTrader }
  });
  const [ack, setAck] = useState(false);
  const [cTraderApiMode, setCTraderApiMode] = useState<'LIVE' | 'DEMO'>('DEMO');
  const [savingCTraderApiMode, setSavingCTraderApiMode] = useState(false);
  const [cTraderApiModeMessage, setCTraderApiModeMessage] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [maxForexUsd, setMaxForexUsd] = useState(100000);
  const [savingLimits, setSavingLimits] = useState(false);
  const [limitMessage, setLimitMessage] = useState('');
  const [forexStopLossPips, setForexStopLossPips] = useState(20);
  const [forexTakeProfitPips, setForexTakeProfitPips] = useState(40);
  const [savingForexPipTargets, setSavingForexPipTargets] = useState(false);
  const [forexPipTargetsMessage, setForexPipTargetsMessage] = useState('');
  const [autoLiveMinSignalScore, setAutoLiveMinSignalScore] = useState(75);
  const [autoLiveMaxTradesPerPair, setAutoLiveMaxTradesPerPair] = useState(4);
  const [maxOpenPositions, setMaxOpenPositions] = useState(5);
  const [savingAutoLiveControls, setSavingAutoLiveControls] = useState(false);
  const [autoLiveControlsMessage, setAutoLiveControlsMessage] = useState('');
  const [autoLiveForexPairs, setAutoLiveForexPairs] = useState<string[]>([
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD'
  ]);
  const [newForexPair, setNewForexPair] = useState('');
  const [pairMessage, setPairMessage] = useState('');
  const [savingUniverse, setSavingUniverse] = useState(false);
  const [universeMessage, setUniverseMessage] = useState('');
  const [pairScores, setPairScores] = useState<Record<string, number>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [statusRes, configRes, signalsRes] = await Promise.all([
        fetch('/api/brokers/status', { cache: 'no-store' }).catch(() => null),
        fetch('/api/config', { cache: 'no-store' }).catch(() => null),
        fetch('/api/signals', { cache: 'no-store' }).catch(() => null)
      ]);

      if (statusRes && statusRes.ok) {
        const data = await statusRes.json();
        setStatuses(data.credentials || []);
      }
      if (configRes && configRes.ok) {
        const cfg = await configRes.json();
        if (cfg.maxTradeValueForexUsd) setMaxForexUsd(cfg.maxTradeValueForexUsd);
        if (cfg.forexStopLossPips) setForexStopLossPips(cfg.forexStopLossPips);
        if (cfg.forexTakeProfitPips) setForexTakeProfitPips(cfg.forexTakeProfitPips);
        if (cfg.autoLiveMinSignalScore !== undefined) setAutoLiveMinSignalScore(cfg.autoLiveMinSignalScore);
        if (cfg.autoLiveMaxTradesPerPair !== undefined) setAutoLiveMaxTradesPerPair(cfg.autoLiveMaxTradesPerPair);
        if (cfg.maxOpenPositions !== undefined) setMaxOpenPositions(cfg.maxOpenPositions);
        if (Array.isArray(cfg.autoLiveForexPairs)) setAutoLiveForexPairs(cfg.autoLiveForexPairs);
        if (cfg.cTraderApiMode === 'LIVE' || cfg.cTraderApiMode === 'DEMO') {
          setCTraderApiMode(cfg.cTraderApiMode);
        }
      }
      if (signalsRes && signalsRes.ok) {
        const sigData = await signalsRes.json();
        if (Array.isArray(sigData)) {
          const scoreMap: Record<string, number> = {};
          for (const s of sigData) {
            if (s?.instrument && typeof s?.score === 'number') {
              scoreMap[s.instrument] = s.score;
            }
          }
          setPairScores(scoreMap);
        }
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleChange = (broker: 'CTRADER', name: string, value: string) => {
    setForms(prev => ({
      ...prev,
      [broker]: { ...prev[broker], [name]: value }
    }));
  };

  const handleSave = async (broker: 'CTRADER') => {
    if (!ack) {
      alert('Please check the acknowledgement checkbox before saving live credentials.');
      return;
    }
    setSaving(broker);
    try {
      const res = await fetch('/api/brokers/credentials/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          broker,
          credentials: forms[broker],
          userConfirmedAcknowledge: true
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save credentials');
      alert(`Live credentials for ${broker} updated successfully.`);
      setForms(prev => ({ ...prev, [broker]: { ...emptyCTrader } }));
      await load();
      onRefreshGlobal?.();
    } catch (err: any) {
      alert(`Failed to update ${broker} credentials: ${err.message}`);
    } finally {
      setSaving(null);
    }
  };

  const handleTest = async (broker: 'CTRADER') => {
    setTesting(broker);
    try {
      const res = await fetch('/api/brokers/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker })
      });
      const data = await res.json();
      const first = (data.results || [])[0] || null;
      setResults(prev => ({ ...prev, [broker]: first }));
    } catch (err: any) {
      setResults(prev => ({
        ...prev,
        [broker]: {
          broker,
          environment: 'LIVE',
          connected: false,
          account: '****',
          error: err.message,
          timestamp: Date.now()
        }
      }));
    } finally {
      setTesting(null);
    }
  };

  const statusFor = (broker: 'CTRADER') =>
    statuses.find(s => s.broker === broker && s.environment === 'LIVE');

  const inputClass = 'w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 focus:border-emerald-500 focus:outline-none';

  return (
    <div id="broker_settings_panel" className="space-y-6">
      {/* HEADER NOTICE */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-start gap-4">
        <Server className="w-6 h-6 text-emerald-400 mt-1 shrink-0" />
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white">cTrader Broker Settings</h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/70 border border-emerald-700 text-emerald-300">
              FOREX ONLY
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Configure live Open API credentials for cTrader Forex execution.
            All secrets are stored securely on the server and masked in the UI.
          </p>
        </div>
      </div>

      {/* CTRADER API MODE SELECTION */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Server className="w-5 h-5 text-emerald-400 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold text-white">cTrader API Mode (LIVE vs DEMO Endpoint)</div>
            <p className="text-xs text-slate-400 mt-1">
              Controls whether the cTrader OpenAPI client connects to Spotware's Live endpoint (live.ctraderapi.com:5035)
              or Demo endpoint (demo.ctraderapi.com:5035).
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ctraderApiMode"
                  value="DEMO"
                  checked={cTraderApiMode === 'DEMO'}
                  onChange={() => setCTraderApiMode('DEMO')}
                  className="text-emerald-500"
                />
                <span className="text-xs font-mono text-slate-300">DEMO (demo.ctraderapi.com)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ctraderApiMode"
                  value="LIVE"
                  checked={cTraderApiMode === 'LIVE'}
                  onChange={() => setCTraderApiMode('LIVE')}
                  className="text-emerald-500"
                />
                <span className="text-xs font-mono text-slate-300 font-bold text-emerald-400">LIVE (live.ctraderapi.com)</span>
              </label>
              <button
                type="button"
                disabled={savingCTraderApiMode}
                onClick={async () => {
                  setSavingCTraderApiMode(true);
                  setCTraderApiModeMessage('');
                  try {
                    const res = await fetch('/api/config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ cTraderApiMode })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to save cTrader API Mode');
                    setCTraderApiModeMessage(`Saved! cTrader client is set to ${cTraderApiMode}.`);
                    onRefreshGlobal?.();
                  } catch (err: any) {
                    setCTraderApiModeMessage(err.message || 'Failed to save');
                  } finally {
                    setSavingCTraderApiMode(false);
                  }
                }}
                className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold"
              >
                {savingCTraderApiMode ? 'SAVING…' : 'APPLY API MODE'}
              </button>
              {cTraderApiModeMessage && (
                <span className="text-[10px] text-slate-400 font-mono">{cTraderApiModeMessage}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* FOREX RISK & EXECUTION LIMITS */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <DollarSign className="w-5 h-5 text-emerald-400 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Forex Trade Value Limit</div>
            <p className="text-xs text-slate-400 mt-1">
              Hard ceiling enforced before submitting any live order. Orders exceeding this limit are blocked.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 mt-3">
              <div>
                <span className="text-[10px] uppercase text-slate-500 font-mono">Max Forex Trade (USD)</span>
                <input
                  type="number"
                  value={maxForexUsd}
                  onChange={e => setMaxForexUsd(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button
                type="button"
                disabled={savingLimits}
                onClick={async () => {
                  setSavingLimits(true);
                  setLimitMessage('');
                  try {
                    const res = await fetch('/api/config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ maxTradeValueForexUsd: maxForexUsd })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to save limits');
                    setLimitMessage('Saved! Maximum trade limit committed to SQLite.');
                    onRefreshGlobal?.();
                  } catch (err: any) {
                    setLimitMessage(err.message || 'Failed to save limits');
                  } finally {
                    setSavingLimits(false);
                  }
                }}
                className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold"
              >
                {savingLimits ? 'SAVING…' : 'SAVE RISK LIMITS'}
              </button>
              {limitMessage && <span className="text-[10px] text-slate-400 font-mono">{limitMessage}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* FOREX PIP TARGETS */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Sliders className="w-5 h-5 text-emerald-400 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Forex Order Pip Target Presets</div>
            <p className="text-xs text-slate-400 mt-1">
              Stop Loss and Take Profit pip offsets used when sizing Forex orders.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 mt-3">
              <div>
                <span className="text-[10px] uppercase text-slate-500 font-mono">Stop Loss (Pips)</span>
                <input
                  type="number"
                  value={forexStopLossPips}
                  onChange={e => setForexStopLossPips(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <span className="text-[10px] uppercase text-slate-500 font-mono">Take Profit (Pips)</span>
                <input
                  type="number"
                  value={forexTakeProfitPips}
                  onChange={e => setForexTakeProfitPips(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button
                type="button"
                disabled={savingForexPipTargets}
                onClick={async () => {
                  setSavingForexPipTargets(true);
                  setForexPipTargetsMessage('');
                  try {
                    const res = await fetch('/api/config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        forexStopLossPips,
                        forexTakeProfitPips
                      })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to save Forex pip presets.');
                    setForexPipTargetsMessage('Saved! SL and TP pip presets committed to SQLite.');
                    onRefreshGlobal?.();
                  } catch (err: any) {
                    setForexPipTargetsMessage(err.message || 'Failed to save Forex pip presets.');
                  } finally {
                    setSavingForexPipTargets(false);
                  }
                }}
                className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold"
              >
                {savingForexPipTargets ? 'SAVING…' : 'SAVE PIP PRESETS'}
              </button>
              {forexPipTargetsMessage && <span className="text-[10px] text-slate-400 font-mono">{forexPipTargetsMessage}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* AUTO LIVE WORKING UNIVERSE */}
      <div className="bg-slate-900 border border-cyan-900/60 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Sliders className="w-5 h-5 text-cyan-400 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Auto Live Working Universe</div>
            <p className="text-xs text-slate-400 mt-1">
              Select the Forex pairs that Goldcrest should actively monitor and trade autonomously.
            </p>

            <div className="mt-4">
              <div className="flex gap-2 mb-3 max-w-md">
                <input
                  value={newForexPair}
                  onChange={e => setNewForexPair(e.target.value.toUpperCase())}
                  placeholder="e.g. CAD/JPY"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => {
                    const pair = newForexPair.trim().toUpperCase();
                    if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(pair)) {
                      setPairMessage('Use BASE/QUOTE format, e.g. CAD/JPY.');
                      return;
                    }
                    if (autoLiveForexPairs.includes(pair)) {
                      setPairMessage(pair + ' is already selected.');
                      return;
                    }
                    setAutoLiveForexPairs(prev => [...prev, pair]);
                    setNewForexPair('');
                    setPairMessage(pair + ' added. Save Working Universe to activate it.');
                  }}
                  className="shrink-0 px-3 py-2 rounded bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold"
                >ADD PAIR</button>
              </div>
              {pairMessage && <div className="text-[10px] text-cyan-300 font-mono mb-2">{pairMessage}</div>}

              <div className="grid sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                {['EUR/USD','GBP/USD','USD/JPY','USD/CHF','AUD/USD','USD/CAD','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY','AUD/JPY','EUR/AUD','GBP/AUD','XAU/USD'].map(pair => {
                  const checked = autoLiveForexPairs.includes(pair);
                  const score = pairScores[pair] ?? pairScores[pair.replace('/', '')];
                  const min = Number(autoLiveMinSignalScore) || 75;
                  const qualifies = typeof score === 'number' && score >= min;
                  return (
                    <label key={pair} className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer transition ${
                      checked
                        ? qualifies
                          ? 'border-emerald-600 bg-emerald-950/40 text-emerald-200'
                          : 'border-cyan-800 bg-cyan-950/30 text-cyan-200'
                        : 'border-slate-800 bg-slate-950 text-slate-400 opacity-75 hover:opacity-100'
                    }`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setAutoLiveForexPairs(prev =>
                          checked ? prev.filter(item => item !== pair) : [...prev, pair]
                        )}
                      />
                      <span className="font-mono text-xs font-semibold">{pair}</span>
                      {typeof score === 'number' ? (
                        <span className={`ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                          qualifies
                            ? 'bg-emerald-900/60 text-emerald-300 border-emerald-700 font-bold'
                            : 'bg-slate-900 text-slate-400 border-slate-800'
                        }`}>
                          Score: {score}
                        </span>
                      ) : (
                        <span className="ml-auto text-[9px] font-mono text-slate-600">Pending</span>
                      )}
                    </label>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-3 mt-4">
                <button
                  type="button"
                  disabled={savingUniverse || autoLiveForexPairs.length === 0}
                  onClick={async () => {
                    setSavingUniverse(true);
                    setUniverseMessage('');
                    try {
                      const res = await fetch('/api/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ autoLiveForexPairs })
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || 'Failed to save working universe.');
                      setUniverseMessage('Working universe saved. Auto Live will evaluate the selected Forex pairs.');
                      onRefreshGlobal?.();
                    } catch (err: any) {
                      setUniverseMessage(err.message || 'Failed to save working universe.');
                    } finally {
                      setSavingUniverse(false);
                    }
                  }}
                  className="px-4 py-2 rounded bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-xs font-bold"
                >
                  {savingUniverse ? 'SAVING…' : 'SAVE WORKING UNIVERSE'}
                </button>
                <span className="text-[10px] text-slate-500 font-mono">
                  {autoLiveForexPairs.length} Forex pairs active
                </span>
                {universeMessage && <span className="text-[10px] text-slate-400 font-mono">{universeMessage}</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CTRADER LIVE CREDENTIALS CARD */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm text-white">cTrader Live OpenAPI Credentials</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statusFor('CTRADER')?.configured ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <span className="text-[10px] font-mono text-slate-400">
              {statusFor('CTRADER')?.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}
            </span>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <BrokerCredentialField
            broker="CTRADER"
            name="clientId"
            label="Client ID (OpenAPI App Client ID)"
            value={forms.CTRADER.clientId}
            onChange={handleChange}
            inputClass={inputClass}
          />
          <BrokerCredentialField
            broker="CTRADER"
            name="clientSecret"
            label="Client Secret"
            secret
            value={forms.CTRADER.clientSecret}
            onChange={handleChange}
            inputClass={inputClass}
          />
          <BrokerCredentialField
            broker="CTRADER"
            name="accessToken"
            label="Access Token (Bearer Token)"
            secret
            value={forms.CTRADER.accessToken}
            onChange={handleChange}
            inputClass={inputClass}
          />
          <BrokerCredentialField
            broker="CTRADER"
            name="accountId"
            label="cTrader Account ID (ctidTraderAccountId)"
            value={forms.CTRADER.accountId}
            onChange={handleChange}
            inputClass={inputClass}
          />
        </div>

        {/* ACKNOWLEDGEMENT & ACTIONS */}
        <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-400">
            <input
              type="checkbox"
              checked={ack}
              onChange={e => setAck(e.target.checked)}
              className="rounded bg-slate-950 border-slate-800 text-emerald-500"
            />
            <span>I confirm these credentials connect directly to my live cTrader account</span>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={testing === 'CTRADER'}
              onClick={() => handleTest('CTRADER')}
              className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-bold"
            >
              {testing === 'CTRADER' ? 'TESTING…' : 'TEST CONNECTION'}
            </button>
            <button
              type="button"
              disabled={saving === 'CTRADER' || !ack}
              onClick={() => handleSave('CTRADER')}
              className="px-4 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold"
            >
              {saving === 'CTRADER' ? 'SAVING…' : 'UPDATE CTRADER CREDENTIALS'}
            </button>
          </div>
        </div>

        {/* TEST RESULT DISPLAY */}
        {results.CTRADER && (
          <div className={`mt-4 p-3 rounded-lg border text-xs font-mono flex items-start gap-2 ${
            results.CTRADER.connected
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800 text-rose-300'
          }`}>
            {results.CTRADER.connected ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
            <div>
              <div className="font-bold">{results.CTRADER.connected ? 'cTrader Connection Succeeded' : 'cTrader Connection Failed'}</div>
              {results.CTRADER.account && <div>Account: {results.CTRADER.account}</div>}
              {results.CTRADER.error && <div>Error: {results.CTRADER.error}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
