// ============================================================================
// PHASE 43.1 — MARTINGALE RECTIFICATION & PROPER LIVE POSITION RECOVERY
// ============================================================================

import { getSystemConfig } from './configService';
import { executeQuery, executeRun } from '../database/db';
import { DynamicExitEngine } from '../ml/exits/dynamicExitEngine';
import { logBrokerAction } from '../brokers/auditLog';
import { BrokerAdapter, NormalizedPosition, OrderRequest } from '../brokers/types';
import { liveRuntimeLog } from './liveRuntimeLog';

export type MartingaleState =
  | 'IDLE'
  | 'TRIGGER_DETECTED'
  | 'RECOVERY_PENDING'
  | 'RECOVERY_SUBMITTED'
  | 'RECOVERY_CONFIRMED'
  | 'TP_RECALCULATION_PENDING'
  | 'TP_MODIFICATION_PENDING'
  | 'TP_MODIFIED'
  | 'WAITING_NEXT_TRIGGER'
  | 'CLOSING'
  | 'COMPLETED'
  | 'ABORTED';

export interface MartingaleSequenceRecord {
  id: string;
  sequenceId: string;
  positionId: string;
  pair: string;
  direction: 'BUY' | 'SELL';
  baseVolume: number;
  currentVolume: number;
  recoveryLevel: number;
  lastTriggerPrice: number;
  nextTriggerPrice: number;
  initialEntryPrice: number;
  currentAverageEntry: number;
  currentDynamicTP: number;
  currentFloatingPnL: number;
  maxFloatingLoss: number;
  maxMarginUsed: number;
  accumulatedCosts: number;
  status: MartingaleState;
  startedAt: number;
  lastRecoveryAt?: number;
  completedAt?: number;
  completionReason?: string;
  initialPredictionScore?: number;
  currentPredictionScore?: number;
  finalRealizedPnL?: number;
  broker: string;
  environment: string;
  lastBrokerOrderId?: string;
  lastBrokerPositionId?: string;
  lastRecoveryVolume?: number;
  updatedAt?: number;
  lastError?: string;
}

export class MartingaleRecoveryService {
  private static activeSequences: Map<string, MartingaleSequenceRecord> = new Map();
  private static executionLocks: Set<string> = new Set();

  /**
   * Initializes the service by loading active sequences from the database.
   */
  public static async initialize(): Promise<void> {
    try {
      const rows = await executeQuery(`SELECT * FROM martingale_sequences WHERE status NOT IN ('COMPLETED', 'ABORTED')`);
      for (const row of rows) {
        const record: MartingaleSequenceRecord = {
          id: row.id,
          sequenceId: row.sequence_id,
          positionId: String(row.position_id),
          pair: row.pair,
          direction: row.direction as 'BUY' | 'SELL',
          baseVolume: Number(row.base_volume),
          currentVolume: Number(row.current_volume),
          recoveryLevel: Number(row.recovery_level),
          lastTriggerPrice: Number(row.last_trigger_price),
          nextTriggerPrice: Number(row.next_trigger_price),
          initialEntryPrice: Number(row.initial_entry_price),
          currentAverageEntry: Number(row.current_average_entry),
          currentDynamicTP: Number(row.current_tp),
          currentFloatingPnL: Number(row.floating_pnl || 0),
          maxFloatingLoss: Number(row.max_floating_loss || 0),
          maxMarginUsed: Number(row.max_margin_used || 0),
          accumulatedCosts: 0.5,
          status: row.status as MartingaleState,
          startedAt: Number(row.started_at),
          lastRecoveryAt: row.last_recovery_at ? Number(row.last_recovery_at) : undefined,
          completedAt: row.completed_at ? Number(row.completed_at) : undefined,
          completionReason: row.completion_reason || undefined,
          initialPredictionScore: row.initial_prediction_score ? Number(row.initial_prediction_score) : undefined,
          currentPredictionScore: row.current_prediction_score ? Number(row.current_prediction_score) : undefined,
          finalRealizedPnL: row.final_realized_pnl ? Number(row.final_realized_pnl) : undefined,
          broker: row.broker || 'CTRADER',
          environment: row.environment || 'LIVE',
          lastBrokerOrderId: row.last_broker_order_id || undefined,
          lastBrokerPositionId: row.last_broker_position_id || undefined,
          lastRecoveryVolume: row.last_recovery_volume ? Number(row.last_recovery_volume) : undefined,
          updatedAt: row.updated_at ? Number(row.updated_at) : undefined
        };
        this.activeSequences.set(this.getLookupKey(record.broker, record.environment, record.positionId), record);
      }
      console.log(`[MARTINGALE] Service initialized. Loaded ${this.activeSequences.size} active sequences.`);
    } catch (err) {
      console.error('[MARTINGALE] Initialization failed:', err);
    }
  }

