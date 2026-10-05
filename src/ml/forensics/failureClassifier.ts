import {
  ImmutablePredictionSnapshot,
  PredictionFeatureSnapshot,
  PredictionOutcomeRecord,
  PredictionForensicAudit,
  ForensicFailureReason
} from './types';

export class FailureClassifier {
  /**
   * Classifies root-cause failure and evaluates confidence calibration on an empirical basis.
   * STRICT INVARIANT: Never hallucinates an explanation; falls back to UNKNOWN_FAILURE if unsupported.
   */
  public static diagnosePrediction(
    snapshot: ImmutablePredictionSnapshot,
    features: PredictionFeatureSnapshot,
    outcome: PredictionOutcomeRecord
  ): PredictionForensicAudit {
    const isWin = outcome.isTradeWon;
    const isDirectionCorrect = outcome.isDirectionCorrect;
    const confidence = snapshot.confidenceScore;
    const secondaryFactors: string[] = [];
    const evidenceSummary: string[] = [];

    // 1. Determine Confidence Bucket
    let confidenceBucket: '50-60%' | '60-70%' | '70-80%' | '80-90%' | '90-100%' = '50-60%';
    if (confidence >= 0.90) confidenceBucket = '90-100%';
    else if (confidence >= 0.80) confidenceBucket = '80-90%';
    else if (confidence >= 0.70) confidenceBucket = '70-80%';
    else if (confidence >= 0.60) confidenceBucket = '60-70%';

    // 2. Compute Calibration Error & Brier Score
    const actualOutcomeVal = isWin ? 1.0 : 0.0;
    const brierScore = Number(Math.pow(confidence - actualOutcomeVal, 2).toFixed(4));
    const calibrationError = Number(Math.abs(confidence - actualOutcomeVal).toFixed(4));
    const isOverconfident = confidence > 0.70 && !isWin;
    const isUnderconfident = confidence < 0.60 && isWin && outcome.actualRealizedR > 1.5;

    // If trade won and direction was correct, no failure classification is needed
    if (isWin && isDirectionCorrect) {
      return {
        predictionId: snapshot.predictionId,
        primaryFailureReason: 'UNKNOWN_FAILURE',
        secondaryFactors: [],
        evidenceSummary: [
          `Target reached (+${outcome.actualRealizedR.toFixed(2)} R)`,
          `Direction confirmed correct (${snapshot.predictedDirection})`,
          `MFE peaked at +${outcome.mfeR.toFixed(2)} R`
        ],
        confidenceBucket,
        isOverconfident: false,
        isUnderconfident,
        calibrationError,
        brierScore
      };
    }

    // 3. Evidence Gathering & Root Cause Attribution
    let primaryFailureReason: ForensicFailureReason = 'UNKNOWN_FAILURE';

    // A. Data Quality / Spread Failure
    if (snapshot.dataQuality === 'DEGRADED' || snapshot.spreadQuality === 'EXPANDED' || snapshot.quoteAgeMs > 30000) {
      secondaryFactors.push('Degraded quote quality or expanded spread at entry');
    }

    // B. High Impact News Shock
    if (snapshot.newsShockState || snapshot.highImpactNews || snapshot.newsRisk === 'EXTREME') {
      secondaryFactors.push(`High impact news or news shock active (Sentiment: ${snapshot.newsSentiment.toFixed(2)})`);
      if (!isDirectionCorrect) {
        primaryFailureReason = 'NEWS_FAILURE';
        evidenceSummary.push('Prediction reversed abruptly following scheduled/breaking high-impact economic news release');
      }
    }

    // C. Multi-Timeframe Alignment Conflict
    if (features.mtfAlignment === 'CONFLICTING' || features.mtfConflictScore > 0.40) {
      secondaryFactors.push(`Higher-timeframe conflict detected (MTF conflict score: ${(features.mtfConflictScore * 100).toFixed(0)}%)`);
      if (primaryFailureReason === 'UNKNOWN_FAILURE') {
        primaryFailureReason = 'MTF_CONFLICT_FAILURE';
        evidenceSummary.push('Higher timeframe momentum opposed prediction direction, capping price progression');
      }
    }

    // D. Regime Incompatibility / Transition
    if (snapshot.marketRegime === 'TRANSITION' || snapshot.marketRegime === 'HIGH_VOLATILITY') {
      secondaryFactors.push(`Unstable market regime (${snapshot.marketRegime})`);
      if (primaryFailureReason === 'UNKNOWN_FAILURE') {
        primaryFailureReason = 'REGIME_FAILURE';
        evidenceSummary.push(`Setup failed due to range-bound whipsaw in ${snapshot.marketRegime} regime`);
      }
    }

    // E. Entry Timing Failure: Direction was initially correct (price moved favorably > 0.3R) but reversed before TP
    if (outcome.mfeR >= 0.30 && outcome.actualOutcome === 'SL_FIRST') {
      primaryFailureReason = 'ENTRY_TIMING_FAILURE';
      evidenceSummary.push(
        `Price initially moved favorably (+${outcome.mfeR.toFixed(2)} R MFE) but suffered severe adverse reversal before target was reached`
      );
    }

    // F. Overextended Volatility / ATR Exhaustion
    if (features.rsi > 75 && snapshot.predictedDirection === 'BUY') {
      secondaryFactors.push(`Overbought RSI (${features.rsi.toFixed(1)}) at entry`);
    } else if (features.rsi < 25 && snapshot.predictedDirection === 'SELL') {
      secondaryFactors.push(`Oversold RSI (${features.rsi.toFixed(1)}) at entry`);
    }

    // G. Pure Direction Failure
    if (!isDirectionCorrect && outcome.mfeR < 0.15 && primaryFailureReason === 'UNKNOWN_FAILURE') {
      primaryFailureReason = 'DIRECTION_FAILURE';
      evidenceSummary.push('Immediate structural momentum failure; price moved directly into adverse excursion');
    }

    // H. Confidence Calibration Failure
    if (isOverconfident && primaryFailureReason === 'UNKNOWN_FAILURE') {
      primaryFailureReason = 'CONFIDENCE_CALIBRATION_FAILURE';
      evidenceSummary.push(`High model confidence tier (${(confidence * 100).toFixed(1)}%) unsupported by underlying market regime`);
    }

    if (evidenceSummary.length === 0) {
      evidenceSummary.push('Insufficient discrete anomalous indicators; classified as standard market variance');
    }

    return {
      predictionId: snapshot.predictionId,
      primaryFailureReason,
      secondaryFactors,
      evidenceSummary,
      confidenceBucket,
      isOverconfident,
      isUnderconfident,
      calibrationError,
      brierScore
    };
  }
}
