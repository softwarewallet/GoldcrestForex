import React, { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Lock,
  RefreshCw,
  Server,
  KeyRound,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  PlayCircle,
  Radio,
  Wifi,
  Activity,
  Layers,
  FileCheck2
} from 'lucide-react';

export type VariableStatus = 'PRESENT' | 'MISSING';

export type DemoLifecycleStatus =
  | 'CREDENTIALS_MISSING'
  | 'CREDENTIALS_PRESENT_NOT_VALIDATED'
  | 'AUTHENTICATION_IN_PROGRESS'
  | 'AUTHENTICATION_FAILED'
  | 'ACCOUNT_VERIFICATION_FAILED'
  | 'AUTHENTICATION_SUCCESSFUL'
  | 'ACCOUNT_IDENTITY_VERIFIED'
  | 'MARKET_DATA_VERIFIED'
  | 'DEMO_CONNECTIVITY_VERIFIED'
  | 'DEMO_RUNTIME_READY';

export interface SanitizedVariableMeta {
  status: VariableStatus;
  label: string;
  description: string;
  maskedPreview: string;
}

export interface DemoDiagnosticsReport {
  lifecycleStatus: DemoLifecycleStatus;
  statusLabel: string;
  variables: Record<string, SanitizedVariableMeta>;
  presentCount: number;
  totalCount: number;
  missingVariables: string[];
  readinessGate: 'BLOCKED' | 'EVALUATED_READY';
  readinessBlocker: string | null;
  liveExecutionLock: 'LOCKED_AND_DISABLED';
  tradingDecouplingActive: boolean;
  endpoint: string;
  environment: 'DEMO';
  readOnly: boolean;
  tlsVerification: 'ENFORCED';
  canAttemptAuthentication: boolean;
  authentication?: {
    attempted: boolean;
    success: boolean;
    error?: string;
    latencyMs?: number;
  };
  accountVerification?: {
    attempted: boolean;
    verified: boolean;
    maskedAccountId?: string;
    permissions?: string[];
    accountType?: string;
    currency?: string;
    error?: string;
  };
  marketDataVerification?: {
    attempted: boolean;
    verified: boolean;
    symbol?: string;
    bid?: number;
    ask?: number;
    spread?: number;
    dataTimestamp?: number;
    freshness?: string;
    error?: string;
  };
  timestamp: number;
}

const DEFAULT_VARIABLES: Record<string, SanitizedVariableMeta> = {
  CTRADER_DEMO_CLIENT_ID: {
    status: 'MISSING',
    label: 'Client ID',
    description: 'Open API OAuth application client identifier registered in Spotware Open API portal',
    maskedPreview: 'NOT CONFIGURED'
  },
  CTRADER_DEMO_CLIENT_SECRET: {
    status: 'MISSING',
    label: 'Client Secret',
    description: 'Open API OAuth application client secret used for client credentials verification',
    maskedPreview: 'NOT CONFIGURED'
  },
  CTRADER_DEMO_ACCESS_TOKEN: {
    status: 'MISSING',
    label: 'Access Token',
    description: 'Spotware OAuth 2.0 authorized bearer access token for DEMO account operations',
    maskedPreview: 'NOT CONFIGURED'
  },
  CTRADER_DEMO_ACCOUNT_ID: {
    status: 'MISSING',
    label: 'Account ID',
    description: 'Target cTrader DEMO trading account number for position and order routing',
    maskedPreview: 'NOT CONFIGURED'
  }
};

const ORDERED_KEYS = [
  'CTRADER_DEMO_CLIENT_ID',
  'CTRADER_DEMO_CLIENT_SECRET',
  'CTRADER_DEMO_ACCESS_TOKEN',
  'CTRADER_DEMO_ACCOUNT_ID'
] as const;

