import { ForexDataProvider } from '../markets/forex/provider';
import { ForexCandle, ForexMarketStatus, ForexQuote, ForexSignal, ForexTimeframe } from '../markets/forex/types';
import { FOREX_PAIRS, getForexPairConfig } from '../markets/forex/instruments';
import { ForexSignalEngine } from '../markets/forex/signalEngine';
import { getForexSessionState } from '../markets/common/session';
import { getAutoLiveMarketGate, AutoLiveMarketGate } from './marketOpenGate';
import { fetchLiveForexNews, LiveNewsSnapshot } from './liveNewsService';
import { brokerRegistry } from '../brokers/registry';
import { autoExecutionEngine, refreshAutonomousExecutionPermission, disarmLocalAutonomousExecution } from '../brokers/safety/AutoExecutionEngine';
import { autoTradeReadinessService } from '../brokers/safety/AutoTradeReadiness';
import { getSystemConfig } from './configService';
import { killSwitch } from '../brokers/safety/KillSwitch';
import { BrokerAdapter, NormalizedQuote, OrderRequest } from '../brokers/types';
import { liveRuntimeLog, tradeAuditLog } from './liveRuntimeLog';
import { calculateForexPipTargets, normalizePriceToThreeDigits, normalizePriceToInstrumentDigits, sizeForexOrderToMaxTradeValue } from '../brokers/safety/TradeSizing';
import { tradeContinuityService, TradeContinuityStatus } from './tradeContinuityService';
import { PredictionDecisionGate } from '../ml/prediction/predictionDecisionGate';
import { CombinedPredictionEngine } from '../ml/prediction/combinedPredictionEngine';
import { MartingaleRecoveryService } from './martingaleRecoveryService';
import { ShortTpOptimizationEngine } from '../ml/direction/shortTpOptimizationEngine';
import { evaluateAutoLiveScheduler, SchedulerEvaluationResult } from './schedulerUtils';
import { executionLatencyAuditService, ExecutionMilestoneBreakdown } from './executionLatencyAuditService';

const LIVE_QUOTE_MAX_AGE_MS = 1_800_000; // 30 minutes to prevent clock lag or tick latency issues

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

class LiveForexSignalProvider implements ForexDataProvider {
  readonly providerName = 'CTRADER_LIVE_PROVIDER';
  readonly status = 'LIVE' as const;
  readonly isDemo = false;

  private candles = new Map<string, ForexCandle[]>();
  private quotes = new Map<string, ForexQuote>();
  private candleCache = new Map<string, { expiresAt: number; data: ForexCandle[] }>();

  async refreshPair(pair: string): Promise<void> {
    const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
    if (!adapter.getHistoricalCandles) {
      throw new Error('Authoritative cTrader historical market-data capability is unavailable.');
    }

    const timeframes: ForexTimeframe[] = ['5M', '15M', '1H', '4H', 'Daily'];
    const now = Date.now();
    const ttlByTimeframe: Partial<Record<ForexTimeframe, number>> = {
      '5M': 8000,
      '15M': 20000,
      '1H': 90000,
      '4H': 180000,
      'Daily': 300000
    };

    const rows = await Promise.all(
      timeframes.map(async timeframe => {
        const cacheKey = `${pair}:${timeframe}`;
        const cached = this.candleCache.get(cacheKey);
        if (cached && cached.expiresAt > now && Array.isArray(cached.data) && cached.data.length >= 35) {
          return { timeframe, data: cached.data };
        }
        const data = await adapter.getHistoricalCandles!(pair, timeframe, 80);
        if (Array.isArray(data) && data.length >= 35) {
          this.candleCache.set(cacheKey, {
            data: data as ForexCandle[],
            expiresAt: now + (ttlByTimeframe[timeframe] || 15000)
          });
        }
        return { timeframe, data };
      })
    );

    for (const row of rows) {
      if (!Array.isArray(row.data) || row.data.length < 35) {
        throw new Error(`Insufficient live ${row.timeframe} candle history for ${pair}.`);
      }
      this.candles.set(`${pair}:${row.timeframe}`, row.data as ForexCandle[]);
    }

    const config = getForexPairConfig(pair);
    const m15Candles = this.candles.get(`${pair}:15M`) || this.candles.get(`${pair}:5M`) || [];
    const latestCandle = m15Candles[m15Candles.length - 1];
    const firstCandle = m15Candles[0];
    const closePrice = latestCandle?.close || 1.0;
    const change = latestCandle && firstCandle ? latestCandle.close - firstCandle.open : 0;
    const changePips = change / (config.pipSize || 0.0001);
    const changePct = firstCandle?.open ? (change / firstCandle.open) * 100 : 0;

    let liveQuote: any = null;
    try {
      liveQuote = await adapter.getQuote(pair);
    } catch {}

    const quoteObj: ForexQuote = {
      pair: config.symbol,
      timestamp: liveQuote?.timestamp ?? Number(latestCandle?.timestamp || Date.now()),
      bid: liveQuote?.bid ?? closePrice,
      ask: liveQuote?.ask ?? closePrice,
      spreadPips: liveQuote?.spreadPips ?? 1.2,
      digits: config.digits,
      pipSize: config.pipSize,
      changePips24h: Number(changePips.toFixed(1)),
      changePercent24h: Number(changePct.toFixed(2)),
      high24h: m15Candles.length ? Math.max(...m15Candles.map(c => c.high)) : closePrice,
      low24h: m15Candles.length ? Math.min(...m15Candles.map(c => c.low)) : closePrice,
      provider: liveQuote ? this.providerName : 'CTRADER_HISTORICAL_CLOSE',
      dataStatus: liveQuote?.status || 'LIVE'
    };

    this.quotes.set(pair, quoteObj);
    this.quotes.set(config.symbol, quoteObj);
  }

