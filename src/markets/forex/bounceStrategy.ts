import { Candle } from '../common/types';
import { calculateEMA, calculateATR } from './indicators';
import { findSwingPoints } from './marketStructure';
import { calculateSupportResistance } from './supportResistance';
import { AdvancedQuantitativePredictiveEngine } from './advancedPredictiveEngine';

export interface RejectionCandleDetail {
  hasRejection: boolean;
  type: 'BULLISH_REJECTION' | 'BEARISH_REJECTION' | 'NONE';
  wickRatio: number;
  wickPips: number;
  bodyPips: number;
  rangePips: number;
  candleIndex: number;
  candleHigh: number;
  candleLow: number;
  candleOpen: number;
  candleClose: number;
  touchedZone: boolean;
  summary: string;
}

export type BounceSetupState =
  | 'READY_TO_ENTER'        // 5M candle touched zone and closed with strong rejection wick -> enter next candle open
  | 'TESTING_ZONE'          // Price currently testing the support/resistance level, waiting for rejection candle close
  | 'WAITING_FOR_PULLBACK'  // Trend established above/below 50 EMA, but price hasn't retraced to key level yet
  | 'NO_TRADE';             // Price chopping around 50 EMA or no clear trend/level

export interface ThreeStepRiskSettings {
  stopLossEnabled: boolean;
  stopLossPips: number; // 6 to 8 pips (default 7)
  takeProfitEnabled: boolean;
  takeProfitPips: number; // 10 to 12 pips (default 11)
  freeTradeEnabled: boolean;
  freeTradeLockPips: number; // 6 pips
  confidenceThresholdEnabled: boolean;
  confidenceThreshold: number; // 75
  // Predictive Engine Mandates
  macroAlignmentFilterEnabled: boolean; // Strictly forbid BUY if 1H Bearish, SELL if 1H Bullish
  volatilityScalingEnabled: boolean;     // Dynamic SL = 1.2x 5M ATR, TP = 2x SL (1:2 R:R)
  sessionRiskFilterEnabled: boolean;     // Safety penalty in GAP or TOKYO keeping confidence below 0.88 gate
}

export function getStoredThreeStepRiskSettings(): ThreeStepRiskSettings {
  const defaults: ThreeStepRiskSettings = {
    stopLossEnabled: true,
    stopLossPips: 7,
    takeProfitEnabled: true,
    takeProfitPips: 11,
    freeTradeEnabled: true,
    freeTradeLockPips: 6,
    confidenceThresholdEnabled: true,
    confidenceThreshold: 75,
    macroAlignmentFilterEnabled: true,
    volatilityScalingEnabled: true,
    sessionRiskFilterEnabled: true
  };
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = localStorage.getItem('goldcrest_3step_risk_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...defaults, ...parsed };
      }
    }
  } catch {}
  return defaults;
}

export interface BounceStrategyEvaluation {
  // Step 1: Trend Identification
  trendDirection: 'BUY' | 'SELL' | 'NEUTRAL';
  ema50: number;
  currentPrice: number;
  priceVsEma50Pips: number;
  isTrendConfirmed: boolean;
  trendReason: string;

  // Step 2: Spot the Zone (The Bounce)
  keyLevelType: 'SUPPORT' | 'RESISTANCE' | 'NONE';
  keyLevelPrice: number;
  distanceToLevelPips: number;
  isAtOrNearZone: boolean;
  zoneReason: string;
  allSupportLevels: number[];
  allResistanceLevels: number[];

  // Step 3: The Entry Trigger (5M Rejection Wick Confirmation)
  rejection: RejectionCandleDetail;
  setupState: BounceSetupState;
  triggerReason: string;

  // Execution Trade Plan
  entryPreferred: number;
  entryMin: number;
  entryMax: number;
  stopLoss: number;
  stopLossReason: string;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskReward: number;
  riskPips: number;
  rewardPips: number;

  // Confidence & Quality Score (0-100)
  strategyScore: number;
  stepsPassed: {
    step1Trend: boolean;
    step2Zone: boolean;
    step3Trigger: boolean;
  };

