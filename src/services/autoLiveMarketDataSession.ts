let enabled = false;
let generation = 0;
let lastReason = 'Auto Live has not been started.';

export interface AutoLiveMarketDataSessionStatus {
  enabled: boolean;
  generation: number;
  reason: string;
}

export function isAutoLiveMarketDataEnabled(): boolean {
  return enabled;
}

export function getAutoLiveMarketDataGeneration(): number {
  return generation;
}

export function isAutoLiveMarketDataSessionCurrent(expectedGeneration: number): boolean {
  return enabled && expectedGeneration === generation;
}

export function enableAutoLiveMarketDataSession(reason = 'Start Auto Live requested'): number {
  if (!enabled) generation += 1;
  enabled = true;
  lastReason = reason;
  return generation;
}

export function disableAutoLiveMarketDataSession(reason = 'Auto Live stopped'): number {
  if (enabled) generation += 1;
  enabled = false;
  lastReason = reason;
  return generation;
}

export function getAutoLiveMarketDataSessionStatus(): AutoLiveMarketDataSessionStatus {
  return { enabled, generation, reason: lastReason };
}
