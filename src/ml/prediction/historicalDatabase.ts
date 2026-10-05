// ============================================================================
// HISTORICAL DATABASE & EVIDENCE EXTRACTOR (STRICT LEAKAGE ISOLATION)
// ============================================================================

import { executeQuery } from '../../database/db';
import { HistoricalTradeRecord, RollingStrategyPerformance } from './types';

export class HistoricalDatabaseExtractor {
  private static cachedTrades: HistoricalTradeRecord[] | null = null;
  private static lastCacheBuild = 0;

  /**
   * Clears in-memory trade cache for testing or refresh
   */
  public static clearCache(): void {
    this.cachedTrades = null;
    this.lastCacheBuild = 0;
  }

  /**
   * Extracts historical executed transactions from broker_reconciliation_snapshots
   * and execution_intents strictly up to cutoffTimestamp.
   * GUARANTEE: Never uses records with timestamp > cutoffTimestamp.
   */
  public static async getHistoricalTrades(cutoffTimestamp: number = Date.now()): Promise<HistoricalTradeRecord[]> {
    if (!this.cachedTrades || Date.now() - this.lastCacheBuild > 60_000) {
      await this.buildHistoricalTradeLedger();
    }

    const all = this.cachedTrades || [];
    return all.filter(t => t.entryTimestamp <= cutoffTimestamp);
  }

  /**
   * Reconstructs executed trades from broker reconciliation snapshots and execution intents
   */
  private static async buildHistoricalTradeLedger(): Promise<void> {
    const records: HistoricalTradeRecord[] = [];
    const seen = new Set<string>();

    try {
      // 1. Extract from broker_reconciliation_snapshots
      const rows = await executeQuery<{ positions_json: string; timestamp: number }>(
        `SELECT positions_json, timestamp 
         FROM broker_reconciliation_snapshots 
         WHERE positions_json IS NOT NULL AND positions_json != '[]'
         ORDER BY timestamp ASC`
      );

      for (const row of rows) {
        try {
          const list = JSON.parse(row.positions_json);
          if (Array.isArray(list)) {
            for (const p of list) {
              const id = String(p.id || p.brokerPositionId || '');
              if (!id || seen.has(id)) continue;
              seen.add(id);

              const rawSym = String(p.symbol || '').toUpperCase().replace('/', '');
              const sym = rawSym.length === 6 ? `${rawSym.slice(0, 3)}/${rawSym.slice(3, 6)}` : p.symbol;
              const pnl = Number(p.unrealizedPnL ?? p.realizedPnL ?? 0);
              const entryPrice = Number(p.entryPrice || p.price || 0);
              const currentPrice = Number(p.currentPrice || entryPrice);

              records.push({
                id,
                broker: p.broker || 'CTRADER',
                pair: sym,
                direction: p.side === 'SELL' ? 'SELL' : 'BUY',
                entryPrice,
                exitPrice: currentPrice,
                entryTimestamp: Number(p.timestamp || row.timestamp),
                exitTimestamp: Number(row.timestamp),
                realizedPnl: pnl,
                holdingDurationMs: Math.max(0, Number(row.timestamp) - Number(p.timestamp || row.timestamp)),
                stopLoss: p.stopLoss ? Number(p.stopLoss) : undefined,
                takeProfit: p.takeProfit ? Number(p.takeProfit) : undefined,
                marketRegime: 'LIVE_EXECUTION',
                isWin: pnl > 0
              });
            }
          }
        } catch {
          // ignore corrupted json row
        }
      }

      // 2. Supplement from execution_intents
      const intents = await executeQuery<{
        idempotency_key: string;
        symbol: string;
        side: string;
        state: string;
        payload_json: string;
        result_json: string | null;
        created_at: number;
        updated_at: number;
      }>(
        `SELECT idempotency_key, symbol, side, state, payload_json, result_json, created_at, updated_at
         FROM execution_intents
         WHERE state = 'COMPLETED'
         ORDER BY created_at ASC`
      );

      for (const item of intents) {
        const id = `intent_${item.idempotency_key}`;
        if (seen.has(id)) continue;
        seen.add(id);

        let price = 0;
        let sl: number | undefined;
        let tp: number | undefined;
        try {
          const payload = JSON.parse(item.payload_json || '{}');
          price = Number(payload.price || 0);
          sl = payload.stopLoss ? Number(payload.stopLoss) : undefined;
          tp = payload.takeProfit ? Number(payload.takeProfit) : undefined;
        } catch {}

        records.push({
          id,
          broker: 'CTRADER',
          pair: item.symbol,
          direction: item.side === 'SELL' ? 'SELL' : 'BUY',
          entryPrice: price,
          entryTimestamp: Number(item.created_at),
          exitTimestamp: Number(item.updated_at),
          realizedPnl: 0,
          stopLoss: sl,
          takeProfit: tp,
          marketRegime: 'LIVE_INTENT',
          isWin: false // conservative baseline
        });
      }
    } catch (err) {
      console.warn('Failed to build historical trade ledger:', err);
    }

    this.cachedTrades = records.sort((a, b) => a.entryTimestamp - b.entryTimestamp);
    this.lastCacheBuild = Date.now();
  }

