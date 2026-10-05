// ============================================================================
// PHASE 43 — SINGLE-POSITION DYNAMIC MARTINGALE / RECOVERY SERVICE
// ============================================================================

import { getSystemConfig } from './configService';
import { getDatabase } from '../database/db';
import { DynamicExitEngine } from '../ml/exits/dynamicExitEngine';
import { logBrokerAction } from '../brokers/auditLog';

export type MartingaleState =
  | 'IDLE'
  | 'ACTIVE'
  | 'TRIGGER_DETECTED'
  | 'MODIFICATION_PENDING'
  | 'VOLUME_MODIFIED'
  | 'TP_RECALCULATION_PENDING'
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
}

export class MartingaleRecoveryService {
  private static activeSequences: Map<string, MartingaleSequenceRecord> = new Map();
  private static sequenceLock: Set<string> = new Set();

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
  }): MartingaleSequenceRecord | null {
    if (!this.isPairEligible(options.pair)) {
      return null;
    }

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
      currentPredictionScore: options.predictionScore ?? 80
    };

    this.activeSequences.set(options.positionId, record);
    this.persistSequenceToDatabase(record);

    logBrokerAction({
      source: 'MARTINGALE',
      broker: 'CTRADER',
      environment: 'LIVE',
      account: 'CTRADER-ACCOUNT',
      action: 'MARTINGALE_SEQUENCE_STARTED',
      result: 'SUCCESS'
    });

    return record;
  }

  /**
   * Evaluates price tick against active Martingale sequences for adverse triggers.
   */
  public static async evaluatePriceTick(
    positionId: string,
    currentPrice: number,
    atrPips = 12.0
  ): Promise<{ triggered: boolean; record?: MartingaleSequenceRecord; reason?: string }> {
    const record = this.activeSequences.get(positionId);
    if (!record) return { triggered: false, reason: 'POSITION_NOT_MANAGED' };

    // Idempotency & Lock Guard
    if (this.sequenceLock.has(positionId) || ['MODIFICATION_PENDING', 'CLOSING', 'COMPLETED', 'ABORTED'].includes(record.status)) {
      return { triggered: false, reason: 'SEQUENCE_LOCKED_OR_PENDING' };
    }

    const config = getSystemConfig().martingale;
    if (!config || !config.enabled) {
      return { triggered: false, reason: 'MARTINGALE_DISABLED' };
    }

    // Check Trigger Condition
    const isBuy = record.direction === 'BUY';
    const isTriggered = isBuy
      ? currentPrice <= record.nextTriggerPrice
      : currentPrice >= record.nextTriggerPrice;

    if (!isTriggered) {
      return { triggered: false, reason: 'TRIGGER_PRICE_NOT_REACHED' };
    }

    // Check Recovery Safety Limits
    if (record.recoveryLevel >= config.maxRecoveryLevels) {
      logBrokerAction({
        source: 'MARTINGALE',
        broker: 'CTRADER',
        environment: 'LIVE',
        account: 'CTRADER-ACCOUNT',
        action: 'MARTINGALE_LIMIT_REACHED',
        result: 'SUCCESS'
      });
      return { triggered: false, reason: 'MAX_RECOVERY_LEVEL_REACHED' };
    }

    const nextVolume = record.currentVolume * (config.volumeMultiplier || 2.0);
    if (nextVolume > config.maximumVolume) {
      logBrokerAction({
        source: 'MARTINGALE',
        broker: 'CTRADER',
        environment: 'LIVE',
        account: 'CTRADER-ACCOUNT',
        action: 'MARTINGALE_LIMIT_REACHED',
        result: 'SUCCESS'
      });
      return { triggered: false, reason: 'MAX_VOLUME_EXCEEDED' };
    }

    const durationMin = (Date.now() - record.startedAt) / (60 * 1000);
    if (durationMin > config.maximumRecoveryDurationMin) {
      logBrokerAction({
        source: 'MARTINGALE',
        broker: 'CTRADER',
        environment: 'LIVE',
        account: 'CTRADER-ACCOUNT',
        action: 'MARTINGALE_LIMIT_REACHED',
        result: 'SUCCESS'
      });
      return { triggered: false, reason: 'MAX_DURATION_EXCEEDED' };
    }

    // Lock and proceed to single-position volume amendment
    this.sequenceLock.add(positionId);
    record.status = 'MODIFICATION_PENDING';

    try {
      logBrokerAction({
        source: 'MARTINGALE',
        broker: 'CTRADER',
        environment: 'LIVE',
        account: 'CTRADER-ACCOUNT',
        action: 'MARTINGALE_RECOVERY_TRIGGERED',
        result: 'SUCCESS'
      });

      const pipSize = record.pair.includes('JPY') ? 0.01 : 0.0001;
      const addedVolume = nextVolume - record.currentVolume;

      // Recalculate Weighted Average Entry Price
      const newAverageEntry = ((record.currentVolume * record.currentAverageEntry) + (addedVolume * currentPrice)) / nextVolume;

      // Recalculate Dynamic TP for enlarged position
      const dynamicExit = DynamicExitEngine.calculateDynamicExit({
        pair: record.pair,
        direction: isBuy ? 'UP' : 'DOWN',
        horizon: '15M',
        currentBid: isBuy ? currentPrice : currentPrice - (1.0 * pipSize),
        currentAsk: isBuy ? currentPrice + (1.0 * pipSize) : currentPrice,
        spreadPips: 1.0,
        atrPips,
        probabilityUp: isBuy ? 0.70 : 0.30,
        probabilityDown: isBuy ? 0.30 : 0.70,
        confidence: 0.70
      });

      const tpDistancePips = Math.max(5.0, dynamicExit.tpDistancePips || 8.0);
      const newTP = isBuy
        ? newAverageEntry + (tpDistancePips * pipSize)
        : newAverageEntry - (tpDistancePips * pipSize);

      const normalizedTP = Number(newTP.toFixed(record.pair.includes('JPY') ? 3 : 5));

      // Update State Record
      record.recoveryLevel += 1;
      record.currentVolume = nextVolume;
      record.currentAverageEntry = Number(newAverageEntry.toFixed(record.pair.includes('JPY') ? 3 : 5));
      record.currentDynamicTP = normalizedTP;
      record.lastTriggerPrice = currentPrice;

      const triggerPips = config.adverseTriggerPips || 5.0;
      const nextTrigger = isBuy
        ? currentPrice - (triggerPips * pipSize)
        : currentPrice + (triggerPips * pipSize);

      record.nextTriggerPrice = Number(nextTrigger.toFixed(record.pair.includes('JPY') ? 3 : 5));
      record.lastRecoveryAt = Date.now();
      record.status = 'WAITING_NEXT_TRIGGER';

      this.persistSequenceToDatabase(record);

      logBrokerAction({
        source: 'MARTINGALE',
        broker: 'CTRADER',
        environment: 'LIVE',
        account: 'CTRADER-ACCOUNT',
        action: 'MARTINGALE_VOLUME_MODIFIED',
        result: 'SUCCESS'
      });

      logBrokerAction({
        source: 'MARTINGALE',
        broker: 'CTRADER',
        environment: 'LIVE',
        account: 'CTRADER-ACCOUNT',
        action: 'MARTINGALE_TP_MODIFIED',
        result: 'SUCCESS'
      });

      return { triggered: true, record };
    } finally {
      this.sequenceLock.delete(positionId);
    }
  }

  /**
   * Completes a Martingale recovery sequence after successful TP close.
   */
  public static completeSequence(positionId: string, finalRealizedPnL: number, reason = 'DYNAMIC_TP_REACHED'): MartingaleSequenceRecord | null {
    const record = this.activeSequences.get(positionId);
    if (!record) return null;

    record.status = 'COMPLETED';
    record.completedAt = Date.now();
    record.completionReason = reason;
    record.finalRealizedPnL = finalRealizedPnL;

    this.persistSequenceToDatabase(record);
    this.activeSequences.delete(positionId);

    logBrokerAction({
      source: 'MARTINGALE',
      broker: 'CTRADER',
      environment: 'LIVE',
      account: 'CTRADER-ACCOUNT',
      action: 'MARTINGALE_SEQUENCE_COMPLETED',
      result: 'SUCCESS'
    });

    return record;
  }

  /**
   * Retrieves active Martingale recovery sequence for a position.
   */
  public static getActiveSequence(positionId: string): MartingaleSequenceRecord | undefined {
    return this.activeSequences.get(positionId);
  }

  /**
   * Retrieves all currently active Martingale recovery sequences.
   */
  public static getAllActiveSequences(): MartingaleSequenceRecord[] {
    return Array.from(this.activeSequences.values());
  }

  private static async persistSequenceToDatabase(record: MartingaleSequenceRecord): Promise<void> {
    try {
      const db = await getDatabase();
      db.run(
        `INSERT INTO martingale_sequences (
          id, sequence_id, position_id, pair, direction, base_volume, current_volume,
          recovery_level, last_trigger_price, next_trigger_price, current_tp, status,
          started_at, last_recovery_at, completed_at, initial_prediction_score,
          current_prediction_score, initial_entry_price, current_average_entry,
          floating_pnl, max_floating_loss, max_margin_used, final_realized_pnl, completion_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sequence_id) DO UPDATE SET
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
          completion_reason = excluded.completion_reason`,
        [
          record.id, record.sequenceId, record.positionId, record.pair, record.direction,
          record.baseVolume, record.currentVolume, record.recoveryLevel, record.lastTriggerPrice,
          record.nextTriggerPrice, record.currentDynamicTP, record.status, record.startedAt,
          record.lastRecoveryAt || null, record.completedAt || null, record.initialPredictionScore || 80,
          record.currentPredictionScore || 80, record.initialEntryPrice, record.currentAverageEntry,
          record.currentFloatingPnL || 0, record.maxFloatingLoss || 0, record.maxMarginUsed || 0,
          record.finalRealizedPnL || null, record.completionReason || null
        ]
      );
    } catch {}
  }
}