  // Advanced Quantitative Predictive Engine Extensions
  macroStructure?: {
    timeframe_1H_trend: 'BULLISH' | 'BEARISH' | 'CHOPPY';
    key_1H_liquidity_pools: Array<{ price: number; type: string; label: string; distancePips: number }>;
  };
  marketVelocity?: {
    atr_5M: number;
    atr_5M_pips: number;
    current_session: 'LONDON' | 'NEW_YORK' | 'TOKYO' | 'GAP';
  };
  mandates?: {
    macroAlignmentStatus: string;
    volatilityScaling: {
      dynamic_stop_loss_pips: number;
      dynamic_take_profit_pips: number;
      riskRewardRatio: number;
    };
    sessionRisk: {
      session: string;
      penaltyApplied: boolean;
      executionGateMet: boolean;
    };
  };
}

/**
 * Analyzes a single 5-minute candle to determine if it touched a key level
 * and closed leaving an institutional rejection wick.
 */
export function analyzeRejectionWick(
  candle: Candle,
  keyLevel: number,
  isBuy: boolean,
  pipSize: number,
  candleIndex: number
): RejectionCandleDetail {
  const range = candle.high - candle.low;
  if (range <= 0) {
    return {
      hasRejection: false,
      type: 'NONE',
      wickRatio: 0,
      wickPips: 0,
      bodyPips: 0,
      rangePips: 0,
      candleIndex,
      candleHigh: candle.high,
      candleLow: candle.low,
      candleOpen: candle.open,
      candleClose: candle.close,
      touchedZone: false,
      summary: 'Zero range candle'
    };
  }

  const rangePips = range / pipSize;
  const body = Math.abs(candle.close - candle.open);
  const bodyPips = body / pipSize;

  // Tolerance around the level (typically 4-6 pips or 0.25 ATR)
  const zoneTolerance = Math.max(3 * pipSize, range * 0.25);

  if (isBuy) {
    // For Buy: Candle low should touch or probe the Support level
    const touchedSupport = candle.low <= keyLevel + zoneTolerance && candle.high >= keyLevel - zoneTolerance;
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const lowerWickPips = lowerWick / pipSize;
    const wickRatio = body > 0 ? lowerWick / body : lowerWick / (range * 0.1);

    // Bullish Rejection Requirements:
    // 1. Lower wick is at least 1.25x the body OR at least 38% of total candle range
    // 2. Candle closes in the upper half of its range: (close - low) / range >= 0.48
    // 3. Candle closed back above or near the support level
    const isWickProminent = (lowerWick >= 1.25 * body || lowerWick >= 0.38 * range) && lowerWickPips >= 2.0;
    const closedInUpperHalf = (candle.close - candle.low) / range >= 0.48;
    const closedAboveSupport = candle.close >= keyLevel - (1.5 * pipSize);

    const hasRejection = touchedSupport && isWickProminent && closedInUpperHalf && closedAboveSupport;

    return {
      hasRejection,
      type: hasRejection ? 'BULLISH_REJECTION' : 'NONE',
      wickRatio: Number(wickRatio.toFixed(2)),
      wickPips: Number(lowerWickPips.toFixed(1)),
      bodyPips: Number(bodyPips.toFixed(1)),
      rangePips: Number(rangePips.toFixed(1)),
      candleIndex,
      candleHigh: candle.high,
      candleLow: candle.low,
      candleOpen: candle.open,
      candleClose: candle.close,
      touchedZone: touchedSupport,
      summary: hasRejection
        ? `Bullish rejection: ${lowerWickPips.toFixed(1)} pip lower wick (${wickRatio.toFixed(1)}x body) bounced off Support at ${keyLevel.toFixed(5)}.`
        : touchedSupport
          ? `Candle touched Support at ${keyLevel.toFixed(5)} but rejection wick was insufficient (wick: ${lowerWickPips.toFixed(1)}p, body: ${bodyPips.toFixed(1)}p).`
          : `Candle did not touch Support zone at ${keyLevel.toFixed(5)}.`
    };
  } else {
    // For Sell: Candle high should touch or probe the Resistance level
    const touchedResistance = candle.high >= keyLevel - zoneTolerance && candle.low <= keyLevel + zoneTolerance;
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const upperWickPips = upperWick / pipSize;
    const wickRatio = body > 0 ? upperWick / body : upperWick / (range * 0.1);

    // Bearish Rejection Requirements:
    // 1. Upper wick is at least 1.25x the body OR at least 38% of total candle range
    // 2. Candle closes in the lower half of its range: (high - close) / range >= 0.48
    // 3. Candle closed back below or near the resistance level
    const isWickProminent = (upperWick >= 1.25 * body || upperWick >= 0.38 * range) && upperWickPips >= 2.0;
    const closedInLowerHalf = (candle.high - candle.close) / range >= 0.48;
    const closedBelowResistance = candle.close <= keyLevel + (1.5 * pipSize);

    const hasRejection = touchedResistance && isWickProminent && closedInLowerHalf && closedBelowResistance;

    return {
      hasRejection,
      type: hasRejection ? 'BEARISH_REJECTION' : 'NONE',
      wickRatio: Number(wickRatio.toFixed(2)),
      wickPips: Number(upperWickPips.toFixed(1)),
      bodyPips: Number(bodyPips.toFixed(1)),
      rangePips: Number(rangePips.toFixed(1)),
      candleIndex,
      candleHigh: candle.high,
      candleLow: candle.low,
      candleOpen: candle.open,
      candleClose: candle.close,
      touchedZone: touchedResistance,
      summary: hasRejection
        ? `Bearish rejection: ${upperWickPips.toFixed(1)} pip upper wick (${wickRatio.toFixed(1)}x body) rejected Resistance at ${keyLevel.toFixed(5)}.`
        : touchedResistance
          ? `Candle touched Resistance at ${keyLevel.toFixed(5)} but rejection wick was insufficient (wick: ${upperWickPips.toFixed(1)}p, body: ${bodyPips.toFixed(1)}p).`
          : `Candle did not touch Resistance zone at ${keyLevel.toFixed(5)}.`
    };
  }
}

