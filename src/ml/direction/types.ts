// ============================================================================
// QUANTITATIVE DIRECTION ENGINE TYPES (PHASES 2-30)
// ============================================================================

export type DirectionType = 'BUY' | 'SELL' | 'NEUTRAL' | 'NO_EDGE' | 'CONFLICT';

export type ComponentStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'STALE' | 'LOW_QUALITY';

export type MarketRegimeType =
  | 'TREND_UP'
  | 'TREND_DOWN'
  | 'RANGE'
  | 'TRANSITION'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'NEWS_SHOCK';

export interface ComponentDirectionResult {
  componentName: string;
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  score: number; // -1.0 to +1.0
  strength: number; // 0.0 to 1.0
  confidence: number; // 0.0 to 1.0
  dataQuality: ComponentStatus;
  timestamp: number;
  featureVersion: string;
  explanation: string;
  metadata?: Record<string, any>;
}

export interface MACDResult {
  macdLine: number;
  signalLine: number;
  histogram: number;
  histogramSlope: number;
  zeroLinePosition: 'ABOVE' | 'BELOW';
  crossoverState: 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'NONE';
  distance: number;
  score: number;
}

export interface ADXResult {
  adx: number;
  diPlus: number;
  diMinus: number;
  diSpread: number;
  adxSlope: number;
  regime: 'LOW_TREND' | 'MODERATE_TREND' | 'STRONG_TREND';
  score: number;
}

export interface TrendVelocityResult {
  return1: number;
  return3: number;
  return5: number;
  return15: number;
  return30: number;
  normalizedSlope: number;
  acceleration: number;
  velocityScore: number;
  persistenceScore: number;
}

export interface EMAStructureResult {
  ema9: number;
  ema21: number;
  ema50: number;
  ema100: number;
  ema200: number;
  structureScore: number; // -1 to +1
  alignment: 'BULLISH_CASCADE' | 'BEARISH_CASCADE' | 'MIXED';
}

export interface VWAPResult {
  vwap: number;
  distancePips: number;
  normalizedDistanceATR: number;
  slope: number;
  status: ComponentStatus;
  score: number;
}

export interface OrderBookImbalanceResult {
  bidDepth: number;
  askDepth: number;
  obi: number; // -1 to +1
  status: ComponentStatus;
  score: number;
}

export interface MacroDifferentialResult {
  baseCurrency: string;
  quoteCurrency: string;
  baseRate: number;
  quoteRate: number;
  rateDifferential: number; // baseRate - quoteRate
  rateDifferentialChange: number;
  status: ComponentStatus;
  score: number;
}

export interface MTFMatrixResult {
  timeframes: Record<string, { direction: 'UP' | 'DOWN' | 'NEUTRAL'; score: number; adx: number }>;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  agreementRatio: number;
  conflictRatio: number;
  score: number;
}

export interface QuantitativePredictionResult {
  predictionId: string;
  timestamp: number;
  pair: string;
  horizon: string;
  finalDirection: DirectionType;
  probabilityUp: number;
  probabilityDown: number;
  probabilityNeutral: number;
  probabilityTPBeforeSL: number;
  probabilitySLBeforeTP: number;
  expectedR: number;
  confidence: number;
  conflictRatio: number;
  signalAgreement: number;
  marketRegime: MarketRegimeType;
  components: Record<string, ComponentDirectionResult>;
  costAdjustedSpreadPips: number;
  explanation: string;
  championVsChallenger?: {
    championDirection: string;
    championProbability: number;
    challengerDirection: string;
    challengerProbability: number;
    agreement: boolean;
  };
}
