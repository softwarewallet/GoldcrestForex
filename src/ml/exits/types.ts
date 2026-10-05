// ============================================================================
// DYNAMIC EXIT ENGINE TYPES (PHASE 41)
// ============================================================================

import { PredictionDirection, PredictionHorizon } from '../prediction/types';

export type ExitFailureClassification =
  | 'TP_TOO_FAR'
  | 'TP_TOO_CLOSE'
  | 'SL_TOO_TIGHT'
  | 'SL_TOO_WIDE'
  | 'GOOD_TP_BAD_SL'
  | 'GOOD_SL_BAD_TP'
  | 'NEAR_TARGET_REVERSAL'
  | 'EXPECTED_MOVE_OVERESTIMATION'
  | 'EXPECTED_MOVE_UNDERESTIMATION'
  | 'STRUCTURE_MISREAD'
  | 'VOLATILITY_MISREAD'
  | 'NEWS_SHOCK'
  | 'EXECUTION_FAILURE'
  | 'UNKNOWN';

export interface DynamicExitInput {
  pair: string;
  direction: PredictionDirection;
  horizon: PredictionHorizon;
  currentBid: number;
  currentAsk: number;
  spreadPips: number;
  atrPips: number;
  probabilityUp: number;
  probabilityDown: number;
  confidence: number;
  nearestSupportPips?: number;
  nearestResistancePips?: number;
  regime?: string;
  newsRisk?: string;
}

export interface ExitCandidate {
  tpMultiplier: number;
  slMultiplier: number;
  tpDistancePips: number;
  slDistancePips: number;
  tpPrice: number;
  slPrice: number;
  rrRatio: number;
  tpProbability: number;
  slProbability: number;
  expectedGrossR: number;
  expectedNetR: number;
}

export interface DynamicExitRecommendation {
  exitModelVersion: string;
  recommendation: 'EXECUTE_DYNAMIC_EXIT' | 'NO_EDGE';
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  tpDistancePips: number;
  slDistancePips: number;
  riskRewardRatio: number;
  tpProbability: number;
  slProbability: number;
  expectedGrossR: number;
  expectedNetR: number;
  atrPips: number;
  mfeReferencePips: number;
  maeReferencePips: number;
  nearestSupportPips: number;
  nearestResistancePips: number;
  tpConfidence: number;
  slConfidence: number;
  exitConfidenceReason: string;
  candidatePool: ExitCandidate[];
}

export interface NearTargetReversalRecord {
  predictionId: string;
  pair: string;
  tpDistancePips: number;
  maxFavorableExcursionPips: number;
  distanceRemainingToTpPips: number;
  reversalDistancePips: number;
  timeSpentNearTpSec: number;
  isNearTargetReversal: boolean;
}

export interface ExitComparisonAB {
  predictionId: string;
  pair: string;
  currentTpPips: number;
  currentSlPips: number;
  currentExpectedNetR: number;
  dynamicTpPips: number;
  dynamicSlPips: number;
  dynamicExpectedNetR: number;
  realizedRCurrent?: number;
  realizedRDynamic?: number;
  winner: 'DYNAMIC' | 'CURRENT' | 'DRAW';
}