/**
 * Executes the complete 3-Step Strategy:
 * 1. Trend: 5M 50 EMA (Price > 50 EMA = Buy only; Price < 50 EMA = Sell only)
 * 2. Zone: Wait for pullback to recent Support (Buy) or Resistance (Sell)
 * 3. Trigger: 5M candle touch & long rejection wick close -> enter on next candle open
 */
export function evaluate5mBounceStrategy(params: {
  candles5m: Candle[];
  candles15m?: Candle[];
  candles1h?: Candle[];
  pipSize: number;
  currentPrice: number;
}): BounceStrategyEvaluation {
  const { candles5m, candles15m, candles1h, pipSize, currentPrice } = params;

  if (!candles5m || candles5m.length < 52) {
    return createEmptyEvaluation(currentPrice, 'Insufficient 5-minute candle history (minimum 52 bars required for 50 EMA).');
  }

  const closes5m = candles5m.map(c => c.close);
  const ema50Series = calculateEMA(closes5m, 50);
  const lastIndex = candles5m.length - 1;
  const ema50Raw = ema50Series[lastIndex];

  if (ema50Raw === null) {
    return createEmptyEvaluation(currentPrice, 'Could not calculate 50 EMA on 5-minute chart.');
  }

  const ema50 = Number(ema50Raw.toFixed(5));
  const priceDiffPips = (currentPrice - ema50) / pipSize;
  const atrSeries = calculateATR(candles5m, 14);
  const atr5m = atrSeries[lastIndex] || (currentPrice * 0.001);
  const atrPips = Math.max(5, Math.round(atr5m / pipSize));

  // ---------------------------------------------------------------------------
  // STEP 0: ADVANCED QUANTITATIVE PREDICTIVE ENGINE EXTENSIONS & MANDATE 1
  // ---------------------------------------------------------------------------
  const riskSettings = getStoredThreeStepRiskSettings();
  const macroStructure = AdvancedQuantitativePredictiveEngine.computeMacroStructure(
    candles1h || [],
    currentPrice,
    pipSize
  );
  const marketVelocity = AdvancedQuantitativePredictiveEngine.computeMarketVelocity(
    candles5m,
    pipSize
  );

  // ---------------------------------------------------------------------------
  // STEP 1: IDENTIFY THE TREND (50 EMA on 5-Minute Chart + 1H MACRO MANDATE)
  // ---------------------------------------------------------------------------
  // • Before checking 5M EMA, verify 1H macro trend.
  // • Strictly FORBIDDEN from issuing BUY if 1H trend is BEARISH.
  // • Strictly FORBIDDEN from issuing SELL if 1H trend is BULLISH.
  // • If macro trend is CHOPPY, scale down confidence instantly.
  let trendDirection: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  let isTrendConfirmed = false;
  let trendReason = '';

  if (priceDiffPips >= 1.0) {
    if (riskSettings.macroAlignmentFilterEnabled && macroStructure.timeframe_1H_trend === 'BEARISH') {
      trendDirection = 'NEUTRAL';
      isTrendConfirmed = false;
      trendReason = `FORBIDDEN by Macro Alignment Filter: Price is above 5M 50 EMA, but 1H macro trend is BEARISH. BUY orders strictly prohibited.`;
    } else if (macroStructure.timeframe_1H_trend === 'BULLISH') {
      trendDirection = 'BUY';
      isTrendConfirmed = true;
      trendReason = `Macro Aligned: 1H trend is BULLISH & price (${currentPrice.toFixed(5)}) is ${priceDiffPips.toFixed(1)}p above 5M 50 EMA (${ema50.toFixed(5)}). Permitting BUY opportunities only.`;
    } else {
      trendDirection = 'BUY';
      isTrendConfirmed = true;
      trendReason = `Price is ${priceDiffPips.toFixed(1)}p above 5M 50 EMA (${ema50.toFixed(5)}). Permitting BUY opportunities (1H Macro: ${macroStructure.timeframe_1H_trend}).`;
    }
  } else if (priceDiffPips <= -1.0) {
    if (riskSettings.macroAlignmentFilterEnabled && macroStructure.timeframe_1H_trend === 'BULLISH') {
      trendDirection = 'NEUTRAL';
      isTrendConfirmed = false;
      trendReason = `FORBIDDEN by Macro Alignment Filter: Price is below 5M 50 EMA, but 1H macro trend is BULLISH. SELL orders strictly prohibited.`;
    } else if (macroStructure.timeframe_1H_trend === 'BEARISH') {
      trendDirection = 'SELL';
      isTrendConfirmed = true;
      trendReason = `Macro Aligned: 1H trend is BEARISH & price (${currentPrice.toFixed(5)}) is ${Math.abs(priceDiffPips).toFixed(1)}p below 5M 50 EMA (${ema50.toFixed(5)}). Permitting SELL opportunities only.`;
    } else {
      trendDirection = 'SELL';
      isTrendConfirmed = true;
      trendReason = `Price is ${Math.abs(priceDiffPips).toFixed(1)}p below 5M 50 EMA (${ema50.toFixed(5)}). Permitting SELL opportunities (1H Macro: ${macroStructure.timeframe_1H_trend}).`;
    }
  } else {
    trendDirection = 'NEUTRAL';
    isTrendConfirmed = false;
    trendReason = `Price is oscillating directly on the 5M 50 EMA (${ema50.toFixed(5)}). Market is in neutral transition / chop.`;
  }

  // ---------------------------------------------------------------------------
  // STEP 2: SPOT THE ZONE (THE "BOUNCE" LEVEL)
  // ---------------------------------------------------------------------------
  // • For BUY: Find recent Support level (floor where price previously bounced up)
  // • For SELL: Find recent Resistance level (ceiling where price previously dropped)
  const swings5m = findSwingPoints(candles5m, 2);
  const sr5m = calculateSupportResistance(candles5m, pipSize);
  const sr15m = candles15m && candles15m.length > 20
    ? calculateSupportResistance(candles15m, pipSize)
    : null;

  const allSupportLevels: number[] = [];
  const allResistanceLevels: number[] = [];

  // Collect swing points and clustered levels
  swings5m.lows.forEach(l => allSupportLevels.push(l.price));
  sr5m.localSupport.forEach(s => allSupportLevels.push(s.price));
  if (sr15m) sr15m.localSupport.forEach(s => allSupportLevels.push(s.price));

  swings5m.highs.forEach(h => allResistanceLevels.push(h.price));
  sr5m.localResistance.forEach(r => allResistanceLevels.push(r.price));
  if (sr15m) sr15m.localResistance.forEach(r => allResistanceLevels.push(r.price));

  let keyLevelPrice = 0;
  let keyLevelType: 'SUPPORT' | 'RESISTANCE' | 'NONE' = 'NONE';
  let distanceToLevelPips = 999;
  let zoneReason = '';

  // Allowed pullback tolerance window
  const zoneTolerancePips = Math.max(5, Math.min(15, atrPips * 0.8));

  if (trendDirection === 'BUY') {
    keyLevelType = 'SUPPORT';
    // Find highest support level that is at or below current price (or slightly above if candle dipped)
    // Preference: recent swing floor or support clustered near current price / 50 EMA
    const candidateSupports = allSupportLevels
      .filter(p => p <= currentPrice + (4 * pipSize))
      .sort((a, b) => b - a); // closest to current price first

    if (candidateSupports.length > 0) {
      keyLevelPrice = candidateSupports[0];
    } else if (sr5m.nearestSupport) {
      keyLevelPrice = sr5m.nearestSupport.price;
    } else {
      // Fallback: 50 EMA itself as dynamic floor support
      keyLevelPrice = ema50;
    }

    distanceToLevelPips = Number(((currentPrice - keyLevelPrice) / pipSize).toFixed(1));
    if (distanceToLevelPips <= zoneTolerancePips && distanceToLevelPips >= -3.0) {
      zoneReason = `Price pulled back to Support floor at ${keyLevelPrice.toFixed(5)} (distance: ${distanceToLevelPips} pips). Zone in play.`;
    } else if (distanceToLevelPips > zoneTolerancePips) {
      zoneReason = `Waiting for pullback down to Support floor at ${keyLevelPrice.toFixed(5)} (currently ${distanceToLevelPips} pips away; tolerance ${zoneTolerancePips}p).`;
    } else {
      zoneReason = `Price has broken through Support floor at ${keyLevelPrice.toFixed(5)} by ${Math.abs(distanceToLevelPips)} pips.`;
    }
  } else if (trendDirection === 'SELL') {
    keyLevelType = 'RESISTANCE';
    const candidateResistances = allResistanceLevels
      .filter(p => p >= currentPrice - (4 * pipSize))
      .sort((a, b) => a - b); // closest to current price first

    if (candidateResistances.length > 0) {
      keyLevelPrice = candidateResistances[0];
    } else if (sr5m.nearestResistance) {
      keyLevelPrice = sr5m.nearestResistance.price;
    } else {
      // Fallback: 50 EMA itself as dynamic ceiling resistance
      keyLevelPrice = ema50;
    }

    distanceToLevelPips = Number(((keyLevelPrice - currentPrice) / pipSize).toFixed(1));
    if (distanceToLevelPips <= zoneTolerancePips && distanceToLevelPips >= -3.0) {
      zoneReason = `Price pulled back up to Resistance ceiling at ${keyLevelPrice.toFixed(5)} (distance: ${distanceToLevelPips} pips). Zone in play.`;
    } else if (distanceToLevelPips > zoneTolerancePips) {
      zoneReason = `Waiting for pullback up to Resistance ceiling at ${keyLevelPrice.toFixed(5)} (currently ${distanceToLevelPips} pips away; tolerance ${zoneTolerancePips}p).`;
    } else {
      zoneReason = `Price has broken through Resistance ceiling at ${keyLevelPrice.toFixed(5)} by ${Math.abs(distanceToLevelPips)} pips.`;
    }
  } else {
    zoneReason = 'No directional zone active due to neutral 50 EMA trend.';
  }

  const isAtOrNearZone = distanceToLevelPips <= zoneTolerancePips && distanceToLevelPips >= -3.0;

  // ---------------------------------------------------------------------------
  // STEP 3: THE ENTRY TRIGGER (5M Rejection Wick Confirmation)
  // ---------------------------------------------------------------------------
  // Check the last 1 to 3 completed 5M candles for rejection wick confirmation
  let bestRejection: RejectionCandleDetail = {
    hasRejection: false,
    type: 'NONE',
    wickRatio: 0,
    wickPips: 0,
    bodyPips: 0,
    rangePips: 0,
    candleIndex: lastIndex,
    candleHigh: currentPrice,
    candleLow: currentPrice,
    candleOpen: currentPrice,
    candleClose: currentPrice,
    touchedZone: false,
    summary: 'No rejection analyzed yet.'
  };

  if (trendDirection !== 'NEUTRAL' && keyLevelPrice > 0) {
    const isBuy = trendDirection === 'BUY';
    // Inspect the last 3 candles (latest closed candle has highest priority)
    const checkIndices = [lastIndex, lastIndex - 1, lastIndex - 2].filter(i => i >= 0);

    for (const idx of checkIndices) {
      const candle = candles5m[idx];
      const detail = analyzeRejectionWick(candle, keyLevelPrice, isBuy, pipSize, idx);
      if (detail.hasRejection) {
        bestRejection = detail;
        break; // found confirmed rejection on most recent candle!
      } else if (detail.touchedZone && !bestRejection.touchedZone) {
        bestRejection = detail; // record zone test even if wick didn't qualify
      }
    }
  }

  // ---------------------------------------------------------------------------
  // SETUP STATE EVALUATION
  // ---------------------------------------------------------------------------
  let setupState: BounceSetupState = 'NO_TRADE';
  let triggerReason = '';

  const step1Trend = isTrendConfirmed;
  const step2Zone = isAtOrNearZone || bestRejection.touchedZone;
  const step3Trigger = bestRejection.hasRejection;

  if (step1Trend && step2Zone && step3Trigger) {
    setupState = 'READY_TO_ENTER';
    triggerReason = `ENTRY CONFIRMED: 5M candle touched ${keyLevelType} at ${keyLevelPrice.toFixed(5)} and printed a ${bestRejection.wickPips} pip rejection wick (${bestRejection.wickRatio}x body). Enter trade on the opening of the next candle.`;
  } else if (step1Trend && (step2Zone || bestRejection.touchedZone)) {
    setupState = 'TESTING_ZONE';
    triggerReason = `ZONE TESTING: Price reached the ${keyLevelType} level at ${keyLevelPrice.toFixed(5)}. Waiting for 5M candle close to confirm rejection wick before entry.`;
  } else if (step1Trend) {
    setupState = 'WAITING_FOR_PULLBACK';
    triggerReason = `PULLBACK PENDING: Trend is confirmed (${trendDirection}), but price is currently ${distanceToLevelPips} pips from ${keyLevelType} at ${keyLevelPrice.toFixed(5)}. Waiting for retracement bounce.`;
  } else {
    setupState = 'NO_TRADE';
    triggerReason = 'NO TRADE: Price is fluctuating on the 50 EMA without clear directional edge.';
  }

  // ---------------------------------------------------------------------------
  // TRADE PLAN (SL behind rejection wick, TP at 1.8R / 2.8R / 4.0R)
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // TRADE PLAN & RISK MANAGEMENT (MANDATE 2: VOLATILITY-BASED TARGET SCALING)
  // ---------------------------------------------------------------------------
  // "Instead of using fixed pip targets, dynamically scale your TP and SL using the incoming atr_5M variable.
  // Set your dynamic_stop_loss_pips to exactly 1.2x the current 5M ATR.
  // Set your dynamic_take_profit_pips to 2x the calculated Stop Loss to maintain a mathematically superior 1:2 Risk-to-Reward ratio, provided it does not hit a major 1H liquidity pool or structural barrier."
  const entryPreferred = currentPrice;
  const entrySpread = 1.5 * pipSize;
  const entryMin = trendDirection === 'BUY'
    ? Number((entryPreferred - entrySpread).toFixed(5))
    : Number((entryPreferred - entrySpread * 0.5).toFixed(5));
  const entryMax = trendDirection === 'BUY'
    ? Number((entryPreferred + entrySpread * 0.5).toFixed(5))
    : Number((entryPreferred + entrySpread).toFixed(5));

  let slPips = 7;
  let tpPips = 11;
  let liquidityPoolCapped = false;
  let liquidityPoolNote = '1:2.0 Risk-to-Reward maintained without liquidity barrier obstruction.';

  if (riskSettings.volatilityScalingEnabled) {
    const dynamicSl = Number((1.2 * marketVelocity.atr_5M_pips).toFixed(1));
    let dynamicTp = Number((2.0 * dynamicSl).toFixed(1));

    // Check collision with 1H liquidity pools
    if (trendDirection === 'BUY') {
      const bslAhead = macroStructure.key_1H_liquidity_pools
        .filter(p => p.type === 'BUY_SIDE_LIQUIDITY' || p.type === 'EQUAL_HIGHS')
        .sort((a, b) => a.distancePips - b.distancePips)[0];
      if (bslAhead && bslAhead.distancePips > 0 && bslAhead.distancePips < dynamicTp) {
        dynamicTp = Math.max(dynamicSl * 1.2, Number((bslAhead.distancePips - 1.0).toFixed(1)));
        liquidityPoolCapped = true;
        liquidityPoolNote = `TP scaled to ${dynamicTp}p ahead of 1H BSL pool (${bslAhead.price.toFixed(5)}) to avoid liquidity trap.`;
      }
    } else if (trendDirection === 'SELL') {
      const sslAhead = macroStructure.key_1H_liquidity_pools
        .filter(p => p.type === 'SELL_SIDE_LIQUIDITY' || p.type === 'EQUAL_LOWS')
        .sort((a, b) => a.distancePips - b.distancePips)[0];
      if (sslAhead && sslAhead.distancePips > 0 && sslAhead.distancePips < dynamicTp) {
        dynamicTp = Math.max(dynamicSl * 1.2, Number((sslAhead.distancePips - 1.0).toFixed(1)));
        liquidityPoolCapped = true;
        liquidityPoolNote = `TP scaled to ${dynamicTp}p ahead of 1H SSL pool (${sslAhead.price.toFixed(5)}) to avoid liquidity trap.`;
      }
    }
    slPips = dynamicSl;
    tpPips = dynamicTp;
  } else {
    slPips = riskSettings.stopLossEnabled ? riskSettings.stopLossPips : 7;
    tpPips = riskSettings.takeProfitEnabled ? riskSettings.takeProfitPips : 11;
  }

  const slBuffer = slPips * pipSize;
  let stopLoss = currentPrice;
  let stopLossReason = '';

  if (trendDirection === 'BUY') {
    const wickLow = bestRejection.hasRejection ? bestRejection.candleLow : Math.min(keyLevelPrice, currentPrice - (atrPips * pipSize));
    stopLoss = Number((wickLow - slBuffer).toFixed(5));
    stopLossReason = riskSettings.volatilityScalingEnabled
      ? `Dynamic Stop Loss set at 1.2x 5M ATR (${slPips} pips) past structural candle wick low (${wickLow.toFixed(5)}).`
      : `Stop Loss set exactly ${slPips} pips away past structural candle wick low (${wickLow.toFixed(5)}). cTrader cut active.`;
  } else if (trendDirection === 'SELL') {
    const wickHigh = bestRejection.hasRejection ? bestRejection.candleHigh : Math.max(keyLevelPrice, currentPrice + (atrPips * pipSize));
    stopLoss = Number((wickHigh + slBuffer).toFixed(5));
    stopLossReason = riskSettings.volatilityScalingEnabled
      ? `Dynamic Stop Loss set at 1.2x 5M ATR (${slPips} pips) past structural candle wick high (${wickHigh.toFixed(5)}).`
      : `Stop Loss set exactly ${slPips} pips away past structural candle wick high (${wickHigh.toFixed(5)}). cTrader cut active.`;
  }

  const riskDist = Math.abs(entryPreferred - stopLoss);
  const minRisk = 5 * pipSize;
  const effectiveRisk = Math.max(riskDist, minRisk);
  const riskPips = Number((effectiveRisk / pipSize).toFixed(1));

  let takeProfit1 = currentPrice;
  let takeProfit2 = currentPrice;
  let takeProfit3 = currentPrice;
  let rewardPips = tpPips;
  let riskReward = Number((tpPips / Math.max(1, slPips)).toFixed(2));

  if (trendDirection === 'BUY') {
    takeProfit1 = Number((entryPreferred + (tpPips * pipSize)).toFixed(5));
    takeProfit2 = Number((entryPreferred + (tpPips * 1.5 * pipSize)).toFixed(5));
    takeProfit3 = Number((entryPreferred + (tpPips * 2.0 * pipSize)).toFixed(5));
    rewardPips = tpPips;
  } else if (trendDirection === 'SELL') {
    takeProfit1 = Number((entryPreferred - (tpPips * pipSize)).toFixed(5));
    takeProfit2 = Number((entryPreferred - (tpPips * 1.5 * pipSize)).toFixed(5));
    takeProfit3 = Number((entryPreferred - (tpPips * 2.0 * pipSize)).toFixed(5));
    rewardPips = tpPips;
  }

  if (riskSettings.freeTradeEnabled) {
    triggerReason += ` [Free Trade Trigger Active: Lock 50% profit at +${riskSettings.freeTradeLockPips} pips and move Stop Loss to breakeven].`;
  }

  // ---------------------------------------------------------------------------
  // SCORING (0-100), MANDATE 3: SESSION RISK FILTER & CONFIDENCE THRESHOLD
  // ---------------------------------------------------------------------------
  let score = 30;
  if (step1Trend) score += 30; // Clear 50 EMA trend separation
  if (step2Zone) score += 20;  // Price in key support/resistance zone
  if (step3Trigger) score += 20; // Rejection wick confirmed!

  // Bonus for clean risk/reward and wick quality
  if (bestRejection.wickRatio >= 2.0) score += 5;
  if (setupState === 'READY_TO_ENTER') score = Math.max(82, score);

  // Mandate 1 Choppy Penalty:
  if (macroStructure.timeframe_1H_trend === 'CHOPPY') {
    score = Math.round(score * 0.70);
  }

  // Mandate 3 Session Risk Filter:
  // "If current_session matches 'GAP' or 'TOKYO', automatically apply a safety
  // penalty to the confidence_score, keeping it below your 0.88 execution gate
  // unless news sentiment is overwhelmingly one-sided (>0.95 absolute delta)."
  let sessionPenaltyApplied = false;
  if (riskSettings.sessionRiskFilterEnabled && (marketVelocity.current_session === 'GAP' || marketVelocity.current_session === 'TOKYO')) {
    sessionPenaltyApplied = true;
    score = Math.min(score, 83); // Strictly below 88 execution gate
  }

  let finalScore = Math.min(100, score);

  if (riskSettings.confidenceThresholdEnabled && finalScore < riskSettings.confidenceThreshold) {
    setupState = 'NO_TRADE';
    triggerReason = `Confidence score (${finalScore}) is below threshold floor (${riskSettings.confidenceThreshold}) or session risk gate (0.88). Preventing over-trading in choppy or restricted market.`;
  }

  return {
    trendDirection,
    ema50,
    currentPrice,
    priceVsEma50Pips: Number(priceDiffPips.toFixed(1)),
    isTrendConfirmed,
    trendReason,
    keyLevelType,
    keyLevelPrice,
    distanceToLevelPips,
    isAtOrNearZone,
    zoneReason,
    allSupportLevels,
    allResistanceLevels,
    rejection: bestRejection,
    setupState,
    triggerReason,
    entryPreferred,
    entryMin,
    entryMax,
    stopLoss,
    stopLossReason,
    takeProfit1,
    takeProfit2,
    takeProfit3,
    riskReward,
    riskPips,
    rewardPips,
    strategyScore: finalScore,
    stepsPassed: {
      step1Trend,
      step2Zone,
      step3Trigger
    },
    macroStructure: {
      timeframe_1H_trend: macroStructure.timeframe_1H_trend,
      key_1H_liquidity_pools: macroStructure.key_1H_liquidity_pools
    },
    marketVelocity: {
      atr_5M: marketVelocity.atr_5M,
      atr_5M_pips: marketVelocity.atr_5M_pips,
      current_session: marketVelocity.current_session
    },
    mandates: {
      macroAlignmentStatus: macroStructure.timeframe_1H_trend,
      volatilityScaling: {
        dynamic_stop_loss_pips: slPips,
        dynamic_take_profit_pips: tpPips,
        riskRewardRatio: riskReward
      },
      sessionRisk: {
        session: marketVelocity.current_session,
        penaltyApplied: sessionPenaltyApplied,
        executionGateMet: finalScore >= 88
      }
    }
  };
}

