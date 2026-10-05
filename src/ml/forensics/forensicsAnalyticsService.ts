import { executeQuery, executeRun } from '../../database/db';
import {
  DailyPredictionMetrics,
  PerformanceBreakdownGroup,
  ConfidenceCalibrationBucket,
  RollingDriftMetrics
} from './types';

export class ForensicsAnalyticsService {
  /**
   * Generates or retrieves daily metrics for a specific date (YYYY-MM-DD).
   */
  public static async getDailyMetrics(dateStr: string): Promise<DailyPredictionMetrics> {
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`).getTime();
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`).getTime();

    const sql = `
      SELECT s.prediction_id, s.confidence_score, s.expected_r, s.final_decision,
             o.actual_outcome, o.is_direction_correct, o.is_trade_won, o.actual_realized_r,
             f.brier_score, f.calibration_error
      FROM prediction_snapshots s
      LEFT JOIN prediction_outcomes o ON o.prediction_id = s.prediction_id
      LEFT JOIN prediction_forensics f ON f.prediction_id = s.prediction_id
      WHERE s.timestamp >= ? AND s.timestamp <= ?
    `;

    const rows = await executeQuery<any>(sql, [startOfDay, endOfDay]);

    const total = rows.length;
    const completed = rows.filter(r => r.actual_outcome && r.actual_outcome !== 'PENDING').length;
    const pending = total - completed;
    const actionable = rows.filter(r => r.final_decision === 'TRADE_BUY' || r.final_decision === 'TRADE_SELL').length;
    const abstained = total - actionable;

    const completedRows = rows.filter(r => r.actual_outcome && r.actual_outcome !== 'PENDING');
    const correct = completedRows.filter(r => r.is_direction_correct === 1).length;
    const incorrect = completed - correct;
    const accuracyPct = completed > 0 ? Number(((correct / completed) * 100).toFixed(2)) : 0;

    const tpFirst = completedRows.filter(r => r.actual_outcome === 'TP_FIRST').length;
    const slFirst = completedRows.filter(r => r.actual_outcome === 'SL_FIRST').length;
    const timeExit = completedRows.filter(r => r.actual_outcome === 'TIME_EXIT').length;
    const noEntry = completedRows.filter(r => r.actual_outcome === 'NO_ENTRY').length;

    const avgConfidence = total > 0
      ? Number((rows.reduce((acc, r) => acc + (r.confidence_score || 0), 0) / total).toFixed(3))
      : 0;
    const avgExpectedR = total > 0
      ? Number((rows.reduce((acc, r) => acc + (r.expected_r || 0), 0) / total).toFixed(2))
      : 0;
    const avgRealizedR = completed > 0
      ? Number((completedRows.reduce((acc, r) => acc + (r.actual_realized_r || 0), 0) / completed).toFixed(2))
      : 0;

    const grossWinsR = completedRows.filter(r => (r.actual_realized_r || 0) > 0).reduce((acc, r) => acc + r.actual_realized_r, 0);
    const grossLossesR = Math.abs(completedRows.filter(r => (r.actual_realized_r || 0) < 0).reduce((acc, r) => acc + r.actual_realized_r, 0));
    const realizedProfitFactor = grossLossesR > 0 ? Number((grossWinsR / grossLossesR).toFixed(2)) : grossWinsR > 0 ? 9.99 : 1.0;

    const brierScore = completed > 0
      ? Number((completedRows.reduce((acc, r) => acc + (r.brier_score || 0.25), 0) / completed).toFixed(4))
      : 0.25;
    const calibrationError = completed > 0
      ? Number((completedRows.reduce((acc, r) => acc + (r.calibration_error || 0.25), 0) / completed).toFixed(4))
      : 0.25;

