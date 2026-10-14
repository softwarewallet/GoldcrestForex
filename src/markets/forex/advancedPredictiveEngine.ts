// ============================================================================
// ADVANCED QUANTITATIVE PREDICTIVE ENGINE
// Multi-Timeframe Order Flow and Liquidity Analysis for Forex Major Pairs
// ============================================================================

import { GoogleGenAI } from '@google/genai';
import { Candle } from '../common/types';
import { calculateEMA, calculateATR } from './indicators';
import { findSwingPoints } from './marketStructure';
import { calculateSupportResistance } from './supportResistance';
import { getForexSessionState } from '../common/session';
import { liveRuntimeLog } from '../../services/liveRuntimeLog';

export interface KeyLiquidityPool {
  price: number;
  type: 'BUY_SIDE_LIQUIDITY' | 'SELL_SIDE_LIQUIDITY' | 'EQUAL_HIGHS' | 'EQUAL_LOWS';
  label: string;
  distancePips: number;
  volumeWeight?: number;
}

export interface MacroStructureData {
  timeframe_1H_trend: 'BULLISH' | 'BEARISH' | 'CHOPPY';
  key_1H_liquidity_pools: KeyLiquidityPool[];
  trendReason: string;
  ema21_1H: number;
  ema50_1H: number;
  swingHighs: number[];
  swingLows: number[];
}

export interface MarketVelocityData {
  atr_5M: number;
  atr_5M_pips: number;
  current_session: 'LONDON' | 'NEW_YORK' | 'TOKYO' | 'GAP';
  sessionSummary: string;
  rawActiveSessions: string[];
}

export interface NewsSentimentInput {
  score: number;             // 0 to 100
  sentimentDelta: number;    // -1.0 to +1.0 (relative delta base vs quote)
  dominantHeadlines: string[];
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  isOverwhelming: boolean;   // Math.abs(sentimentDelta) > 0.95
}

export interface SystemSafetyCapsInput {
  maxDrawdownPct: number;    // default 5.0%
  maxLotSize: number;        // default 1.0 lot
  dailyLossCapPips: number;  // default 50 pips
  executionGate: number;     // 0.88 (88% confidence)
}

export interface MandateAuditResults {
  macroAlignment: {
    status: 'PASSED' | 'VETOED' | 'CHOPPY_SCALED';
    timeframe_1H_trend: 'BULLISH' | 'BEARISH' | 'CHOPPY';
    ruleApplied: string;
    isForbidden: boolean;
  };
  volatilityScaling: {
    atr_5M_pips: number;
    dynamic_stop_loss_pips: number;
    dynamic_take_profit_pips: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    riskRewardRatio: number; // 2.0 = 1:2 R:R
    liquidityPoolCapped: boolean;
    liquidityPoolDetails?: string;
  };
  sessionRisk: {
    current_session: 'LONDON' | 'NEW_YORK' | 'TOKYO' | 'GAP';
    penaltyApplied: boolean;
    prePenaltyConfidence: number;
    postPenaltyConfidence: number;
    overwhelmingNewsBypass: boolean;
    executionGateMet: boolean;
    details: string;
  };
}

export interface PredictivePolicyResult {
  pair: string;
  timestamp: number;
  orderAction: 'BUY' | 'SELL' | 'NO_TRADE';
  confidenceScore: number;          // 0.00 to 1.00
  executionGatePassed: boolean;     // confidenceScore >= 0.88
  macroStructure: MacroStructureData;
  marketVelocity: MarketVelocityData;
  newsSentiment: NewsSentimentInput;
  systemSafetyCaps: SystemSafetyCapsInput;
  mandates: MandateAuditResults;
  executionPlan: {
    entryPrice: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    stopLossPips: number;
    takeProfitPips: number;
    riskReward: string;             // '1:2.0'
    freeTradeTriggerPips: number;   // 6 pips: lock 50% profit & breakeven SL
  };
  policySummary: string;
  rejectionReasons: string[];
  aiGenerated: boolean;
  aiExplanation?: string;
}