export const CTraderDemoConfigStatus: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [data, setData] = useState<DemoDiagnosticsReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [testingPreflight, setTestingPreflight] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let res = await fetch('/api/ctrader/demo-env-status', { cache: 'no-store' }).catch(() => null);
      if (!res || !res.ok) {
        res = await fetch('/api/brokers/ctrader/demo-env-status', { cache: 'no-store' }).catch(() => null);
      }

      if (res && res.ok) {
        const json: DemoDiagnosticsReport = await res.json();
        setData(json);
        setLastChecked(new Date(json.timestamp || Date.now()));
      } else {
        throw new Error('Unable to retrieve cTrader DEMO environment status.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to check DEMO environment configuration.');
    } finally {
      setLoading(false);
    }
  }, []);

  const runPreflightTest = useCallback(async () => {
    setTestingPreflight(true);
    setError(null);

    try {
      let res = await fetch('/api/ctrader/demo-preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }).catch(() => null);

      if (!res || !res.ok) {
        res = await fetch('/api/brokers/ctrader/demo-preflight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => null);
      }

      if (res && res.ok) {
        const json: DemoDiagnosticsReport = await res.json();
        setData(json);
        setLastChecked(new Date(json.timestamp || Date.now()));
      } else {
        throw new Error('Preflight verification request failed.');
      }
    } catch (err: any) {
      setError(err?.message || 'Preflight test failed.');
    } finally {
      setTestingPreflight(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const variables = data?.variables || DEFAULT_VARIABLES;
  const presentCount = data?.presentCount ?? ORDERED_KEYS.filter(k => variables[k]?.status === 'PRESENT').length;
  const totalCount = data?.totalCount ?? ORDERED_KEYS.length;
  const lifecycle = data?.lifecycleStatus ?? (presentCount === totalCount ? 'CREDENTIALS_PRESENT_NOT_VALIDATED' : 'CREDENTIALS_MISSING');

  const getStatusBadgeConfig = (status: DemoLifecycleStatus) => {
    switch (status) {
      case 'DEMO_RUNTIME_READY':
        return {
          bg: 'bg-emerald-950/80 border-emerald-500 text-emerald-300',
          icon: CheckCircle2,
          label: 'DEMO RUNTIME READY'
        };
      case 'MARKET_DATA_VERIFIED':
      case 'DEMO_CONNECTIVITY_VERIFIED':
        return {
          bg: 'bg-emerald-950/70 border-emerald-600 text-emerald-300',
          icon: Wifi,
          label: 'DEMO CONNECTIVITY VERIFIED'
        };
      case 'ACCOUNT_IDENTITY_VERIFIED':
      case 'AUTHENTICATION_SUCCESSFUL':
        return {
          bg: 'bg-cyan-950/80 border-cyan-600 text-cyan-300',
          icon: FileCheck2,
          label: 'AUTHENTICATION SUCCESSFUL'
        };
      case 'CREDENTIALS_PRESENT_NOT_VALIDATED':
        return {
          bg: 'bg-sky-950/80 border-sky-600 text-sky-300',
          icon: AlertTriangle,
          label: 'CREDENTIALS PRESENT — NOT VALIDATED'
        };
      case 'AUTHENTICATION_FAILED':
        return {
          bg: 'bg-rose-950/80 border-rose-600 text-rose-300',
          icon: XCircle,
          label: 'AUTHENTICATION FAILED'
        };
      case 'ACCOUNT_VERIFICATION_FAILED':
        return {
          bg: 'bg-rose-950/80 border-rose-600 text-rose-300',
          icon: XCircle,
          label: 'ACCOUNT VERIFICATION FAILED'
        };
      case 'AUTHENTICATION_IN_PROGRESS':
        return {
          bg: 'bg-amber-950/80 border-amber-600 text-amber-300',
          icon: RefreshCw,
          label: 'AUTHENTICATION IN PROGRESS'
        };
      case 'CREDENTIALS_MISSING':
      default:
        return {
          bg: 'bg-amber-950/80 border-amber-700 text-amber-300',
          icon: ShieldAlert,
          label: 'CREDENTIALS MISSING'
        };
    }
  };

  const badgeConfig = getStatusBadgeConfig(lifecycle);
  const StatusIcon = badgeConfig.icon;

  return (
    <div
      id="ctrader_demo_config_status"
      className={`bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-5 font-sans ${className}`}
    >
      {/* Header and Lifecycle Status Summary */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-950/60 border border-cyan-800 text-cyan-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-wide">
                  cTrader DEMO Environment & Runtime Readiness
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                  SECURITY PREFLIGHT
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Multi-stage readiness inspection: configuration presence, authentication preflight, market data, and execution locks
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-end sm:self-auto flex-wrap">
          {/* Detailed Lifecycle Badge */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono font-bold ${badgeConfig.bg}`}
          >
            <StatusIcon className={`w-4 h-4 shrink-0 ${lifecycle === 'AUTHENTICATION_IN_PROGRESS' || testingPreflight ? 'animate-spin' : ''}`} />
            <span>{badgeConfig.label}</span>
          </div>

          {/* Test Preflight Button */}
          <button
            type="button"
            onClick={runPreflightTest}
            disabled={loading || testingPreflight}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 border border-emerald-500 text-white text-xs font-mono font-bold transition disabled:opacity-50"
            title="Run non-destructive preflight authentication & market-data diagnostic"
          >
            <PlayCircle className={`w-3.5 h-3.5 ${testingPreflight ? 'animate-spin' : ''}`} />
            <span>{testingPreflight ? 'TESTING...' : 'RUN PREFLIGHT'}</span>
          </button>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={fetchStatus}
            disabled={loading || testingPreflight}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-mono font-semibold transition disabled:opacity-50"
            title="Re-check environment variables"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Progressive Readiness Pipeline Stages */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2">
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
          <span>Readiness Diagnostic Pipeline</span>
          <span className="text-slate-500">Step 2 Hardened Lifecycle</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs font-mono">
          {/* Stage 1: Variables */}
          <div className={`p-2.5 rounded-lg border ${
            presentCount === totalCount
              ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300'
              : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}>
            <div className="text-[10px] text-slate-500 uppercase">1. Credentials</div>
            <div className="font-bold text-[11px] mt-0.5">
              {presentCount === totalCount ? 'ALL PRESENT' : `MISSING (${presentCount}/${totalCount})`}
            </div>
          </div>

          {/* Stage 2: Authentication */}
          <div className={`p-2.5 rounded-lg border ${
            data?.authentication?.success
              ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300'
              : data?.authentication?.attempted
                ? 'bg-rose-950/40 border-rose-700/60 text-rose-300'
                : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}>
            <div className="text-[10px] text-slate-500 uppercase">2. Auth Handshake</div>
            <div className="font-bold text-[11px] mt-0.5">
              {data?.authentication?.success ? 'CONFIRMED' : data?.authentication?.attempted ? 'FAILED' : 'NOT TESTED'}
            </div>
          </div>

          {/* Stage 3: Account Verification */}
          <div className={`p-2.5 rounded-lg border ${
            data?.accountVerification?.verified
              ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300'
              : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}>
            <div className="text-[10px] text-slate-500 uppercase">3. Target Account</div>
            <div className="font-bold text-[11px] mt-0.5 truncate">
              {data?.accountVerification?.verified ? (data.accountVerification.maskedAccountId || 'VERIFIED') : 'UNVERIFIED'}
            </div>
          </div>

          {/* Stage 4: Market Data */}
          <div className={`p-2.5 rounded-lg border ${
            data?.marketDataVerification?.verified
              ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300'
              : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}>
            <div className="text-[10px] text-slate-500 uppercase">4. Market Data</div>
            <div className="font-bold text-[11px] mt-0.5">
              {data?.marketDataVerification?.verified ? 'STREAMING' : 'OFFLINE'}
            </div>
          </div>

          {/* Stage 5: Execution Lock */}
          <div className="p-2.5 rounded-lg border bg-slate-900 border-slate-800 text-slate-300 col-span-2 sm:col-span-1">
            <div className="text-[10px] text-slate-500 uppercase">5. LIVE Execution</div>
            <div className="font-bold text-[11px] mt-0.5 text-rose-400">
              LOCKED (SAFE)
            </div>
          </div>
        </div>
      </div>

      {/* Security and Redaction Guarantees */}
      <div className="bg-slate-950/90 border border-cyan-900/40 rounded-lg p-3.5 space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <div className="font-bold text-slate-200 font-mono text-[11px] uppercase tracking-wider flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-cyan-400" />
            <span>Mandatory Security Rules & Sanitization Guarantee</span>
          </div>
          <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 text-[9px] font-mono border border-cyan-800">
            ZERO PLAINTEXT SECRETS
          </span>
        </div>
        <p className="text-slate-400 text-[11px] leading-relaxed">
          Secret values are 100% redacted and never delivered to the client. Presence is audited safely via sanitized presence states (
          <span className="font-mono text-emerald-400 font-bold">PRESENT</span> /{' '}
          <span className="font-mono text-rose-400 font-bold">MISSING</span>).
          Credentials are <strong className="text-slate-300">never labeled valid based solely on nonempty environment variables</strong>. Successful authentication does not automatically enable order execution.
        </p>
      </div>

      {/* Error or Blocker Banner */}
      {(error || (data?.readinessGate === 'BLOCKED' && data?.readinessBlocker)) && (
        <div className="p-3 bg-amber-950/40 border border-amber-800/80 rounded-lg text-xs font-mono text-amber-200 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-bold uppercase text-[10px] tracking-wider text-amber-400">Readiness Gate Blocked</div>
            <div>{error || data?.readinessBlocker}</div>
          </div>
        </div>
      )}

      {/* Grid of the Four Environment Variables */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {ORDERED_KEYS.map((key) => {
          const item = variables[key] || DEFAULT_VARIABLES[key];
          const isPresent = item.status === 'PRESENT';

          return (
            <div
              key={key}
              className={`p-4 rounded-xl border transition-all ${
                isPresent
                  ? 'bg-slate-950 border-emerald-900/50 shadow-sm'
                  : 'bg-slate-950 border-slate-800/80'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <KeyRound className={`w-3.5 h-3.5 ${isPresent ? 'text-emerald-400' : 'text-slate-500'}`} />
                    <span className="text-xs font-bold text-slate-200">{item.label}</span>
                  </div>
                  <div className="font-mono text-[11px] text-cyan-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800 inline-block font-semibold">
                    {key}
                  </div>
                </div>

                {/* Sanitized Status Badge */}
                <span
                  id={`status_${key.toLowerCase()}`}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono font-bold border tracking-wider ${
                    isPresent
                      ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                      : 'bg-rose-950/80 border-rose-700 text-rose-300'
                  }`}
                >
                  {isPresent ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      PRESENT
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3.5 h-3.5 text-rose-400" />
                      MISSING
                    </>
                  )}
                </span>
              </div>

              <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
                {item.description}
              </p>

              <div className="mt-3 pt-2.5 border-t border-slate-900 flex items-center justify-between text-[10px] font-mono text-slate-500">
                <span>Sanitized Preview:</span>
                <span className="text-slate-300 font-semibold">{item.maskedPreview || (isPresent ? 'SAVED (REDACTED)' : 'NOT CONFIGURED')}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Environment Metadata & Isolation Footer */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-xs font-mono">
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
          <div className="text-[10px] text-slate-500 uppercase">DEMO ENDPOINT</div>
          <div className="text-slate-300 font-semibold text-[11px] mt-0.5 truncate" title="wss://demo.ctraderapi.com:5036">
            demo.ctraderapi.com:5036
          </div>
        </div>
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
          <div className="text-[10px] text-slate-500 uppercase">TLS VERIFICATION</div>
          <div className="text-emerald-400 font-semibold text-[11px] mt-0.5">
            ENFORCED
          </div>
        </div>
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
          <div className="text-[10px] text-slate-500 uppercase">AUTONOMOUS LIVE</div>
          <div className="text-rose-400 font-semibold text-[11px] mt-0.5">
            LOCKED & DISABLED
          </div>
        </div>
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
          <div className="text-[10px] text-slate-500 uppercase">LAST AUDITED</div>
          <div className="text-slate-300 text-[11px] mt-0.5">
            {lastChecked ? lastChecked.toLocaleTimeString() : '—'}
          </div>
        </div>
      </div>
    </div>
  );
};
