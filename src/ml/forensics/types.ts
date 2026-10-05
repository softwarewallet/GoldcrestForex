// ============================================================================
// PREDICTION FORENSICS & ACCURACY INTELLIGENCE SYSTEM TYPES
// ============================================================================

export type ForensicDirection = 'BUY' | 'SELL' | 'FLAT' | 'NO_TRADE';

export type ForensicPredictionClass = 'STRONG_BUY' | 'MODERATE_BUY' | 'NEUTRAL' | 'MODERATE_SELL' | 'STRONG_SELL' | 'NO_TRADE';

export type ForensicOutcomeClass =
  | 'TP_FIRST'
  | 'SL_FIRST'
  | 'TIME_EXIT'
  | 'NO_ENTRY'
  | 'INVALIDATED'
  | 'PARTIAL_TARGET'
  | 'PENDING';

export type ForensicTradeClass =
  | 'CORRECT_PREDICTION_WIN'
  | 'CORRECT_PREDICTION_LOSS'
  | 'WRONG_PREDICTION_WIN'
  | 'WRONG_PREDICTION_LOSS'
  | 'NO_TRADE_OBSERVED'
  | 'PENDING';

export type ForensicFailureReason =
  | 'DIRECTION_FAILURE'
  | 'ENTRY_TIMING_FAILURE'
  | 'REGIME_FAILURE'
  | 'NEWS_FAILURE'
  | 'VOLATILITY_FAILURE'
  | 'LIQUIDITY_FAILURE'
  | 'MTF_CONFLICT_FAILURE'
  | 'SIGNAL_CONFLICT'
  | 'CONFIDENCE_CALIBRATION_FAILURE'
  | 'EXIT_FAILURE'
  | 'RISK_REWARD_FAILURE'
  | 'EXECUTION_FAILURE'
  | 'DATA_QUALITY_FAILURE'
  | 'UNKNOWN_FAILURE';

export type MarketRegimeType =
  | 'TREND_UP'
  | 'TREND_DOWN'
  | 'RANGE'
  | 'BREAKOUT'
  | 'POST_BREAKOUT'
  | 'MEAN_REVERSION'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'TRANSITION'
  | 'EVENT_DRIVEN';

export type SessionName = 'LONDON' | 'NEW_YORK' | 'TOKYO' | 'SYDNEY' | 'OVERLAP_LONDON_NY' | 'ASIAN_PACIFIC' | 'OFF_PEAK';

export interface ImmutablePredictionSnapshot {
  predictionId: string;
  timestamp: number;
  pair: string;
  timeframe: string;
  horizon: string;
  modelId: string;
  modelVersion: string;
  featureVersion: string;
  regimeVersion: string;
  newsEngineVersion: string;

  // Directional & Probabilistic outputs
  predictedDirection: ForensicDirection;
  predictionClass: ForensicPredictionClass;
  probabilityTargetBeforeStop: number; // P(TP_FIRST)
  probabilityStopBeforeTarget: number; // P(SL_FIRST)
  probabilityTimeExit: number;
  expectedR: number;
  confidenceTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  confidenceScore: number;
  predictionHorizonCandles: number;

  // Trade Setup parameters
  predictedEntry: number;
  predictedStopLoss: number;
  predictedTakeProfit: number;
  predictedRiskReward: number;
  predictedPositionSize: number;
  spreadAtPrediction: number;

  // Market & Microstructure state
  bid: number;
  ask: number;
  midPrice: number;
  atr: number;
  atrPips: number;
  volatility: number;
  marketRegime: MarketRegimeType;
  trendStrength: number;
  marketStructure: string;
  distToSupportPips: number;
  distToResistancePips: number;
  session: SessionName;

  // Signal & Sub-score Context
  deterministicSignal: string;
  deterministicScore: number;
  mlScore: number;
  tradeQualityScore: number;
  finalDecision: 'TRADE_BUY' | 'TRADE_SELL' | 'NO_TRADE' | 'INSUFFICIENT_DATA';

  // News State
  newsRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  highImpactNews: boolean;
  elevatedNews: boolean;
  newsSentiment: number;
  newsShockState: boolean;
  relevantNewsCount: number;