  public static getLookupKey(broker: string, environment: string, positionId: string): string {
    return `${broker.toUpperCase()}:${environment.toUpperCase()}:${positionId}`;
  }

  /**
   * Reconciles internal sequences with authoritative broker positions.
   */
  public static async reconcileWithBroker(broker: string, environment: string, positions: NormalizedPosition[]): Promise<void> {
    const config = getSystemConfig().martingale;
    if (!config || !config.enabled) {
      return;
    }

    const activePositionIds = new Set(positions.map(p => String(p.id)));
    const currentKeys = Array.from(this.activeSequences.keys());

    // 1. Mark closed sequences
    for (const key of currentKeys) {
      const record = this.activeSequences.get(key);
      if (!record) continue;
      if (record.broker === broker && record.environment === environment && !activePositionIds.has(record.positionId)) {
        this.completeSequence(record.positionId, 0, 'CLOSED_EXTERNAL', broker, environment);
        liveRuntimeLog('INFO', 'MARTINGALE_RECONCILE_CLOSED', { positionId: record.positionId, pair: record.pair });
      }
    }

    // 2. Discover new positions and reconcile existing volume
    for (const pos of positions) {
      if (!this.isPairEligible(pos.symbol)) continue;
      const key = this.getLookupKey(broker, environment, String(pos.id));
      if (this.activeSequences.has(key)) {
        const record = this.activeSequences.get(key)!;
        if (Math.abs(record.currentVolume - pos.quantity) > 0.001) {
          record.currentVolume = pos.quantity;
          record.currentAverageEntry = pos.entryPrice;
          if (pos.takeProfit && pos.takeProfit > 0) {
            record.currentDynamicTP = pos.takeProfit;
          }
          // Infer recovery level if position volume was multiplied during restart or offline
          const ratio = record.baseVolume > 0 ? pos.quantity / record.baseVolume : 1;
          if (ratio > 1.5) {
            const inferredLevel = Math.round(Math.log2(ratio));
            if (inferredLevel > record.recoveryLevel) {
              record.recoveryLevel = inferredLevel;
              const pipSize = record.pair.includes('JPY') ? 0.01 : 0.0001;
              const triggerPips = (config.adverseTriggerPips || 5.0) * (record.recoveryLevel + 1);
              record.nextTriggerPrice = record.direction === 'BUY'
                ? Number((record.initialEntryPrice - (triggerPips * pipSize)).toFixed(record.pair.includes('JPY') ? 3 : 5))
                : Number((record.initialEntryPrice + (triggerPips * pipSize)).toFixed(record.pair.includes('JPY') ? 3 : 5));
            }
          }
          record.updatedAt = Date.now();
          this.persistSequenceToDatabase(record);
        }
        continue;
      }

      // Register new discovery (Auto Live, manual, or pre-existing)
      this.registerInitialPosition({
        positionId: String(pos.id),
        pair: pos.symbol,
        direction: pos.side,
        volume: pos.quantity,
        entryPrice: pos.entryPrice,
        initialTP: pos.takeProfit || 0,
        broker,
        environment
      });
      liveRuntimeLog('INFO', 'MARTINGALE_RECONCILE_DISCOVERED', { positionId: pos.id, pair: pos.symbol });
    }
  }