    const metrics: DailyPredictionMetrics = {
      date: dateStr,
      totalPredictions: total,
      completedPredictions: completed,
      pendingPredictions: pending,
      actionablePredictions: actionable,
      abstainedPredictions: abstained,
      correctPredictions: correct,
      incorrectPredictions: incorrect,
      accuracyPct,
      tpFirstCount: tpFirst,
      slFirstCount: slFirst,
      timeExitCount: timeExit,
      noEntryCount: noEntry,
      avgConfidence,
      avgExpectedR,
      avgRealizedR,
      realizedProfitFactor,
      brierScore,
      calibrationError
    };

    // Store/update in prediction_daily_metrics
    await executeRun(
      `INSERT OR REPLACE INTO prediction_daily_metrics (
        date, total_predictions, completed_predictions, pending_predictions,
        actionable_predictions, abstained_predictions, correct_predictions,
        incorrect_predictions, accuracy_pct, tp_first_count, sl_first_count,
        time_exit_count, no_entry_count, avg_confidence, avg_expected_r,
        avg_realized_r, realized_profit_factor, brier_score, calibration_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        metrics.date, metrics.totalPredictions, metrics.completedPredictions, metrics.pendingPredictions,
        metrics.actionablePredictions, metrics.abstainedPredictions, metrics.correctPredictions,
        metrics.incorrectPredictions, metrics.accuracyPct, metrics.tpFirstCount, metrics.slFirstCount,
        metrics.timeExitCount, metrics.noEntryCount, metrics.avgConfidence, metrics.avgExpectedR,
        metrics.avgRealizedR, metrics.realizedProfitFactor, metrics.brierScore, metrics.calibrationError, Date.now()
      ]
    );

    return metrics;
  }

  /**
   * Computes period aggregation across a date range.
   */
  public static async getPeriodMetrics(fromTimestamp: number, toTimestamp: number): Promise<DailyPredictionMetrics> {
    const sql = `
      SELECT s.prediction_id, s.confidence_score, s.expected_r, s.final_decision,
             o.actual_outcome, o.is_direction_correct, o.is_trade_won, o.actual_realized_r,
             f.brier_score, f.calibration_error
      FROM prediction_snapshots s
      LEFT JOIN prediction_outcomes o ON o.prediction_id = s.prediction_id
      LEFT JOIN prediction_forensics f ON f.prediction_id = s.prediction_id
      WHERE s.timestamp >= ? AND s.timestamp <= ?
    `;

    const rows = await executeQuery<any>(sql, [fromTimestamp, toTimestamp]);
    const total = rows.length;
    const completed = rows.filter(r => r.actual_outcome && r.actual_outcome !== 'PENDING').length;
    const pending = total - completed;
    const actionable = rows.filter(r => r.final_decision === 'TRADE_BUY' || r.final_decision === 'TRADE_SELL').length;
    const abstained = total - actionable;

    const completedRows = rows.filter(r => r.actual_outcome && r.actual_outcome !== 'PENDING');
    const correct = completedRows.filter(r => r.is_direction_correct === 1).length;
    const incorrect = completed - correct;
    const accuracyPct = completed > 0 ? Number(((correct / completed) * 100).toFixed(2)) : 0;

    const tpFirst = completedRows.filter(r => r.actual_outcome === 'TP_FIRST').length;
    const slFirst = completedRows.filter(r => r.actual_outcome === 'SL_FIRST').length;
    const timeExit = completedRows.filter(r => r.actual_outcome === 'TIME_EXIT').length;
    const noEntry = completedRows.filter(r => r.actual_outcome === 'NO_ENTRY').length;

    const avgConfidence = total > 0
      ? Number((rows.reduce((acc, r) => acc + (r.confidence_score || 0), 0) / total).toFixed(3))
      : 0;
    const avgExpectedR = total > 0
      ? Number((rows.reduce((acc, r) => acc + (r.expected_r || 0), 0) / total).toFixed(2))
      : 0;
    const avgRealizedR = completed > 0
      ? Number((completedRows.reduce((acc, r) => acc + (r.actual_realized_r || 0), 0) / completed).toFixed(2))
      : 0;

    const grossWinsR = completedRows.filter(r => (r.actual_realized_r || 0) > 0).reduce((acc, r) => acc + r.actual_realized_r, 0);
    const grossLossesR = Math.abs(completedRows.filter(r => (r.actual_realized_r || 0) < 0).reduce((acc, r) => acc + r.actual_realized_r, 0));
    const realizedProfitFactor = grossLossesR > 0 ? Number((grossWinsR / grossLossesR).toFixed(2)) : grossWinsR > 0 ? 9.99 : 1.0;

    const brierScore = completed > 0
      ? Number((completedRows.reduce((acc, r) => acc + (r.brier_score || 0.25), 0) / completed).toFixed(4))
      : 0.25;
    const calibrationError = completed > 0
      ? Number((completedRows.reduce((acc, r) => acc + (r.calibration_error || 0.25), 0) / completed).toFixed(4))
      : 0.25;

    return {
      date: 'PERIOD_AGGREGATE',
      totalPredictions: total,
      completedPredictions: completed,
      pendingPredictions: pending,
      actionablePredictions: actionable,
      abstainedPredictions: abstained,
      correctPredictions: correct,
      incorrectPredictions: incorrect,
      accuracyPct,
      tpFirstCount: tpFirst,
      slFirstCount: slFirst,
      timeExitCount: timeExit,
      noEntryCount: noEntry,
      avgConfidence,
      avgExpectedR,
      avgRealizedR,
      realizedProfitFactor,
      brierScore,
      calibrationError
    };
  }

  /**
   * Computes breakdowns across categories (Pair, Direction, Regime, Session, News, Model Version).
   */
  public static async getBreakdown(
    groupBy: 'pair' | 'predicted_direction' | 'market_regime' | 'session' | 'news_risk' | 'model_version',
    fromTimestamp: number = 0,
    toTimestamp: number = Date.now()
  ): Promise<PerformanceBreakdownGroup[]> {
    const sql = `
      SELECT s.${groupBy} as group_key,
             s.confidence_score, s.expected_r,
             o.actual_outcome, o.is_direction_correct, o.is_trade_won, o.actual_realized_r
      FROM prediction_snapshots s
      LEFT JOIN prediction_outcomes o ON o.prediction_id = s.prediction_id
      WHERE s.timestamp >= ? AND s.timestamp <= ?
    `;

    const rows = await executeQuery<any>(sql, [fromTimestamp, toTimestamp]);
    const groupsMap = new Map<string, any[]>();

    for (const r of rows) {
      const key = String(r.group_key || 'UNKNOWN');
      if (!groupsMap.has(key)) groupsMap.set(key, []);
      groupsMap.get(key)!.push(r);
    }

    const results: PerformanceBreakdownGroup[] = [];

    for (const [key, groupRows] of groupsMap.entries()) {
      const total = groupRows.length;
      const completed = groupRows.filter(r => r.actual_outcome && r.actual_outcome !== 'PENDING');
      const correct = completed.filter(r => r.is_direction_correct === 1).length;
      const accuracyPct = completed.length > 0 ? Number(((correct / completed.length) * 100).toFixed(1)) : 0;
      const avgConfidencePct = total > 0
        ? Number(((groupRows.reduce((acc, r) => acc + (r.confidence_score || 0), 0) / total) * 100).toFixed(1))
        : 0;
      const avgExpectedR = total > 0
        ? Number((groupRows.reduce((acc, r) => acc + (r.expected_r || 0), 0) / total).toFixed(2))
        : 0;
      const avgRealizedR = completed.length > 0
        ? Number((completed.reduce((acc, r) => acc + (r.actual_realized_r || 0), 0) / completed.length).toFixed(2))
        : 0;

      const tpFirst = completed.filter(r => r.actual_outcome === 'TP_FIRST').length;
      const slFirst = completed.filter(r => r.actual_outcome === 'SL_FIRST').length;
      const timeExit = completed.filter(r => r.actual_outcome === 'TIME_EXIT').length;

      const grossWins = completed.filter(r => (r.actual_realized_r || 0) > 0).reduce((acc, r) => acc + r.actual_realized_r, 0);
      const grossLosses = Math.abs(completed.filter(r => (r.actual_realized_r || 0) < 0).reduce((acc, r) => acc + r.actual_realized_r, 0));
      const profitFactor = grossLosses > 0 ? Number((grossWins / grossLosses).toFixed(2)) : grossWins > 0 ? 9.99 : 1.0;

      let warningFlag: string | undefined = undefined;
      if (completed.length >= 10 && accuracyPct < 45) {
        warningFlag = 'POOR_ACCURACY_WARNING';
      } else if (completed.length >= 10 && avgRealizedR < -0.15) {
        warningFlag = 'NEGATIVE_EXPECTANCY_WARNING';
      }

      results.push({
        groupKey: key,
        totalPredictions: total,
        completedCount: completed.length,
        correctCount: correct,
        accuracyPct,
        avgConfidencePct,
        avgExpectedR,
        avgRealizedR,
        profitFactor,
        tpFirstCount: tpFirst,
        slFirstCount: slFirst,
        timeExitCount: timeExit,
        warningFlag
      });
    }

    return results.sort((a, b) => b.totalPredictions - a.totalPredictions);
  }

  /**
   * Evaluates empirical confidence calibration across standard probability buckets (Phase 9).
   */
  public static async getConfidenceCalibration(
    fromTimestamp: number = 0,
    toTimestamp: number = Date.now()
  ): Promise<ConfidenceCalibrationBucket[]> {
    const buckets: { name: '50-60%' | '60-70%' | '70-80%' | '80-90%' | '90-100%'; min: number; max: number }[] = [
      { name: '50-60%', min: 0.50, max: 0.60 },
      { name: '60-70%', min: 0.60, max: 0.70 },
      { name: '70-80%', min: 0.70, max: 0.80 },
      { name: '80-90%', min: 0.80, max: 0.90 },
      { name: '90-100%', min: 0.90, max: 1.00 }
    ];

    const sql = `
      SELECT s.confidence_score, o.is_direction_correct, o.is_trade_won, o.actual_realized_r, f.brier_score
      FROM prediction_snapshots s
      LEFT JOIN prediction_outcomes o ON o.prediction_id = s.prediction_id
      LEFT JOIN prediction_forensics f ON f.prediction_id = s.prediction_id
      WHERE s.timestamp >= ? AND s.timestamp <= ?
    `;

    const rows = await executeQuery<any>(sql, [fromTimestamp, toTimestamp]);

    return buckets.map(b => {
      const inBucket = rows.filter(r => r.confidence_score >= b.min && (b.name === '90-100%' ? r.confidence_score <= b.max : r.confidence_score < b.max));
      const completed = inBucket.filter(r => r.is_direction_correct !== undefined && r.is_direction_correct !== null);
      const count = completed.length;

      if (count < 5) {
        return {
          bucketName: b.name,
          predictionsCount: count,
          avgPredictedProbability: Number(((b.min + b.max) / 2).toFixed(2)),
          actualSuccessRate: 0,
          calibrationError: 0,
          brierScore: 0.25,
          avgRealizedR: 0,
          profitFactor: 1.0,
          status: 'INSUFFICIENT_SAMPLE'
        };
      }

      const avgPredicted = inBucket.reduce((acc, r) => acc + r.confidence_score, 0) / count;
      const wins = completed.filter(r => r.is_direction_correct === 1).length;
      const actualSuccessRate = wins / count;
      const calibrationError = Number(Math.abs(avgPredicted - actualSuccessRate).toFixed(3));
      const brierScore = Number((completed.reduce((acc, r) => acc + (r.brier_score || 0.25), 0) / count).toFixed(4));
      const avgRealizedR = Number((completed.reduce((acc, r) => acc + (r.actual_realized_r || 0), 0) / count).toFixed(2));

      const grossWins = completed.filter(r => (r.actual_realized_r || 0) > 0).reduce((acc, r) => acc + r.actual_realized_r, 0);
      const grossLosses = Math.abs(completed.filter(r => (r.actual_realized_r || 0) < 0).reduce((acc, r) => acc + r.actual_realized_r, 0));
      const profitFactor = grossLosses > 0 ? Number((grossWins / grossLosses).toFixed(2)) : 1.0;

      let status: 'CALIBRATED' | 'OVERCONFIDENT' | 'UNDERCONFIDENT' | 'INSUFFICIENT_SAMPLE' = 'CALIBRATED';
      if (avgPredicted - actualSuccessRate > 0.12) {
        status = 'OVERCONFIDENT';
      } else if (actualSuccessRate - avgPredicted > 0.12) {
        status = 'UNDERCONFIDENT';
      }

      return {
        bucketName: b.name,
        predictionsCount: count,
        avgPredictedProbability: Number(avgPredicted.toFixed(3)),
        actualSuccessRate: Number(actualSuccessRate.toFixed(3)),
        calibrationError,
        brierScore,
        avgRealizedR,
        profitFactor,
        status
      };
    });
  }

  /**
   * Tracks rolling metrics to detect prediction performance drift (Phase 13).
   */
  public static async getRollingDriftMetrics(windowSize: number = 50): Promise<RollingDriftMetrics> {
    const sql = `
      SELECT s.confidence_score, s.expected_r, o.is_direction_correct, o.actual_realized_r
      FROM prediction_snapshots s
      INNER JOIN prediction_outcomes o ON o.prediction_id = s.prediction_id
      ORDER BY s.timestamp DESC
      LIMIT ?
    `;

    const rows = await executeQuery<any>(sql, [windowSize * 4]);
    const chronologicalRows = rows.reverse();

    const accuracyTrend: number[] = [];
    const realizedRTrend: number[] = [];
    const expectedRTrend: number[] = [];
    const confidenceTrend: number[] = [];

    const step = Math.max(5, Math.floor(windowSize / 5));

    for (let i = 0; i <= chronologicalRows.length - windowSize; i += step) {
      const windowRows = chronologicalRows.slice(i, i + windowSize);
      const wins = windowRows.filter(r => r.is_direction_correct === 1).length;
      const acc = Number(((wins / windowSize) * 100).toFixed(1));
      const avgRealR = Number((windowRows.reduce((a, r) => a + (r.actual_realized_r || 0), 0) / windowSize).toFixed(2));
      const avgExpR = Number((windowRows.reduce((a, r) => a + (r.expected_r || 0), 0) / windowSize).toFixed(2));
      const avgConf = Number(((windowRows.reduce((a, r) => a + (r.confidence_score || 0), 0) / windowSize) * 100).toFixed(1));

      accuracyTrend.push(acc);
      realizedRTrend.push(avgRealR);
      expectedRTrend.push(avgExpR);
      confidenceTrend.push(avgConf);
    }

    let isDrifting = false;
    let driftWarningMessage: string | undefined = undefined;

    if (accuracyTrend.length >= 3) {
      const first = accuracyTrend[0];
      const latest = accuracyTrend[accuracyTrend.length - 1];
      if (first - latest > 12.0) {
        isDrifting = true;
        driftWarningMessage = `Prediction accuracy dropped from ${first}% to ${latest}% across rolling ${windowSize}-prediction windows.`;
      }
    }

    return {
      windowSize,
      accuracyTrend,
      realizedRTrend,
      expectedRTrend,
      confidenceTrend,
      isDrifting,
      driftWarningMessage
    };
  }
}