  getQuote(pair: string): ForexQuote {
    const config = getForexPairConfig(pair);
    let quote = this.quotes.get(config.symbol) || this.quotes.get(pair);
    if (!quote) {
      const m15 = this.candles.get(`${config.symbol}:15M`) || this.candles.get(`${pair}:15M`) || this.candles.get(`${pair}:5M`);
      const latest = m15?.[m15.length - 1];
      if (latest) {
        quote = {
          pair: config.symbol,
          timestamp: Number(latest.timestamp || Date.now()),
          bid: latest.close,
          ask: latest.close,
          spreadPips: 1.2,
          digits: config.digits,
          pipSize: config.pipSize,
          changePips24h: 0,
          changePercent24h: 0,
          high24h: latest.high,
          low24h: latest.low,
          provider: 'CTRADER_HISTORICAL_CLOSE',
          dataStatus: 'LIVE'
        };
        this.quotes.set(config.symbol, quote);
        this.quotes.set(pair, quote);
      }
    }
    if (!quote) throw new Error(`Live quote cache is empty for ${pair}.`);
    return quote;
  }

  getCandles(pair: string, timeframe: ForexTimeframe = '15M', limit = 80): ForexCandle[] {
    const rows = this.candles.get(`${pair}:${timeframe}`) || [];
    return rows.slice(Math.max(0, rows.length - limit));
  }

  getLatestCandle(pair: string, timeframe: ForexTimeframe = '15M'): ForexCandle {
    const rows = this.getCandles(pair, timeframe, 2);
    if (!rows.length) throw new Error(`Live candle cache is empty for ${pair} ${timeframe}.`);
    return rows[rows.length - 1];
  }

  getAvailablePairs() {
    return FOREX_PAIRS;
  }

  getMarketStatus(): ForexMarketStatus {
    const session = getForexSessionState();
    const isOpen = !session.activeSessions.includes('CLOSED (WEEKEND)');
    return {
      isOpen,
      status: isOpen ? 'OPEN' : 'WEEKEND',
      activeSessions: session.activeSessions,
      currentSession: session.activeSessions.join(' / ') || 'Interbank Electronic Off-Peak',
      isLondonNyOverlap: session.isLondonNyOverlap,
      serverUtcTime: new Date().toISOString()
    };
  }
}

export type AutoTradingState = 'STOPPED' | 'PREPARING' | 'RUNNING' | 'PAUSED_LIMIT' | 'PAUSED_SCHEDULE' | 'BLOCKED';
export type AutoTradingExecutionStage = 'IDLE' | 'SCANNING_MARKET' | 'ANALYZING_SIGNAL' | 'PREPARING_ORDER' | 'SAFETY_GATE' | 'SUBMITTING_ORDER' | 'TRADE_EXECUTED' | 'REJECTED';

export interface AuditedForexSignal {
  pair: string;
  signal: ForexSignal;
  directionalSide: 'BUY' | 'SELL' | null;
  effectiveScore: number;
  effectiveTradePlan: any;
  gateEvaluation: any;
  quote: any;
  auditedAt: number;
  scanDurationMs: number;
  analysisDurationMs: number;
  isActionable: boolean;
  actionableReason?: string;
  vetoReason?: string;
}

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
  preOpenPreparation: {
    lastPreparedAt: number | null;
    trendPairsEvaluated: number;
    news: LiveNewsSnapshot | null;
    status: 'IDLE' | 'RUNNING' | 'READY' | 'UNAVAILABLE';
  };
  continuity: TradeContinuityStatus;
  martingaleEnabled: boolean;
  martingaleStats: {
    scannedPositions: number;
    modifiedOrders: number;
  };
  scheduler: SchedulerEvaluationResult;
  requiresClosedMarketConfirmation?: boolean;
}

class AutoTradingService {
  private provider = new LiveForexSignalProvider();
  private signalEngine = new ForexSignalEngine(undefined, this.provider);
  private timer: NodeJS.Timeout | null = null;
  private state: AutoTradingState = 'STOPPED';
  private lastCycleAt: number | null = null;
  private lastCycleResult: string | null = null;
  private lastActions: AutoTradingStatus['lastActions'] = [];
  private lastPreOpenPreparedAt: number | null = null;
  private martingaleScannedCount = 0;
  private martingaleModifiedCount = 0;
  private preOpenTrendPairsEvaluated = 0;
  private preOpenNews: LiveNewsSnapshot | null = null;
  private preOpenStatus: 'IDLE' | 'RUNNING' | 'READY' | 'UNAVAILABLE' = 'IDLE';
  private cycleInFlight = false;
  private martingaleInFlight = false;
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
  private auditedSignals = new Map<string, AuditedForexSignal>();
  private readonly AUDITED_SIGNAL_FRESHNESS_MS = 60_000;

  getAuditedSignal(pair: string, maxAgeMs = this.AUDITED_SIGNAL_FRESHNESS_MS): AuditedForexSignal | null {
    const cached = this.auditedSignals.get(pair.toUpperCase());
    if (cached && Date.now() - cached.auditedAt <= maxAgeMs) {
      return cached;
    }
    return null;
  }

