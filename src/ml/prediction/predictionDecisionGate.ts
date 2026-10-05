// ============================================================================
// PREDICTION DECISION GATE & SAFETY MODE ISOLATION (PHASE 14 & 18)
// ============================================================================

import { MultiFactorPredictionResult, PredictionMode } from './types';
import { CombinedPredictionEngine, PredictOptions } from './combinedPredictionEngine';
import { PredictionStorage } from './predictionStorage';

export interface GateEvaluationResponse {
  allowedToExecute: boolean;
  prediction: MultiFactorPredictionResult;
  mode: PredictionMode;
  reasons: string[];
  vetoReason?: string;
}

export class PredictionDecisionGate {
  private static currentMode: PredictionMode = 'SHADOW'; // Default safe mode: SHADOW observation mode
  private static liveUnlocked: boolean = false; // Only unlockable if validation criteria met

  /**
   * Returns current prediction mode
   */
  public static getMode(): PredictionMode {
    return this.currentMode;
  }

  /**
   * Sets prediction mode
   */
  public static setMode(mode: PredictionMode): void {
    if (mode === 'LIVE_GATED' && !this.liveUnlocked) {
      console.warn('Cannot switch to LIVE_GATED until validation acceptance thresholds are met. Maintaining SHADOW mode.');
      this.currentMode = 'SHADOW';
      return;
    }
    this.currentMode = mode;
  }

  /**
   * Unlocks live gating when out-of-sample criteria are verified
   */
  public static unlockLiveMode(approved: boolean): void {
    this.liveUnlocked = approved;
    if (!approved && this.currentMode === 'LIVE_GATED') {
      this.currentMode = 'SHADOW';
    }
  }

  /**
   * Evaluates a trade opportunity against the Prediction Engine and Safety Gate.
   * STRICT SEPARATION: In RESEARCH and SHADOW modes, allowedToExecute is ALWAYS false.
   */
  public static async evaluateTradeOpportunity(options: PredictOptions): Promise<GateEvaluationResponse> {
    // Generate prediction
    const prediction = await CombinedPredictionEngine.predict(options);

    // Persist prediction for auditing & subsequent outcome resolution
    await PredictionStorage.savePrediction(prediction);

    const reasons = [...prediction.reasons];

    // RESEARCH MODE: Never dispatches to broker
    if (this.currentMode === 'RESEARCH') {
      return {
        allowedToExecute: false,
        prediction,
        mode: 'RESEARCH',
        reasons,
        vetoReason: 'Execution disabled: Prediction engine operating in RESEARCH mode.'
      };
    }

    // SHADOW OBSERVATION MODE: Records predictions and monitors performance without placing orders
    if (this.currentMode === 'SHADOW') {
      return {
        allowedToExecute: false,
        prediction,
        mode: 'SHADOW',
        reasons,
        vetoReason: `Shadow mode active: Prediction logged (${prediction.recommendation}, confidence ${(prediction.calibratedConfidence * 100).toFixed(1)}%). No live order placed.`
      };
    }

    // LIVE_GATED MODE: Only permits execution if recommendation is strictly TRADE_BUY or TRADE_SELL
    if (prediction.recommendation === 'NO_TRADE') {
      return {
        allowedToExecute: false,
        prediction,
        mode: 'LIVE_GATED',
        reasons,
        vetoReason: prediction.vetoReasons[0] || 'Prediction engine recommended NO_TRADE.'
      };
    }

    if (prediction.recommendation === 'INSUFFICIENT_DATA') {
      return {
        allowedToExecute: false,
        prediction,
        mode: 'LIVE_GATED',
        reasons,
        vetoReason: 'Insufficient statistical data to support trade execution.'
      };
    }

    // Conflict check
    if (prediction.conflictScore > 0.45) {
      return {
        allowedToExecute: false,
        prediction,
        mode: 'LIVE_GATED',
        reasons,
        vetoReason: `Directional conflict too high (${(prediction.conflictScore * 100).toFixed(0)}%). Execution vetoed.`
      };
    }

    // Confidence threshold
    if (prediction.calibratedConfidence < 0.56) {
      return {
        allowedToExecute: false,
        prediction,
        mode: 'LIVE_GATED',
        reasons,
        vetoReason: `Confidence ${(prediction.calibratedConfidence * 100).toFixed(1)}% below required 56% threshold.`
      };
    }

    // Positive expected value
    if (prediction.expectedValue <= 0.5) {
      return {
        allowedToExecute: false,
        prediction,
        mode: 'LIVE_GATED',
        reasons,
        vetoReason: `Expected value +${prediction.expectedValue.toFixed(1)} pips is insufficient after execution costs.`
      };
    }

    return {
      allowedToExecute: true,
      prediction,
      mode: 'LIVE_GATED',
      reasons: [
        ...reasons,
        `Passed all prediction gates: ${prediction.recommendation} qualified with EV=+${prediction.expectedValue.toFixed(1)} pips.`
      ]
    };
  }
}