function createEmptyEvaluation(currentPrice: number, reason: string): BounceStrategyEvaluation {
  return {
    trendDirection: 'NEUTRAL',
    ema50: currentPrice,
    currentPrice,
    priceVsEma50Pips: 0,
    isTrendConfirmed: false,
    trendReason: reason,
    keyLevelType: 'NONE',
    keyLevelPrice: currentPrice,
    distanceToLevelPips: 0,
    isAtOrNearZone: false,
    zoneReason: reason,
    allSupportLevels: [],
    allResistanceLevels: [],
    rejection: {
      hasRejection: false,
      type: 'NONE',
      wickRatio: 0,
      wickPips: 0,
      bodyPips: 0,
      rangePips: 0,
      candleIndex: 0,
      candleHigh: currentPrice,
      candleLow: currentPrice,
      candleOpen: currentPrice,
      candleClose: currentPrice,
      touchedZone: false,
      summary: reason
    },
    setupState: 'NO_TRADE',
    triggerReason: reason,
    entryPreferred: currentPrice,
    entryMin: currentPrice,
    entryMax: currentPrice,
    stopLoss: currentPrice,
    stopLossReason: 'No trade formed.',
    takeProfit1: currentPrice,
    takeProfit2: currentPrice,
    takeProfit3: currentPrice,
    riskReward: 0,
    riskPips: 0,
    rewardPips: 0,
    strategyScore: 0,
    stepsPassed: {
      step1Trend: false,
      step2Zone: false,
      step3Trigger: false
    }
  };
}
