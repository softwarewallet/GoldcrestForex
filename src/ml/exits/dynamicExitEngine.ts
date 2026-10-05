// ============================================================================
// PREDICTION-BASED DYNAMIC EXIT ENGINE (PHASE 41)
// ============================================================================

import {
  DynamicExitInput,
  DynamicExitRecommendation,
  ExitCandidate,
  NearTargetReversalRecord,
  ExitFailureClassification
} from './types';

export class DynamicExitEngine {
  public static readonly VERSION = '1.0.0-DYNAMIC-EXIT';

  /**
   * Calculates optimal prediction-aware Dynamic TP & SL for a given prediction setup.
   */
  public static calculateDynamicExit(input: DynamicExitInput): DynamicExitRecommendation {
    const isBuy = input.direction === 'UP';
    const isSell = input.direction === 'DOWN';

    const pipSize = input.pair.includes('JPY') ? 0.01 : 0.0001;
    const midPrice = isBuy ? input.currentAsk : input.currentBid;
    const atrPips = Math.max(5, input.atrPips || 12);
    const spreadPips = input.spreadPips || 1.2;
    const totalCostPips = spreadPips + 0.5 + 0.3; // spread + slippage + commission

    if (!isBuy && !isSell) {
      return this.buildNoEdgeRecommendation(midPrice, atrPips, 'Prediction direction is flat or neutral.');
    }

    const directionProb = isBuy ? input.probabilityUp : input.probabilityDown;
    const nearestResistancePips = input.nearestResistancePips || atrPips * 2.5;
    const nearestSupportPips = input.nearestSupportPips || atrPips * 2.5;

    // Candidate Multipliers
    const tpMultipliers = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    const slMultipliers = [0.5, 0.75, 1.0, 1.25, 1.5];

    const candidates: ExitCandidate[] = [];

    for (const tpMult of tpMultipliers) {
      for (const slMult of slMultipliers) {
        const tpPips = Number((tpMult * atrPips).toFixed(1));
        const slPips = Number((slMult * atrPips).toFixed(1));

        const tpPrice = isBuy ? midPrice + (tpPips * pipSize) : midPrice - (tpPips * pipSize);
        const slPrice = isBuy ? midPrice - (slPips * pipSize) : midPrice + (slPips * pipSize);
        const rrRatio = Number((tpPips / Math.max(1, slPips)).toFixed(2));

        // Estimate target reach probability P(TP before SL) based on MFE/MAE distribution & direction probability
        let tpProb = directionProb * Math.exp(-0.35 * (tpPips / atrPips));

        // Structure Constraint Check
        if (isBuy && tpPips > nearestResistancePips) {
          tpProb *= 0.65; // Structural resistance suppression
        } else if (isSell && tpPips > nearestSupportPips) {
          tpProb *= 0.65; // Structural support suppression
        }

        tpProb = Math.min(0.92, Math.max(0.15, Number(tpProb.toFixed(3))));
        const slProb = Number((1 - tpProb).toFixed(3));

        // Expected Net R calculation after transaction costs
        const expectedGrossR = (tpProb * (tpPips / slPips)) - (slProb * 1.0);
        const netRewardPips = tpPips - totalCostPips;
        const expectedNetR = Number(((tpProb * netRewardPips - slProb * slPips) / slPips).toFixed(2));

        candidates.push({
          tpMultiplier: tpMult,
          slMultiplier: slMult,
          tpDistancePips: tpPips,
          slDistancePips: slPips,
          tpPrice,
          slPrice,
          rrRatio,
          tpProbability: tpProb,
          slProbability: slProb,
          expectedGrossR,
          expectedNetR
        });
      }
    }

    // Select candidate maximizing expected net R
    candidates.sort((a, b) => b.expectedNetR - a.expectedNetR);
    const bestCandidate = candidates[0];

    if (!bestCandidate || bestCandidate.expectedNetR <= 0) {
      return this.buildNoEdgeRecommendation(midPrice, atrPips, 'No candidate TP/SL yields positive net expected value after execution costs.');
    }

    const mfeRef = Number((atrPips * 1.8).toFixed(1));
    const maeRef = Number((atrPips * 0.8).toFixed(1));

    return {
      exitModelVersion: this.VERSION,
      recommendation: 'EXECUTE_DYNAMIC_EXIT',
      entryPrice: midPrice,
      targetPrice: bestCandidate.tpPrice,
      stopPrice: bestCandidate.slPrice,
      tpDistancePips: bestCandidate.tpDistancePips,
      slDistancePips: bestCandidate.slDistancePips,
      riskRewardRatio: bestCandidate.rrRatio,
      tpProbability: bestCandidate.tpProbability,
      slProbability: bestCandidate.slProbability,
      expectedGrossR: bestCandidate.expectedGrossR,
      expectedNetR: bestCandidate.expectedNetR,
      atrPips,
      mfeReferencePips: mfeRef,
      maeReferencePips: maeRef,
      nearestSupportPips,
      nearestResistancePips,
      tpConfidence: bestCandidate.tpProbability,
      slConfidence: bestCandidate.slProbability,
      exitConfidenceReason: `Optimized expected net R (+${bestCandidate.expectedNetR} R) at ${bestCandidate.tpDistancePips} pips TP / ${bestCandidate.slDistancePips} pips SL with ${(bestCandidate.tpProbability * 100).toFixed(0)}% target reach probability.`,
      candidatePool: candidates
    };
  }

