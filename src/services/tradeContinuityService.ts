import fs from 'node:fs';
import path from 'node:path';
import { liveRuntimeLog, tradeAuditLog } from './liveRuntimeLog';
import { executeQuery } from '../database/db';

export const LOSS_STREAK_PAUSE_THRESHOLD = 20;
export const PROFIT_STREAK_AUTO_CONTINUE_THRESHOLD = 10;

export interface TradeOutcomeRecord {
  id: string;
  symbol: string;
  pnl: number;
  outcome: 'PROFIT' | 'LOSS' | 'BREAKEVEN';
  timestamp: number;
}

export interface TradeContinuityStatus {
  consecutiveLossCount: number;
  consecutiveProfitCount: number;
  lossLimitThreshold: number;
  profitAutoContinuityThreshold: number;
  isContinuityPaused: boolean;
  requiresContinuityAuthorization: boolean;
  isProfitContinuityActive: boolean;
  lastAuthorization: {
    authorizedAt: number;
    authorizedBy: string;
    note?: string;
  } | null;
  lastOutcome: TradeOutcomeRecord | null;
  recentTradeOutcomes: TradeOutcomeRecord[];
  message: string;
}

interface PersistedContinuityState {
  consecutiveLossCount: number;
  consecutiveProfitCount: number;
  isContinuityPaused: boolean;
  requiresContinuityAuthorization: boolean;
  isProfitContinuityActive: boolean;
  lastAuthorization: {
    authorizedAt: number;
    authorizedBy: string;
    note?: string;
  } | null;
  recentTradeOutcomes: TradeOutcomeRecord[];
}

const DATA_DIR = process.env.GOLDCREST_CONFIG_DIR
  ? path.resolve(process.env.GOLDCREST_CONFIG_DIR)
  : path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'trade-continuity-state.json');

class TradeContinuityService {
  private consecutiveLossCount = 0;
  private consecutiveProfitCount = 0;
  private isContinuityPaused = false;
  private requiresContinuityAuthorization = false;
  private isProfitContinuityActive = false;
  private lastAuthorization: PersistedContinuityState['lastAuthorization'] = null;
  private recentTradeOutcomes: TradeOutcomeRecord[] = [];

  constructor() {
    this.loadPersistedState();
  }

