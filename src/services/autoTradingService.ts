import { LiveForexProvider } from '../markets/forex/provider';
import { FOREX_PAIRS, getForexPairConfig } from '../markets/forex/instruments';
import { ForexSignalEngine } from '../markets/forex/signalEngine';
import { getForexSessionState } from '../markets/common/session';
import { getAutoLiveMarketGate, AutoLiveMarketGate } from './marketOpenGate';
import { fetchLiveForexNews, LiveNewsSnapshot } from './liveNewsService';
import { getCTraderApiMode } from './configService';
import { brokerRegistry } from '../brokers/registry';
import { autoExecutionEngine, refreshAutonomousExecutionPermission, disarmLocalAutonomousExecution } from '../brokers/safety/AutoExecutionEngine';
import { autoTradeReadinessService } from '../brokers/safety/AutoTradeReadiness';
import { getSystemConfig } from './configService';
import { killSwitch } from '../brokers/safety/KillSwitch';
import { BrokerAdapter, NormalizedQuote, OrderRequest } from '../brokers/types';
import { liveRuntimeLog, tradeAuditLog } from './liveRuntimeLog';
import { tradeContinuityService } from './tradeContinuityService';
import { calculateForexPipTargets, normalizePriceToThreeDigits, sizeForexOrderToMaxTradeValue } from '../brokers/safety/TradeSizing';

const LIVE_QUOTE_MAX_AGE_MS = 30_000;

const AUTO_INTERVAL_MS = Math.max(
  15_000,
  Number(process.env.GOLDCREST_AUTO_TRADING_INTERVAL_MS || 60_000)
);

const DEFAULT_AUTO_FOREX_PAIRS = FOREX_PAIRS.map(pair => pair.symbol);

function getConfiguredAutoForexPairs(): string[] {
  const configured = getSystemConfig().autoLiveForexPairs;
  if (!Array.isArray(configured) || configured.length === 0) return [...DEFAULT_AUTO_FOREX_PAIRS];
  return [...new Set(configured
    .map(symbol => String(symbol).toUpperCase().trim())
    .filter(symbol => /^[A-Z]{3}\/[A-Z]{3}$/.test(symbol)))];
}

// Pre-open preparation is background work. Keep the operator-facing arm fast,
// avoid repeating the same broker history fetch every minute, and bound
// concurrent pair preparation so cTrader is not flooded with sessions.
const PREOPEN_PREPARATION_MIN_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.GOLDCREST_PREOPEN_MIN_INTERVAL_MS || 120_000)
);
const PREOPEN_PAIR_CONCURRENCY = Math.max(
  1,
  Math.min(3, Number(process.env.GOLDCREST_PREOPEN_PAIR_CONCURRENCY || 3))
);

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );
  return results;
}

export type AutoTradingState = 'STOPPED' | 'PREPARING' | 'RUNNING' | 'PAUSED_LIMIT' | 'PAUSED_RUNTIME' | 'BLOCKED';
export type AutoTradingExecutionStage = 'IDLE' | 'SCANNING_MARKET' | 'ANALYZING_SIGNAL' | 'PREPARING_ORDER' | 'SAFETY_GATE' | 'SUBMITTING_ORDER' | 'TRADE_EXECUTED' | 'REJECTED';

export interface AutoTradingExecutionStatus {
  stage: AutoTradingExecutionStage;
  pair: string | null;
  side: 'BUY' | 'SELL' | null;
  signalId: string | null;
  message: string;
  updatedAt: number;
}

export interface AutoTradingStatus {
  state: AutoTradingState;
  enabledByEnvironment: boolean;
  autonomousPermission: boolean;
  intervalMs: number;
  minSignalScore: number;
  maxTradesPerPair: number;
  maxOpenPositions: number;
  pairs: string[];
  indianUnderlyings: string[];
  lastCycleAt: number | null;
  lastCycleResult: string | null;
  lastActions: Array<{
    pair: string;
    result: string;
    signalId?: string;
    reason?: string;
    orderId?: string;
  }>;
  marketGate: AutoLiveMarketGate;
  currentExecution: AutoTradingExecutionStatus;
  lastExecution: AutoTradingExecutionStatus | null;
  executionPausedByPositionLimit: boolean;
  continuity: ReturnType<typeof tradeContinuityService.getStatus>;
  preOpenPreparation: {
    lastPreparedAt: number | null;
    trendPairsEvaluated: number;
    news: LiveNewsSnapshot | null;
    status: 'IDLE' | 'RUNNING' | 'READY' | 'UNAVAILABLE';
  };
  requiresClosedMarketConfirmation?: boolean;
}

class AutoTradingService {
  private provider = new LiveForexProvider();
  private signalEngine = new ForexSignalEngine(undefined, this.provider);
  private timer: NodeJS.Timeout | null = null;
  private state: AutoTradingState = 'STOPPED';
  private lastCycleAt: number | null = null;
  private lastCycleResult: string | null = null;
  private lastActions: AutoTradingStatus['lastActions'] = [];
  private lastPreOpenPreparedAt: number | null = null;
  private preOpenTrendPairsEvaluated = 0;
  private preOpenNews: LiveNewsSnapshot | null = null;
  private preOpenStatus: 'IDLE' | 'RUNNING' | 'READY' | 'UNAVAILABLE' = 'IDLE';
  private cycleInFlight = false;
  // When the authoritative system-wide live-position limit is full, Auto Live
  // pauses expensive market/news analysis and polls only the broker position
  // count until a slot becomes available.
  private executionPausedByPositionLimit = false;
  private positionCapacityTimer: NodeJS.Timeout | null = null;
  private readonly POSITION_CAPACITY_POLL_MS = 10_000;
  // Market analysis can run concurrently across the configured universe, but
  // broker-side execution is serialized so two pairs cannot race the same
  // account-position/exposure snapshot and bypass the global safety limits.
  private executionQueue: Promise<void> = Promise.resolve();
  private currentExecution: AutoTradingExecutionStatus = {
    stage: 'IDLE',
    pair: null,
    side: null,
    signalId: null,
    message: 'Waiting for the next Auto Live cycle.',
    updatedAt: Date.now()
  };
  private lastExecution: AutoTradingExecutionStatus | null = null;

  private isRequested(): boolean {
    // Development mode is not itself an execution request. Autonomous live
    // execution must be explicitly armed through the two runtime flags.
    return process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true'
      && process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION === 'true';
  }


  private async withExecutionLock<T>(worker: () => Promise<T>): Promise<T> {
    const previous = this.executionQueue;
    let release!: () => void;
    this.executionQueue = new Promise<void>(resolve => {
      release = resolve;
    });

    await previous;
    try {
      return await worker();
    } finally {
      release();
    }
  }

  private setExecutionStatus(update: Partial<AutoTradingExecutionStatus> & Pick<AutoTradingExecutionStatus, 'stage' | 'message'>): void {
    this.currentExecution = { ...this.currentExecution, ...update, updatedAt: Date.now() };
    liveRuntimeLog('INFO', 'AUTO_TRADING_EXECUTION_STAGE', this.currentExecution);
    tradeAuditLog('EXECUTION_STAGE', this.currentExecution);
  }

  private finishExecution(stage: 'TRADE_EXECUTED' | 'REJECTED', message: string, extra: Partial<AutoTradingExecutionStatus> = {}): void {
    this.setExecutionStatus({ stage, message, ...extra });
    this.lastExecution = { ...this.currentExecution };
  }

  private getConfiguredMaxOpenPositions(): number {
    return Math.max(1, Math.floor(Number(getSystemConfig().maxOpenPositions)));
  }

