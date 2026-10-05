// ============================================================================
// PREDICTION & EVIDENCE PIPELINE TYPES (PHASE 1 - 20)
// ============================================================================

export type PredictionDirection = 'UP' | 'DOWN' | 'FLAT' | 'INSUFFICIENT_DATA';
export type TradeRecommendation = 'TRADE_BUY' | 'TRADE_SELL' | 'NO_TRADE' | 'INSUFFICIENT_DATA';
export type PredictionHorizon = '5M' | '15M' | '1H' | '4H' | '1D';
export type PredictionMode = 'RESEARCH' | 'SHADOW' | 'LIVE_GATED';

export interface NewsIntelligence {
  pair: string;
  timestamp: number;
  relevantArticles: number;
  baseCurrencySentiment: number;    // -1 (strongly bearish) to +1 (strongly bullish)
  quoteCurrencySentiment: number;   // -1 to +1
  relativeSentiment: number;        // normalized base - quote: -1 (bearish pair) to +1 (bullish pair)
  sentimentStrength: number;        // 0 to 1
  marketImpactScore: number;        // 0 to 1 (macroeconomic / central bank / high-impact)
  freshnessScore: number;           // 0 to 1 (decay over time)
  sourceQualityScore: number;       // 0 to 1
  conflictScore: number;            // 0 to 1 (conflict with technical direction)
  eventRiskScore: number;           // 0 to 1 (upcoming/recent central bank, inflation, NFP)
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  dominantHeadlines: string[];
}

export interface TechnicalEvidence {
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  atr: number;
  atrPips: number;
  trend: 'bullish' | 'bearish' | 'neutral' | 'ranging';
  momentum: 'bullish' | 'bearish' | 'neutral';
  regime: 'TRENDING_BULLISH' | 'TRENDING_BEARISH' | 'RANGING' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' | 'BREAKOUT' | 'REVERSAL';
  distToSupportPips: number;
  distToResistancePips: number;
  returns1: number;
  returns5: number;
  returns15: number;
  emaSpread: number;
  multiTimeframeAlignment: 'BULLISH' | 'BEARISH' | 'CONFLICTING' | 'NEUTRAL';
}

export interface HistoricalAnalogRecord {
  timestamp: number;
  similarity: number;
  actualReturnPct: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  maePct: number;
  mfePct: number;
  holdingMinutes: number;
}

export interface HistoricalAnalogEvidence {
  sampleSize: number;
  minRequiredSample: number;
  isSampleSufficient: boolean;
  historicalUpProbability: number;
  historicalDownProbability: number;
  historicalFlatProbability: number;
  averageReturnPct: number;
  medianReturnPct: number;
  maxDrawdownPct: number;
  maxFavorableExcursionPct: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  confidence: number;
  topAnalogs: HistoricalAnalogRecord[];
}

export interface RollingStrategyPerformance {
  pair: string;
  direction: 'BUY' | 'SELL';
  tradesCount: number;
  winRate: number;
  profitFactor: number;
  consecutiveLosses: number;
  penaltyMultiplier: number; // 1.0 = normal, < 1.0 = penalized due to recent losses, 0.0 = vetoed
  isPenalized: boolean;
  reason?: string;
}

export interface MultiFactorPredictionResult {
  predictionId: string;
  timestamp: number;
  pair: string;
  horizon: PredictionHorizon;
  direction: PredictionDirection;
  probabilityUp: number;
  probabilityDown: number;
  probabilityFlat: number;
  calibratedConfidence: number;
  sampleSize: number;
  expectedReturn: number;
  expectedRisk: number;
  expectedValue: number;
  regime: string;
  technicalScore: number;
  newsScore: number;
  historicalScore: number;
  conflictScore: number;
  recommendation: TradeRecommendation;
  reasons: string[];
  vetoReasons: string[];
  evidence: {
    news: NewsIntelligence;
    technical: TechnicalEvidence;
    historical: HistoricalAnalogEvidence;
    rollingPerformance: RollingStrategyPerformance;
    quantDirection?: any;
    nativeIndicators?: any;
  };
  targetPrice?: number;
  stopPrice?: number;
}

export interface HistoricalTradeRecord {
  id: string;
  broker: string;
  pair: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice?: number;
  entryTimestamp: number;
  exitTimestamp?: number;
  realizedPnl: number;
  holdingDurationMs?: number;
  stopLoss?: number;
  takeProfit?: number;
  marketRegime?: string;
  isWin: boolean;
}