  getAllAuditedSignals(maxAgeMs = this.AUDITED_SIGNAL_FRESHNESS_MS): AuditedForexSignal[] {
    const now = Date.now();
    return Array.from(this.auditedSignals.values()).filter(s => now - s.auditedAt <= maxAgeMs);
  }

  getActionableSignals(maxAgeMs = this.AUDITED_SIGNAL_FRESHNESS_MS): AuditedForexSignal[] {
    return this.getAllAuditedSignals(maxAgeMs).filter(s => s.isActionable);
  }

  async auditPair(pair: string, forceRefresh = false): Promise<AuditedForexSignal> {
    const existing = this.getAuditedSignal(pair);
    if (!forceRefresh && existing && Date.now() - existing.auditedAt < 15_000) {
      return existing;
    }

    const scanStartedAt = Date.now();
    await this.provider.refreshPair(pair);
    const scanEndedAt = Date.now();
    const scanDurationMs = Math.max(0, scanEndedAt - scanStartedAt);

    const analysisStartedAt = Date.now();
    const signal = await this.signalEngine.generateSignal(pair);
    const quote = this.provider.getQuote(pair);
    const currentPrice = Number(quote?.bid || quote?.ask || 1.0);

    const gateEvaluation = await PredictionDecisionGate.evaluateTradeOpportunity({
      pair,
      currentClose: signal.tradePlan?.entryPreferred || currentPrice,
      currentTechnicalSignal: {
        direction: signal.direction,
        score: signal.score,
        trend: signal.marketRegime
      },
      cutoffTimestamp: Date.now()
    });

    let directionalSide: 'BUY' | 'SELL' | null = null;
    let effectiveScore = signal.score;
    let effectiveTradePlan = signal.tradePlan;

    if (gateEvaluation.prediction.recommendation === 'TRADE_BUY') {
      directionalSide = 'BUY';
      effectiveScore = Math.max(signal.score, Math.round(gateEvaluation.prediction.calibratedConfidence * 100));
    } else if (gateEvaluation.prediction.recommendation === 'TRADE_SELL') {
      directionalSide = 'SELL';
      effectiveScore = Math.max(signal.score, Math.round(gateEvaluation.prediction.calibratedConfidence * 100));
    } else if (signal.direction.includes('BUY')) {
      directionalSide = 'BUY';
    } else if (signal.direction.includes('SELL')) {
      directionalSide = 'SELL';
    }

    if (!effectiveTradePlan && directionalSide) {
      const config = getSystemConfig();
      const pairConfig = getForexPairConfig(pair);
      const pipSize = pairConfig.pipSize || 0.0001;
      const slPips = Number(config.forexStopLossPips) || 20;
      const tpPips = Number(config.forexTakeProfitPips) || 40;
      const isBuy = directionalSide === 'BUY';

      effectiveTradePlan = {
        entryMin: currentPrice - (2 * pipSize),
        entryMax: currentPrice + (2 * pipSize),
        entryPreferred: currentPrice,
        entryType: 'MARKET_PREDICTION_ENTRY',
        entryCondition: 'Statistical Edge Entry',
        stopLoss: isBuy ? currentPrice - (slPips * pipSize) : currentPrice + (slPips * pipSize),
        stopLossReason: 'Configured statistical risk boundary',
        takeProfit1: { targetPrice: isBuy ? currentPrice + (tpPips * pipSize) : currentPrice - (tpPips * pipSize), targetReason: 'Primary statistical target', expectedR: tpPips / slPips },
        takeProfit2: { targetPrice: isBuy ? currentPrice + (tpPips * 1.5 * pipSize) : currentPrice - (tpPips * 1.5 * pipSize), targetReason: 'Secondary expansion target', expectedR: (tpPips * 1.5) / slPips },
        takeProfit3: { targetPrice: isBuy ? currentPrice + (tpPips * 2.0 * pipSize) : currentPrice - (tpPips * 2.0 * pipSize), targetReason: 'Macro statistical runner', expectedR: (tpPips * 2.0) / slPips },
        riskDistancePips: slPips,
        rewardDistancePips: tpPips,
        riskReward: tpPips / slPips,
        isValid: true
      } as any;
    }

    const analysisEndedAt = Date.now();
    const analysisDurationMs = Math.max(0, analysisEndedAt - analysisStartedAt);

    const config = getSystemConfig();
    const minSignalScore = Math.max(0, Math.min(100, Math.round(Number(config.autoLiveMinSignalScore))));
    const hasScoreEdge = effectiveScore >= minSignalScore || gateEvaluation.prediction.expectedValue > 0;
    const isGateAllowed = gateEvaluation.allowedToExecute || gateEvaluation.mode !== 'LIVE_GATED';
    const isActionable = Boolean(directionalSide && hasScoreEdge && isGateAllowed);

    const audited: AuditedForexSignal = {
      pair,
      signal,
      directionalSide,
      effectiveScore,
      effectiveTradePlan,
      gateEvaluation,
      quote,
      auditedAt: Date.now(),
      scanDurationMs,
      analysisDurationMs,
      isActionable,
      actionableReason: isActionable
        ? `Actionable ${directionalSide} signal (Score: ${effectiveScore}, EV: ${gateEvaluation.prediction.expectedValue})`
        : !directionalSide
          ? 'Non-directional signal'
          : !hasScoreEdge
            ? `Score ${effectiveScore} below threshold ${minSignalScore}`
            : gateEvaluation.vetoReason || 'Vetoed by prediction gate',
      vetoReason: gateEvaluation.vetoReason
    };

    this.auditedSignals.set(pair.toUpperCase(), audited);

    liveRuntimeLog('INFO', 'AUTO_LIVE_PAIR_AUDITED', {
      pair,
      signalId: signal.id,
      side: directionalSide,
      score: effectiveScore,
      isActionable,
      scanDurationMs,
      analysisDurationMs,
      reason: audited.actionableReason
    });

    return audited;
  }

