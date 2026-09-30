import { executeQuery, executeTransaction } from '../database/db';
import type { SystemConfig } from './configService';

type PersistedConfigKey =
  | 'cTraderApiMode'
  | 'selectedCtraderAccountId'
  | 'selectedCtraderAccountCurrency'
  | 'selectedCtraderAccountLabel'
  | 'defaultRiskPct'
  | 'maxDailyLossPct'
  | 'maxOpenPositions'
  | 'maxTradesPerDay'
  | 'maxConsecutiveLosses'
  | 'maxSpreadBps'
  | 'signalCooldownMs'
  | 'eventProximityThresholdMinutes'
  | 'strikeDepth'
  | 'maxTradeValueForexUsd'
  | 'autoLiveMinSignalScore'
  | 'autoLiveMaxTradesPerPair'
  | 'forexStopLossPips'
  | 'forexTakeProfitPips'
  | 'autoLiveForexPairs'
  | 'financialDisclaimer';

const SYSTEM_SETTING_MAP: ReadonlyArray<[string, PersistedConfigKey]> = [
  ['CTRADER_API_MODE', 'cTraderApiMode'],
  ['SELECTED_CTRADER_ACCOUNT_ID', 'selectedCtraderAccountId'],
  ['SELECTED_CTRADER_ACCOUNT_CURRENCY', 'selectedCtraderAccountCurrency'],
  ['SELECTED_CTRADER_ACCOUNT_LABEL', 'selectedCtraderAccountLabel'],
  ['DEFAULT_RISK_PCT', 'defaultRiskPct'],
  ['MAX_DAILY_LOSS_PCT', 'maxDailyLossPct'],
  ['MAX_OPEN_POSITIONS', 'maxOpenPositions'],
  ['MAX_TRADES_PER_DAY', 'maxTradesPerDay'],
  ['MAX_CONSECUTIVE_LOSSES', 'maxConsecutiveLosses'],
  ['MAX_SPREAD_BPS', 'maxSpreadBps'],
  ['SIGNAL_COOLDOWN_MS', 'signalCooldownMs'],
  ['EVENT_PROXIMITY_THRESHOLD_MINUTES', 'eventProximityThresholdMinutes'],
  ['STRIKE_DEPTH', 'strikeDepth'],
  ['MAX_TRADE_VALUE_FOREX_USD', 'maxTradeValueForexUsd'],
  ['AUTO_LIVE_MIN_SIGNAL_SCORE', 'autoLiveMinSignalScore'],
  ['AUTO_LIVE_MAX_TRADES_PER_PAIR', 'autoLiveMaxTradesPerPair'],
  ['FOREX_STOP_LOSS_PIPS', 'forexStopLossPips'],
  ['FOREX_TAKE_PROFIT_PIPS', 'forexTakeProfitPips'],
  ['AUTO_LIVE_FOREX_PAIRS', 'autoLiveForexPairs'],
  ['FINANCIAL_DISCLAIMER', 'financialDisclaimer']
];

const NUMERIC_KEYS = new Set<PersistedConfigKey>([
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
  'forexTakeProfitPips'
]);

const ARRAY_KEYS = new Set<PersistedConfigKey>([
  'autoLiveForexPairs'
]);

function serializeConfigValue(key: PersistedConfigKey, value: SystemConfig[PersistedConfigKey]): string {
  if (ARRAY_KEYS.has(key)) {
    return JSON.stringify(Array.isArray(value) ? value : []);
  }
  if (value === undefined || value === null) return '';
  return String(value);
}

export function buildSystemSettingRows(
  config: SystemConfig,
  updatedAt = Date.now()
): Array<[string, string, number]> {
  return SYSTEM_SETTING_MAP.map(([dbKey, configKey]) => [
    dbKey,
    serializeConfigValue(configKey, config[configKey]),
    updatedAt
  ]);
}

export async function persistSystemConfigToDatabase(
  config: SystemConfig,
  updatedAt = Date.now()
): Promise<void> {
  const rows = buildSystemSettingRows(config, updatedAt);
  await executeTransaction((db) => {
    for (const [key, value, ts] of rows) {
      db.run(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
        [key, value, ts]
      );
    }
  });
}

export async function loadPersistedSystemConfigFromDatabase(): Promise<Partial<SystemConfig>> {
  const rows = await executeQuery<{ key: string; value: string }>(
    'SELECT key, value FROM system_settings'
  );
  if (!rows || rows.length === 0) return {};

  const map = new Map(rows.map(r => [r.key, r.value]));
  const result: Partial<SystemConfig> = {};

  for (const [dbKey, configKey] of SYSTEM_SETTING_MAP) {
    if (!map.has(dbKey)) continue;
    const raw = map.get(dbKey);
    if (raw === undefined || raw === null || raw === '') continue;

    if (ARRAY_KEYS.has(configKey)) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          (result as any)[configKey] = parsed;
        }
      } catch {}
      continue;
    }

    if (NUMERIC_KEYS.has(configKey)) {
      const num = Number(raw);
      if (Number.isFinite(num)) {
        (result as any)[configKey] = num;
      }
      continue;
    }

    (result as any)[configKey] = raw;
  }

  return result;
}