  private async getAuthoritativePositionCapacity(): Promise<{ current: number; max: number; available: number }> {
    const adapter = brokerRegistry.getAdapter('CTRADER', getCTraderApiMode());
    const positions = await adapter.getPositions();
    const current = Array.isArray(positions) ? positions.length : 0;
    const max = this.getConfiguredMaxOpenPositions();
    return { current, max, available: Math.max(0, max - current) };
  }

  private pauseForPositionLimit(current: number, max: number, reason: string): void {
    this.executionPausedByPositionLimit = true;
    this.lastCycleResult = `Auto Live paused: ${reason} (${current}/${max}). Waiting for a free position slot.`;
    liveRuntimeLog('INFO', 'AUTO_TRADING_POSITION_CAPACITY_PAUSED', { currentOpenPositions: current, maxOpenPositions: max, reason, pollIntervalMs: this.POSITION_CAPACITY_POLL_MS });
    if (!this.positionCapacityTimer) {
      this.positionCapacityTimer = setInterval(() => { void this.checkPositionCapacityAndResume(); }, this.POSITION_CAPACITY_POLL_MS);
      this.positionCapacityTimer.unref?.();
    }
  }

  private async checkPositionCapacityAndResume(): Promise<void> {
    if (!this.executionPausedByPositionLimit || this.state !== 'RUNNING' || this.cycleInFlight) return;
    try {
      const capacity = await this.getAuthoritativePositionCapacity();
      if (capacity.available <= 0) return;
      this.executionPausedByPositionLimit = false;
      if (this.positionCapacityTimer) {
        clearInterval(this.positionCapacityTimer);
        this.positionCapacityTimer = null;
      }
      this.lastCycleResult = `Auto Live resumed: ${capacity.available} live position slot(s) are available.`;
      liveRuntimeLog('INFO', 'AUTO_TRADING_POSITION_CAPACITY_RESUMED', { currentOpenPositions: capacity.current, maxOpenPositions: capacity.max, availableSlots: capacity.available });
      void this.runCycle();
    } catch (error: any) {
      liveRuntimeLog('WARN', 'AUTO_TRADING_POSITION_CAPACITY_CHECK_ERROR', { error: error?.message || String(error) });
    }
  }

  private clearPositionCapacityPause(): void {
    this.executionPausedByPositionLimit = false;
    if (this.positionCapacityTimer) {
      clearInterval(this.positionCapacityTimer);
      this.positionCapacityTimer = null;
    }
  }

  getStatus(): AutoTradingStatus {
    const autonomousPermission = refreshAutonomousExecutionPermission();
    return {
      state: this.state,
      enabledByEnvironment: this.isRequested(),
      autonomousPermission,
      intervalMs: AUTO_INTERVAL_MS,
      minSignalScore: Number(getSystemConfig().autoLiveMinSignalScore),
      maxTradesPerPair: Number(getSystemConfig().autoLiveMaxTradesPerPair),
      maxOpenPositions: Number(getSystemConfig().maxOpenPositions),
      pairs: getConfiguredAutoForexPairs(),
      indianUnderlyings: [...getSystemConfig().autoLiveIndianUnderlyings],
      lastCycleAt: this.lastCycleAt,
      lastCycleResult: this.lastCycleResult,
      lastActions: [...this.lastActions],
      marketGate: getAutoLiveMarketGate(),
      currentExecution: { ...this.currentExecution },
      lastExecution: this.lastExecution ? { ...this.lastExecution } : null,
      executionPausedByPositionLimit: this.executionPausedByPositionLimit,
      continuity: tradeContinuityService.getStatus(),
      preOpenPreparation: {
        lastPreparedAt: this.lastPreOpenPreparedAt,
        trendPairsEvaluated: this.preOpenTrendPairsEvaluated,
        news: this.preOpenNews,
        status: this.preOpenStatus
      }
    };
  }