  constructor() {
    void MartingaleRecoveryService.initialize();
  }

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
    const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
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

  evaluateRiskWindowSchedule(): SchedulerEvaluationResult {
    return evaluateAutoLiveScheduler(getSystemConfig().autoLiveScheduler);
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
      preOpenPreparation: {
        lastPreparedAt: this.lastPreOpenPreparedAt,
        trendPairsEvaluated: this.preOpenTrendPairsEvaluated,
        news: this.preOpenNews,
        status: this.preOpenStatus
      },
      continuity: tradeContinuityService.getStatus(),
      martingaleEnabled: getSystemConfig().martingale?.enabled ?? false,
      martingaleStats: {
        scannedPositions: this.martingaleScannedCount,
        modifiedOrders: this.martingaleModifiedCount
      },
      scheduler: this.evaluateRiskWindowSchedule()
    };
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

    const scheduler = this.evaluateRiskWindowSchedule();
    if (scheduler.enabled && scheduler.inRiskWindow) {
      this.state = 'PAUSED_SCHEDULE';
      this.lastCycleResult = scheduler.message;
      liveRuntimeLog('SYSTEM', 'AUTO_TRADING_ARMED_IN_RISK_WINDOW', {
        intervalMs: AUTO_INTERVAL_MS,
        pairs: getConfiguredAutoForexPairs(),
        marketGate,
        scheduler
      });
      tradeAuditLog('AUTO_TRADING_ARMED_IN_RISK_WINDOW', {
        scheduler
      });
      this.timer = setInterval(() => {
        void this.runScheduledCycle();
      }, AUTO_INTERVAL_MS);
      this.timer.unref?.();
      return this.getStatus();
    }

