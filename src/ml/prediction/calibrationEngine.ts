// ============================================================================
// EMPIRICAL CALIBRATION ENGINE (PHASE 7)
// ============================================================================

export interface CalibrationBucket {
  binMin: number;
  binMax: number;
  count: number;
  actualWinCount: number;
  empiricalProbability: number;
  meanPredictedProbability: number;
}

export interface CalibrationMetrics {
  brierScore: number;
  expectedCalibrationError: number;
  maxCalibrationError: number;
  totalPredictions: number;
  buckets: CalibrationBucket[];
}

export class CalibrationEngine {
  private static readonly BINS = [
    { min: 0.50, max: 0.60 },
    { min: 0.60, max: 0.70 },
    { min: 0.70, max: 0.80 },
    { min: 0.80, max: 1.00 }
  ];

  /**
   * Calibrates raw model probability against empirical reliability curves.
   * Maps raw probability to calibrated probability based on historical bin win-rates.
   */
  public static calibrateProbability(rawProb: number, sampleSize: number): number {
    const clamped = Math.max(0.01, Math.min(0.99, rawProb));

    // Statistical sample penalty: shrink towards 0.50 prior if sample size is small
    const shrinkageFactor = Math.min(1.0, Math.max(0.1, sampleSize / 60));
    const regressedToMean = 0.50 + (clamped - 0.50) * shrinkageFactor;

    // Empirical calibration curve (historically derived conservative scaling)
    if (regressedToMean >= 0.75) {
      return Number((0.62 + (regressedToMean - 0.75) * 0.45).toFixed(3));
    } else if (regressedToMean >= 0.60) {
      return Number((0.55 + (regressedToMean - 0.60) * 0.45).toFixed(3));
    } else if (regressedToMean >= 0.50) {
      return Number((0.50 + (regressedToMean - 0.50) * 0.50).toFixed(3));
    } else if (regressedToMean >= 0.40) {
      return Number((0.45 + (regressedToMean - 0.40) * 0.50).toFixed(3));
    } else {
      return Number((0.38 + (regressedToMean - 0.25) * 0.45).toFixed(3));
    }
  }

  /**
   * Calculates Brier Score and Expected Calibration Error (ECE) for predictions vs actual outcomes
   */
  public static evaluateCalibration(
    predictions: Array<{ predictedProbability: number; actualOutcome: 1 | 0 }>
  ): CalibrationMetrics {
    const n = predictions.length;
    if (n === 0) {
      return {
        brierScore: 0.25,
        expectedCalibrationError: 0,
        maxCalibrationError: 0,
        totalPredictions: 0,
        buckets: []
      };
    }

    let brierSum = 0;
    const bucketData = this.BINS.map(b => ({
      binMin: b.min,
      binMax: b.max,
      count: 0,
      actualWinCount: 0,
      predictedSum: 0
    }));

    for (const p of predictions) {
      brierSum += Math.pow(p.predictedProbability - p.actualOutcome, 2);

      const bucket = bucketData.find(b => p.predictedProbability >= b.binMin && p.predictedProbability < b.binMax)
        || bucketData[bucketData.length - 1];

      bucket.count++;
      bucket.predictedSum += p.predictedProbability;
      if (p.actualOutcome === 1) bucket.actualWinCount++;
    }

    const brierScore = Number((brierSum / n).toFixed(4));
    let ece = 0;
    let maxError = 0;

    const buckets: CalibrationBucket[] = bucketData.map(b => {
      const empiricalProbability = b.count > 0 ? Number((b.actualWinCount / b.count).toFixed(3)) : 0;
      const meanPredictedProbability = b.count > 0 ? Number((b.predictedSum / b.count).toFixed(3)) : (b.binMin + b.binMax) / 2;
      const error = Math.abs(empiricalProbability - meanPredictedProbability);

      if (b.count > 0) {
        ece += (b.count / n) * error;
        if (error > maxError) maxError = error;
      }

      return {
        binMin: b.binMin,
        binMax: b.binMax,
        count: b.count,
        actualWinCount: b.actualWinCount,
        empiricalProbability,
        meanPredictedProbability
      };
    });

    return {
      brierScore,
      expectedCalibrationError: Number(ece.toFixed(4)),
      maxCalibrationError: Number(maxError.toFixed(4)),
      totalPredictions: n,
      buckets
    };
  }
}