  private loadPersistedState(): void {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PersistedContinuityState>;
        this.consecutiveLossCount = Math.max(0, Number(parsed.consecutiveLossCount || 0));
        this.consecutiveProfitCount = Math.max(0, Number(parsed.consecutiveProfitCount || 0));
        this.isContinuityPaused = Boolean(parsed.isContinuityPaused);
        this.requiresContinuityAuthorization = Boolean(parsed.requiresContinuityAuthorization);
        this.isProfitContinuityActive = Boolean(parsed.isProfitContinuityActive);
        this.lastAuthorization = parsed.lastAuthorization || null;
        this.recentTradeOutcomes = Array.isArray(parsed.recentTradeOutcomes) ? parsed.recentTradeOutcomes.slice(-50) : [];
      }
    } catch (err: any) {
      liveRuntimeLog('WARN', 'TRADE_CONTINUITY_LOAD_ERROR', { error: err?.message || String(err) });
    }
  }

  private persistState(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const state: PersistedContinuityState = {
        consecutiveLossCount: this.consecutiveLossCount,
        consecutiveProfitCount: this.consecutiveProfitCount,
        isContinuityPaused: this.isContinuityPaused,
        requiresContinuityAuthorization: this.requiresContinuityAuthorization,
        isProfitContinuityActive: this.isProfitContinuityActive,
        lastAuthorization: this.lastAuthorization,
        recentTradeOutcomes: this.recentTradeOutcomes.slice(-50)
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err: any) {
      liveRuntimeLog('WARN', 'TRADE_CONTINUITY_PERSIST_ERROR', { error: err?.message || String(err) });
    }
  }

  public recordTradeOutcome(record: { id: string; symbol: string; pnl: number; timestamp?: number }): TradeContinuityStatus {
    const pnl = Number(record.pnl);
    let outcome: 'PROFIT' | 'LOSS' | 'BREAKEVEN' = 'BREAKEVEN';

    if (pnl < -0.0001) {
      outcome = 'LOSS';
      this.consecutiveLossCount += 1;
      this.consecutiveProfitCount = 0;
      this.isProfitContinuityActive = false;

      // When consecutive losses reach constant 20, pause executing new trades
      // and require user authorization in the cockpit
      if (this.consecutiveLossCount >= LOSS_STREAK_PAUSE_THRESHOLD) {
        this.isContinuityPaused = true;
        this.requiresContinuityAuthorization = true;

        liveRuntimeLog('WARN', 'TRADE_CONTINUITY_LOSS_CIRCUIT_BREAKER', {
          consecutiveLossCount: this.consecutiveLossCount,
          threshold: LOSS_STREAK_PAUSE_THRESHOLD,
          message: '20 consecutive losing trades reached. Execution paused until user authorizes continuity in cockpit.'
        });
        tradeAuditLog('LOSS_CIRCUIT_BREAKER_TRIGGERED', {
          consecutiveLossCount: this.consecutiveLossCount,
          threshold: LOSS_STREAK_PAUSE_THRESHOLD
        });
      }
    } else if (pnl > 0.0001) {
      outcome = 'PROFIT';
      this.consecutiveProfitCount += 1;
      this.consecutiveLossCount = 0;

      // In the event of continuity of 10 profit trades, automatically continue executing trades
      if (this.consecutiveProfitCount >= PROFIT_STREAK_AUTO_CONTINUE_THRESHOLD) {
        this.isProfitContinuityActive = true;
        // Auto-clear any pause or pending authorization
        if (this.isContinuityPaused || this.requiresContinuityAuthorization) {
          this.isContinuityPaused = false;
          this.requiresContinuityAuthorization = false;
        }

        liveRuntimeLog('INFO', 'TRADE_CONTINUITY_PROFIT_STREAK_AUTO_CONTINUE', {
          consecutiveProfitCount: this.consecutiveProfitCount,
          threshold: PROFIT_STREAK_AUTO_CONTINUE_THRESHOLD,
          message: '10 consecutive profit trades reached. Continuing automatic trade execution.'
        });
        tradeAuditLog('PROFIT_STREAK_AUTO_CONTINUE', {
          consecutiveProfitCount: this.consecutiveProfitCount,
          threshold: PROFIT_STREAK_AUTO_CONTINUE_THRESHOLD
        });
      }
    }

    const tradeRecord: TradeOutcomeRecord = {
      id: record.id || `trade_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      symbol: record.symbol,
      pnl,
      outcome,
      timestamp: record.timestamp || Date.now()
    };

    // Avoid duplicate insertions
    if (!this.recentTradeOutcomes.some(t => t.id === tradeRecord.id)) {
      this.recentTradeOutcomes.push(tradeRecord);
      if (this.recentTradeOutcomes.length > 50) {
        this.recentTradeOutcomes.shift();
      }
    }

    this.persistState();
    return this.getStatus();
  }

  public canExecuteNewTrade(): { allowed: boolean; reason?: string } {
    if (this.isContinuityPaused || this.requiresContinuityAuthorization) {
      return {
        allowed: false,
        reason: `Auto Live paused: ${this.consecutiveLossCount} consecutive losing trades reached (limit: ${LOSS_STREAK_PAUSE_THRESHOLD}). Operator authorization required in Cockpit for continuity.`
      };
    }
    return { allowed: true };
  }

  public authorizeContinuity(operatorId = 'OPERATOR', note?: string): TradeContinuityStatus {
    this.isContinuityPaused = false;
    this.requiresContinuityAuthorization = false;
    this.consecutiveLossCount = 0; // Reset consecutive loss counter on authorization
    this.lastAuthorization = {
      authorizedAt: Date.now(),
      authorizedBy: operatorId,
      note: note || 'Operator authorized continuity in Cockpit after loss threshold'
    };

    liveRuntimeLog('SYSTEM', 'OPERATOR_CONTINUITY_AUTHORIZED', {
      operatorId,
      note: this.lastAuthorization.note,
      timestamp: this.lastAuthorization.authorizedAt
    });
    tradeAuditLog('CONTINUITY_AUTHORIZED_BY_OPERATOR', {
      operatorId,
      note: this.lastAuthorization.note
    });

    this.persistState();
    return this.getStatus();
  }

  public getStatus(): TradeContinuityStatus {
    let message = 'Normal execution mode. Continuous trade monitoring active.';
    if (this.isContinuityPaused || this.requiresContinuityAuthorization) {
      message = `EXECUTION PAUSED: ${this.consecutiveLossCount} consecutive losing trades reached. Operator authorization required in Cockpit.`;
    } else if (this.isProfitContinuityActive) {
      message = `PROFIT CONTINUITY ACTIVE: ${this.consecutiveProfitCount} consecutive profit trades. Executing trades automatically.`;
    } else if (this.consecutiveLossCount > 0) {
      message = `Warning: ${this.consecutiveLossCount}/${LOSS_STREAK_PAUSE_THRESHOLD} consecutive losing trades.`;
    }

    const lastOutcome = this.recentTradeOutcomes.length > 0
      ? this.recentTradeOutcomes[this.recentTradeOutcomes.length - 1]
      : null;

    return {
      consecutiveLossCount: this.consecutiveLossCount,
      consecutiveProfitCount: this.consecutiveProfitCount,
      lossLimitThreshold: LOSS_STREAK_PAUSE_THRESHOLD,
      profitAutoContinuityThreshold: PROFIT_STREAK_AUTO_CONTINUE_THRESHOLD,
      isContinuityPaused: this.isContinuityPaused,
      requiresContinuityAuthorization: this.requiresContinuityAuthorization,
      isProfitContinuityActive: this.isProfitContinuityActive,
      lastAuthorization: this.lastAuthorization,
      lastOutcome,
      recentTradeOutcomes: [...this.recentTradeOutcomes],
      message
    };
  }

  public async syncFromHistoricalTrades(): Promise<TradeContinuityStatus> {
    try {
      // Query all closed trades from SQLite trades table in chronological order (exit_time ASC)
      const rows = await executeQuery<any>(
        'SELECT id, instrument, pnl, exit_time FROM trades WHERE exit_time IS NOT NULL AND pnl IS NOT NULL ORDER BY exit_time ASC'
      );
      if (Array.isArray(rows) && rows.length > 0) {
        this.consecutiveLossCount = 0;
        this.consecutiveProfitCount = 0;
        this.recentTradeOutcomes = [];

        for (const row of rows) {
          const pnl = Number(row.pnl || 0);
          const outcome: 'PROFIT' | 'LOSS' | 'BREAKEVEN' = pnl > 0.0001 ? 'PROFIT' : pnl < -0.0001 ? 'LOSS' : 'BREAKEVEN';

          this.recentTradeOutcomes.push({
            id: String(row.id),
            symbol: String(row.instrument || 'FOREX'),
            pnl,
            outcome,
            timestamp: Number(row.exit_time)
          });

          if (outcome === 'LOSS') {
            this.consecutiveLossCount += 1;
            this.consecutiveProfitCount = 0;
            this.isProfitContinuityActive = false;
          } else if (outcome === 'PROFIT') {
            this.consecutiveProfitCount += 1;
            this.consecutiveLossCount = 0;
            if (this.consecutiveProfitCount >= PROFIT_STREAK_AUTO_CONTINUE_THRESHOLD) {
              this.isProfitContinuityActive = true;
              this.isContinuityPaused = false;
              this.requiresContinuityAuthorization = false;
            }
          }
        }

        if (this.consecutiveLossCount >= LOSS_STREAK_PAUSE_THRESHOLD) {
          this.isContinuityPaused = true;
          this.requiresContinuityAuthorization = true;
        }
      }
    } catch (err: any) {
      liveRuntimeLog('WARN', 'TRADE_CONTINUITY_SYNC_ERROR', { error: err?.message || String(err) });
    }
    return this.getStatus();
  }

  public simulateTradeOutcome(pnl: number, symbol = 'EUR/USD'): TradeContinuityStatus {
    return this.recordTradeOutcome({
      id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      symbol,
      pnl,
      timestamp: Date.now()
    });
  }

  public resetStreaks(): void {
    this.consecutiveLossCount = 0;
    this.consecutiveProfitCount = 0;
    this.isContinuityPaused = false;
    this.requiresContinuityAuthorization = false;
    this.isProfitContinuityActive = false;
    this.lastAuthorization = null;
    this.recentTradeOutcomes = [];
    this.persistState();
  }
}

export const tradeContinuityService = new TradeContinuityService();