  private refreshNewsOnStart(): void {
    const pairs = getConfiguredAutoForexPairs();
    this.preOpenStatus = 'RUNNING';
    liveRuntimeLog('INFO', 'AUTO_TRADING_START_NEWS_REFRESH_REQUESTED', { pairs, forceRefresh: true });

    void fetchLiveForexNews({ pairs, forceRefresh: true })
      .then(snapshot => {
        this.preOpenNews = snapshot;
        this.preOpenStatus = snapshot.status === 'LIVE' ? 'READY' : 'UNAVAILABLE';
        liveRuntimeLog(snapshot.status === 'LIVE' ? 'INFO' : 'WARN', 'AUTO_TRADING_START_NEWS_REFRESH_COMPLETED', {
          source: snapshot.source,
          status: snapshot.status,
          articleCount: snapshot.articleCount,
          highImpactCount: snapshot.highImpactCount,
          riskLevel: snapshot.riskLevel,
          providerStatus: snapshot.providerStatus,
          error: snapshot.error
        });
      })
      .catch(error => {
        this.preOpenStatus = 'UNAVAILABLE';
        liveRuntimeLog('ERROR', 'AUTO_TRADING_START_NEWS_REFRESH_FAILED', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  start(options: { confirmWhenClosed?: boolean } = {}): AutoTradingStatus {
    const marketGate = getAutoLiveMarketGate();

    liveRuntimeLog('SYSTEM', 'AUTO_TRADING_START_ATTEMPT', {
      previousState: this.state,
      requestedFlags: {
        autoTrading: process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true',
        autonomousLiveExecution: process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION === 'true'
      },
      marketGate,
      confirmWhenClosed: Boolean(options.confirmWhenClosed)
    });

    if (marketGate.bothMarketsClosed && !options.confirmWhenClosed) {
      const message = 'Markets are closed, do you still want to start Auto Live';
      this.lastCycleResult = message;
      liveRuntimeLog('INFO', 'AUTO_TRADING_CLOSED_MARKET_CONFIRMATION_REQUIRED', {
        message,
        marketGate
      });
      return {
        ...this.getStatus(),
        requiresClosedMarketConfirmation: true
      };
    }

    // Auto Live is mode-agnostic: the cTrader adapter resolves the selected
    // DEMO/LIVE endpoint and matching credentials from system configuration.
    if (!this.isRequested()) {
      this.state = 'BLOCKED';
      this.lastCycleResult = 'Autonomous execution is not enabled. Both GOLDCREST_AUTO_TRADING_ENABLED and GOLDCREST_AUTONOMOUS_LIVE_EXECUTION must be true.';
      liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
        stage: 'REQUEST_FLAGS',
        reason: this.lastCycleResult
      });
      return this.getStatus();
    }

    const activation = autoExecutionEngine.enableAutomaticExecution();
    if (!activation.success) {
      this.state = 'BLOCKED';
      this.lastCycleResult = activation.message;
      liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
        stage: 'ARM',
        code: activation.code,
        reason: activation.message
      });
      return this.getStatus();
    }

    if (!getSystemConfig().liveTradingEnabled) {
      this.state = 'BLOCKED';
      this.lastCycleResult = 'LIVE_TRADING_ENABLED is not true.';
      liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
        stage: 'LIVE_TRADING_CONFIG',
        reason: this.lastCycleResult
      });
      return this.getStatus();
    }

    const permission = refreshAutonomousExecutionPermission();
    if (!permission) {
      this.state = 'BLOCKED';
      this.lastCycleResult = 'Autonomous execution is not currently permitted. The strategy must be calibrated and the safety controls must pass.';
      liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
        stage: 'AUTONOMOUS_PERMISSION',
        reason: this.lastCycleResult
      });
      return this.getStatus();
    }

    if (this.timer) return this.getStatus();

    // Refresh the news universe immediately on every new Auto Live start;
    // don't wait for the first scan interval or rely on an old cached snapshot.
    this.refreshNewsOnStart();

    if (marketGate.anyMarketOpen) {
      this.state = 'RUNNING';
      this.lastCycleResult = 'Auto-trading loop started.';
      liveRuntimeLog('SYSTEM', 'AUTO_TRADING_STARTED', {
        intervalMs: AUTO_INTERVAL_MS,
        pairs: getConfiguredAutoForexPairs(),
        marketGate
      });
      // Yield to the event loop before starting the first scan. runCycle
      // performs synchronous setup before its first await and can delay the
      // HTTP arm response when invoked inline.
      setTimeout(() => { void this.runCycle(); }, 0).unref?.();
    } else {
      this.state = 'PREPARING';
      this.lastCycleResult = 'Markets are closed. Auto Live is armed; pre-open preparation is running and the system will begin evaluating trades as soon as a supported market opens.';
      this.preOpenStatus = 'RUNNING';
      liveRuntimeLog('SYSTEM', 'AUTO_TRADING_PRE_OPEN_ARMED', {
        intervalMs: AUTO_INTERVAL_MS,
        pairs: getConfiguredAutoForexPairs(),
        marketGate
      });
      // Return PREPARING promptly; run pre-open preparation after this call.
      setTimeout(() => { void this.runScheduledCycle(); }, 0).unref?.();
    }

    this.timer = setInterval(() => {
      void this.runScheduledCycle();
    }, AUTO_INTERVAL_MS);
    this.timer.unref?.();

    return this.getStatus();
  }

  abandonClosedMarketStart(): AutoTradingStatus {
    this.lastCycleResult = 'Auto Live start abandoned while markets were closed.';
    liveRuntimeLog('INFO', 'AUTO_TRADING_CLOSED_MARKET_START_ABANDONED', {
      marketGate: getAutoLiveMarketGate()
    });
    return this.getStatus();
  }

  stop(reason = 'Operator stopped auto trading.'): AutoTradingStatus {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.clearPositionCapacityPause();
    this.state = 'STOPPED';
    this.lastCycleResult = reason;
    liveRuntimeLog('SYSTEM', 'AUTO_TRADING_STOPPED', { reason });
    disarmLocalAutonomousExecution();
    return this.getStatus();
  }

  /**
   * Check the authoritative live cTrader position count before starting or
   * continuing an Auto Live execution cycle.
   *
   * When the configured system-wide position limit is full, Auto Live enters
   * PAUSED_LIMIT rather than repeatedly scanning signals and reaching
   * Condition 13B one order at a time. The timer remains armed, so the service
   * re-checks the broker when the next cycle arrives and automatically resumes
   * as soon as a live-position slot is available.
   */
  private async checkSystemPositionCapacity(): Promise<boolean> {
    const maxOpenPositions = Math.max(
      1,
      Math.min(100, Math.floor(Number(getSystemConfig().maxOpenPositions)))
    );

    try {
      const adapter = brokerRegistry.getAdapter('CTRADER', getCTraderApiMode());
      const positions = await adapter.getPositions();
      const activePositionsCount = Array.isArray(positions) ? positions.length : 0;

      if (activePositionsCount >= maxOpenPositions) {
        const wasAlreadyPaused = this.state === 'PAUSED_LIMIT';
        this.state = 'PAUSED_LIMIT';
        this.lastCycleResult =
          `Auto Live paused: maximum system-wide live positions reached (${activePositionsCount}/${maxOpenPositions}). Waiting for a position slot to become available.`;

        if (!wasAlreadyPaused) {
          liveRuntimeLog('INFO', 'AUTO_TRADING_POSITION_LIMIT_PAUSED', {
            activePositionsCount,
            maxOpenPositions
          });
          tradeAuditLog('AUTO_TRADING_POSITION_LIMIT_PAUSED', {
            activePositionsCount,
            maxOpenPositions
          });
        }

        return false;
      }

      if (this.state === 'PAUSED_LIMIT') {
        this.state = 'RUNNING';
        this.lastCycleResult =
          `Auto Live resumed: a live-position slot is available (${activePositionsCount}/${maxOpenPositions}).`;
        liveRuntimeLog('INFO', 'AUTO_TRADING_POSITION_LIMIT_RESUMED', {
          activePositionsCount,
          maxOpenPositions
        });
        tradeAuditLog('AUTO_TRADING_POSITION_LIMIT_RESUMED', {
          activePositionsCount,
          maxOpenPositions
        });
      }

      return true;
    } catch (error: any) {
      // Do not hammer the broker when the authoritative position snapshot is
      // unavailable. Stay paused and retry on the next scheduled cycle.
      this.state = 'PAUSED_LIMIT';
      this.lastCycleResult =
        'Auto Live paused: unable to verify current live-position capacity. Retrying on the next cycle.';
      liveRuntimeLog('WARN', 'AUTO_TRADING_POSITION_LIMIT_CHECK_UNAVAILABLE', {
        maxOpenPositions,
        error: error?.message || String(error)
      });
      return false;
    }
  }

  private async runScheduledCycle(): Promise<void> {
    if (!['PREPARING', 'RUNNING', 'PAUSED_LIMIT', 'PAUSED_RUNTIME'].includes(this.state) || this.cycleInFlight) return;

    const marketGate = getAutoLiveMarketGate();

    if (this.state === 'PAUSED_RUNTIME') {
      if (killSwitch.isHalted()) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Emergency kill switch is active; Auto Live remains blocked until operator intervention.';
        liveRuntimeLog('WARN', 'AUTO_TRADING_RUNTIME_PAUSE_KILL_SWITCH', { marketGate });
        return;
      }
      if (!refreshAutonomousExecutionPermission()) {
        this.lastCycleResult = 'Auto Live is paused because runtime permission is temporarily unavailable. It will retry automatically on the next cycle; no orders can be submitted while permission is false.';
        liveRuntimeLog('WARN', 'AUTO_TRADING_RUNTIME_PERMISSION_RETRY', { intervalMs: AUTO_INTERVAL_MS, marketGate });
        return;
      }
      this.state = marketGate.bothMarketsClosed ? 'PREPARING' : 'RUNNING';
      this.lastCycleResult = 'Auto Live resumed after runtime permission recovered.';
      liveRuntimeLog('INFO', 'AUTO_TRADING_RUNTIME_RESUMED', { marketGate, nextState: this.state });
    }

    if (this.state === 'PAUSED_LIMIT') {
      const capacityAvailable = await this.checkSystemPositionCapacity();
      if (!capacityAvailable) return;
    }

    if (marketGate.bothMarketsClosed) {
      if (this.state === 'RUNNING') {
        this.state = 'PREPARING';
        this.lastCycleResult = 'Markets closed. Auto Live remains armed and has returned to pre-open preparation.';
        liveRuntimeLog('INFO', 'AUTO_TRADING_MARKET_CLOSED_PREPARATION_RESUMED', { marketGate });
      }
      await this.runPreOpenPreparation(marketGate);
      return;
    }

    if (this.state === 'PREPARING') {
      this.state = 'RUNNING';
      this.lastCycleResult = 'A supported market is now open. Auto Live is moving from preparation to live signal evaluation.';
      liveRuntimeLog('SYSTEM', 'AUTO_TRADING_MARKET_OPENED', { marketGate });
    }

    await this.runCycle();
  }

  private async runPreOpenPreparation(marketGate: AutoLiveMarketGate): Promise<void> {
    if (this.state !== 'PREPARING' || this.cycleInFlight) return;

    const sinceLastPreparation = this.lastPreOpenPreparedAt
      ? Date.now() - this.lastPreOpenPreparedAt
      : Number.POSITIVE_INFINITY;
    const hasFreshNews = this.preOpenNews?.status === 'LIVE';
    const hasFreshPreparation =
      sinceLastPreparation < PREOPEN_PREPARATION_MIN_INTERVAL_MS
      && this.preOpenStatus === 'READY'
      && hasFreshNews;

    if (hasFreshPreparation) {
      this.lastCycleResult = `Pre-open preparation is already fresh (${Math.round(sinceLastPreparation / 1000)}s old). Auto Live remains armed.`;
      liveRuntimeLog('INFO', 'PREOPEN_PREPARATION_SKIPPED_FRESH', {
        ageMs: sinceLastPreparation,
        minIntervalMs: PREOPEN_PREPARATION_MIN_INTERVAL_MS,
        newsStatus: this.preOpenNews?.status,
        newsFetchedAt: this.preOpenNews?.fetchedAt
      });
      return;
    }

    this.cycleInFlight = true;
    this.preOpenStatus = 'RUNNING';

    try {
      if (killSwitch.isHalted()) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Emergency kill switch is active.';
        this.preOpenStatus = 'UNAVAILABLE';
        liveRuntimeLog('WARN', 'AUTO_TRADING_PRE_OPEN_BLOCKED', { reason: this.lastCycleResult });
        return;
      }

      if (!refreshAutonomousExecutionPermission()) {
        this.state = 'PAUSED_RUNTIME';
        this.lastCycleResult = 'Auto Live pre-open preparation is paused because runtime permission is temporarily unavailable. It will retry automatically.';
        this.preOpenStatus = 'UNAVAILABLE';
        liveRuntimeLog('WARN', 'AUTO_TRADING_PRE_OPEN_PERMISSION_PAUSED', { reason: this.lastCycleResult, intervalMs: AUTO_INTERVAL_MS });
        return;
      }

      const newsPromise = fetchLiveForexNews({
        pairs: getConfiguredAutoForexPairs()
      });
      const trendResultsRaw = await mapWithConcurrency(
        getConfiguredAutoForexPairs(),
        PREOPEN_PAIR_CONCURRENCY,
        async pair => {
          try {
            await this.provider.refreshPair(pair);
            const analysis = this.signalEngine.analyzePair(pair);
            liveRuntimeLog('INFO', 'PREOPEN_TREND_EVALUATED', {
              pair,
              trend: analysis.trend.direction,
              strength: analysis.trend.strength,
              regime: analysis.regime,
              alignment: analysis.multiTimeframe.alignment,
              signalScore: analysis.signal.score
            });
            return {
              pair,
              trend: analysis.trend.direction,
              strength: analysis.trend.strength,
              regime: analysis.regime,
              alignment: analysis.multiTimeframe.alignment,
              score: analysis.signal.score
            };
          } catch (error: any) {
            liveRuntimeLog('WARN', 'PREOPEN_TREND_UNAVAILABLE', {
              pair,
              error: error?.message || String(error)
            });
            return null;
          }
        }
      );

      const trendResults = trendResultsRaw.filter(Boolean) as Array<{
        pair: string;
        trend: string;
        strength: number;
        regime: string;
        alignment: string;
        score: number;
      }>;

      this.preOpenTrendPairsEvaluated = trendResults.length;
      this.preOpenNews = await newsPromise;
      this.preOpenStatus = this.preOpenNews.status === 'LIVE' ? 'READY' : 'UNAVAILABLE';

      liveRuntimeLog(
        this.preOpenNews.status === 'UNAVAILABLE' ? 'WARN' : 'INFO',
        'PREOPEN_NEWS_EVALUATED',
        {
          source: this.preOpenNews.source,
          status: this.preOpenNews.status,
          articleCount: this.preOpenNews.articleCount,
          highImpactCount: this.preOpenNews.highImpactCount,
          elevatedCount: this.preOpenNews.elevatedCount,
          riskLevel: this.preOpenNews.riskLevel,
          providerStatus: this.preOpenNews.providerStatus,
          sentimentSummary: this.preOpenNews.sentimentSummary,
          error: this.preOpenNews.error
        }
      );

      this.lastPreOpenPreparedAt = Date.now();
      this.preOpenStatus = this.preOpenNews.status === 'UNAVAILABLE'
        ? 'UNAVAILABLE'
        : 'READY';
      this.lastCycleResult = this.preOpenNews.status === 'UNAVAILABLE'
        ? `Pre-open trend preparation completed for ${trendResults.length} pairs, but live news is unavailable. No trade is placed until the normal execution gates pass.`
        : `Pre-open preparation completed: ${trendResults.length} live Forex pairs evaluated and live news checked. Waiting for a supported market to open.`;

      liveRuntimeLog('INFO', 'PREOPEN_PREPARATION_COMPLETED', {
        marketGate,
        trendPairsEvaluated: trendResults.length,
        newsStatus: this.preOpenNews.status,
        newsRiskLevel: this.preOpenNews.riskLevel,
        preparedAt: this.lastPreOpenPreparedAt
      });
    } catch (error: any) {
      this.preOpenStatus = 'UNAVAILABLE';
      this.lastCycleResult = error?.message || String(error);
      liveRuntimeLog('ERROR', 'AUTO_TRADING_PRE_OPEN_ERROR', { error: this.lastCycleResult });
    } finally {
      this.cycleInFlight = false;
    }
  }

  private async runCycle(): Promise<void> {
    if (this.state !== 'RUNNING' || this.cycleInFlight) return;
    this.cycleInFlight = true;
    const cycleStartedAt = Date.now();
    const cycleId = `autolive-${cycleStartedAt}-${Math.random().toString(36).slice(2, 8)}`;
    const cycleWatchdog = setTimeout(() => {
      liveRuntimeLog('ERROR', 'AUTO_LIVE_CYCLE_STILL_IN_PROGRESS', {
        cycleId, elapsedMs: Date.now() - cycleStartedAt, state: this.state,
        currentExecution: this.currentExecution,
        message: 'Diagnostic watchdog threshold exceeded; no broker operation is cancelled.'
      });
    }, Math.max(90_000, AUTO_INTERVAL_MS * 2));
    cycleWatchdog.unref?.();

    this.lastCycleAt = Date.now();
    this.lastActions = [];
    this.setExecutionStatus({
      stage: 'SCANNING_MARKET',
      pair: null,
      side: null,
      signalId: null,
      message: 'Scanning configured Forex pairs for executable signals.'
    });
    liveRuntimeLog('INFO', 'AUTO_TRADING_CYCLE_STARTED', {
      cycleId, timestamp: this.lastCycleAt, pairs: getConfiguredAutoForexPairs(),
      configuredPairCount: getConfiguredAutoForexPairs().length, intervalMs: AUTO_INTERVAL_MS,
      mode: getCTraderApiMode()
    });
    tradeAuditLog('CYCLE_STARTED', { cycleId, timestamp: this.lastCycleAt, pairs: getConfiguredAutoForexPairs() });

    try {
      if (killSwitch.isHalted()) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Emergency kill switch is active.';
        return;
      }

      if (!refreshAutonomousExecutionPermission()) {
        this.state = 'PAUSED_RUNTIME';
        this.lastCycleResult = 'Auto Live paused because runtime permission became unavailable. It will retry automatically on the next cycle; execution remains disabled until permission recovers.';
        liveRuntimeLog('WARN', 'AUTO_TRADING_RUNTIME_PERMISSION_PAUSED', { intervalMs: AUTO_INTERVAL_MS });
        return;
      }

      // Stop the scan before news/market analysis when the authoritative
      // system-wide live-position capacity is already full. The timer remains
      // active so a later cycle can detect a freed slot and resume.
      if (!(await this.checkSystemPositionCapacity())) {
        return;
      }

      const positionCapacity = await this.getAuthoritativePositionCapacity();
      if (positionCapacity.available <= 0) {
        this.pauseForPositionLimit(positionCapacity.current, positionCapacity.max, 'Maximum configured live positions are already open.');
        this.setExecutionStatus({ stage: 'IDLE', pair: null, side: null, signalId: null, message: `Auto Live paused: system position limit reached (${positionCapacity.current}/${positionCapacity.max}).` });
        return;
      }
      this.clearPositionCapacityPause();

      // Live news is an execution input, not just a display metric. The
      // deterministic technical strategy can only enter a new trade when a
      // current authoritative news snapshot is available.
      const newsStartedAt = Date.now();
      liveRuntimeLog('INFO', 'AUTO_LIVE_NEWS_CHECK_STARTED', { cycleId, pairs: getConfiguredAutoForexPairs() });
      const cycleNews = await fetchLiveForexNews({ pairs: getConfiguredAutoForexPairs() });
      liveRuntimeLog(cycleNews.status === 'LIVE' ? 'INFO' : 'WARN', 'AUTO_LIVE_NEWS_CHECK_FINISHED', {
        cycleId, durationMs: Date.now() - newsStartedAt, status: cycleNews.status,
        source: cycleNews.source, articleCount: cycleNews.articleCount,
        highImpactCount: cycleNews.highImpactCount, riskLevel: cycleNews.riskLevel,
        providerStatus: cycleNews.providerStatus, error: cycleNews.error
      });
      this.preOpenNews = cycleNews;
      this.preOpenStatus = cycleNews.status === 'LIVE' ? 'READY' : 'UNAVAILABLE';

      liveRuntimeLog(
        cycleNews.status === 'LIVE' ? 'INFO' : 'WARN',
        'LIVE_NEWS_CYCLE_INPUT',
        {
          source: cycleNews.source,
          status: cycleNews.status,
          articleCount: cycleNews.articleCount,
          highImpactCount: cycleNews.highImpactCount,
          activeHighImpactCount: cycleNews.activeHighImpactCount,
          elevatedCount: cycleNews.elevatedCount,
          riskLevel: cycleNews.riskLevel,
          providerStatus: cycleNews.providerStatus,
          sentimentSummary: cycleNews.sentimentSummary,
          error: cycleNews.error
        }
      );

      if (cycleNews.status !== 'LIVE') {
        this.lastActions = getConfiguredAutoForexPairs().map(pair => ({
          pair,
          result: 'BLOCKED',
          reason: 'Authoritative live news feed is unavailable; autonomous entry is blocked until fresh news is available.'
        }));
        this.lastCycleResult = 'Auto Live cycle blocked: authoritative live news is unavailable. No new trade is submitted.';
        liveRuntimeLog('WARN', 'AUTO_TRADING_BLOCKED_NEWS_UNAVAILABLE', {
          status: cycleNews.status,
          source: cycleNews.source,
          error: cycleNews.error
        });
        return;
      }

      const configuredPairs = getConfiguredAutoForexPairs();
      const blockedNewsPairs = configuredPairs.filter(pair => {
        const pairRisk = cycleNews.pairRisk?.[pair];
        // Backward-compatible fallback for snapshots produced by an older
        // process without pairRisk diagnostics.
        return pairRisk
          ? pairRisk.riskLevel === 'HIGH'
          : cycleNews.riskLevel === 'HIGH';
      });

      if (blockedNewsPairs.length > 0) {
        liveRuntimeLog('WARN', 'AUTO_TRADING_PAIR_NEWS_BLOCKS', {
          blockedPairs: blockedNewsPairs,
          articleCount: cycleNews.articleCount,
          highImpactCount: cycleNews.highImpactCount,
          pairRisk: cycleNews.pairRisk
        });
      }

      const pairsToEvaluate = configuredPairs.filter(pair => !blockedNewsPairs.includes(pair));
      liveRuntimeLog('INFO', 'AUTO_TRADING_SCAN_UNIVERSE', {
        configuredPairs,
        configuredPairCount: configuredPairs.length,
        blockedByNews: blockedNewsPairs,
        blockedByNewsCount: blockedNewsPairs.length,
        pairsToEvaluate,
        pairsToEvaluateCount: pairsToEvaluate.length
      });

      const session = getForexSessionState();
      if (session.activeSessions.includes('CLOSED (WEEKEND)')) {
        this.state = 'PREPARING';
        this.lastCycleResult = 'Forex market closed; pre-open preparation resumed.';
        liveRuntimeLog('INFO', 'AUTO_TRADING_MARKET_CLOSED', { session: session.activeSessions });
        return;
      }

      for (const pair of blockedNewsPairs) {
        const pairRisk = cycleNews.pairRisk?.[pair];
        const reason = 'Active pair-relevant high-impact news is inside the configured blackout window for ' + pair + '.';
        this.lastActions.push({
          pair,
          result: 'BLOCKED',
          reason
        });
        liveRuntimeLog('WARN', 'AUTO_TRADING_PAIR_BLOCKED_NEWS', {
          pair,
          signalId: undefined,
          reason,
          pairRisk: pairRisk || null
        });
      }

      // Scan/analyze every eligible configured pair in parallel. Each pair is
      // independently isolated, while the execution portion of evaluatePair
      // is serialized by withExecutionLock(). This removes the old sequential
      // scan bottleneck without weakening account-level safety gates.
      liveRuntimeLog('INFO', 'AUTO_LIVE_PAIR_EVALUATION_BATCH_STARTED', { cycleId, pairsToEvaluate });
      const pairBatchStartedAt = Date.now();
      await Promise.all(pairsToEvaluate.map(async pair => {
        const startedAt = Date.now();
        liveRuntimeLog('INFO', 'AUTO_LIVE_PAIR_EVALUATION_STARTED', { cycleId, pair });
        try {
          await this.evaluatePair(pair);
          liveRuntimeLog('INFO', 'AUTO_LIVE_PAIR_EVALUATION_FINISHED', { cycleId, pair, durationMs: Date.now() - startedAt });
        } catch (error: any) {
          liveRuntimeLog('ERROR', 'AUTO_LIVE_PAIR_EVALUATION_UNHANDLED_ERROR', { cycleId, pair, durationMs: Date.now() - startedAt, error: error?.message || String(error) });
          throw error;
        }
      }));
      liveRuntimeLog('INFO', 'AUTO_LIVE_PAIR_EVALUATION_BATCH_FINISHED', { cycleId, durationMs: Date.now() - pairBatchStartedAt, actions: this.lastActions });

      const executed = this.lastActions.find(action => action.result === 'EXECUTED');
      if (!executed) {
        const reasons = this.lastActions
          .filter(action => action.reason)
          .map(action => `${action.pair}: ${action.reason}`)
          .slice(-8);
        const message = reasons.length
          ? `No trade executed this cycle. ${reasons.join(' | ')}`
          : 'No trade executed this cycle; see TradeLog for pair-level decisions.';
        this.finishExecution('REJECTED', message, {
          pair: null,
          side: null,
          signalId: null
        });
      }
      this.lastCycleResult = executed
        ? `Cycle completed. Executed ${executed.pair}.`
        : 'Cycle completed. No trade executed.';
      liveRuntimeLog('INFO', 'AUTO_TRADING_CYCLE_COMPLETED', {
        cycleId, durationMs: Date.now() - cycleStartedAt, actionCount: this.lastActions.length,
        actions: this.lastActions, result: this.lastCycleResult, finalExecution: this.currentExecution
      });
      tradeAuditLog('CYCLE_COMPLETED', { cycleId, durationMs: Date.now() - cycleStartedAt, actions: this.lastActions, result: this.lastCycleResult });
    } catch (error: any) {
      this.lastCycleResult = error?.message || String(error);
      liveRuntimeLog('ERROR', 'AUTO_TRADING_CYCLE_ERROR', { cycleId, durationMs: Date.now() - cycleStartedAt, error: this.lastCycleResult, currentExecution: this.currentExecution });
    } finally {
      clearTimeout(cycleWatchdog);
      liveRuntimeLog('INFO', 'AUTO_LIVE_CYCLE_FINALLY', { cycleId, durationMs: Date.now() - cycleStartedAt, state: this.state });
      this.cycleInFlight = false;
    }
  }

  private async evaluatePair(pair: string): Promise<void> {
    const pairStartedAt = Date.now();
    liveRuntimeLog('INFO', 'AUTO_LIVE_PAIR_STARTED', { pair, mode: getCTraderApiMode() });
    try {
      this.setExecutionStatus({
        stage: 'SCANNING_MARKET',
        pair,
        side: null,
        signalId: null,
        message: 'Scanning live market data for ' + pair + '.'
      });
      await this.provider.refreshPair(pair);
      liveRuntimeLog('INFO', 'LIVE_DATA_REFRESHED', { pair });
      const signalStartedAt = Date.now();
      liveRuntimeLog('INFO', 'AUTO_LIVE_SIGNAL_GENERATION_STARTED', { pair });
      const signal = await this.signalEngine.generateSignal(pair);
      liveRuntimeLog('INFO', 'AUTO_LIVE_SIGNAL_GENERATION_FINISHED', {
        pair, durationMs: Date.now() - signalStartedAt, signalId: signal.id,
        direction: signal.direction, score: signal.score, status: signal.status,
        hasTradePlan: Boolean(signal.tradePlan), strategyId: signal.strategyVersion
      });
      const isDirectionalSignal = signal.direction.includes('BUY') || signal.direction.includes('SELL');
      const signalSide: 'BUY' | 'SELL' | null = signal.direction.includes('BUY')
        ? 'BUY'
        : signal.direction.includes('SELL')
          ? 'SELL'
          : null;

      this.setExecutionStatus({
        stage: 'ANALYZING_SIGNAL',
        pair,
        side: signalSide,
        signalId: signal.id,
        message: 'Analyzing ' + pair + ' signal and execution conditions.'
      });
      liveRuntimeLog('INFO', 'SIGNAL_EVALUATED', {
        pair,
        signalId: signal.id,
        direction: signal.direction,
        score: signal.score,
        status: signal.status,
        hasTradePlan: Boolean(signal.tradePlan),
        strategyId: signal.strategyVersion
      });

      // The signal engine has multiple directional categories (BUY, STRONG_BUY,
      // WATCH_BUY and their SELL equivalents). The scanner already normalizes
      // these to BUY/SELL for the UI. Auto Live must use the same directional
      // classification, otherwise valid WATCH/STRONG setups are incorrectly
      // rejected before the configurable minimum-score gate is reached.
      if (!isDirectionalSignal || !signal.tradePlan) {
        const reason = !isDirectionalSignal
          ? `Signal engine returned non-directional setup: ${signal.direction}.`
          : 'Signal engine produced a directional signal without a valid trade plan.';
        this.lastActions.push({ pair, result: 'NO_TRADE', signalId: signal.id, reason });
        liveRuntimeLog('INFO', 'NO_TRADE', { pair, signalId: signal.id, reason });
                tradeAuditLog('NO_TRADE', { pair, signalId: signal.id, direction: signal.direction, score: signal.score, reason });
return;
      }

      return this.withExecutionLock(async () => {
      const config = getSystemConfig();
      const systemPositionCapacity = await this.getAuthoritativePositionCapacity();
      if (systemPositionCapacity.available <= 0) {
        this.pauseForPositionLimit(systemPositionCapacity.current, systemPositionCapacity.max, 'Maximum configured live positions were reached during this cycle.');
        this.setExecutionStatus({ stage: 'IDLE', pair, side: signalSide, signalId: signal.id, message: `Auto Live paused: system position limit reached (${systemPositionCapacity.current}/${systemPositionCapacity.max}).` });
        return;
      }

      // Another pair may have filled the final system-wide slot while this
      // signal was waiting in the serialized execution queue. Do not make
      // another broker position request or run the remaining execution work
      // once the service has already entered PAUSED_LIMIT.
      if (this.state === 'PAUSED_LIMIT') {
        const reason = 'Auto Live execution paused because the maximum system-wide live-position limit has been reached. Waiting for a slot to become available.';
        this.lastActions.push({ pair, result: 'PAUSED', signalId: signal.id, reason });
        liveRuntimeLog('INFO', 'AUTO_TRADING_POSITION_LIMIT_QUEUE_PAUSED', {
          pair,
          signalId: signal.id,
          maxOpenPositions: Number(config.maxOpenPositions)
        });
        return;
      }

      const minSignalScore = Math.max(0, Math.min(100, Math.round(Number(config.autoLiveMinSignalScore))));
      if (signal.score < minSignalScore) {
        const reason = `Signal score ${signal.score} is below the configured Auto Live threshold of ${minSignalScore}.`;
        this.lastActions.push({ pair, result: 'FILTERED', signalId: signal.id, reason });
        liveRuntimeLog('INFO', 'SIGNAL_FILTERED', { pair, signalId: signal.id, score: signal.score, threshold: minSignalScore });
                tradeAuditLog('SIGNAL_FILTERED', { pair, signalId: signal.id, score: signal.score, reason });
return;
      }

      const adapter = brokerRegistry.getAdapter('CTRADER', getCTraderApiMode());

      // Re-check the authoritative account position count inside the serialized
      // execution lock. Another pair may have filled the final available slot
      // earlier in this same cycle.
      const positionsBeforeExecution = await adapter.getPositions();
      const maxOpenPositions = Math.max(
        1,
        Math.min(100, Math.floor(Number(config.maxOpenPositions)))
      );
      if (positionsBeforeExecution.length >= maxOpenPositions) {
        this.state = 'PAUSED_LIMIT';
        const reason =
          `Auto Live paused: maximum system-wide live positions reached (${positionsBeforeExecution.length}/${maxOpenPositions}). Waiting for a position slot to become available.`;
        this.lastActions.push({ pair, result: 'PAUSED', signalId: signal.id, reason });
        liveRuntimeLog('INFO', 'AUTO_TRADING_POSITION_LIMIT_PAUSED', {
          pair,
          signalId: signal.id,
          activePositionsCount: positionsBeforeExecution.length,
          maxOpenPositions
        });
        tradeAuditLog('AUTO_TRADING_POSITION_LIMIT_PAUSED', {
          pair,
          signalId: signal.id,
          activePositionsCount: positionsBeforeExecution.length,
          maxOpenPositions
        });
        return;
      }

      let quote = await adapter.getQuote(pair);
      if (quote.status !== 'FRESH' || Date.now() - quote.timestamp >= LIVE_QUOTE_MAX_AGE_MS) {
        const reason = 'Fresh broker quote unavailable at dispatch boundary.';
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
                tradeAuditLog('QUOTE_BLOCKED', { pair, signalId: signal.id, score: signal.score, reason });
return;
      }

      const plan = signal.tradePlan;
      if (!signalSide) {
        const reason = `Directional side could not be resolved from signal direction ${signal.direction}.`;
        this.lastActions.push({ pair, result: 'NO_TRADE', signalId: signal.id, reason });
        tradeAuditLog('NO_TRADE', { pair, signalId: signal.id, direction: signal.direction, score: signal.score, reason });
        return;
      }
      let entryPrice = signalSide === 'BUY' ? quote.ask : quote.bid;

      // Auto Live submits a MARKET order using the authoritative broker quote
      // available at the dispatch boundary. The signal entry zone is an
      // analytical/preferred-entry reference, not a second execution gate.
      // Trigger Now already follows this market-order path, and Auto Live must
      // use the same execution semantics; otherwise a valid live signal can be
      // generated and then discarded simply because the quote moved a few
      // points outside the model's original entry zone.
      liveRuntimeLog('INFO', 'MARKET_ENTRY_EXECUTION', {
        pair,
        signalId: signal.id,
        side: signalSide,
        entryPrice,
        entryMin: plan.entryMin,
        entryMax: plan.entryMax,
        entryZoneStatus: entryPrice >= plan.entryMin && entryPrice <= plan.entryMax ? 'INSIDE' : 'OUTSIDE_USING_MARKET_QUOTE'
      });
      tradeAuditLog('MARKET_ENTRY_EXECUTION', {
        pair,
        signalId: signal.id,
        score: signal.score,
        side: signalSide,
        entryPrice,
        entryMin: plan.entryMin,
        entryMax: plan.entryMax
      });

      // Account and instrument metadata are independent broker reads. Fetch
      // them concurrently to reduce time before the final quote refresh.
      const [account, instrument] = await Promise.all([
        adapter.getAccount(),
        adapter.getInstrument(pair)
      ]);

      // Direct-quantity sizing does not require the cTrader account currency
      // to be USD. The configured Forex quantity is sent directly to the broker.
      if (!instrument) {
        const reason = 'Live broker instrument metadata unavailable.';
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
                tradeAuditLog('INSTRUMENT_BLOCKED', { pair, signalId: signal.id, score: signal.score, reason });
return;
      }

      // Score-based parallel-trade ladder:
      //   score >= 65 and <= 70 -> 1 trade
      //   score > 70 and <= 78   -> 2 trades
      //   score > 78              -> 5 trades
      // Scores below 65 do not receive a parallel-trade allowance here.
      // Condition 13B remains authoritative and can still block the order when
      // the system-wide live-position limit has been reached.
      const score = Number(signal.score);
      const maxTradesPerPair =
        score > 78 ? 5 :
        score > 70 ? 2 :
        score >= 65 ? 1 :
        0;
      const scoreParallelTradeTier =
        score > 78 ? '5_TRADES' :
        score > 70 ? '2_TRADES' :
        score >= 65 ? '1_TRADE' :
        'BELOW_65';

      const positions = positionsBeforeExecution;
      const activePairPositionsCount = positions.filter(position =>
        String(position.symbol || '').toUpperCase() === pair.toUpperCase()
      ).length;
      if (maxTradesPerPair <= 0 || activePairPositionsCount >= maxTradesPerPair) {
        const reason = maxTradesPerPair <= 0
          ? `Auto Live score ${score.toFixed(2)} is below the minimum parallel-trade threshold of 65.`
          : `Maximum simultaneous Auto Live trades for ${pair} is ${maxTradesPerPair}; ${activePairPositionsCount} position(s) are already open.`;
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
        liveRuntimeLog('INFO', 'AUTO_TRADING_PAIR_POSITION_LIMIT', {
          pair,
          signalId: signal.id,
          activePairPositionsCount,
          effectiveMaxTradesPerPair: maxTradesPerPair,
          scoreParallelTradeTier,
          score: signal.score
        });
        tradeAuditLog('PAIR_LIMIT_BLOCKED', {
          pair,
          signalId: signal.id,
          score: signal.score,
          effectiveMaxTradesPerPair: maxTradesPerPair,
          scoreParallelTradeTier,
          reason
        });
        return;
      }

      // Operator-configured Forex pip margins are authoritative for every
      // new Auto Live order. Calculate SL/TP from the exact three-decimal
      // execution price that will be placed in the broker packet, rather than
      // from the signal engine's analytical trade-plan levels.
      let executionEntryPrice = normalizePriceToThreeDigits(entryPrice);
      let configuredTargets;
      try {
        configuredTargets = calculateForexPipTargets(
          signalSide,
          executionEntryPrice,
          instrument.pipSize,
          config.forexStopLossPips,
          config.forexTakeProfitPips
        );
      } catch (targetError: any) {
        const reason = targetError?.message || String(targetError);
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
        liveRuntimeLog('WARN', 'AUTO_PIP_TARGETS_BLOCKED', {
          pair,
          signalId: signal.id,
          entryPrice: executionEntryPrice,
          brokerQuotePrice: entryPrice,
          pipSize: instrument.pipSize,
          stopLossPips: config.forexStopLossPips,
          takeProfitPips: config.forexTakeProfitPips,
          error: reason
        });
        tradeAuditLog('AUTO_PIP_TARGETS_BLOCKED', {
          pair,
          signalId: signal.id,
          entryPrice: executionEntryPrice,
          brokerQuotePrice: entryPrice,
          stopLossPips: config.forexStopLossPips,
          takeProfitPips: config.forexTakeProfitPips,
          reason
        });
        return;
      }

      const riskBudget = Math.max(0, Number(account.balance || 0) * (Number(getSystemConfig().defaultRiskPct) / 100));
      const stopDistance = Math.abs(executionEntryPrice - configuredTargets.stopLoss);
      if (!(riskBudget > 0 && stopDistance > 0)) {
        const reason = 'Unable to calculate positive risk budget and stop distance.';
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
                tradeAuditLog('RISK_BLOCKED', { pair, signalId: signal.id, score: signal.score, reason });
return;
      }

      const riskQuantity = riskBudget / stopDistance;
      let sizing;
      try {
        sizing = await sizeForexOrderToMaxTradeValue(
          adapter,
          pair,
          entryPrice,
          instrument,
          riskQuantity
        );
      } catch (sizingError: any) {
        const reason = sizingError?.message || String(sizingError);
        this.lastActions.push({
          pair,
          result: 'BLOCKED',
          signalId: signal.id,
          reason
        });
        liveRuntimeLog('WARN', 'AUTO_ORDER_SIZING_BLOCKED', {
          pair,
          signalId: signal.id,
          requestedQuantity: riskQuantity,
          maxTradeValueUsd: getSystemConfig().maxTradeValueForexUsd,
          error: reason
        });
        return;
      }

      const quantity = sizing.quantity;

      this.setExecutionStatus({
        stage: 'PREPARING_ORDER',
        pair,
        side: signalSide,
        signalId: signal.id,
        message: 'Preparing live order for ' + pair + '.'
      });

      const order: OrderRequest = {
        market: 'FOREX',
        symbol: pair,
        side: signalSide,
        orderType: 'MARKET',
        quantity,
        price: executionEntryPrice,
        stopLoss: configuredTargets.stopLoss,
        takeProfit: configuredTargets.takeProfit,
        strategyId: signal.strategyVersion,
        signalId: signal.id,
        comment: 'Goldcrest autonomous FX strategy'
      };

      const dailyRealizedPnL = typeof adapter.getDailyRealizedPnL === 'function'
        ? await adapter.getDailyRealizedPnL()
        : 0;
      // Refresh the authoritative quote AFTER slow account, instrument,
      // sizing and daily-PnL work. The earlier quote is only a planning input;
      // the safety gate must receive a quote obtained immediately before it.
      const quoteRefreshStartedAt = Date.now();
      try {
        quote = await adapter.getQuote(pair);
      } catch (quoteError: any) {
        const reason = 'Unable to refresh authoritative broker quote immediately before safety gate: ' + (quoteError?.message || String(quoteError));
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
        liveRuntimeLog('WARN', 'AUTO_LIVE_FINAL_QUOTE_REFRESH_FAILED', {
          pair, signalId: signal.id, durationMs: Date.now() - quoteRefreshStartedAt, error: quoteError?.message || String(quoteError)
        });
        tradeAuditLog('QUOTE_BLOCKED', { pair, signalId: signal.id, reason });
        return;
      }
      const finalQuoteAgeMs = Date.now() - Number(quote.timestamp);
      if (quote.status !== 'FRESH' || finalQuoteAgeMs < 0 || finalQuoteAgeMs >= LIVE_QUOTE_MAX_AGE_MS) {
        const reason = `Authoritative broker quote is not fresh enough for dispatch (status=${quote.status}, ageMs=${finalQuoteAgeMs}).`;
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
        liveRuntimeLog('WARN', 'AUTO_LIVE_FINAL_QUOTE_NOT_FRESH', {
          pair, signalId: signal.id, status: quote.status, quoteAgeMs: finalQuoteAgeMs,
          durationMs: Date.now() - quoteRefreshStartedAt
        });
        tradeAuditLog('QUOTE_BLOCKED', { pair, signalId: signal.id, reason, quoteAgeMs: finalQuoteAgeMs });
        return;
      }

      entryPrice = signalSide === 'BUY' ? quote.ask : quote.bid;
      executionEntryPrice = normalizePriceToThreeDigits(entryPrice);
      try {
        configuredTargets = calculateForexPipTargets(
          signalSide,
          executionEntryPrice,
          instrument.pipSize,
          config.forexStopLossPips,
          config.forexTakeProfitPips
        );
      } catch (targetError: any) {
        const reason = 'Unable to recalculate SL/TP from the final broker quote: ' + (targetError?.message || String(targetError));
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
        liveRuntimeLog('WARN', 'AUTO_LIVE_FINAL_TARGETS_BLOCKED', {
          pair, signalId: signal.id, entryPrice: executionEntryPrice, error: targetError?.message || String(targetError)
        });
        return;
      }
      order.price = executionEntryPrice;
      order.stopLoss = configuredTargets.stopLoss;
      order.takeProfit = configuredTargets.takeProfit;
      liveRuntimeLog('INFO', 'AUTO_LIVE_FINAL_QUOTE_READY', {
        pair, signalId: signal.id, side: signalSide, quoteAgeMs: finalQuoteAgeMs,
        quoteRefreshDurationMs: Date.now() - quoteRefreshStartedAt,
        entryPrice: executionEntryPrice, stopLoss: order.stopLoss, takeProfit: order.takeProfit
      });

      const totalExposure = positions
        .filter(position => position.currency === 'USD' && position.market === 'FOREX')
        .reduce((sum, position) => sum + Math.abs(Number(position.quantity || 0)) * Number(position.currentPrice || 0), 0)
        + (quantity * entryPrice);

      liveRuntimeLog('INFO', 'ORDER_CANDIDATE', {
        pair,
        signalId: signal.id,
        side: order.side,
        quantity,
        requestedRiskQuantity: riskQuantity,
        entryPrice: executionEntryPrice,
        brokerQuotePrice: entryPrice,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        stopLossPips: configuredTargets.stopLossPips,
        takeProfitPips: configuredTargets.takeProfitPips,
        pipSize: configuredTargets.pipSize,
        directQuantity: sizing.directQuantity,
        configuredQuantity: sizing.maxTradeValueUsd,
        sizingAdjusted: sizing.adjusted,
        sizingMode: 'DIRECT_QUANTITY_NO_CURRENCY_CONVERSION'
      });

      this.setExecutionStatus({
        stage: 'SAFETY_GATE',
        pair,
        side: order.side,
        signalId: signal.id,
        message: 'Running live safety and readiness gates for ' + pair + '.'
      });

      const result = await autoExecutionEngine.processSignal(
        {
          signalId: signal.id,
          strategyId: signal.strategyVersion,
          market: 'FOREX',
          symbol: pair,
          side: order.side,
          signalTimestamp: signal.timestamp,
          entryPrice,
          currentPrice: entryPrice,
          stopLoss: configuredTargets.stopLoss,
          takeProfit: configuredTargets.takeProfit,
          spread: quote.spread,
          broker: 'CTRADER',
          environment: getCTraderApiMode()
        },
        order,
        {
          signalAgeMs: Date.now() - signal.timestamp,
          currentQuote: {
            symbol: pair,
            bid: quote.bid,
            ask: quote.ask,
            spread: quote.spread,
            timestamp: quote.timestamp,
            source: quote.source,
            environment: getCTraderApiMode(),
            status: quote.status
          } satisfies NormalizedQuote,
          isMarketOpen: true,
          dailyRealizedLoss: Math.max(0, -Number(dailyRealizedPnL || 0)),
          dailyLossLimit: Math.max(Number(account.balance || 0) * (Number(getSystemConfig().maxDailyLossPct) / 100), 1),
          totalAccountExposure: totalExposure,
          maxAllowedExposure: Math.max(Number(account.equity || 0), 1),
          activePositionsCount: positions.length,
          maxOpenPositions: Number(config.maxOpenPositions),
          activePairPositionsCount,
          maxPairPositions: maxTradesPerPair
        },
        () => {
          this.setExecutionStatus({
            stage: 'SUBMITTING_ORDER',
            pair,
            side: order.side,
            signalId: signal.id,
            message: 'Submitting ' + pair + ' ' + order.side + ' to the live broker API.'
          });
        }
      );

      if (result.executed) {
        this.finishExecution('TRADE_EXECUTED', pair + ' ' + order.side + ' trade confirmed by the execution engine.', {
          pair,
          side: order.side,
          signalId: signal.id
        });
      } else {
        this.finishExecution('REJECTED', pair + ' ' + order.side + ' was blocked or rejected before confirmed execution.', {
          pair,
          side: order.side,
          signalId: signal.id
        });
      }

      this.lastActions.push({
        pair,
        result: result.executed ? 'EXECUTED' : 'BLOCKED',
        signalId: signal.id,
        reason: result.reason,
        orderId: result.order?.brokerOrderId || result.order?.id
      });
      liveRuntimeLog(result.executed ? 'TRADE' : 'WARN', result.executed ? 'AUTO_ORDER_EXECUTION_RESULT' : 'AUTO_ORDER_BLOCKED', { pair, signalId: signal.id, result: result.executed ? 'EXECUTED' : 'BLOCKED', code: result.code, reason: result.reason, brokerOrderId: result.order?.brokerOrderId, brokerStatus: result.order?.status });
      });
    } catch (error: any) {
      const reason = error?.message || String(error);
            this.lastActions.push({
        pair,
        result: 'ERROR',
        reason
      });
      liveRuntimeLog('ERROR', 'PAIR_EVALUATION_ERROR', { pair, error: reason });
      tradeAuditLog('PAIR_EVALUATION_ERROR', { pair, reason });
    }
  }
}

export const autoTradingService = new AutoTradingService();