  /**
   * Evaluates if Martingale recovery is enabled for a given Forex pair.
   */
  public static isPairEligible(pair: string): boolean {
    const config = getSystemConfig().martingale;
    if (!config || !config.enabled) return false;
    if (config.scope === 'ALL') return true;
    if (config.scope === 'SELECTED') {
      return Array.isArray(config.selectedPairs) && config.selectedPairs.includes(pair);
    }
    return false;
  }

  /**
   * Registers an initial position as a Martingale recovery sequence anchor.
   */
  public static registerInitialPosition(options: {
    positionId: string;
    pair: string;
    direction: 'BUY' | 'SELL';
    volume: number;
    entryPrice: number;
    initialTP: number;
    predictionScore?: number;
    broker?: string;
    environment?: string;
  }): MartingaleSequenceRecord | null {
    if (!this.isPairEligible(options.pair)) {
      return null;
    }

    const broker = options.broker || 'CTRADER';
    const environment = options.environment || 'LIVE';
    const key = this.getLookupKey(broker, environment, options.positionId);
    
    if (this.activeSequences.has(key)) return this.activeSequences.get(key)!;

    const config = getSystemConfig().martingale;
    const pipSize = options.pair.includes('JPY') ? 0.01 : 0.0001;
    const triggerPips = config.adverseTriggerPips || 5.0;

    const sequenceId = `mart_${options.pair.replace('/', '')}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const nextTrigger = options.direction === 'BUY'
      ? options.entryPrice - (triggerPips * pipSize)
      : options.entryPrice + (triggerPips * pipSize);

    const record: MartingaleSequenceRecord = {
      id: sequenceId,
      sequenceId,
      positionId: options.positionId,
      pair: options.pair,
      direction: options.direction,
      baseVolume: options.volume,
      currentVolume: options.volume,
      recoveryLevel: 0,
      lastTriggerPrice: options.entryPrice,
      nextTriggerPrice: Number(nextTrigger.toFixed(options.pair.includes('JPY') ? 3 : 5)),
      initialEntryPrice: options.entryPrice,
      currentAverageEntry: options.entryPrice,
      currentDynamicTP: options.initialTP,
      currentFloatingPnL: 0,
      maxFloatingLoss: 0,
      maxMarginUsed: options.volume * 10,
      accumulatedCosts: 0.5,
      status: 'WAITING_NEXT_TRIGGER',
      startedAt: Date.now(),
      initialPredictionScore: options.predictionScore ?? 80,
      currentPredictionScore: options.predictionScore ?? 80,
      broker,
      environment,
      updatedAt: Date.now()
    };

    this.activeSequences.set(key, record);
    this.persistSequenceToDatabase(record);

    logBrokerAction({
      source: 'MARTINGALE',
      broker: record.broker as any,
      environment: record.environment as any,
      account: 'AUTO',
      action: 'MARTINGALE_SEQUENCE_STARTED',
      result: 'SUCCESS'
    });

    return record;
  }

  /**
   * Evaluates price tick against active Martingale sequences for adverse triggers.
   */
  public static evaluatePriceTick(
    positionId: string,
    currentPrice: number,
    broker = 'CTRADER',
    environment = 'LIVE',
    quote?: { bid: number; ask: number }
  ): { triggered: boolean; record?: MartingaleSequenceRecord; reason?: string } {
    const key = this.getLookupKey(broker, environment, positionId);
    const record = this.activeSequences.get(key);
    if (!record) return { triggered: false, reason: 'POSITION_NOT_MANAGED' };

    // Idempotency & Lock Guard: Do not re-evaluate a locked or in-flight recovery
    if (
      this.executionLocks.has(key) ||
      ['RECOVERY_PENDING', 'RECOVERY_SUBMITTED', 'RECOVERY_CONFIRMED', 'TP_RECALCULATION_PENDING', 'TP_MODIFICATION_PENDING', 'CLOSING', 'COMPLETED', 'ABORTED'].includes(record.status)
    ) {
      return { triggered: false, reason: 'SEQUENCE_LOCKED_OR_PENDING' };
    }

    const config = getSystemConfig().martingale;
    if (!config || !config.enabled) {
      return { triggered: false, reason: 'MARTINGALE_DISABLED' };
    }

    // Check Trigger Condition:
    // BUY adverse: executable bid price falls to or below next trigger
    // SELL adverse: executable ask price rises to or above next trigger
    const isBuy = record.direction === 'BUY';
    const evalPrice = quote ? (isBuy ? quote.bid : quote.ask) : currentPrice;
    const isTriggered = isBuy
      ? evalPrice <= record.nextTriggerPrice + 1e-7
      : evalPrice >= record.nextTriggerPrice - 1e-7;

    if (!isTriggered) {
      return { triggered: false, reason: 'TRIGGER_PRICE_NOT_REACHED' };
    }

    // Check Recovery Safety Limits
    if (record.recoveryLevel >= (config.maxRecoveryLevels || 5)) {
      return { triggered: false, reason: 'MAX_RECOVERY_LEVEL_REACHED' };
    }

    const maxUnits = config.maximumVolume >= 500
      ? config.maximumVolume
      : (record.currentVolume > 500 ? config.maximumVolume * 100000 : config.maximumVolume);
    const nextVolume = record.currentVolume * (config.volumeMultiplier || 2.0);
    if (nextVolume > maxUnits) {
      return { triggered: false, reason: 'MAX_VOLUME_EXCEEDED' };
    }

    const durationMin = (Date.now() - record.startedAt) / (60 * 1000);
    if (durationMin > (config.maximumRecoveryDurationMin || 120)) {
      return { triggered: false, reason: 'MAX_DURATION_EXCEEDED' };
    }

    const pipSize = record.pair.includes('JPY') ? 0.01 : 0.0001;
    const adversePips = isBuy
      ? (record.lastTriggerPrice - evalPrice) / pipSize
      : (evalPrice - record.lastTriggerPrice) / pipSize;

    // Explicit audit log requirement
    liveRuntimeLog('INFO', 'MARTINGALE_TRIGGER_DETECTED', {
      timestamp: Date.now(),
      broker: record.broker,
      environment: record.environment,
      positionId: record.positionId,
      pair: record.pair,
      side: record.direction,
      level: record.recoveryLevel,
      currentVolume: record.currentVolume,
      adverseDistancePips: Number(adversePips.toFixed(1)),
      triggerPrice: record.nextTriggerPrice,
      currentBid: quote?.bid ?? currentPrice,
      currentAsk: quote?.ask ?? currentPrice
    });

    return { triggered: true, record };
  }

  /**
   * Dedicated guarded Martingale recovery execution path.
   */
  public static async executeRecovery(
    positionId: string,
    adapter: BrokerAdapter,
    currentPrice: number,
    atrPips = 12.0
  ): Promise<boolean> {
    const key = this.getLookupKey(adapter.broker, adapter.environment, positionId);
    const record = this.activeSequences.get(key);
    if (!record) return false;

    // Concurrency protection: positionId-specific lock
    if (this.executionLocks.has(key)) return false;
    this.executionLocks.add(key);

    try {
      const config = getSystemConfig().martingale;
      if (!config || !config.enabled) {
        liveRuntimeLog('WARN', 'MARTINGALE_RECOVERY_ABORTED', { positionId, reason: 'DISABLED' });
        return false;
      }

      // 1. Account & Margin Safety Limits
      try {
        const margin = await adapter.getMargin();
        const equity = await adapter.getEquity();
        const balance = await adapter.getBalance();

        if (equity > 0 && config.maximumMarginUtilizationPct > 0) {
          const marginUtilPct = (margin.usedMargin / equity) * 100;
          if (marginUtilPct > config.maximumMarginUtilizationPct) {
            liveRuntimeLog('WARN', 'MARTINGALE_RECOVERY_BLOCKED_MARGIN', {
              positionId,
              marginUtilPct,
              limitPct: config.maximumMarginUtilizationPct
            });
            return false;
          }
        }

        if (balance > 0 && config.maximumBasketDrawdownPct > 0) {
          const drawdownPct = ((balance - equity) / balance) * 100;
          if (drawdownPct > config.maximumBasketDrawdownPct) {
            liveRuntimeLog('WARN', 'MARTINGALE_RECOVERY_BLOCKED_DRAWDOWN', {
              positionId,
              drawdownPct,
              limitPct: config.maximumBasketDrawdownPct
            });
            return false;
          }
        }
      } catch (marginCheckErr) {
        // Proceed if margin check not supported by adapter
      }

      // 2. Validate Position still exists on broker
      const existingPositions = await adapter.getPositions();
      const initialPos = existingPositions.find(p => String(p.id) === positionId);
      if (!initialPos) {
        liveRuntimeLog('WARN', 'MARTINGALE_RECOVERY_POSITION_NOT_FOUND', { positionId });
        this.completeSequence(positionId, 0, 'POSITION_CLOSED_PRIOR_TO_RECOVERY', adapter.broker, adapter.environment);
        return false;
      }

      // 3. Stale quote validation (30-second window)
      let quote;
      try {
        quote = await adapter.getQuote(record.pair);
      } catch (qErr: any) {
        liveRuntimeLog('ERROR', 'MARTINGALE_QUOTE_FETCH_FAILED', { positionId, error: qErr?.message || String(qErr) });
        return false;
      }

      const quoteTimestamp = Number(quote?.timestamp || 0);
      const quoteAgeMs = quoteTimestamp > 0 ? Date.now() - quoteTimestamp : 0;
      if (!quote || quote.status !== 'FRESH' || quoteAgeMs > 30_000 || !(quote.bid > 0) || !(quote.ask > 0)) {
        liveRuntimeLog('WARN', 'MARTINGALE_QUOTE_STALE_OR_INVALID', {
          positionId,
          quoteStatus: quote?.status,
          quoteAgeMs
        });
        return false;
      }

      // Executable price for order entry: BUY at Ask, SELL at Bid
      const executionEntryPrice = record.direction === 'BUY' ? quote.ask : quote.bid;

      // 4. Calculate Recovery Volume Plan
      const pipSize = record.pair.includes('JPY') ? 0.01 : 0.0001;
      const nextVolume = record.currentVolume * (config.volumeMultiplier || 2.0);
      const addedVolume = nextVolume - record.currentVolume;

      if (!Number.isFinite(addedVolume) || addedVolume <= 0) {
        liveRuntimeLog('WARN', 'MARTINGALE_INVALID_RECOVERY_VOLUME', { positionId, addedVolume });
        return false;
      }

      const maxUnits = config.maximumVolume >= 500
        ? config.maximumVolume
        : (record.currentVolume > 500 ? config.maximumVolume * 100000 : config.maximumVolume);
      if (nextVolume > maxUnits) {
        liveRuntimeLog('WARN', 'MARTINGALE_RECOVERY_EXCEEDS_MAX_VOLUME', { positionId, nextVolume, maxUnits });
        return false;
      }

      if (record.recoveryLevel >= (config.maxRecoveryLevels || 5)) {
        liveRuntimeLog('WARN', 'MARTINGALE_RECOVERY_MAX_LEVEL_REACHED', { positionId, level: record.recoveryLevel });
        return false;
      }

      record.status = 'RECOVERY_PENDING';
      record.updatedAt = Date.now();
      this.persistSequenceToDatabase(record);

      // 5. Submit Position-Linked Order to Broker
      const clientReqId = `mart_${record.positionId}_lvl${record.recoveryLevel + 1}_${Date.now()}`;
      const recoveryOrder: OrderRequest = {
        market: 'FOREX',
        symbol: record.pair,
        side: record.direction,
        orderType: 'MARKET',
        quantity: addedVolume,
        price: executionEntryPrice,
        comment: clientReqId,
        positionId: record.positionId
      };

      record.status = 'RECOVERY_SUBMITTED';
      record.updatedAt = Date.now();
      this.persistSequenceToDatabase(record);

      liveRuntimeLog('TRADE', 'MARTINGALE_RECOVERY_SUBMITTED', {
        positionId: record.positionId,
        recoveryLevel: record.recoveryLevel + 1,
        requestedRecoveryVolume: addedVolume,
        requestId: clientReqId
      });

      let orderRes;
      try {
        orderRes = await adapter.placeOrder(recoveryOrder);
      } catch (err: any) {
        liveRuntimeLog('ERROR', 'MARTINGALE_RECOVERY_FAILED', {
          positionId: record.positionId,
          level: record.recoveryLevel + 1,
          requestedVolume: addedVolume,
          brokerErrorCode: err?.code || 'ORDER_ERROR',
          brokerErrorMessage: err?.message || String(err),
          retryEligibility: true
        });
        record.status = 'WAITING_NEXT_TRIGGER';
        record.updatedAt = Date.now();
        this.persistSequenceToDatabase(record);
        return false;
      }

      if (orderRes.status === 'REJECTED') {
        liveRuntimeLog('ERROR', 'MARTINGALE_RECOVERY_FAILED', {
          positionId: record.positionId,
          level: record.recoveryLevel + 1,
          requestedVolume: addedVolume,
          brokerErrorCode: 'ORDER_REJECTED',
          brokerErrorMessage: orderRes.rejectionReason || 'Broker rejected position recovery order.',
          retryEligibility: false
        });
        record.status = 'WAITING_NEXT_TRIGGER';
        record.updatedAt = Date.now();
        this.persistSequenceToDatabase(record);
        return false;
      }

      // 6. Confirm Recovery Execution with Authoritative Broker State
      const postRecoveryPositions = await adapter.getPositions();
      const updatedPos = postRecoveryPositions.find(p => String(p.id) === positionId);
      if (!updatedPos) {
        liveRuntimeLog('ERROR', 'MARTINGALE_POSITION_LOST_AFTER_RECOVERY', { positionId });
        record.status = 'ABORTED';
        record.updatedAt = Date.now();
        this.persistSequenceToDatabase(record);
        return false;
      }

      const confirmedEntry = updatedPos.entryPrice;
      const confirmedVolume = updatedPos.quantity;
      const previousVolume = record.currentVolume;

      record.status = 'RECOVERY_CONFIRMED';
      liveRuntimeLog('TRADE', 'MARTINGALE_RECOVERY_CONFIRMED', {
        positionId: record.positionId,
        previousVolume,
        addedVolume,
        resultingBrokerVolume: confirmedVolume,
        resultingWeightedAverageEntry: confirmedEntry,
        brokerOrderId: orderRes.brokerOrderId || orderRes.id,
        brokerPositionId: record.positionId
      });

      // 7. Calculate Dynamic TP from Resulting Authoritative Position
      record.status = 'TP_RECALCULATION_PENDING';
      const isBuy = record.direction === 'BUY';
      const dynamicExit = DynamicExitEngine.calculateDynamicExit({
        pair: record.pair,
        direction: isBuy ? 'UP' : 'DOWN',
        horizon: '15M',
        currentBid: quote.bid,
        currentAsk: quote.ask,
        spreadPips: Number(quote.spread || 1.0),
        atrPips,
        probabilityUp: isBuy ? 0.70 : 0.30,
        probabilityDown: isBuy ? 0.30 : 0.70,
        confidence: 0.70
      });

      const shortTpConfig = getSystemConfig().shortTPOptimization;
      let tpDistancePips = Math.max(5.0, dynamicExit.tpDistancePips || 8.0);
      if (shortTpConfig?.enabled) {
        // Phase 44 Hard Maximum: recovery TP distance must not exceed 5.0 pips
        tpDistancePips = Math.min(5.0, Math.max(1.0, tpDistancePips));
      }
      const newTP = isBuy
        ? confirmedEntry + (tpDistancePips * pipSize)
        : confirmedEntry - (tpDistancePips * pipSize);

      const normalizedTP = Number(newTP.toFixed(record.pair.includes('JPY') ? 3 : 5));
      const oldTP = Number(updatedPos.takeProfit || record.currentDynamicTP || 0);

      // 8. Amend Position TP on cTrader
      record.status = 'TP_MODIFICATION_PENDING';
      liveRuntimeLog('INFO', 'MARTINGALE_TP_SUBMITTED', {
        positionId: record.positionId,
        oldTP,
        requestedTP: normalizedTP,
        weightedAverageEntry: confirmedEntry,
        tpDistancePips
      });

      let tpAmended = false;
      try {
        if (typeof adapter.modifyPosition === 'function') {
          tpAmended = await adapter.modifyPosition(positionId, { takeProfit: normalizedTP });
        } else {
          await adapter.modifyOrder(positionId, { takeProfit: normalizedTP });
          tpAmended = true;
        }
      } catch (tpErr: any) {
        tpAmended = false;
        liveRuntimeLog('ERROR', 'MARTINGALE_TP_AMEND_FAILED', { positionId, error: tpErr?.message || String(tpErr) });
      }

      if (!tpAmended) {
        liveRuntimeLog('ERROR', 'MARTINGALE_TP_AMEND_FAILED', {
          positionId: record.positionId,
          requestedTP: normalizedTP,
          reason: 'Broker rejected TP amendment.'
        });
        // Volume was confirmed. Keep position state up to date for retry in next cycle,
        // but DO NOT mark TP as modified and DO NOT falsely update currentDynamicTP!
        record.recoveryLevel += 1;
        record.currentVolume = confirmedVolume;
        record.currentAverageEntry = confirmedEntry;
        record.lastRecoveryAt = Date.now();
        record.lastRecoveryVolume = addedVolume;
        record.lastBrokerOrderId = String(orderRes.brokerOrderId || orderRes.id);
        record.lastBrokerPositionId = record.positionId;
        record.status = 'WAITING_NEXT_TRIGGER';
        record.updatedAt = Date.now();
        this.persistSequenceToDatabase(record);
        return false;
      }

      // 9. Re-query and Confirm Position TP
      let confirmedTP = normalizedTP;
      try {
        const positionsAfterTP = await adapter.getPositions();
        const posWithTP = positionsAfterTP.find(p => String(p.id) === positionId);
        if (posWithTP?.takeProfit) {
          confirmedTP = Number(posWithTP.takeProfit);
        }
      } catch {}

      record.status = 'TP_MODIFIED';
      liveRuntimeLog('INFO', 'MARTINGALE_TP_CONFIRMED', {
        positionId: record.positionId,
        oldTP,
        requestedTP: normalizedTP,
        confirmedTP,
        weightedAverageEntry: confirmedEntry,
        tpDistancePips
      });

      // 10. Update Authoritative Local State & Persist
      record.recoveryLevel += 1;
      record.currentVolume = confirmedVolume;
      record.currentAverageEntry = confirmedEntry;
      record.currentDynamicTP = confirmedTP;
      record.lastTriggerPrice = currentPrice;
      record.lastRecoveryAt = Date.now();
      record.lastRecoveryVolume = addedVolume;
      record.lastBrokerOrderId = String(orderRes.brokerOrderId || orderRes.id);
      record.lastBrokerPositionId = record.positionId;

      const nextTriggerPips = config.adverseTriggerPips || 5.0;
      const nextTrigger = isBuy
        ? currentPrice - (nextTriggerPips * pipSize)
        : currentPrice + (nextTriggerPips * pipSize);
      record.nextTriggerPrice = Number(nextTrigger.toFixed(record.pair.includes('JPY') ? 3 : 5));

      record.status = 'WAITING_NEXT_TRIGGER';
      record.updatedAt = Date.now();
      this.persistSequenceToDatabase(record);

      return true;
    } catch (err: any) {
      liveRuntimeLog('ERROR', 'MARTINGALE_RECOVERY_FATAL_ERROR', { positionId, error: err?.message || String(err) });
      return false;
    } finally {
      this.executionLocks.delete(key);
    }
  }

  /**
   * Completes a Martingale recovery sequence after successful TP close.
   */
  public static completeSequence(positionId: string, finalRealizedPnL: number, reason = 'DYNAMIC_TP_REACHED', broker = 'CTRADER', environment = 'LIVE'): MartingaleSequenceRecord | null {
    const key = this.getLookupKey(broker, environment, positionId);
    const record = this.activeSequences.get(key);
    if (!record) return null;

    record.status = 'COMPLETED';
    record.completedAt = Date.now();
    record.completionReason = reason;
    record.finalRealizedPnL = finalRealizedPnL;
    record.updatedAt = Date.now();

    this.persistSequenceToDatabase(record);
    this.activeSequences.delete(key);

    logBrokerAction({
      source: 'MARTINGALE',
      broker: record.broker as any,
      environment: record.environment as any,
      account: 'AUTO',
      action: 'MARTINGALE_SEQUENCE_COMPLETED',
      result: 'SUCCESS'
    });

    return record;
  }

  /**
   * Retrieves active Martingale recovery sequence for a position.
   */
  public static getActiveSequence(positionId: string, broker = 'CTRADER', environment = 'LIVE'): MartingaleSequenceRecord | undefined {
    return this.activeSequences.get(this.getLookupKey(broker, environment, positionId));
  }

  /**
   * Retrieves all currently active Martingale recovery sequences.
   */
  public static getAllActiveSequences(): MartingaleSequenceRecord[] {
    return Array.from(this.activeSequences.values());
  }

  private static async persistSequenceToDatabase(record: MartingaleSequenceRecord): Promise<void> {
    try {
      await executeRun(
        `INSERT INTO martingale_sequences (
          id, sequence_id, position_id, pair, direction, base_volume, current_volume,
          recovery_level, last_trigger_price, next_trigger_price, current_tp, status,
          started_at, last_recovery_at, completed_at, initial_prediction_score,
          current_prediction_score, initial_entry_price, current_average_entry,
          floating_pnl, max_floating_loss, max_margin_used, final_realized_pnl, completion_reason,
          broker, environment, last_broker_order_id, last_broker_position_id, last_recovery_volume, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          current_volume = excluded.current_volume,
          recovery_level = excluded.recovery_level,
          last_trigger_price = excluded.last_trigger_price,
          next_trigger_price = excluded.next_trigger_price,
          current_tp = excluded.current_tp,
          status = excluded.status,
          last_recovery_at = excluded.last_recovery_at,
          completed_at = excluded.completed_at,
          current_average_entry = excluded.current_average_entry,
          floating_pnl = excluded.floating_pnl,
          max_floating_loss = excluded.max_floating_loss,
          final_realized_pnl = excluded.final_realized_pnl,
          completion_reason = excluded.completion_reason,
          last_broker_order_id = excluded.last_broker_order_id,
          last_broker_position_id = excluded.last_broker_position_id,
          last_recovery_volume = excluded.last_recovery_volume,
          updated_at = excluded.updated_at`,
        [
          record.id, record.sequenceId, record.positionId, record.pair, record.direction,
          record.baseVolume, record.currentVolume, record.recoveryLevel, record.lastTriggerPrice,
          record.nextTriggerPrice, record.currentDynamicTP, record.status, record.startedAt,
          record.lastRecoveryAt || null, record.completedAt || null, record.initialPredictionScore || 80,
          record.currentPredictionScore || 80, record.initialEntryPrice, record.currentAverageEntry,
          record.currentFloatingPnL || 0, record.maxFloatingLoss || 0, record.maxMarginUsed || 0,
          record.finalRealizedPnL || null, record.completionReason || null,
          record.broker, record.environment,
          record.lastBrokerOrderId || null, record.lastBrokerPositionId || null,
          record.lastRecoveryVolume || null, record.updatedAt || Date.now()
        ]
      );
    } catch (err: any) {
      console.error('[MARTINGALE] Database persistence failed:', err?.message || err);
    }
  }
}
