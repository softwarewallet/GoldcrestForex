// ============================================================================
// PREDICTION STORAGE & OUTCOME FINALIZATION (PHASE 17)
// ============================================================================

import { executeQuery, executeRun } from '../../database/db';
import { MultiFactorPredictionResult } from './types';

export class PredictionStorage {
  /**
   * Persists a prediction result to SQLite
   */
  public static async savePrediction(pred: MultiFactorPredictionResult): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO predictions (
        prediction_id, timestamp, pair, horizon, direction,
        probability_up, probability_down, confidence, regime,
        technical_features, news_features, historical_features,
        sample_size, expected_return, expected_risk, recommendation,
        target_price, actual_price, actual_outcome, actual_return,
        win_loss, prediction_error, created_at, evaluated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      pred.predictionId,
      pred.timestamp,
      pred.pair,
      pred.horizon,
      pred.direction,
      pred.probabilityUp,
      pred.probabilityDown,
      pred.calibratedConfidence,
      pred.regime,
      JSON.stringify(pred.evidence.technical),
      JSON.stringify(pred.evidence.news),
      JSON.stringify({
        historicalUpProbability: pred.evidence.historical.historicalUpProbability,
        historicalDownProbability: pred.evidence.historical.historicalDownProbability,
        sampleSize: pred.evidence.historical.sampleSize,
        winRate: pred.evidence.historical.winRate
      }),
      pred.sampleSize,
      pred.expectedReturn,
      pred.expectedRisk,
      pred.recommendation,
      pred.targetPrice || null,
      null, // actual_price evaluated later
      'PENDING',
      null,
      null,
      null,
      Date.now(),
      null
    ];

    try {
      await executeRun(sql, params);
    } catch (err) {
      console.warn('Failed to save prediction:', err);
    }
  }

  /**
   * Evaluates pending predictions against actual forward market prices
   */
  public static async evaluatePendingPredictions(now: number = Date.now()): Promise<number> {
    try {
      const pending = await executeQuery<{
        prediction_id: string;
        timestamp: number;
        pair: string;
        horizon: string;
        direction: string;
        target_price: number | null;
        recommendation: string;
      }>(
        `SELECT prediction_id, timestamp, pair, horizon, direction, target_price, recommendation
         FROM predictions
         WHERE actual_outcome = 'PENDING'
         ORDER BY timestamp ASC LIMIT 50`
      );

      let resolvedCount = 0;

      for (const p of pending) {
        const horizonMs = p.horizon === '5M' ? 5 * 60_000 : p.horizon === '15M' ? 15 * 60_000 : p.horizon === '1H' ? 60 * 60_000 : 24 * 3600_000;
        const targetTime = p.timestamp + horizonMs;

        if (now < targetTime) {
          // Horizon has not elapsed yet
          continue;
        }

        // Fetch actual price at or immediately after targetTime
        const candles = await executeQuery<{ close: number; timestamp: number }>(
          `SELECT close, timestamp FROM candles
           WHERE symbol = ? AND timestamp >= ?
           ORDER BY timestamp ASC LIMIT 1`,
          [p.pair, targetTime]
        );

        if (candles.length === 0) continue;

        const actualPrice = candles[0].close;
        const startCandles = await executeQuery<{ close: number }>(
          `SELECT close FROM candles
           WHERE symbol = ? AND timestamp <= ?
           ORDER BY timestamp DESC LIMIT 1`,
          [p.pair, p.timestamp]
        );

        const startPrice = startCandles.length > 0 ? startCandles[0].close : actualPrice;
        const actualReturnPct = ((actualPrice - startPrice) / startPrice) * 100;

        let winLoss = 0;
        let outcome = 'BREAKEVEN';
        let error = 0;

        if (p.direction === 'UP') {
          winLoss = actualReturnPct > 0.05 ? 1 : 0;
          outcome = actualReturnPct > 0.05 ? 'WIN' : 'LOSS';
          error = Math.abs(1 - (actualReturnPct > 0 ? 1 : 0));
        } else if (p.direction === 'DOWN') {
          winLoss = actualReturnPct < -0.05 ? 1 : 0;
          outcome = actualReturnPct < -0.05 ? 'WIN' : 'LOSS';
          error = Math.abs(1 - (actualReturnPct < 0 ? 1 : 0));
        } else {
          outcome = Math.abs(actualReturnPct) <= 0.05 ? 'WIN' : 'LOSS';
          winLoss = Math.abs(actualReturnPct) <= 0.05 ? 1 : 0;
        }

        await executeRun(
          `UPDATE predictions
           SET actual_price = ?, actual_outcome = ?, actual_return = ?, win_loss = ?, prediction_error = ?, evaluated_at = ?
           WHERE prediction_id = ?`,
          [actualPrice, outcome, Number(actualReturnPct.toFixed(3)), winLoss, error, now, p.prediction_id]
        );

        resolvedCount++;
      }

      return resolvedCount;
    } catch (err) {
      console.warn('Failed to evaluate pending predictions:', err);
      return 0;
    }
  }

  /**
   * Fetches latest predictions
   */
  public static async getLatestPredictions(limit: number = 20): Promise<any[]> {
    return executeQuery(
      `SELECT * FROM predictions ORDER BY timestamp DESC LIMIT ?`,
      [limit]
    );
  }
}
