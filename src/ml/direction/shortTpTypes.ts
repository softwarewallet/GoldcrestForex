// ============================================================================
// SHORT-TERM TP OPTIMIZATION TYPES & CONSTANTS (PHASE 44)
// Client-safe types and schemas for research, validation & UI
// ============================================================================

export const SHORT_TP_ENGINE_VERSION = '1.0.0';
export const SHORT_TP_RESEARCH_VERSION = 'PHASE44_V1';
export const SHORT_TP_CANDIDATES = [1.0, 2.0, 3.0, 4.0, 5.0] as const;
export const HARD_MAX_SHORT_TP_PIPS = 5.0;

export type ShortTPCandidateValue = (typeof SHORT_TP_CANDIDATES)[number];

export interface ShortTPEvaluationInput {
  predictionId?: string;
  pair: string;
  direction: 'BUY' | 'SELL' | 'UP' | 'DOWN';
  entryPrice: number;
  riskBoundaryPips?: number;
  probabilityUp?: number;
  probabilityDown?: number;
  confidence?: number;
  atrPips?: number;
  volatility?: number;
  spreadPips?: number;
  regime?: string;
  session?: string;
  mtfAlignment?: 'ALIGNED' | 'MIXED' | 'CONFLICT';
  newsRisk?: string;
  holdingDurationMinutesEstimate?: number;
}

export interface ShortTPCandidateMetric {
  tpPips: number;
  tpPrice: number;
  grossRewardPips: number;
  netRewardPips: number;
  spreadPips: number;
  estimatedSlippagePips: number;
  commissionPips: number;
  targetHitProbability: number;
  stopProbability: number;
  timeoutProbability: number;
  expectedGrossR: number;
  expectedNetR: number;
  expectedNetPips: number;
  profitFactor: number;
  winRate: number;
  averageHoldingTimeMinutes: number;
  nearTargetReversalRate: number;
  sampleCount: number;
  dataStatus: 'MEASURED' | 'ESTIMATED' | 'INSUFFICIENT_DATA';
  confidenceInterval95: [number, number];
}

export interface NearTargetReversalSummary {
  testedTP: number;
  reversals90PctCount: number;
  reversals80PctCount: number;
  reversals70PctCount: number;
  reversalRate: number;
  rescuedByShorterTP: Record<number, number>; // e.g. how many times TP=1, 2, 3, or 4 rescued profit before reversal
}

export interface ShortTPDecision {
  selectedTPPips: number | null;
  targetPrice: number | null;
  candidateMetrics: Record<number, ShortTPCandidateMetric>;
  expectedNetR: number;
  expectedNetPips: number;
  targetHitProbability: number;
  stopProbability: number;
  timeoutProbability: number;
  confidence: number;
  reason: string;
  decision: 'SHORT_TP_QUALIFIED' | 'NO_TRADE';
  nearTargetReversals: Record<number, NearTargetReversalSummary>;
  modelVersion: string;
  researchVersion: string;
  dataSufficiency: 'DATA_SUFFICIENT' | 'INSUFFICIENT_DATA';
}

export interface BreakdownBucketMetrics {
  bucket: string;
  count: number;
  bestCandidatePips: number;
  avgNetR: number;
  winRate: number;
  reversalRate: number;
}

export interface ShortTPResearchResults {
  researchVersion: string;
  modelVersion: string;
  generatedAt: number;
  dataSources: string[];
  totalObservations: number;
  actionableObservations: number;
  dateRange: { start: number; end: number };
  costAssumptions: {
    averageSpreadPips: number;
    slippagePips: number;
    commissionPips: number;
    totalFrictionPips: number;
  };
  riskBoundaryPips: number;
  candidatesSummary: Record<number, ShortTPCandidateMetric>;
  optimizedPolicySummary: {
    avgNetR: number;
    profitFactor: number;
    winRate: number;
    avgHoldingTimeMin: number;
    maxDrawdownPct: number;
    expectancyPips: number;
  };
  existingWideTPSummary: {
    avgNetR: number;
    profitFactor: number;
    winRate: number;
    avgHoldingTimeMin: number;
    maxDrawdownPct: number;
    nearTargetReversalCount: number;
  };
  nearTargetReversalFindings: {
    totalWideReversalsDetected: number;
    percentSavedByShorterTP: number;
    netPipsPreserved: number;
  };
  breakdowns: {
    byPair: BreakdownBucketMetrics[];
    byDirection: BreakdownBucketMetrics[];
    bySession: BreakdownBucketMetrics[];
    byRegime: BreakdownBucketMetrics[];
    byConfidence: BreakdownBucketMetrics[];
  };
  riskBoundarySensitivity: Array<{
    riskBoundaryPips: number;
    bestCandidatePips: number;
    avgNetR: number;
    winRate: number;
    profitFactor: number;
  }>;
  probabilityCurves: {
    buy: Record<number, number>;
    sell: Record<number, number>;
  };
  walkForwardResults: {
    folds: number;
    trainScoreNetR: number;
    validationScoreNetR: number;
    outOfSampleScoreNetR: number;
    overfittingDegradationPct: number;
    isRobust: boolean;
  };
  statisticalSignificance: {
    pValueVsWideTP: number;
    pValueVsFixed5Pip: number;
    confidenceInterval95NetR: [number, number];
    verdict: 'SUPERIOR' | 'PROMISING' | 'INCONCLUSIVE' | 'INFERIOR';
  };
  productionGatesPassed: boolean;
  recommendation: string;
}
