/**
 * Centralized Auto Live Trade Policy & Parallel Execution Thresholds
 */

export const AUTO_LIVE_TRAILING_STOP_LOSS_REQUIRED = true;

/**
 * XAU/USD and other gold pairs use 1/1000 volume divisor to align with standard lot sizing.
 */
export const AUTO_LIVE_XAU_VOLUME_DIVISOR = 1000;

/**
 * Polling intervals in milliseconds
 */
export const AUTO_LIVE_POSITION_REFRESH_INTERVAL_MS = 5000;
export const AUTO_LIVE_POSITION_CAPACITY_POLL_MS = 5000;
export const AUTO_LIVE_RUNTIME_RECOVERY_POLL_MS = 15000;

export type ParallelTradeTier = 'TIER_1' | 'TIER_2' | 'TIER_3' | 'BELOW_THRESHOLD';

export interface ParallelTradePolicy {
  tier: ParallelTradeTier;
  maxTradesPerPair: number;
  minScore: number;
}

/**
 * Score-based parallel-trade ladder:
 * - score >= 65 and <= 70 -> 1 trade
 * - score > 70 and <= 78  -> 2 trades
 * - score > 78            -> 5 trades
 * - score < 65            -> 0 trades
 */
export function getAutoLiveParallelTradePolicy(score: number): ParallelTradePolicy {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore) || numericScore < 65) {
    return {
      tier: 'BELOW_THRESHOLD',
      maxTradesPerPair: 0,
      minScore: 65
    };
  }

  if (numericScore <= 70) {
    return {
      tier: 'TIER_1',
      maxTradesPerPair: 1,
      minScore: 65
    };
  }

  if (numericScore <= 78) {
    return {
      tier: 'TIER_2',
      maxTradesPerPair: 2,
      minScore: 70.01
    };
  }

  return {
    tier: 'TIER_3',
    maxTradesPerPair: 5,
    minScore: 78.01
  };
}

/**
 * Validates whether a pair currently has remaining capacity to open an additional position.
 */
export function hasPairPositionCapacity(activePairPositionsCount: number, maxTradesPerPair: number): boolean {
  if (maxTradesPerPair <= 0) return false;
  return activePairPositionsCount < maxTradesPerPair;
}

/**
 * Determines whether a trading signal has an actionable direction (BUY or SELL)
 * for display in the active Auto Live trade planner.
 */
export function isVisibleAutoLiveSignal(direction?: string | null): boolean {
  if (!direction) return false;
  const upper = String(direction).toUpperCase().trim();
  return upper === 'BUY' || upper === 'SELL';
}
