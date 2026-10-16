import { getSystemConfig } from '../../services/configService';
import { FOREX_PAIRS, ForexPairConfig } from './instruments';

function normalizeForexPairKey(value: unknown): string {
  return String(value ?? '').toUpperCase().trim().replace(/[^A-Z]/g, '');
}

/**
 * Resolve persisted SettingsHub selections to supported instruments only.
 * An explicitly empty array means "no active pairs"; it never falls back to
 * the full universe. Preserve the operator's selected order and deduplicate.
 */
export function resolveConfiguredActiveForexPairs(selection: unknown): ForexPairConfig[] {
  if (!Array.isArray(selection)) return [];
  const supported = new Map(
    FOREX_PAIRS.map(pair => [normalizeForexPairKey(pair.symbol), pair] as const)
  );
  const seen = new Set<string>();
  const resolved: ForexPairConfig[] = [];
  for (const item of selection) {
    const key = normalizeForexPairKey(item);
    const pair = supported.get(key);
    if (!pair || seen.has(key)) continue;
    seen.add(key);
    resolved.push(pair);
  }
  return resolved;
}

export function getActiveAutoLiveForexPairs(): ForexPairConfig[] {
  return resolveConfiguredActiveForexPairs(getSystemConfig().autoLiveForexPairs);
}

export function isActiveAutoLiveForexPair(pair: string): boolean {
  const key = normalizeForexPairKey(pair);
  return key.length > 0 && getActiveAutoLiveForexPairs()
    .some(activePair => normalizeForexPairKey(activePair.symbol) === key);
}