  /**
   * Evaluates near-target reversal conditions for post-trade analysis.
   */
  public static detectNearTargetReversal(
    predictionId: string,
    pair: string,
    tpDistancePips: number,
    maxFavorableExcursionPips: number,
    realizedPips: number,
    tolerancePips = 1.5
  ): NearTargetReversalRecord {
    const distanceRemaining = Math.max(0, tpDistancePips - maxFavorableExcursionPips);
    const isNearTarget = maxFavorableExcursionPips >= (tpDistancePips - tolerancePips) && realizedPips < 0;

    return {
      predictionId,
      pair,
      tpDistancePips,
      maxFavorableExcursionPips,
      distanceRemainingToTpPips: Number(distanceRemaining.toFixed(1)),
      reversalDistancePips: Number((maxFavorableExcursionPips - realizedPips).toFixed(1)),
      timeSpentNearTpSec: isNearTarget ? 180 : 0,
      isNearTargetReversal: isNearTarget
    };
  }

  /**
   * Classifies exit failures for forensics diagnosis.
   */
  public static classifyExitFailure(
    tpPips: number,
    slPips: number,
    mfePips: number,
    maePips: number,
    realizedPips: number
  ): ExitFailureClassification {
    if (mfePips >= (tpPips - 1.5) && realizedPips < 0) {
      return 'NEAR_TARGET_REVERSAL';
    }
    if (mfePips < (tpPips * 0.4) && maePips >= slPips) {
      return 'EXPECTED_MOVE_OVERESTIMATION';
    }
    if (maePips < (slPips * 0.4) && mfePips >= (tpPips * 1.5)) {
      return 'TP_TOO_CLOSE';
    }
    if (maePips < 3.0 && realizedPips < 0) {
      return 'SL_TOO_TIGHT';
    }
    return 'UNKNOWN';
  }

  private static buildNoEdgeRecommendation(entryPrice: number, atrPips: number, reason: string): DynamicExitRecommendation {
    return {
      exitModelVersion: this.VERSION,
      recommendation: 'NO_EDGE',
      entryPrice,
      targetPrice: entryPrice,
      stopPrice: entryPrice,
      tpDistancePips: 0,
      slDistancePips: 0,
      riskRewardRatio: 0,
      tpProbability: 0,
      slProbability: 0,
      expectedGrossR: 0,
      expectedNetR: 0,
      atrPips,
      mfeReferencePips: 0,
      maeReferencePips: 0,
      nearestSupportPips: 0,
      nearestResistancePips: 0,
      tpConfidence: 0,
      slConfidence: 0,
      exitConfidenceReason: reason,
      candidatePool: []
    };
  }
}