  // Explainability & Data Quality
  topContributingFeatures: string[];
  conflictingFactors: string[];
  quoteAgeMs: number;
  dataQuality: 'EXCELLENT' | 'GOOD' | 'DEGRADED';
  spreadQuality: 'TIGHT' | 'NORMAL' | 'EXPANDED';
  missingFeatureCount: number;
}

export interface PredictionFeatureSnapshot {
  predictionId: string;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  adx: number;
  diPlus: number;
  diMinus: number;
  bollingerUpper: number;
  bollingerLower: number;
  bollingerWidth: number;
  stochasticK: number;
  stochasticD: number;
  roc: number;
  vwapDistance: number;
  mtfAlignment: 'BULLISH' | 'BEARISH' | 'CONFLICTING' | 'NEUTRAL';
  mtfConflictScore: number;
}

export interface PredictionOutcomeRecord {
  predictionId: string;
  evaluatedAt: number;
  actualOutcome: ForensicOutcomeClass;
  tradeClassification: ForensicTradeClass;
  isDirectionCorrect: boolean;
  isTradeWon: boolean;
  entryReached: boolean;
  entryPriceActual?: number;
  exitPriceActual?: number;
  actualRealizedR: number;
  holdingDurationMinutes: number;
  maePips: number;
  mfePips: number;
  maeR: number;
  mfeR: number;
  closedBy: 'TARGET_HIT' | 'STOP_HIT' | 'TIME_EXPIRY' | 'AUTO_LIVE_EXIT' | 'MANUAL_OPERATOR' | 'UNRESOLVED';
}

export interface PredictionForensicAudit {
  predictionId: string;
  primaryFailureReason: ForensicFailureReason;
  secondaryFactors: string[];
  evidenceSummary: string[];
  confidenceBucket: '50-60%' | '60-70%' | '70-80%' | '80-90%' | '90-100%';
  isOverconfident: boolean;
  isUnderconfident: boolean;
  calibrationError: number;
  brierScore: number;
}

export interface FullForensicPredictionItem {
  snapshot: ImmutablePredictionSnapshot;
  features: PredictionFeatureSnapshot;
  outcome?: PredictionOutcomeRecord;
  forensics?: PredictionForensicAudit;
}

export interface DailyPredictionMetrics {
  date: string; // YYYY-MM-DD
  totalPredictions: number;
  completedPredictions: number;
  pendingPredictions: number;
  actionablePredictions: number;
  abstainedPredictions: number;
  correctPredictions: number;
  incorrectPredictions: number;
  accuracyPct: number;
  tpFirstCount: number;
  slFirstCount: number;
  timeExitCount: number;
  noEntryCount: number;
  avgConfidence: number;
  avgExpectedR: number;
  avgRealizedR: number;
  realizedProfitFactor: number;
  brierScore: number;
  calibrationError: number;
}

export interface PerformanceBreakdownGroup {
  groupKey: string;
  totalPredictions: number;
  completedCount: number;
  correctCount: number;
  accuracyPct: number;
  avgConfidencePct: number;
  avgExpectedR: number;
  avgRealizedR: number;
  profitFactor: number;
  tpFirstCount: number;
  slFirstCount: number;
  timeExitCount: number;
  warningFlag?: string;
}

export interface ConfidenceCalibrationBucket {
  bucketName: '50-60%' | '60-70%' | '70-80%' | '80-90%' | '90-100%';
  predictionsCount: number;
  avgPredictedProbability: number;
  actualSuccessRate: number;
  calibrationError: number;
  brierScore: number;
  avgRealizedR: number;
  profitFactor: number;
  status: 'CALIBRATED' | 'OVERCONFIDENT' | 'UNDERCONFIDENT' | 'INSUFFICIENT_SAMPLE';
}

export interface RollingDriftMetrics {
  windowSize: number;
  accuracyTrend: number[];
  realizedRTrend: number[];
  expectedRTrend: number[];
  confidenceTrend: number[];
  isDrifting: boolean;
  driftWarningMessage?: string;
}