export const ADVANCED_PREDICTIVE_ENGINE_SYSTEM_PROMPT = `You are an Advanced Quantitative Predictive Engine specializing in Multi-Timeframe Order Flow and Liquidity Analysis for Forex Major pairs. Your objective is to combine multi-source news sentiment, macro structure, and micro-execution parameters to output a hyper-optimized trading policy.

### New Input Data Extensions (Provided by Host App):
1. macroStructure: { timeframe_1H_trend: "BULLISH" | "BEARISH" | "CHOPPY", key_1H_liquidity_pools: Array }
2. marketVelocity: { atr_5M: float, current_session: "LONDON" | "NEW_YORK" | "TOKYO" | "GAP" }
3. newsSentiment & systemSafetyCaps (As previously structured).

### Profit Optimization & Filtering Mandates:

1. Macro Alignment Filter:
- Before checking the 5-Minute EMA, verify the timeframe_1H_trend. 
- You are strictly FORBIDDEN from issuing a BUY order if the 1H trend is BEARISH, and forbidden from issuing a SELL order if the 1H trend is BULLISH. If the macro trend is CHOPPY, scale down confidence instantly.

2. Volatility-Based Target Scaling:
- Instead of using fixed pip targets, dynamically scale your TP and SL using the incoming atr_5M variable.
- Set your dynamic_stop_loss_pips to exactly 1.2x the current 5M ATR.
- Set your dynamic_take_profit_pips to 2x the calculated Stop Loss to maintain a mathematically superior 1:2 Risk-to-Reward ratio, provided it does not hit a major 1H liquidity pool or structural barrier.

3. Session Risk Filter:
- If current_session matches "GAP" or "TOKYO", automatically apply a safety penalty to the confidence_score, keeping it below your 0.88 execution gate unless news sentiment is overwhelmingly one-sided (>0.95 absolute delta).`;

export class AdvancedQuantitativePredictiveEngine {
  /**
   * Derives current trading session from UTC time into:
   * "LONDON" | "NEW_YORK" | "TOKYO" | "GAP"
   */
  public static resolveCurrentSession(now: Date = new Date()): {
    session: 'LONDON' | 'NEW_YORK' | 'TOKYO' | 'GAP';
    summary: string;
    rawActiveSessions: string[];
  } {
    const sessionState = getForexSessionState(now);
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
    const day = now.getUTCDay();

    // Weekend or transition gap
    const isWeekend = (day === 6) || (day === 0 && utcHours < 21) || (day === 5 && utcHours >= 21);
    if (isWeekend) {
      return {
        session: 'GAP',
        summary: 'Weekend market closure / Gap risk window',
        rawActiveSessions: sessionState.activeSessions
      };
    }

    if (sessionState.london || sessionState.isLondonNyOverlap) {
      return {
        session: 'LONDON',
        summary: sessionState.isLondonNyOverlap ? 'London / New York Overlap (Peak Liquidity)' : 'London European Session',
        rawActiveSessions: sessionState.activeSessions
      };
    }

    if (sessionState.newYork) {
      return {
        session: 'NEW_YORK',
        summary: 'New York North American Session',
        rawActiveSessions: sessionState.activeSessions
      };
    }

    if (sessionState.tokyo) {
      return {
        session: 'TOKYO',
        summary: 'Tokyo Asian Session (Low Volatility / Range Bound)',
        rawActiveSessions: sessionState.activeSessions
      };
    }

    return {
      session: 'GAP',
      summary: 'Inter-session transition / Asian-Sydney Gap (Spread Widening Risk)',
      rawActiveSessions: sessionState.activeSessions
    };
  }