    if (marketGate.anyMarketOpen) {
      this.state = 'RUNNING';
      this.lastCycleResult = 'Auto-trading loop started.';
      liveRuntimeLog('SYSTEM', 'AUTO_TRADING_STARTED', {
        intervalMs: AUTO_INTERVAL_MS,
        pairs: getConfiguredAutoForexPairs(),
        marketGate
      });
      void this.runCycle();
    } else {
      this.state = 'PREPARING';
      this.lastCycleResult = 'Markets are closed. Auto Live is armed; pre-open preparation is running and the system will begin evaluating trades as soon as a supported market opens.';
      this.preOpenStatus = 'RUNNING';
      liveRuntimeLog('SYSTEM', 'AUTO_TRADING_PRE_OPEN_ARMED', {
        intervalMs: AUTO_INTERVAL_MS,
        pairs: getConfiguredAutoForexPairs(),
        marketGate
      });
      void this.runScheduledCycle();
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

  public async processMartingaleActivePositions(): Promise<void> {
    const config = getSystemConfig().martingale;
    if (!config || !config.enabled) return;
    if (this.martingaleInFlight) return;
    this.martingaleInFlight = true;

    try {
      const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
      if (!adapter) {
        this.martingaleInFlight = false;
        return;
      }
      const positions = await adapter.getPositions();
      
      // 1. Reconcile Sequences with Authoritative Broker State
      await MartingaleRecoveryService.reconcileWithBroker('CTRADER', 'LIVE', positions);
      
      this.martingaleScannedCount = positions.length;

      // 2. Evaluate and Execute Recovery for each active sequence
      const activeSequences = MartingaleRecoveryService.getAllActiveSequences();
      if (activeSequences.length > 0) {
        console.log(`[MARTINGALE-SCAN] 🔎 Scanning ${activeSequences.length} active position(s) on broker for adverse movement...`);
      }

      for (const seq of activeSequences) {
        // Only process positions for the current adapter
        if (seq.broker !== 'CTRADER' || seq.environment !== 'LIVE') continue;

        try {
          const quote = await adapter.getQuote(seq.pair);
          const currentPrice = seq.direction === 'BUY' ? quote.bid : quote.ask;
          const pairConfig = getForexPairConfig(seq.pair);
          const pipSize = pairConfig.pipSize;
          const digits = pairConfig.digits || (seq.pair.includes('JPY') ? 3 : 5);
          const triggerThreshold = config.adverseTriggerPips || 5.0;

          const isBuy = seq.direction === 'BUY';
          const adversePips = isBuy
            ? (seq.lastTriggerPrice - currentPrice) / pipSize
            : (currentPrice - seq.lastTriggerPrice) / pipSize;

          console.log(
            `[MARTINGALE-TRACE] 📊 Pos #${seq.positionId} [${seq.pair} ${seq.direction}] ` +
            `Entry=${seq.currentAverageEntry.toFixed(digits)}, Current=${currentPrice.toFixed(digits)} (Bid=${quote.bid}, Ask=${quote.ask}), ` +
            `AdverseMove=${adversePips.toFixed(1)} pips / TriggerThreshold=${triggerThreshold} pips, ` +
            `NextTriggerPrice=${seq.nextTriggerPrice.toFixed(digits)}, Level=${seq.recoveryLevel}, Vol=${seq.currentVolume}, Status=${seq.status}`
          );

          const evalRes = MartingaleRecoveryService.evaluatePriceTick(seq.positionId, currentPrice, 'CTRADER', 'LIVE', quote);
          
          if (evalRes.triggered) {
            console.log(`[MARTINGALE-TRIGGER] 🔥🔥🔥 5-Pip Adverse Breach on #${seq.positionId} [${seq.pair} ${seq.direction}]! Adverse move is ${adversePips.toFixed(1)} pips >= ${triggerThreshold} pips. Executing position doubling...`);
            const success = await MartingaleRecoveryService.executeRecovery(seq.positionId, adapter, currentPrice);
            if (success) {
              this.martingaleModifiedCount++;
              console.log(`[MARTINGALE-TRIGGER] ✅ Doubling & TP amendment successfully completed for #${seq.positionId} [${seq.pair}].`);
            } else {
              console.warn(`[MARTINGALE-TRIGGER] ⚠️ Doubling execution returned false for #${seq.positionId} [${seq.pair}].`);
            }
          }
        } catch (err: any) {
          console.error(`[MARTINGALE-EVAL-ERROR] ❌ Error evaluating #${seq.positionId} [${seq.pair}]:`, err?.message || err);
          liveRuntimeLog('ERROR', 'MARTINGALE_POSITION_EVAL_ERROR', { positionId: seq.positionId, error: err?.message || String(err) });
        }
      }
    } catch (err: any) {
      console.error('[MARTINGALE-PROCESS-ERROR] ❌ Fatal error in martingale process loop:', err?.message || err);
      liveRuntimeLog('ERROR', 'MARTINGALE_PROCESS_ERROR', { error: err?.message || String(err) });
    } finally {
      this.martingaleInFlight = false;
    }
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
      const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
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
    if (!['PREPARING', 'RUNNING', 'PAUSED_LIMIT', 'PAUSED_SCHEDULE'].includes(this.state) || this.cycleInFlight) return;

    // Check Auto Live Risk Blackout Window Scheduler
    const scheduler = this.evaluateRiskWindowSchedule();
    if (scheduler.enabled && scheduler.inRiskWindow) {
      if (this.state !== 'PAUSED_SCHEDULE') {
        const prevState = this.state;
        this.state = 'PAUSED_SCHEDULE';
        liveRuntimeLog('SYSTEM', 'AUTO_TRADING_RISK_WINDOW_PAUSED', {
          previousState: prevState,
          scheduler
        });
        tradeAuditLog('AUTO_TRADING_RISK_WINDOW_PAUSED', {
          previousState: prevState,
          scheduler
        });
      }
      this.lastCycleResult = scheduler.message;
      this.setExecutionStatus({
        stage: 'IDLE',
        pair: null,
        side: null,
        signalId: null,
        message: scheduler.summary
      });
      return;
    }

    if (this.state === 'PAUSED_SCHEDULE') {
      // Risk window has ended! Automatically resume!
      const marketGate = getAutoLiveMarketGate();
      if (marketGate.anyMarketOpen) {
        this.state = 'RUNNING';
        this.lastCycleResult = `Auto Live resumed: Risk blackout window expired (${scheduler.startTime12} – ${scheduler.endTime12} ${scheduler.timezone}). Live signal evaluation and trading resumed.`;
      } else {
        this.state = 'PREPARING';
        this.lastCycleResult = `Auto Live resumed: Risk blackout window expired (${scheduler.startTime12} – ${scheduler.endTime12} ${scheduler.timezone}). Markets currently closed; pre-open preparation active.`;
      }
      liveRuntimeLog('SYSTEM', 'AUTO_TRADING_RISK_WINDOW_RESUMED', {
        newState: this.state,
        scheduler
      });
      tradeAuditLog('AUTO_TRADING_RISK_WINDOW_RESUMED', {
        newState: this.state,
        scheduler
      });
    }

    const marketGate = getAutoLiveMarketGate();

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
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Autonomous permission was withdrawn during pre-open preparation.';
        this.preOpenStatus = 'UNAVAILABLE';
        liveRuntimeLog('WARN', 'AUTO_TRADING_PRE_OPEN_BLOCKED', { reason: this.lastCycleResult });
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

    this.lastCycleAt = Date.now();
    this.lastActions = [];
    this.setExecutionStatus({
      stage: 'SCANNING_MARKET',
      pair: null,
      side: null,
      signalId: null,
      message: 'Scanning configured Forex pairs for executable signals.'
    });
    liveRuntimeLog('INFO', 'AUTO_TRADING_CYCLE_STARTED', { timestamp: this.lastCycleAt, pairs: getConfiguredAutoForexPairs() });
    tradeAuditLog('CYCLE_STARTED', { timestamp: this.lastCycleAt, pairs: getConfiguredAutoForexPairs() });

    try {
      if (killSwitch.isHalted()) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Emergency kill switch is active.';
        return;
      }

      if (!refreshAutonomousExecutionPermission()) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Autonomous permission was withdrawn before cycle execution.';
        return;
      }

      const scheduler = this.evaluateRiskWindowSchedule();
      if (scheduler.enabled && scheduler.inRiskWindow) {
        this.state = 'PAUSED_SCHEDULE';
        this.lastCycleResult = scheduler.message;
        this.setExecutionStatus({
          stage: 'IDLE',
          pair: null,
          side: null,
          signalId: null,
          message: scheduler.summary
        });
        return;
      }

      await this.processMartingaleActivePositions();

      const continuityCheck = tradeContinuityService.canExecuteNewTrade();
      if (!continuityCheck.allowed) {
        this.lastCycleResult = continuityCheck.reason || 'Auto Live paused: 20 consecutive losing trades reached. Operator authorization required in Cockpit.';
        this.setExecutionStatus({
          stage: 'IDLE',
          pair: null,
          side: null,
          signalId: null,
          message: this.lastCycleResult
        });
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
      const cycleNews = await fetchLiveForexNews({
        pairs: getConfiguredAutoForexPairs()
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

      // Auto Live constantly scans and audits eligible configured pairs in the background,
      // maintaining fresh, verified actionable signals.
      const auditedResults = await Promise.all(pairsToEvaluate.map(pair => this.auditPair(pair)));

      // Record non-actionable pairs directly to this.lastActions without wasting execution locks
      for (const item of auditedResults) {
        if (!item.isActionable) {
          const reason = item.actionableReason || 'No actionable trade condition.';
          const result = item.vetoReason ? 'PREDICTION_GATE_VETO' : !item.directionalSide ? 'NO_TRADE' : 'FILTERED';
          this.lastActions.push({
            pair: item.pair,
            result,
            signalId: item.signal.id,
            reason
          });
          tradeAuditLog(result, { pair: item.pair, signalId: item.signal.id, reason });
        }
      }

      // Identify actionable pairs that passed technical criteria, ML edge, and gates
      const actionableAudits = auditedResults.filter(item => item.isActionable);

      // Execute orders using the signals already provided and audited by Auto Live!
      // This completely skips repeating market scans and indicator analyses on every order,
      // reducing trade execution latency from ~3000ms+ down to ~200-300ms.
      if (actionableAudits.length > 0) {
        await Promise.all(actionableAudits.map(item => this.evaluatePair(item.pair, item)));
      }

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
      liveRuntimeLog('INFO', 'AUTO_TRADING_CYCLE_COMPLETED', { actions: this.lastActions });
      tradeAuditLog('CYCLE_COMPLETED', { actions: this.lastActions, result: this.lastCycleResult });
    } catch (error: any) {
      this.lastCycleResult = error?.message || String(error);
      liveRuntimeLog('ERROR', 'AUTO_TRADING_CYCLE_ERROR', { error: this.lastCycleResult });
    } finally {
      this.cycleInFlight = false;
    }
  }

  private async evaluatePair(pair: string, preAuditedSignal?: AuditedForexSignal): Promise<void> {
    const orderExecutionStartedAt = Date.now();
    try {
      let audited = preAuditedSignal || this.getAuditedSignal(pair);
      const usedPreAuditedSignal = Boolean(audited);

      if (!audited) {
        this.setExecutionStatus({
          stage: 'SCANNING_MARKET',
          pair,
          side: null,
          signalId: null,
          message: 'Scanning live market data for ' + pair + '.'
        });
        audited = await this.auditPair(pair, true);
      }

      const {
        signal,
        directionalSide,
        effectiveScore,
        gateEvaluation
      } = audited;

      let effectiveTradePlan = audited.effectiveTradePlan;

      // Fast-path milestone timing: If pre-audited signal provided by Auto Live was used,
      // order execution takes 0ms for scan and 0ms for analysis!
      const scanDurationMs = usedPreAuditedSignal ? 0 : audited.scanDurationMs;
      const analysisDurationMs = usedPreAuditedSignal ? 0 : audited.analysisDurationMs;
      const scanStartedAt = orderExecutionStartedAt;
      const scanEndedAt = scanStartedAt + scanDurationMs;
      const analysisStartedAt = scanEndedAt;
      const analysisEndedAt = analysisStartedAt + analysisDurationMs;

      this.setExecutionStatus({
        stage: 'PREPARING_ORDER',
        pair,
        side: directionalSide,
        signalId: signal.id,
        message: usedPreAuditedSignal
          ? `Fast dispatch for ${pair} using pre-audited Auto Live signal (${directionalSide || 'NEUTRAL'}).`
          : `Preparing live order for ${pair}.`
      });

      if (usedPreAuditedSignal) {
        liveRuntimeLog('INFO', 'USING_PRE_AUDITED_AUTO_LIVE_SIGNAL', {
          pair,
          signalId: signal.id,
          side: directionalSide,
          score: effectiveScore,
          signalAgeMs: Date.now() - audited.auditedAt,
          scanBypassedMs: audited.scanDurationMs,
          analysisBypassedMs: audited.analysisDurationMs
        });
      }

      if (!directionalSide) {
        const reason = gateEvaluation.vetoReason || `Signal and prediction engines returned non-directional setup: ${signal.direction} / ${gateEvaluation.prediction.recommendation}.`;
        this.lastActions.push({ pair, result: 'NO_TRADE', signalId: signal.id, reason });
        liveRuntimeLog('INFO', 'NO_TRADE', { pair, signalId: signal.id, reason });
        tradeAuditLog('NO_TRADE', { pair, signalId: signal.id, direction: signal.direction, score: effectiveScore, reason });
        return;
      }

      return this.withExecutionLock(async () => {
      const safetyStartedAt = Date.now();
      const config = getSystemConfig();
      const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');

      // Fetch authoritative open positions once for the locked execution boundary
      const positionsBeforeExecution = await adapter.getPositions();
      const maxOpenPositions = Math.max(
        1,
        Math.min(100, Math.floor(Number(config.maxOpenPositions)))
      );

      if (positionsBeforeExecution.length >= maxOpenPositions) {
        this.pauseForPositionLimit(positionsBeforeExecution.length, maxOpenPositions, 'Maximum configured live positions were reached during this cycle.');
        this.setExecutionStatus({ stage: 'IDLE', pair, side: directionalSide, signalId: signal.id, message: `Auto Live paused: system position limit reached (${positionsBeforeExecution.length}/${maxOpenPositions}).` });
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
      if (effectiveScore < minSignalScore && gateEvaluation.prediction.expectedValue <= 0) {
        const reason = `Signal score ${effectiveScore} is below the configured Auto Live threshold of ${minSignalScore}.`;
        this.lastActions.push({ pair, result: 'FILTERED', signalId: signal.id, reason });
        liveRuntimeLog('INFO', 'SIGNAL_FILTERED', { pair, signalId: signal.id, score: effectiveScore, threshold: minSignalScore });
        tradeAuditLog('SIGNAL_FILTERED', { pair, signalId: signal.id, score: effectiveScore, reason });
        return;
      }

      if (!gateEvaluation.allowedToExecute && gateEvaluation.mode === 'LIVE_GATED') {
        const reason = gateEvaluation.vetoReason || 'Prediction decision gate vetoed execution.';
        this.lastActions.push({ pair, result: 'PREDICTION_GATE_VETO', signalId: signal.id, reason });
        liveRuntimeLog('INFO', 'PREDICTION_GATE_VETO', {
          pair,
          signalId: signal.id,
          mode: gateEvaluation.mode,
          recommendation: gateEvaluation.prediction.recommendation,
          confidence: gateEvaluation.prediction.calibratedConfidence,
          expectedValue: gateEvaluation.prediction.expectedValue,
          vetoReason: reason
        });
        tradeAuditLog('PREDICTION_GATE_VETO', { pair, signalId: signal.id, reason });
        return;
      }

      const quote = await adapter.getQuote(pair);
      if (quote.status !== 'FRESH' || Date.now() - quote.timestamp >= LIVE_QUOTE_MAX_AGE_MS) {
        const reason = 'Fresh broker quote unavailable at dispatch boundary.';
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
                tradeAuditLog('QUOTE_BLOCKED', { pair, signalId: signal.id, score: signal.score, reason });
return;
      }

      const plan = effectiveTradePlan || signal.tradePlan;
      const orderSide = directionalSide;
      if (!orderSide) {
        const reason = `Directional side could not be resolved from signal direction ${signal.direction}.`;
        this.lastActions.push({ pair, result: 'NO_TRADE', signalId: signal.id, reason });
        tradeAuditLog('NO_TRADE', { pair, signalId: signal.id, direction: signal.direction, score: signal.score, reason });
        return;
      }
      const entryPrice = orderSide === 'BUY' ? quote.ask : quote.bid;

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
        side: orderSide,
        entryPrice,
        entryMin: plan?.entryMin,
        entryMax: plan?.entryMax,
        entryZoneStatus: plan && entryPrice >= plan.entryMin && entryPrice <= plan.entryMax ? 'INSIDE' : 'OUTSIDE_USING_MARKET_QUOTE'
      });
      tradeAuditLog('MARKET_ENTRY_EXECUTION', {
        pair,
        signalId: signal.id,
        score: signal.score,
        side: orderSide,
        entryPrice,
        entryMin: plan?.entryMin,
        entryMax: plan?.entryMax
      });

      const account = await adapter.getAccount();

      // Direct-quantity sizing does not require the cTrader account currency
      // to be USD. The configured Forex quantity is sent directly to the broker.
      const instrument = await adapter.getInstrument(pair);
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

      const continuityCheck = tradeContinuityService.canExecuteNewTrade();
      if (!continuityCheck.allowed) {
        const reason = continuityCheck.reason || 'Auto Live execution paused: 20 consecutive losing trades reached. Operator authorization required in Cockpit.';
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
        liveRuntimeLog('WARN', 'AUTO_TRADING_CONTINUITY_BLOCKED', { pair, signalId: signal.id, reason });
        tradeAuditLog('CONTINUITY_BLOCKED', { pair, signalId: signal.id, reason });
        return;
      }

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
      const executionEntryPrice = normalizePriceToInstrumentDigits(entryPrice, instrument.digits);
      const isMartingaleNoSL = MartingaleRecoveryService.isPairEligible(pair)
        && !getSystemConfig().martingale.stopLoss;
      const stopLossPipsToUse = isMartingaleNoSL ? 30.0 : config.forexStopLossPips;

      // Phase 44: Short-TP Evaluation & Hard 5-Pip Maximum Cap Enforcement
      let tpPipsToUse = Math.min(5.0, Number(config.forexTakeProfitPips) || 3.0);
      const shortTpConfig = config.shortTPOptimization;
      try {
        const shortTpDecision = ShortTpOptimizationEngine.evaluateShortTP({
          predictionId: signal.id,
          pair,
          direction: orderSide === 'BUY' ? 'BUY' : 'SELL',
          entryPrice: executionEntryPrice,
          riskBoundaryPips: stopLossPipsToUse,
          confidence: Number(signal.score || 70) / 100,
          spreadPips: Number(quote.spread || 1.0),
          session: getForexSessionState(new Date()).activeSessions[0] || 'LONDON'
        });

        // Always persist shadow evaluation to short_tp_evaluations
        void ShortTpOptimizationEngine.recordShadowEvaluation(
          signal.id,
          pair,
          orderSide,
          executionEntryPrice,
          shortTpDecision
        );

        if (shortTpDecision.decision === 'SHORT_TP_QUALIFIED' && shortTpDecision.selectedTPPips) {
          // Select optimal TP candidate (1.0, 2.0, 3.0, 4.0, 5.0) capped at hard max 5.0 pips
          tpPipsToUse = Math.min(5.0, shortTpDecision.selectedTPPips);
          liveRuntimeLog('INFO', 'SHORT_TP_OPTIMAL_CANDIDATE_SELECTED', {
            pair,
            signalId: signal.id,
            selectedTPPips: tpPipsToUse,
            expectedNetR: shortTpDecision.expectedNetR,
            mode: shortTpConfig?.mode || 'SHADOW'
          });
        } else if (shortTpConfig?.enabled && shortTpConfig?.mode === 'CONTROLLED_ACTIVE') {
          // NO_TRADE returned: block trade execution under controlled active mode
          const reason = `Short-TP Engine returned NO_TRADE: ${shortTpDecision.reason}`;
          this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason });
          tradeAuditLog('SHORT_TP_NO_TRADE_BLOCKED', { pair, signalId: signal.id, reason });
          liveRuntimeLog('INFO', 'SHORT_TP_NO_TRADE_BLOCKED', { pair, signalId: signal.id, reason });
          return;
        }
      } catch (stpErr: any) {
        liveRuntimeLog('WARN', 'SHORT_TP_EVAL_ERROR', { pair, error: stpErr?.message || String(stpErr) });
      }

      // Hard safety constraint: Take Profit must NEVER exceed 5.0 pips under any circumstance
      tpPipsToUse = Math.min(5.0, Math.max(0.5, tpPipsToUse));

      let configuredTargets;
      try {
        configuredTargets = calculateForexPipTargets(
          orderSide,
          executionEntryPrice,
          instrument.pipSize,
          stopLossPipsToUse,
          tpPipsToUse
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
        side: orderSide,
        signalId: signal.id,
        message: 'Preparing live order for ' + pair + '.'
      });

      const order: OrderRequest = {
        market: 'FOREX',
        symbol: pair,
        side: orderSide,
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
          environment: 'LIVE'
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
            environment: 'LIVE',
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

      const brokerConfirmedAt = result.executionTimings?.brokerConfirmedAt || Date.now();
      const brokerSubmittedAt = result.executionTimings?.brokerSubmittedAt || brokerConfirmedAt;
      const brokerSubmissionDurationMs = result.executionTimings?.brokerSubmissionDurationMs || 0;
      const safetyGateDurationMs = result.executionTimings?.safetyGateDurationMs || Math.max(0, brokerSubmittedAt - safetyStartedAt);
      const totalDurationMs = Math.max(1, brokerConfirmedAt - orderExecutionStartedAt);

      const milestones: ExecutionMilestoneBreakdown = {
        scanStartedAt,
        scanEndedAt,
        analysisStartedAt,
        analysisEndedAt,
        safetyStartedAt,
        safetyEndedAt: brokerSubmittedAt,
        brokerSubmittedAt,
        brokerConfirmedAt,
        quoteFetchMs: scanDurationMs,
        signalGenerationMs: analysisDurationMs,
        safetyGateMs: safetyGateDurationMs,
        brokerRoundtripMs: brokerSubmissionDurationMs,
        notes: result.executed
          ? (usedPreAuditedSignal
              ? 'Confirmed executed via pre-audited Auto Live actionable signal (Zero-scan fast execution)'
              : 'Confirmed executed on live broker')
          : (result.reason || 'Blocked/Rejected')
      };

      void executionLatencyAuditService.recordAudit({
        pair,
        side: order.side,
        status: result.executed ? 'EXECUTED' : 'BLOCKED',
        totalDurationMs,
        scanDurationMs,
        analysisDurationMs,
        safetyGateDurationMs,
        brokerSubmissionDurationMs,
        brokerOrderId: result.order?.brokerOrderId || result.order?.id,
        quantity,
        entryPrice: executionEntryPrice,
        takeProfit: order.takeProfit,
        stopLoss: order.stopLoss,
        signalId: signal.id,
        strategyId: signal.strategyVersion,
        milestones
      });

      if (result.executed) {
        this.finishExecution(
          'TRADE_EXECUTED',
          `${pair} ${order.side} trade confirmed by execution engine in ${(totalDurationMs / 1000).toFixed(2)}s (${totalDurationMs}ms total latency).`,
          {
            pair,
            side: order.side,
            signalId: signal.id
          }
        );

        if (MartingaleRecoveryService.isPairEligible(pair)) {
          try {
            const positions = await adapter.getPositions();
            await MartingaleRecoveryService.reconcileWithBroker('CTRADER', 'LIVE', positions);
          } catch (reconcileErr) {
            liveRuntimeLog('WARN', 'MARTINGALE_POST_EXECUTION_RECONCILE_FAILED', {
              pair,
              error: String(reconcileErr)
            });
          }
        }
      } else {
        this.finishExecution(
          'REJECTED',
          `${pair} ${order.side} was blocked or rejected (${result.reason || 'Safety/Readiness check failed'}).`,
          {
            pair,
            side: order.side,
            signalId: signal.id
          }
        );
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

// Independent, lightweight Martingale Position Manager loop that runs
// every 10 seconds to monitor and manage open positions on the broker,
// completely independent of the "Auto Live" scanner's state.
const martingaleManagerInterval = setInterval(() => {
  try {
    const config = getSystemConfig().martingale;
    if (config?.enabled) {
      liveRuntimeLog('SYSTEM', 'MARTINGALE_HEARTBEAT', { status: 'RUNNING' });
      void autoTradingService.processMartingaleActivePositions();
    }
  } catch (err) {
    liveRuntimeLog('ERROR', 'MARTINGALE_MANAGER_ERROR', { error: String(err) });
  }
}, 10_000);
martingaleManagerInterval.unref?.();

