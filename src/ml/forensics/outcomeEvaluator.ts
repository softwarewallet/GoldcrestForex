import { executeQuery, executeRun } from '../../database/db';
import { PredictionSnapshotService } from './predictionSnapshotService';
import { FailureClassifier } from './failureClassifier';
import {
  PredictionOutcomeRecord,
  ForensicOutcomeClass,
  ForensicTradeClass
} from './types';

export class OutcomeEvaluator {
  /**
   * Evaluates pending prediction snapshots against actual forward candle data.
   * STRICT INVARIANT: Evaluates ONLY predictions whose horizon has elapsed (evaluatedAt > prediction timestamp).
   */
  public static async evaluatePendingPredictions(currentTime: number = Date.now(), targetPredictionId?: string): Promise<number> {
    const whereCond = targetPredictionId
      ? 'WHERE s.prediction_id = ?'
      : 'WHERE o.prediction_id IS NULL';
    const params = targetPredictionId ? [targetPredictionId] : [];

    const pendingSnaps = await executeQuery<{
      prediction_id: string;
      timestamp: number;
      pair: string;
      horizon: string;
      predicted_direction: string;
      predicted_entry: number;
      predicted_stop_loss: number;
      predicted_take_profit: number;
      predicted_risk_reward: number;
      spread_at_prediction: number;
      pip_size: number;
    }>(
      `SELECT s.prediction_id, s.timestamp, s.pair, s.horizon,
              s.predicted_direction, s.predicted_entry, s.predicted_stop_loss,
              s.predicted_take_profit, s.predicted_risk_reward, s.spread_at_prediction,
              COALESCE(cp.pip_size, 0.0001) as pip_size
       FROM prediction_snapshots s
       LEFT JOIN currency_pairs cp ON cp.symbol = s.pair
       LEFT JOIN prediction_outcomes o ON o.prediction_id = s.prediction_id
       ${whereCond}
       ORDER BY s.timestamp DESC
       LIMIT 500`,
      params
    );

    let resolvedCount = 0;

    for (const snap of pendingSnaps) {
      const horizonMinutes = snap.horizon === '5M' ? 5 : snap.horizon === '15M' ? 15 : snap.horizon === '1H' ? 60 : snap.horizon === '4H' ? 240 : 1440;
      const horizonMs = horizonMinutes * 60_000;
      const expiryTimestamp = snap.timestamp + horizonMs;

      // Do not evaluate if horizon has not elapsed
      if (currentTime < expiryTimestamp) {
        continue;
      }

      // Fetch all forward candles between prediction timestamp and expiryTimestamp
      const forwardCandles = await executeQuery<{
        open: number;
        high: number;
        low: number;
        close: number;
        timestamp: number;
      }>(
        `SELECT open, high, low, close, timestamp
         FROM candles
         WHERE symbol = ? AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC`,
        [snap.pair, snap.timestamp, expiryTimestamp + 3600_000]
      );

      const isBuy = snap.predicted_direction === 'BUY' || snap.predicted_direction === 'STRONG_BUY';
      const isSell = snap.predicted_direction === 'SELL' || snap.predicted_direction === 'STRONG_SELL';
      const entryPrice = snap.predicted_entry;
      const targetPrice = snap.predicted_take_profit;
      const stopPrice = snap.predicted_stop_loss;
      const pipSize = snap.pip_size || (snap.pair.includes('JPY') ? 0.01 : 0.0001);
      const riskDistancePips = Math.abs(entryPrice - stopPrice) / pipSize;
      const safeRiskPips = Math.max(5.0, riskDistancePips);

      let actualOutcome: ForensicOutcomeClass = 'TIME_EXIT';
      let entryReached = true; // In simulated forensic tracking, market price at T is entry base
      let exitPriceActual = forwardCandles.length > 0 ? forwardCandles[forwardCandles.length - 1].close : entryPrice;
      let maxFavorablePips = 0;
      let maxAdversePips = 0;
      let closedBy: 'TARGET_HIT' | 'STOP_HIT' | 'TIME_EXPIRY' | 'AUTO_LIVE_EXIT' | 'MANUAL_OPERATOR' | 'UNRESOLVED' = 'TIME_EXPIRY';
      let resolvedTimestamp = expiryTimestamp;

      for (const candle of forwardCandles) {
        if (isBuy) {
          const favorableMove = (candle.high - entryPrice) / pipSize;
          const adverseMove = (entryPrice - candle.low) / pipSize;
          if (favorableMove > maxFavorablePips) maxFavorablePips = favorableMove;
          if (adverseMove > maxAdversePips) maxAdversePips = adverseMove;

          // Check if TP hit first
          if (candle.high >= targetPrice) {
            actualOutcome = 'TP_FIRST';
            exitPriceActual = targetPrice;
            closedBy = 'TARGET_HIT';
            resolvedTimestamp = candle.timestamp;
            break;
          }
          // Check if SL hit first
          if (candle.low <= stopPrice) {
            actualOutcome = 'SL_FIRST';
            exitPriceActual = stopPrice;
            closedBy = 'STOP_HIT';
            resolvedTimestamp = candle.timestamp;
            break;
          }
        } else if (isSell) {
          const favorableMove = (entryPrice - candle.low) / pipSize;
          const adverseMove = (candle.high - entryPrice) / pipSize;
          if (favorableMove > maxFavorablePips) maxFavorablePips = favorableMove;
          if (adverseMove > maxAdversePips) maxAdversePips = adverseMove;

          if (candle.low <= targetPrice) {
            actualOutcome = 'TP_FIRST';
            exitPriceActual = targetPrice;
            closedBy = 'TARGET_HIT';
            resolvedTimestamp = candle.timestamp;
            break;
          }
          if (candle.high >= stopPrice) {
            actualOutcome = 'SL_FIRST';
            exitPriceActual = stopPrice;
            closedBy = 'STOP_HIT';
            resolvedTimestamp = candle.timestamp;
            break;
          }
        }
      }

      // If neither TP nor SL was hit before expiry, finalize as TIME_EXIT
      if (actualOutcome === 'TIME_EXIT' && forwardCandles.length > 0) {
        exitPriceActual = forwardCandles[forwardCandles.length - 1].close;
        closedBy = 'TIME_EXPIRY';
      }

      // Calculate Realized R & Excursion metrics
      let realizedPips = isBuy ? (exitPriceActual - entryPrice) / pipSize : (entryPrice - exitPriceActual) / pipSize;
      let actualRealizedR = Number((realizedPips / safeRiskPips).toFixed(2));
      const maeR = Number((maxAdversePips / safeRiskPips).toFixed(2));
      const mfeR = Number((maxFavorablePips / safeRiskPips).toFixed(2));
      const isTradeWon = actualOutcome === 'TP_FIRST' || actualRealizedR > 0.3;
      const isDirectionCorrect = (isBuy && exitPriceActual > entryPrice) || (isSell && exitPriceActual < entryPrice);

      let tradeClassification: ForensicTradeClass = 'PENDING';
      if (isDirectionCorrect && isTradeWon) tradeClassification = 'CORRECT_PREDICTION_WIN';
      else if (isDirectionCorrect && !isTradeWon) tradeClassification = 'CORRECT_PREDICTION_LOSS';
      else if (!isDirectionCorrect && isTradeWon) tradeClassification = 'WRONG_PREDICTION_WIN';
      else tradeClassification = 'WRONG_PREDICTION_LOSS';

      const holdingDurationMinutes = Math.max(1, Math.round((resolvedTimestamp - snap.timestamp) / 60_000));

      const outcomeRecord: PredictionOutcomeRecord = {
        predictionId: snap.prediction_id,
        evaluatedAt: currentTime,
        actualOutcome,
        tradeClassification,
        isDirectionCorrect,
        isTradeWon,
        entryReached,
        entryPriceActual: entryPrice,
        exitPriceActual,
        actualRealizedR,
        holdingDurationMinutes,
        maePips: Number(maxAdversePips.toFixed(1)),
        mfePips: Number(maxFavorablePips.toFixed(1)),
        maeR,
        mfeR,
        closedBy
      };

      // Save to prediction_outcomes table
      await executeRun(
        `INSERT OR REPLACE INTO prediction_outcomes (
          prediction_id, evaluated_at, actual_outcome, trade_classification,
          is_direction_correct, is_trade_won, entry_reached, entry_price_actual,
          exit_price_actual, actual_realized_r, holding_duration_minutes,
          mae_pips, mfe_pips, mae_r, mfe_r, closed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          outcomeRecord.predictionId,
          outcomeRecord.evaluatedAt,
          outcomeRecord.actualOutcome,
          outcomeRecord.tradeClassification,
          outcomeRecord.isDirectionCorrect ? 1 : 0,
          outcomeRecord.isTradeWon ? 1 : 0,
          outcomeRecord.entryReached ? 1 : 0,
          outcomeRecord.entryPriceActual,
          outcomeRecord.exitPriceActual,
          outcomeRecord.actualRealizedR,
          outcomeRecord.holdingDurationMinutes,
          outcomeRecord.maePips,
          outcomeRecord.mfePips,
          outcomeRecord.maeR,
          outcomeRecord.mfeR,
          outcomeRecord.closedBy
        ]
      );

      // Perform Forensic Root Cause Classification
      const fullItem = await PredictionSnapshotService.getPredictionById(snap.prediction_id);
      if (fullItem) {
        const forensicAudit = FailureClassifier.diagnosePrediction(
          fullItem.snapshot,
          fullItem.features,
          outcomeRecord
        );

        await executeRun(
          `INSERT OR REPLACE INTO prediction_forensics (
            prediction_id, primary_failure_reason, secondary_factors,
            evidence_summary, confidence_bucket, is_overconfident,
            is_underconfident, calibration_error, brier_score, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            forensicAudit.predictionId,
            forensicAudit.primaryFailureReason,
            JSON.stringify(forensicAudit.secondaryFactors),
            JSON.stringify(forensicAudit.evidenceSummary),
            forensicAudit.confidenceBucket,
            forensicAudit.isOverconfident ? 1 : 0,
            forensicAudit.isUnderconfident ? 1 : 0,
            forensicAudit.calibrationError,
            forensicAudit.brierScore,
            currentTime
          ]
        );
      }

      resolvedCount++;
    }

    return resolvedCount;
  }
}