  /**
   * Computes Macro Structure (1H Trend & 1H Liquidity Pools)
   */
  public static computeMacroStructure(
    candles1H: Candle[],
    currentPrice: number,
    pipSize: number = 0.0001
  ): MacroStructureData {
    if (!candles1H || candles1H.length < 15) {
      return {
        timeframe_1H_trend: 'CHOPPY',
        key_1H_liquidity_pools: [],
        trendReason: 'Insufficient 1H candles to compute institutional macro trend (CHOPPY default).',
        ema21_1H: currentPrice,
        ema50_1H: currentPrice,
        swingHighs: [],
        swingLows: []
      };
    }

    const closes = candles1H.map(c => c.close);
    const ema21Series = calculateEMA(closes, 21);
    const ema50Series = calculateEMA(closes, 50);

    const lastIdx = closes.length - 1;
    const ema21 = ema21Series[lastIdx] ?? currentPrice;
    const ema50 = ema50Series[lastIdx] ?? currentPrice;

    // Swing points & order-flow liquidity pools on 1H
    const swings1H = findSwingPoints(candles1H, 2);
    const sr1H = calculateSupportResistance(candles1H, pipSize);

    const swingHighs = swings1H.highs.map(h => h.price);
    const swingLows = swings1H.lows.map(l => l.price);

    // Identify 1H Order Flow Liquidity Pools:
    // Buy-side Liquidity (BSL) = Resting stop-orders above swing highs / equal highs
    // Sell-side Liquidity (SSL) = Resting stop-orders below swing lows / equal lows
    const liquidityPools: KeyLiquidityPool[] = [];

    // Buy-side liquidity pools (above current price)
    swingHighs
      .filter(p => p > currentPrice)
      .sort((a, b) => a - b)
      .slice(0, 3)
      .forEach((price, idx) => {
        const distPips = Number(((price - currentPrice) / pipSize).toFixed(1));
        liquidityPools.push({
          price: Number(price.toFixed(5)),
          type: 'BUY_SIDE_LIQUIDITY',
          label: `1H BSL Pool #${idx + 1} (Swing High)`,
          distancePips: distPips
        });
      });

    // Sell-side liquidity pools (below current price)
    swingLows
      .filter(p => p < currentPrice)
      .sort((a, b) => b - a)
      .slice(0, 3)
      .forEach((price, idx) => {
        const distPips = Number(((currentPrice - price) / pipSize).toFixed(1));
        liquidityPools.push({
          price: Number(price.toFixed(5)),
          type: 'SELL_SIDE_LIQUIDITY',
          label: `1H SSL Pool #${idx + 1} (Swing Low)`,
          distancePips: distPips
        });
      });

    // Detect equal highs / equal lows (liquidity magnets)
    for (let i = 0; i < swingHighs.length; i++) {
      for (let j = i + 1; j < swingHighs.length; j++) {
        if (Math.abs(swingHighs[i] - swingHighs[j]) <= (2.5 * pipSize)) {
          const avgPrice = (swingHighs[i] + swingHighs[j]) / 2;
          const distPips = Number((Math.abs(avgPrice - currentPrice) / pipSize).toFixed(1));
          liquidityPools.push({
            price: Number(avgPrice.toFixed(5)),
            type: 'EQUAL_HIGHS',
            label: `1H EQH Liquidity Pool (${distPips}p away)`,
            distancePips: distPips
          });
        }
      }
    }

    // Determine 1H Trend: BULLISH | BEARISH | CHOPPY
    const priceVsEma21Pips = (currentPrice - ema21) / pipSize;
    const priceVsEma50Pips = (currentPrice - ema50) / pipSize;
    const emaSpreadPips = (ema21 - ema50) / pipSize;

    let timeframe_1H_trend: 'BULLISH' | 'BEARISH' | 'CHOPPY' = 'CHOPPY';
    let trendReason = '';

    if (currentPrice > ema50 && ema21 >= ema50 && priceVsEma50Pips > 4.0 && emaSpreadPips >= 0.5) {
      timeframe_1H_trend = 'BULLISH';
      trendReason = `1H Macro trend is BULLISH: Price (${currentPrice.toFixed(5)}) is ${priceVsEma50Pips.toFixed(1)} pips above 1H 50 EMA (${ema50.toFixed(5)}) with positive 21/50 EMA stack (+${emaSpreadPips.toFixed(1)}p).`;
    } else if (currentPrice < ema50 && ema21 <= ema50 && priceVsEma50Pips < -4.0 && emaSpreadPips <= -0.5) {
      timeframe_1H_trend = 'BEARISH';
      trendReason = `1H Macro trend is BEARISH: Price (${currentPrice.toFixed(5)}) is ${Math.abs(priceVsEma50Pips).toFixed(1)} pips below 1H 50 EMA (${ema50.toFixed(5)}) with negative 21/50 EMA stack (${emaSpreadPips.toFixed(1)}p).`;
    } else {
      timeframe_1H_trend = 'CHOPPY';
      trendReason = `1H Macro trend is CHOPPY: Price is compressing across 1H 50 EMA (${ema50.toFixed(5)}) with neutral/conflicted EMA spread (${emaSpreadPips.toFixed(1)}p).`;
    }

    return {
      timeframe_1H_trend,
      key_1H_liquidity_pools: liquidityPools,
      trendReason,
      ema21_1H: Number(ema21.toFixed(5)),
      ema50_1H: Number(ema50.toFixed(5)),
      swingHighs,
      swingLows
    };
  }