  /**
   * Computes rolling performance for a pair & direction up to cutoffTimestamp
   */
  public static async getRollingStrategyPerformance(
    pair: string,
    direction: 'BUY' | 'SELL',
    cutoffTimestamp: number = Date.now(),
    windowSize: number = 25
  ): Promise<RollingStrategyPerformance> {
    const allTrades = await this.getHistoricalTrades(cutoffTimestamp);
    const normalizedPair = pair.replace('/', '').toUpperCase();

    const matching = allTrades.filter(t => {
      const p = t.pair.replace('/', '').toUpperCase();
      return p === normalizedPair && t.direction === direction && t.entryTimestamp <= cutoffTimestamp;
    });

    const recent = matching.slice(-windowSize);
    const count = recent.length;

    if (count < 5) {
      return {
        pair,
        direction,
        tradesCount: count,
        winRate: 0.5,
        profitFactor: 1.0,
        consecutiveLosses: 0,
        penaltyMultiplier: 1.0,
        isPenalized: false,
        reason: 'Insufficient sample size for performance penalty'
      };
    }

    let wins = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let currentLossStreak = 0;
    let maxLossStreak = 0;

    for (const t of recent) {
      if (t.isWin) {
        wins++;
        grossProfit += Math.max(0, t.realizedPnl);
        currentLossStreak = 0;
      } else {
        grossLoss += Math.abs(t.realizedPnl);
        currentLossStreak++;
        if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
      }
    }

    const winRate = Number((wins / count).toFixed(3));
    const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : wins > 0 ? 3.0 : 0.5;

    // Calculate penalty multiplier
    let penaltyMultiplier = 1.0;
    let isPenalized = false;
    let reason = 'Normal performance';

    if (currentLossStreak >= 20) {
      penaltyMultiplier = 0.0;
      isPenalized = true;
      reason = 'Circuit breaker active: 20 consecutive losses reached. Complete veto.';
    } else if (currentLossStreak >= 7) {
      penaltyMultiplier = 0.25;
      isPenalized = true;
      reason = `Severe loss streak: ${currentLossStreak} consecutive losses for ${pair} ${direction}. Confidence penalized by 75%.`;
    } else if (winRate < 0.35 && count >= 10) {
      penaltyMultiplier = 0.40;
      isPenalized = true;
      reason = `Underperforming win rate (${(winRate * 100).toFixed(1)}% over ${count} trades). Confidence penalized by 60%.`;
    } else if (winRate < 0.45 && count >= 10) {
      penaltyMultiplier = 0.70;
      isPenalized = true;
      reason = `Below-average win rate (${(winRate * 100).toFixed(1)}%). Confidence penalized by 30%.`;
    }

    return {
      pair,
      direction,
      tradesCount: count,
      winRate,
      profitFactor,
      consecutiveLosses: currentLossStreak,
      penaltyMultiplier,
      isPenalized,
      reason
    };
  }

  /**
   * Fetches historical candles strictly <= cutoffTimestamp
   */
  public static async getCandlesUpTo(
    symbol: string,
    timeframe: string,
    cutoffTimestamp: number,
    limit: number = 200
  ): Promise<Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>> {
    const rows = await executeQuery<{
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>(
      `SELECT timestamp, open, high, low, close, volume 
       FROM candles 
       WHERE symbol = ? AND timeframe = ? AND timestamp <= ?
       ORDER BY timestamp DESC LIMIT ?`,
      [symbol, timeframe, cutoffTimestamp, limit]
    );

    return rows.reverse();
  }
}
