import fs from 'node:fs';
import path from 'node:path';
import { FOREX_PAIRS } from '../markets/forex/instruments';
import { evaluateSystemConfigIntegrity } from './configIntegrityService';

export interface SystemConfig {
  tradingMode: 'LIVE_ONLY';
  liveTradingEnabled: boolean;
  dataStatus: 'LIVE' | 'DELAYED' | 'STALE' | 'UNAVAILABLE';
  modelStatus: string;
  researchStatus: 'CLOSED';
  cTraderApiMode: 'LIVE' | 'DEMO';
  selectedCtraderAccountId?: string;
  selectedCtraderAccountCurrency?: string;
  selectedCtraderAccountLabel?: string;
  defaultRiskPct: number;
  maxDailyLossPct: number;
  maxOpenPositions: number;
  maxTradesPerDay: number;
  maxConsecutiveLosses: number;
  maxSpreadBps: number;
  signalCooldownMs: number;
  eventProximityThresholdMinutes: number;
  strikeDepth: number;
  maxTradeValueForexUsd: number;
  autoLiveMinSignalScore: number;
  autoLiveMaxTradesPerPair: number;
  forexStopLossPips: number;
  forexTakeProfitPips: number;
  autoLiveForexPairs: string[];
  financialDisclaimer: string;
}

const CONFIG_DIR = process.env.GOLDCREST_CONFIG_DIR
  ? path.resolve(process.env.GOLDCREST_CONFIG_DIR)
  : path.join(process.cwd(), 'data');
const CONFIG_FILE = process.env.GOLDCREST_CONFIG_FILE
  ? path.resolve(process.env.GOLDCREST_CONFIG_FILE)
  : path.join(CONFIG_DIR, 'system-config.json');
const CONFIG_TMP_FILE = `${CONFIG_FILE}.tmp`;

/**
 * Only operator-editable, non-secret runtime settings are persisted.
 * Broker credentials remain server-side and are intentionally not copied into
 * this configuration file.
 */
const PERSISTED_KEYS: readonly (keyof SystemConfig)[] = [
  'cTraderApiMode',
  'selectedCtraderAccountId',
  'selectedCtraderAccountCurrency',
  'selectedCtraderAccountLabel',
  'defaultRiskPct',
  'maxDailyLossPct',
  'maxOpenPositions',
  'maxTradesPerDay',
  'maxConsecutiveLosses',
  'maxSpreadBps',
  'signalCooldownMs',
  'eventProximityThresholdMinutes',
  'strikeDepth',
  'maxTradeValueForexUsd',
  'autoLiveMinSignalScore',
  'autoLiveMaxTradesPerPair',
  'forexStopLossPips',
  'forexTakeProfitPips',
  'autoLiveForexPairs',
  'financialDisclaimer'
];

let activeConfig: SystemConfig = {
  tradingMode: 'LIVE_ONLY',
  liveTradingEnabled: true,
  dataStatus: 'UNAVAILABLE',
  modelStatus: 'ML BASELINE / UNCALIBRATED (PHASE 1)',
  researchStatus: 'CLOSED',
  cTraderApiMode: 'DEMO',
  defaultRiskPct: 1.0,
  maxDailyLossPct: 3.0,
  maxOpenPositions: 5,
  maxTradesPerDay: 20,
  maxConsecutiveLosses: 3,
  maxSpreadBps: 30,
  signalCooldownMs: 60000,
  eventProximityThresholdMinutes: 20,
  strikeDepth: 7,
  maxTradeValueForexUsd: 100000,
  autoLiveMinSignalScore: 75,
  autoLiveMaxTradesPerPair: 4,
  forexStopLossPips: 20,
  forexTakeProfitPips: 40,
  autoLiveForexPairs: FOREX_PAIRS.map(pair => pair.symbol),
  financialDisclaimer:
    'Trading in Forex involves substantial risk of loss. Model outputs, signals, probabilities and technical analysis are estimates for informational and analytical purposes only and are not financial advice, guarantees, or assurances of future performance.'
};