  /**
   * Computes Market Velocity (5M ATR & Current Session)
   */
  public static computeMarketVelocity(
    candles5M: Candle[],
    pipSize: number = 0.0001,
    now: Date = new Date()
  ): MarketVelocityData {
    const sessionInfo = this.resolveCurrentSession(now);

    if (!candles5M || candles5M.length < 14) {
      return {
        atr_5M: 0.0008,
        atr_5M_pips: 8.0,
        current_session: sessionInfo.session,
        sessionSummary: sessionInfo.summary,
        rawActiveSessions: sessionInfo.rawActiveSessions
      };
    }

    const atrSeries = calculateATR(candles5M, 14);
    const lastAtr = atrSeries[atrSeries.length - 1] || (candles5M[candles5M.length - 1].close * 0.0008);
    const atr_5M_pips = Math.max(3.5, Number((lastAtr / pipSize).toFixed(1)));

    return {
      atr_5M: Number(lastAtr.toFixed(5)),
      atr_5M_pips,
      current_session: sessionInfo.session,
      sessionSummary: sessionInfo.summary,
      rawActiveSessions: sessionInfo.rawActiveSessions
    };
  }

  /**
   * Evaluates the trading policy adhering strictly to:
   * Mandate 1: Macro Alignment Filter
   * Mandate 2: Volatility-Based Target Scaling (SL=1.2x ATR, TP=2x SL)
   * Mandate 3: Session Risk Filter (GAP/TOKYO safety penalty below 0.88 gate unless news delta > 0.95)
   */
  public static evaluatePolicy(params: {
    pair: string;
    candles5M: Candle[];
    candles1H: Candle[];
    currentPrice: number;
    pipSize?: number;
    newsSentiment?: {
      score?: number;
      sentimentDelta?: number;
      dominantHeadlines?: string[];
      direction?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    };
    systemSafetyCaps?: Partial<SystemSafetyCapsInput>;
  }): PredictivePolicyResult {
    const pair = params.pair;
    const pipSize = params.pipSize || (pair.includes('JPY') ? 0.01 : 0.0001);
    const currentPrice = params.currentPrice;

    // 1. Calculate Input Data Extensions
    const macroStructure = this.computeMacroStructure(params.candles1H, currentPrice, pipSize);
    const marketVelocity = this.computeMarketVelocity(params.candles5M, pipSize);

    // News sentiment input
    const sentimentDelta = params.newsSentiment?.sentimentDelta ?? 0.0;
    const isOverwhelming = Math.abs(sentimentDelta) > 0.95;
    const newsSentiment: NewsSentimentInput = {
      score: params.newsSentiment?.score ?? 50,
      sentimentDelta: Number(sentimentDelta.toFixed(3)),
      dominantHeadlines: params.newsSentiment?.dominantHeadlines ?? ['Macro liquidity stable across major currency corridors.'],
      direction: params.newsSentiment?.direction ?? (sentimentDelta > 0.2 ? 'BULLISH' : sentimentDelta < -0.2 ? 'BEARISH' : 'NEUTRAL'),
      isOverwhelming
    };

    // System safety caps
    const systemSafetyCaps: SystemSafetyCapsInput = {
      maxDrawdownPct: params.systemSafetyCaps?.maxDrawdownPct ?? 5.0,
      maxLotSize: params.systemSafetyCaps?.maxLotSize ?? 1.0,
      dailyLossCapPips: params.systemSafetyCaps?.dailyLossCapPips ?? 50,
      executionGate: params.systemSafetyCaps?.executionGate ?? 0.88
    };

    // Micro-execution (5-minute EMA check)
    let microBias: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let ema50_5M = currentPrice;
    if (params.candles5M && params.candles5M.length >= 20) {
      const closes5M = params.candles5M.map(c => c.close);
      const emaSeries = calculateEMA(closes5M, 50);
      ema50_5M = emaSeries[emaSeries.length - 1] ?? currentPrice;
      const priceVs5mEma = (currentPrice - ema50_5M) / pipSize;
      if (priceVs5mEma >= 1.0) microBias = 'BUY';
      else if (priceVs5mEma <= -1.0) microBias = 'SELL';
    }

    const rejectionReasons: string[] = [];

    // -------------------------------------------------------------------------
    // MANDATE 1: MACRO ALIGNMENT FILTER
    // -------------------------------------------------------------------------
    // "Before checking the 5-Minute EMA, verify the timeframe_1H_trend.
    // Strictly FORBIDDEN from issuing BUY if 1H trend is BEARISH,
    // and forbidden from issuing SELL if 1H trend is BULLISH.
    // If macro trend is CHOPPY, scale down confidence instantly."
    let preliminaryAction: 'BUY' | 'SELL' | 'NO_TRADE' = 'NO_TRADE';
    let macroStatus: 'PASSED' | 'VETOED' | 'CHOPPY_SCALED' = 'PASSED';
    let macroRuleApplied = '';
    let isForbidden = false;

    // Check potential bias
    const candidateDirection = microBias;

    if (candidateDirection === 'BUY') {
      if (macroStructure.timeframe_1H_trend === 'BEARISH') {
        preliminaryAction = 'NO_TRADE';
        macroStatus = 'VETOED';
        isForbidden = true;
        macroRuleApplied = 'FORBIDDEN: Attempted BUY order while 1H macro trend is BEARISH. Hard vetoed by Macro Alignment Filter.';
        rejectionReasons.push(macroRuleApplied);
      } else {
        preliminaryAction = 'BUY';
        macroRuleApplied = macroStructure.timeframe_1H_trend === 'BULLISH'
          ? 'Aligned: 1H macro trend is BULLISH and 5M EMA confirms BUY.'
          : 'Choppy Warning: 1H macro trend is CHOPPY. Scaling confidence down.';
        if (macroStructure.timeframe_1H_trend === 'CHOPPY') {
          macroStatus = 'CHOPPY_SCALED';
        }
      }
    } else if (candidateDirection === 'SELL') {
      if (macroStructure.timeframe_1H_trend === 'BULLISH') {
        preliminaryAction = 'NO_TRADE';
        macroStatus = 'VETOED';
        isForbidden = true;
        macroRuleApplied = 'FORBIDDEN: Attempted SELL order while 1H macro trend is BULLISH. Hard vetoed by Macro Alignment Filter.';
        rejectionReasons.push(macroRuleApplied);
      } else {
        preliminaryAction = 'SELL';
        macroRuleApplied = macroStructure.timeframe_1H_trend === 'BEARISH'
          ? 'Aligned: 1H macro trend is BEARISH and 5M EMA confirms SELL.'
          : 'Choppy Warning: 1H macro trend is CHOPPY. Scaling confidence down.';
        if (macroStructure.timeframe_1H_trend === 'CHOPPY') {
          macroStatus = 'CHOPPY_SCALED';
        }
      }
    } else {
      preliminaryAction = 'NO_TRADE';
      macroRuleApplied = '5M micro price action is neutral/touching 50 EMA without directional expansion.';
      rejectionReasons.push(macroRuleApplied);
    }

    // -------------------------------------------------------------------------
    // MANDATE 2: VOLATILITY-BASED TARGET SCALING
    // -------------------------------------------------------------------------
    // "Instead of fixed pip targets, dynamically scale TP and SL using incoming atr_5M:
    // Set dynamic_stop_loss_pips to exactly 1.2x current 5M ATR.
    // Set dynamic_take_profit_pips to 2x calculated Stop Loss (1:2 R:R),
    // provided it does not hit a major 1H liquidity pool or structural barrier."
    const atr_5M_pips = marketVelocity.atr_5M_pips;
    const dynamic_stop_loss_pips = Number((1.2 * atr_5M_pips).toFixed(1));
    let dynamic_take_profit_pips = Number((2.0 * dynamic_stop_loss_pips).toFixed(1));

    let liquidityPoolCapped = false;
    let liquidityPoolDetails = 'No liquidity pool barrier conflict; full 1:2.0 target preserved.';

    // Check collision with 1H liquidity pools
    if (preliminaryAction === 'BUY') {
      // Find nearest Buy-side liquidity pool ahead of target
      const bslAhead = macroStructure.key_1H_liquidity_pools
        .filter(p => p.type === 'BUY_SIDE_LIQUIDITY' || p.type === 'EQUAL_HIGHS')
        .sort((a, b) => a.distancePips - b.distancePips)[0];

      if (bslAhead && bslAhead.distancePips > 0 && bslAhead.distancePips < dynamic_take_profit_pips) {
        // Pool is located before the full 2x SL target.
        // Cap take-profit 1 pip before the liquidity pool to secure fill before institutional sweep reversal!
        const adjustedTp = Math.max(dynamic_stop_loss_pips * 1.2, Number((bslAhead.distancePips - 1.0).toFixed(1)));
        liquidityPoolDetails = `TP scaled to ${adjustedTp}p (ahead of 1H BSL at ${bslAhead.price.toFixed(5)}, ${bslAhead.distancePips}p away) to prevent institutional reversal trap.`;
        dynamic_take_profit_pips = adjustedTp;
        liquidityPoolCapped = true;
      }
    } else if (preliminaryAction === 'SELL') {
      // Find nearest Sell-side liquidity pool ahead of target
      const sslAhead = macroStructure.key_1H_liquidity_pools
        .filter(p => p.type === 'SELL_SIDE_LIQUIDITY' || p.type === 'EQUAL_LOWS')
        .sort((a, b) => a.distancePips - b.distancePips)[0];

      if (sslAhead && sslAhead.distancePips > 0 && sslAhead.distancePips < dynamic_take_profit_pips) {
        const adjustedTp = Math.max(dynamic_stop_loss_pips * 1.2, Number((sslAhead.distancePips - 1.0).toFixed(1)));
        liquidityPoolDetails = `TP scaled to ${adjustedTp}p (ahead of 1H SSL at ${sslAhead.price.toFixed(5)}, ${sslAhead.distancePips}p away) to prevent institutional reversal trap.`;
        dynamic_take_profit_pips = adjustedTp;
        liquidityPoolCapped = true;
      }
    }

    const calculatedRR = Number((dynamic_take_profit_pips / dynamic_stop_loss_pips).toFixed(2));

    // Calculate actual price levels
    const stopLossPrice = preliminaryAction === 'BUY'
      ? Number((currentPrice - (dynamic_stop_loss_pips * pipSize)).toFixed(5))
      : Number((currentPrice + (dynamic_stop_loss_pips * pipSize)).toFixed(5));

    const takeProfitPrice = preliminaryAction === 'BUY'
      ? Number((currentPrice + (dynamic_take_profit_pips * pipSize)).toFixed(5))
      : Number((currentPrice - (dynamic_take_profit_pips * pipSize)).toFixed(5));

    // -------------------------------------------------------------------------
    // BASE CONFIDENCE SCORING
    // -------------------------------------------------------------------------
    let baseConfidence = 0.85;

    if (macroStructure.timeframe_1H_trend === 'BULLISH' && candidateDirection === 'BUY') {
      baseConfidence = 0.91;
    } else if (macroStructure.timeframe_1H_trend === 'BEARISH' && candidateDirection === 'SELL') {
      baseConfidence = 0.91;
    } else if (macroStructure.timeframe_1H_trend === 'CHOPPY') {
      // Instant confidence scale down for CHOPPY
      baseConfidence = Number((baseConfidence * 0.70).toFixed(3)); // scaled down to ~0.595
    }

    if (preliminaryAction === 'NO_TRADE') {
      baseConfidence = 0.40;
    }

    // -------------------------------------------------------------------------
    // MANDATE 3: SESSION RISK FILTER
    // -------------------------------------------------------------------------
    // "If current_session matches 'GAP' or 'TOKYO', automatically apply a safety
    // penalty to confidence_score, keeping it below your 0.88 execution gate
    // unless news sentiment is overwhelmingly one-sided (>0.95 absolute delta)."
    let sessionPenaltyApplied = false;
    let postPenaltyConfidence = baseConfidence;
    let sessionRiskDetails = '';

    const isRiskySession = marketVelocity.current_session === 'GAP' || marketVelocity.current_session === 'TOKYO';

    if (isRiskySession) {
      if (isOverwhelming) {
        sessionRiskDetails = `Session is ${marketVelocity.current_session}, but news sentiment delta (${sentimentDelta > 0 ? '+' : ''}${sentimentDelta}) exceeds >0.95 threshold. Safety penalty waived due to overwhelming macro news impulse.`;
      } else {
        sessionPenaltyApplied = true;
        // Cap strictly below the 0.88 execution gate (e.g. 0.82 - 0.84)
        postPenaltyConfidence = Math.min(postPenaltyConfidence, 0.83);
        sessionRiskDetails = `Session is ${marketVelocity.current_session}. Safety penalty applied: Confidence restricted to ${(postPenaltyConfidence * 100).toFixed(1)}% (strictly below the 0.88 execution gate) due to low liquidity / gap risk without >0.95 news delta.`;
        if (preliminaryAction !== 'NO_TRADE') {
          rejectionReasons.push(`Session risk safety cap active (${marketVelocity.current_session} session): Confidence held below 0.88 gate.`);
        }
      }
    } else {
      sessionRiskDetails = `Session is ${marketVelocity.current_session}. High liquidity environment; standard execution gate criteria in effect.`;
    }

    // Final order determination against 0.88 gate
    const executionGatePassed = postPenaltyConfidence >= systemSafetyCaps.executionGate && preliminaryAction !== 'NO_TRADE';
    const finalOrderAction: 'BUY' | 'SELL' | 'NO_TRADE' = executionGatePassed ? preliminaryAction : 'NO_TRADE';

    // Free trade trigger: lock 50% profit at +6 pips and move SL to breakeven
    const freeTradeTriggerPips = 6.0;

    let policySummary = '';
    if (finalOrderAction === 'BUY') {
      policySummary = `ACTIONABLE POLICY: BUY ${pair} @ ${currentPrice.toFixed(5)} | SL: ${stopLossPrice.toFixed(5)} (-${dynamic_stop_loss_pips}p = 1.2x ATR) | TP: ${takeProfitPrice.toFixed(5)} (+${dynamic_take_profit_pips}p = ${calculatedRR}R) | Confidence: ${(postPenaltyConfidence * 100).toFixed(1)}% (Passed 0.88 Gate) | Free-Trade Lock @ +${freeTradeTriggerPips}p.`;
    } else if (finalOrderAction === 'SELL') {
      policySummary = `ACTIONABLE POLICY: SELL ${pair} @ ${currentPrice.toFixed(5)} | SL: ${stopLossPrice.toFixed(5)} (+${dynamic_stop_loss_pips}p = 1.2x ATR) | TP: ${takeProfitPrice.toFixed(5)} (-${dynamic_take_profit_pips}p = ${calculatedRR}R) | Confidence: ${(postPenaltyConfidence * 100).toFixed(1)}% (Passed 0.88 Gate) | Free-Trade Lock @ +${freeTradeTriggerPips}p.`;
    } else {
      policySummary = `DEFENSIVE POLICY: NO_TRADE on ${pair} | Reason: ${rejectionReasons[0] || 'Confidence below 0.88 gate or macro alignment filter active.'} | Confidence: ${(postPenaltyConfidence * 100).toFixed(1)}% (Gate: 0.88). Capital protected.`;
    }

    return {
      pair,
      timestamp: Date.now(),
      orderAction: finalOrderAction,
      confidenceScore: Number(postPenaltyConfidence.toFixed(3)),
      executionGatePassed,
      macroStructure,
      marketVelocity,
      newsSentiment,
      systemSafetyCaps,
      mandates: {
        macroAlignment: {
          status: macroStatus,
          timeframe_1H_trend: macroStructure.timeframe_1H_trend,
          ruleApplied: macroRuleApplied,
          isForbidden
        },
        volatilityScaling: {
          atr_5M_pips,
          dynamic_stop_loss_pips,
          dynamic_take_profit_pips,
          stopLossPrice,
          takeProfitPrice,
          riskRewardRatio: calculatedRR,
          liquidityPoolCapped,
          liquidityPoolDetails
        },
        sessionRisk: {
          current_session: marketVelocity.current_session,
          penaltyApplied: sessionPenaltyApplied,
          prePenaltyConfidence: Number(baseConfidence.toFixed(3)),
          postPenaltyConfidence: Number(postPenaltyConfidence.toFixed(3)),
          overwhelmingNewsBypass: isRiskySession && isOverwhelming,
          executionGateMet: executionGatePassed,
          details: sessionRiskDetails
        }
      },
      executionPlan: {
        entryPrice: currentPrice,
        stopLossPrice,
        takeProfitPrice,
        stopLossPips: dynamic_stop_loss_pips,
        takeProfitPips: dynamic_take_profit_pips,
        riskReward: `1:${calculatedRR.toFixed(1)}`,
        freeTradeTriggerPips
      },
      policySummary,
      rejectionReasons,
      aiGenerated: false
    };
  }

