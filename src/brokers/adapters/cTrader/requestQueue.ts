export type CTraderRequestRateClass = 'STANDARD' | 'HISTORICAL';

interface QueuedRequest<T = unknown> {
  priority: number;
  sequence: number;
  enqueuedAt: number;
  rateClass: CTraderRequestRateClass;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export interface CTraderRequestQueueOptions {
  /** Outbound spacing for normal requests; 25 ms caps normal traffic at 40 req/s. */
  standardIntervalMs?: number;
  /** Outbound spacing for historical requests; 220 ms stays below 5 req/s. */
  historicalIntervalMs?: number;
  cooldownMs?: number;
  onSlowRequest?: (waitMs: number, priority: number, pendingCount: number) => void;
}

function isRateLimitError(error: unknown): boolean {
  const message = String((error as any)?.message || error);
  return /BLOCKED_PAYLOAD_TYPE|RATE_LIMIT_EXCEEDED|TOO_MANY_REQUESTS|rate limit|too many requests/i.test(message);
}

/**
 * Priority queue for one authenticated cTrader WebSocket.
 *
 * Dispatch pacing is serialized, but waiting for a broker acknowledgement is
 * not: each request's promise settles independently while the queue continues
 * scheduling outbound messages. This prevents a slow historical response from
 * blocking orders, quotes, reconciliation and every later request.
 */
export class CTraderRequestQueue {
  private readonly pending: Array<QueuedRequest<any>> = [];
  private draining = false;
  private sequence = 0;
  private lastStandardRequestAt = 0;
  private lastHistoricalRequestAt = 0;
  private cooldownUntil = 0;
  private readonly standardIntervalMs: number;
  private readonly historicalIntervalMs: number;
  private readonly cooldownMs: number;
  private readonly onSlowRequest?: CTraderRequestQueueOptions['onSlowRequest'];

  constructor(options: CTraderRequestQueueOptions = {}) {
    this.standardIntervalMs = Math.max(0, Number(options.standardIntervalMs ?? 25));
    this.historicalIntervalMs = Math.max(0, Number(options.historicalIntervalMs ?? 220));
    this.cooldownMs = Math.max(0, Number(options.cooldownMs ?? 5000));
    this.onSlowRequest = options.onSlowRequest;
  }

  enqueue<T>(
    task: () => Promise<T>,
    priority = 40,
    rateClass: CTraderRequestRateClass = 'STANDARD'
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        priority,
        sequence: this.sequence++,
        enqueuedAt: Date.now(),
        rateClass,
        task,
        resolve,
        reject
      });
      void this.drain();
    });
  }

  applyCooldown(durationMs = this.cooldownMs): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + Math.max(0, durationMs));
  }

  private getLastRequestAt(rateClass: CTraderRequestRateClass): number {
    return rateClass === 'HISTORICAL' ? this.lastHistoricalRequestAt : this.lastStandardRequestAt;
  }

  private setLastRequestAt(rateClass: CTraderRequestRateClass, timestamp: number): void {
    if (rateClass === 'HISTORICAL') this.lastHistoricalRequestAt = timestamp;
    else this.lastStandardRequestAt = timestamp;
  }

  private intervalFor(rateClass: CTraderRequestRateClass): number {
    return rateClass === 'HISTORICAL' ? this.historicalIntervalMs : this.standardIntervalMs;
  }

  private async waitUntilDispatchAllowed(rateClass: CTraderRequestRateClass): Promise<void> {
    while (true) {
      const requiredAt = Math.max(
        this.getLastRequestAt(rateClass) + this.intervalFor(rateClass),
        this.cooldownUntil
      );
      const waitMs = requiredAt - Date.now();
      if (waitMs <= 0) return;
      await new Promise<void>(resolve => setTimeout(resolve, waitMs));
    }
  }

  private handleTaskError(entry: QueuedRequest<any>, error: unknown): void {
    if (isRateLimitError(error)) this.applyCooldown();
    entry.reject(error);
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        this.pending.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
        const entry = this.pending.shift()!;
        await this.waitUntilDispatchAllowed(entry.rateClass);
        const dispatchedAt = Date.now();
        this.setLastRequestAt(entry.rateClass, dispatchedAt);

        const queueWaitMs = dispatchedAt - entry.enqueuedAt;
        if (queueWaitMs >= 5000) {
          this.onSlowRequest?.(queueWaitMs, entry.priority, this.pending.length);
        }

        // Start the operation and release the dispatch loop immediately. Its
        // response/error promise remains correlated to this caller, but cannot
        // hold up dispatch of independent requests.
        let operation: Promise<any>;
        try {
          operation = Promise.resolve(entry.task());
        } catch (error) {
          this.handleTaskError(entry, error);
          continue;
        }
        void operation.then(
          value => entry.resolve(value),
          error => this.handleTaskError(entry, error)
        );
      }
    } finally {
      this.draining = false;
      if (this.pending.length > 0) void this.drain();
    }
  }
}