let diskConfigLoaded = false;

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function sanitizeNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function sanitizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function sanitizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const cleaned = value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim());
  return cleaned.length > 0 ? cleaned : [...fallback];
}

export function loadPersistedSystemConfig(): Partial<SystemConfig> {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return {};
    }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};

    const filtered: Partial<SystemConfig> = {};
    for (const key of PERSISTED_KEYS) {
      if (key in parsed) {
        (filtered as any)[key] = parsed[key];
      }
    }
    return filtered;
  } catch (err: any) {
    console.warn(`[Goldcrest Config] Failed to load ${CONFIG_FILE}: ${err?.message || err}`);
    return {};
  }
}

export function persistSystemConfig(config: SystemConfig): void {
  ensureConfigDir();
  const toSave: Record<string, unknown> = {};
  for (const key of PERSISTED_KEYS) {
    if (config[key] !== undefined) {
      toSave[key] = config[key];
    }
  }

  const payload = JSON.stringify(toSave, null, 2);
  try {
    fs.writeFileSync(CONFIG_TMP_FILE, payload, 'utf-8');
    fs.renameSync(CONFIG_TMP_FILE, CONFIG_FILE);
  } catch (err: any) {
    try {
      if (fs.existsSync(CONFIG_TMP_FILE)) {
        fs.unlinkSync(CONFIG_TMP_FILE);
      }
    } catch {}
    throw new Error(`Failed to persist system config: ${err?.message || err}`);
  }
}

export function getSystemConfig(): SystemConfig {
  if (!diskConfigLoaded) {
    const persisted = loadPersistedSystemConfig();
    activeConfig = {
      ...activeConfig,
      ...persisted,
      tradingMode: 'LIVE_ONLY',
      researchStatus: 'CLOSED'
    };
    diskConfigLoaded = true;
  }
  return { ...activeConfig };
}