  /**
   * Generates AI-grounded Predictive Policy using Gemini 3.8 Flash
   * adhering strictly to the system instruction and Mandates.
   */
  public static async generateAiPolicy(params: {
    pair: string;
    candles5M: Candle[];
    candles1H: Candle[];
    currentPrice: number;
    pipSize?: number;
    newsSentiment?: any;
    systemSafetyCaps?: any;
  }): Promise<PredictivePolicyResult> {
    const deterministic = this.evaluatePolicy(params);
    const apiKey = process.env.GEMINI_API_KEY;

    // Validate that a genuine Gemini API key is configured (Gemini API keys start with AIza)
    if (!apiKey || !apiKey.startsWith('AIza')) {
      return {
        ...deterministic,
        aiGenerated: false,
        aiExplanation: `[Quantitative Deterministic Engine] ${deterministic.policySummary} (Macro Trend: ${deterministic.macroStructure.timeframe_1H_trend}, Session: ${deterministic.marketVelocity.current_session}, 5M ATR: ${deterministic.marketVelocity.atr_5M_pips}p)`
      };
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });
      const payload = {
        pair: deterministic.pair,
        currentPrice: params.currentPrice,
        macroStructure: {
          timeframe_1H_trend: deterministic.macroStructure.timeframe_1H_trend,
          key_1H_liquidity_pools: deterministic.macroStructure.key_1H_liquidity_pools
        },
        marketVelocity: {
          atr_5M: deterministic.marketVelocity.atr_5M_pips,
          current_session: deterministic.marketVelocity.current_session
        },
        newsSentiment: deterministic.newsSentiment,
        systemSafetyCaps: deterministic.systemSafetyCaps,
        deterministicPlan: deterministic.executionPlan,
        deterministicAudit: deterministic.mandates
      };

