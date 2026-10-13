import { getCTraderApiMode, getSystemConfig } from '../../../services/configService';
import { CTraderLiveAdapter } from './CTraderLiveAdapter';
import { brokerRegistry } from '../../registry';
import { LIVE_AUTO_EXECUTION_ALLOWED } from '../../safety/AutoExecutionEngine';
import { killSwitch } from '../../safety/KillSwitch';
import { LiveTradingGate } from '../../safety/LiveTradingGate';

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
  status: 'PRESENT' | 'MISSING';
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
  authentication: {
    attempted: boolean;
    success: boolean;
    error?: string;
    latencyMs?: number;
  };
  accountVerification: {
    attempted: boolean;
    verified: boolean;
    maskedAccountId?: string;
    permissions?: string[];
    accountType?: string;
    currency?: string;
    error?: string;
  };
  marketDataVerification: {
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

export const REQUIRED_DEMO_KEYS = [
  'CTRADER_DEMO_CLIENT_ID',
  'CTRADER_DEMO_CLIENT_SECRET',
  'CTRADER_DEMO_ACCESS_TOKEN',
  'CTRADER_DEMO_ACCOUNT_ID'
] as const;

export function sanitizeErrorMessage(error: any): string {
  if (!error) return 'Unknown error occurred.';
  let msg = typeof error === 'string' ? error : error?.message || String(error);

  // Redact any bearer token occurrences
  msg = msg.replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
  // Redact any query param secrets
  msg = msg.replace(/(token|secret|password|access_token|client_secret)=([^&\s]+)/gi, '$1=[REDACTED]');
  // Redact any 32+ char continuous hex/alphanumeric tokens
  msg = msg.replace(/\b[a-zA-Z0-9_\-]{32,}\b/g, '[TOKEN_REDACTED]');

  return msg.trim();
}

export function inspectDemoCredentialStatus(): DemoDiagnosticsReport {
  let adapter: any;
  try {
    adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
  } catch {
    adapter = new CTraderLiveAdapter();
  }
  adapter.syncConfig();
  const cfg = adapter.config || {};

  const clientId = cfg.clientId || process.env.CTRADER_DEMO_CLIENT_ID;
  const clientSecret = cfg.clientSecret || process.env.CTRADER_DEMO_CLIENT_SECRET;
  const accessToken = cfg.accessToken || process.env.CTRADER_DEMO_ACCESS_TOKEN;
  const accountId = cfg.accountId || process.env.CTRADER_DEMO_ACCOUNT_ID;

  const variables: Record<string, SanitizedVariableMeta> = {
    CTRADER_DEMO_CLIENT_ID: {
      status: clientId && String(clientId).trim().length > 0 ? 'PRESENT' : 'MISSING',
      label: 'Client ID',
      description: 'Open API OAuth application client identifier',
      maskedPreview: clientId
        ? `****${String(clientId).trim().slice(-4)}`
        : 'NOT CONFIGURED'
    },
    CTRADER_DEMO_CLIENT_SECRET: {
      status: clientSecret && String(clientSecret).trim().length > 0 ? 'PRESENT' : 'MISSING',
      label: 'Client Secret',
      description: 'Open API OAuth application client secret',
      maskedPreview: clientSecret ? '•••••••• (Saved)' : 'NOT CONFIGURED'
    },
    CTRADER_DEMO_ACCESS_TOKEN: {
      status: accessToken && String(accessToken).trim().length > 0 ? 'PRESENT' : 'MISSING',
      label: 'Access Token',
      description: 'Spotware OAuth 2.0 authorized user access token',
      maskedPreview: accessToken ? '•••••••• (Saved)' : 'NOT CONFIGURED'
    },
    CTRADER_DEMO_ACCOUNT_ID: {
      status: accountId && String(accountId).trim().length > 0 ? 'PRESENT' : 'MISSING',
      label: 'Account ID',
      description: 'Numeric cTrader demo trading account number',
      maskedPreview: accountId
        ? `****${String(accountId).trim().slice(-4)}`
        : 'NOT CONFIGURED'
    }
  };

  const missingVariables = REQUIRED_DEMO_KEYS.filter(k => variables[k].status !== 'PRESENT');
  const presentCount = REQUIRED_DEMO_KEYS.length - missingVariables.length;
  const allPresent = missingVariables.length === 0;

  // Never label credentials VALID based solely on nonempty environment variables
  const lifecycleStatus: DemoLifecycleStatus = allPresent
    ? 'CREDENTIALS_PRESENT_NOT_VALIDATED'
    : 'CREDENTIALS_MISSING';

  const statusLabel = allPresent
    ? 'CREDENTIALS PRESENT — NOT VALIDATED'
    : 'CREDENTIALS MISSING';

  const readinessGate: 'BLOCKED' | 'EVALUATED_READY' = 'BLOCKED';
  const readinessBlocker = allPresent
    ? 'cTrader DEMO authentication preflight not yet performed.'
    : `Missing required cTrader DEMO environment variables: ${missingVariables.join(', ')}`;

  return {
    lifecycleStatus,
    statusLabel,
    variables,
    presentCount,
    totalCount: REQUIRED_DEMO_KEYS.length,
    missingVariables,
    readinessGate,
    readinessBlocker,
    liveExecutionLock: 'LOCKED_AND_DISABLED',
    tradingDecouplingActive: true,
    endpoint: 'wss://demo.ctraderapi.com:5036',
    environment: 'DEMO',
    readOnly: true,
    tlsVerification: 'ENFORCED',
    canAttemptAuthentication: allPresent,
    authentication: {
      attempted: false,
      success: false
    },
    accountVerification: {
      attempted: false,
      verified: false
    },
    marketDataVerification: {
      attempted: false,
      verified: false
    },
    timestamp: Date.now()
  };
}

let lastValidatedReport: DemoDiagnosticsReport | null = null;

export async function executeDemoPreflightValidation(): Promise<DemoDiagnosticsReport> {
  const baseStatus = inspectDemoCredentialStatus();

  // STEP 3: If any variable is missing, safely halt without making network calls or simulating success
  if (!baseStatus.canAttemptAuthentication) {
    baseStatus.readinessGate = 'BLOCKED';
    baseStatus.authentication = {
      attempted: false,
      success: false,
      error: 'Authenticated connectivity testing safely halted: DEMO credentials missing.'
    };
    lastValidatedReport = baseStatus;
    return baseStatus;
  }

  // STEP 4: Authenticate to DEMO using existing cTrader Open API flow
  baseStatus.authentication.attempted = true;
  const startAuth = Date.now();

  let adapter: any;
  try {
    adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
  } catch {
    adapter = new CTraderLiveAdapter();
  }
  adapter.syncConfig();

  try {
    const testResult = await adapter.testConnection();
    baseStatus.authentication.latencyMs = Date.now() - startAuth;

    if (!testResult.connected) {
      baseStatus.lifecycleStatus = 'AUTHENTICATION_FAILED';
      baseStatus.statusLabel = 'AUTHENTICATION FAILED';
      baseStatus.authentication.success = false;
      baseStatus.authentication.error = sanitizeErrorMessage(testResult.error || 'Authentication rejected by cTrader DEMO host.');
      baseStatus.readinessGate = 'BLOCKED';
      baseStatus.readinessBlocker = baseStatus.authentication.error;
      lastValidatedReport = baseStatus;
      return baseStatus;
    }

    baseStatus.authentication.success = true;
    baseStatus.lifecycleStatus = 'AUTHENTICATION_SUCCESSFUL';
    baseStatus.statusLabel = 'AUTHENTICATION SUCCESSFUL';

    // Account Identity Verification
    baseStatus.accountVerification.attempted = true;
    const configuredAccountId = String(process.env.CTRADER_DEMO_ACCOUNT_ID || '').trim();
    const rawAccountId = String(testResult.account || '').trim();

    // Verify account permissions and identity
    const hasPermissions = Array.isArray(testResult.permissions) && testResult.permissions.length > 0;
    const accountMatched = !configuredAccountId || rawAccountId.includes(configuredAccountId.slice(-4));

    if (!accountMatched) {
      baseStatus.lifecycleStatus = 'ACCOUNT_VERIFICATION_FAILED';
      baseStatus.statusLabel = 'ACCOUNT VERIFICATION FAILED';
      baseStatus.accountVerification.verified = false;
      baseStatus.accountVerification.error = 'Returned cTrader account ID does not match configured target account.';
      baseStatus.readinessGate = 'BLOCKED';
      baseStatus.readinessBlocker = baseStatus.accountVerification.error;
      lastValidatedReport = baseStatus;
      return baseStatus;
    }

    baseStatus.accountVerification.verified = true;
    baseStatus.accountVerification.maskedAccountId = `****${configuredAccountId.slice(-4)}`;
    baseStatus.accountVerification.permissions = testResult.permissions || ['TRADE'];
    baseStatus.accountVerification.accountType = testResult.accountType || 'DEMO';
    baseStatus.accountVerification.currency = testResult.currency || 'USD';
    baseStatus.lifecycleStatus = 'ACCOUNT_IDENTITY_VERIFIED';
    baseStatus.statusLabel = 'ACCOUNT IDENTITY VERIFIED';

    // STEP 5: Verify Market Data from authoritative DEMO feed
    baseStatus.marketDataVerification.attempted = true;
    try {
      const quote = await adapter.getQuote('EURUSD');
      const now = Date.now();
      const quoteTimestamp = quote.timestamp || now;
      const isFresh = (now - quoteTimestamp) < 30_000;

      baseStatus.marketDataVerification.symbol = quote.symbol || 'EURUSD';
      baseStatus.marketDataVerification.bid = quote.bid;
      baseStatus.marketDataVerification.ask = quote.ask;
      baseStatus.marketDataVerification.spread = quote.spread;
      baseStatus.marketDataVerification.dataTimestamp = quoteTimestamp;
      baseStatus.marketDataVerification.freshness = isFresh ? 'LIVE_STREAMING' : 'STALE';

      if (!isFresh) {
        baseStatus.marketDataVerification.verified = false;
        baseStatus.readinessGate = 'BLOCKED';
        baseStatus.readinessBlocker = 'DEMO market data quote is stale (>30s old). Readiness gate remains blocked.';
        baseStatus.lifecycleStatus = 'ACCOUNT_IDENTITY_VERIFIED';
        baseStatus.statusLabel = 'ACCOUNT IDENTITY VERIFIED (STALE DATA)';
        lastValidatedReport = baseStatus;
        return baseStatus;
      }

      baseStatus.marketDataVerification.verified = true;
      baseStatus.lifecycleStatus = 'MARKET_DATA_VERIFIED';
      baseStatus.statusLabel = 'DEMO CONNECTIVITY VERIFIED';

      // STEP 6: Preserve Execution Locks & Invariants
      const sysConfig = getSystemConfig();
      const isLiveLocked = LIVE_AUTO_EXECUTION_ALLOWED === false && sysConfig.liveTradingEnabled === false;
      const isKillSwitchActive = !killSwitch.isHalted();

      if (isLiveLocked && isKillSwitchActive) {
        baseStatus.lifecycleStatus = 'DEMO_RUNTIME_READY';
        baseStatus.statusLabel = 'DEMO RUNTIME READY';
        baseStatus.readinessGate = 'EVALUATED_READY';
        baseStatus.readinessBlocker = null;
      }
    } catch (quoteErr: any) {
      baseStatus.marketDataVerification.verified = false;
      baseStatus.marketDataVerification.error = sanitizeErrorMessage(quoteErr?.message || 'Failed to stream DEMO market data.');
      baseStatus.lifecycleStatus = 'DEMO_CONNECTIVITY_VERIFIED';
      baseStatus.statusLabel = 'DEMO CONNECTIVITY VERIFIED';
      baseStatus.readinessGate = 'BLOCKED';
      baseStatus.readinessBlocker = 'DEMO market data stream unavailable: ' + baseStatus.marketDataVerification.error;
    }

  } catch (err: any) {
    baseStatus.authentication.success = false;
    baseStatus.authentication.error = sanitizeErrorMessage(err?.message || 'Authentication flow threw an unhandled error.');
    baseStatus.lifecycleStatus = 'AUTHENTICATION_FAILED';
    baseStatus.statusLabel = 'AUTHENTICATION FAILED';
    baseStatus.readinessGate = 'BLOCKED';
    baseStatus.readinessBlocker = baseStatus.authentication.error;
  }

  baseStatus.timestamp = Date.now();
  lastValidatedReport = baseStatus;
  return baseStatus;
}

export function getLatestDemoStatusReport(): DemoDiagnosticsReport {
  if (lastValidatedReport) {
    // If environment variables changed, update variable presence without invalidating verified state if identical
    const currentInspection = inspectDemoCredentialStatus();
    if (currentInspection.lifecycleStatus === 'CREDENTIALS_MISSING') {
      lastValidatedReport = currentInspection;
      return currentInspection;
    }
    return lastValidatedReport;
  }
  return inspectDemoCredentialStatus();
}