export function prepareSystemConfigUpdate(updates: Partial<SystemConfig>): SystemConfig {
  const current = getSystemConfig();
  const next: SystemConfig = {
    ...current,
    tradingMode: 'LIVE_ONLY',
    researchStatus: 'CLOSED'
  };

  if ('defaultRiskPct' in updates) {
    next.defaultRiskPct = Math.max(0.1, Math.min(10.0, sanitizeNumber(updates.defaultRiskPct, current.defaultRiskPct)));
  }
  if ('maxDailyLossPct' in updates) {
    next.maxDailyLossPct = Math.max(0.5, Math.min(20.0, sanitizeNumber(updates.maxDailyLossPct, current.maxDailyLossPct)));
  }
  if ('maxOpenPositions' in updates) {
    next.maxOpenPositions = Math.max(1, Math.min(50, Math.floor(sanitizeNumber(updates.maxOpenPositions, current.maxOpenPositions))));
  }
  if ('maxTradesPerDay' in updates) {
    next.maxTradesPerDay = Math.max(1, Math.min(200, Math.floor(sanitizeNumber(updates.maxTradesPerDay, current.maxTradesPerDay))));
  }
  if ('maxConsecutiveLosses' in updates) {
    next.maxConsecutiveLosses = Math.max(1, Math.min(10, Math.floor(sanitizeNumber(updates.maxConsecutiveLosses, current.maxConsecutiveLosses))));
  }
  if ('maxSpreadBps' in updates) {
    next.maxSpreadBps = Math.max(1, Math.min(200, Math.floor(sanitizeNumber(updates.maxSpreadBps, current.maxSpreadBps))));
  }
  if ('signalCooldownMs' in updates) {
    next.signalCooldownMs = Math.max(1000, Math.min(600000, Math.floor(sanitizeNumber(updates.signalCooldownMs, current.signalCooldownMs))));
  }
  if ('eventProximityThresholdMinutes' in updates) {
    next.eventProximityThresholdMinutes = Math.max(0, Math.min(120, Math.floor(sanitizeNumber(updates.eventProximityThresholdMinutes, current.eventProximityThresholdMinutes))));
  }
  if ('strikeDepth' in updates) {
    next.strikeDepth = Math.max(1, Math.min(20, Math.floor(sanitizeNumber(updates.strikeDepth, current.strikeDepth))));
  }
  if ('maxTradeValueForexUsd' in updates) {
    next.maxTradeValueForexUsd = Math.max(100, Math.min(5000000, sanitizeNumber(updates.maxTradeValueForexUsd, current.maxTradeValueForexUsd)));
  }
  if ('autoLiveMinSignalScore' in updates) {
    next.autoLiveMinSignalScore = Math.max(0, Math.min(100, Math.floor(sanitizeNumber(updates.autoLiveMinSignalScore, current.autoLiveMinSignalScore))));
  }
  if ('autoLiveMaxTradesPerPair' in updates) {
    next.autoLiveMaxTradesPerPair = Math.max(1, Math.min(20, Math.floor(sanitizeNumber(updates.autoLiveMaxTradesPerPair, current.autoLiveMaxTradesPerPair))));
  }
  if ('forexStopLossPips' in updates) {
    next.forexStopLossPips = Math.max(1, Math.min(500, Math.floor(sanitizeNumber(updates.forexStopLossPips, current.forexStopLossPips))));
  }
  if ('forexTakeProfitPips' in updates) {
    next.forexTakeProfitPips = Math.max(1, Math.min(1000, Math.floor(sanitizeNumber(updates.forexTakeProfitPips, current.forexTakeProfitPips))));
  }
  if ('autoLiveForexPairs' in updates) {
    next.autoLiveForexPairs = sanitizeStringArray(updates.autoLiveForexPairs, current.autoLiveForexPairs);
  }
  if ('cTraderApiMode' in updates) {
    const rawMode = String(updates.cTraderApiMode || '').toUpperCase().trim();
    if (rawMode === 'LIVE' || rawMode === 'DEMO') {
      next.cTraderApiMode = rawMode;
    }
  }
  if ('selectedCtraderAccountId' in updates) {
    next.selectedCtraderAccountId = updates.selectedCtraderAccountId ? String(updates.selectedCtraderAccountId).trim() : undefined;
  }
  if ('selectedCtraderAccountCurrency' in updates) {
    next.selectedCtraderAccountCurrency = updates.selectedCtraderAccountCurrency ? String(updates.selectedCtraderAccountCurrency).trim().toUpperCase() : undefined;
  }
  if ('selectedCtraderAccountLabel' in updates) {
    next.selectedCtraderAccountLabel = updates.selectedCtraderAccountLabel ? String(updates.selectedCtraderAccountLabel).trim() : undefined;
  }
  if ('financialDisclaimer' in updates) {
    next.financialDisclaimer = sanitizeString(updates.financialDisclaimer, current.financialDisclaimer);
  }

  return next;
}

export function applyPersistedSystemConfig(config: Partial<SystemConfig> | SystemConfig): void {
  activeConfig = {
    ...activeConfig,
    ...config,
    tradingMode: 'LIVE_ONLY',
    researchStatus: 'CLOSED'
  };
  diskConfigLoaded = true;
}

export function updateSystemConfig(updates: Partial<SystemConfig>): SystemConfig {
  const updated = prepareSystemConfigUpdate(updates);
  persistSystemConfig(updated);
  applyPersistedSystemConfig(updated);
  return { ...activeConfig };
}

export function getCTraderApiMode(): 'LIVE' | 'DEMO' {
  const configuredMode = getSystemConfig().cTraderApiMode;
  if (configuredMode === 'LIVE' || configuredMode === 'DEMO') {
    return configuredMode;
  }
  return process.env.CTRADER_API_MODE === 'LIVE' ? 'LIVE' : 'DEMO';
}