      const prompt = `Evaluate the following Forex Major setup under your quantitative instructions:

INPUT DATA:
${JSON.stringify(payload, null, 2)}

Provide a strict JSON response with:
{
  "orderAction": "BUY" | "SELL" | "NO_TRADE",
  "confidenceScore": float between 0.00 and 1.00,
  "policySummary": "concise 2-3 sentence execution policy statement",
  "macroAlignmentAudit": "audit statement regarding 1H macro trend mandate",
  "volatilityScalingAudit": "audit statement confirming 1.2x ATR SL and 2x TP calculations",
  "sessionRiskAudit": "audit statement evaluating GAP/TOKYO session penalty against 0.88 gate",
  "aiRationale": "in-depth quantitative commentary"
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          systemInstruction: ADVANCED_PREDICTIVE_ENGINE_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          temperature: 0.1
        }
      });

      const text = response.text?.trim() || '{}';
      const parsed = JSON.parse(text);

      return {
        ...deterministic,
        orderAction: parsed.orderAction || deterministic.orderAction,
        confidenceScore: typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : deterministic.confidenceScore,
        policySummary: parsed.policySummary || deterministic.policySummary,
        aiGenerated: true,
        aiExplanation: parsed.aiRationale || parsed.policySummary || deterministic.policySummary
      };
    } catch (e: any) {
      liveRuntimeLog('ERROR', 'AI_POLICY_GEN_ERROR', { error: e.message || String(e) });
      return {
        ...deterministic,
        aiGenerated: false,
        aiExplanation: `[Quantitative Deterministic Engine] ${deterministic.policySummary} (Macro Trend: ${deterministic.macroStructure.timeframe_1H_trend}, Session: ${deterministic.marketVelocity.current_session}, 5M ATR: ${deterministic.marketVelocity.atr_5M_pips}p)`
      };
    }
  }
}
