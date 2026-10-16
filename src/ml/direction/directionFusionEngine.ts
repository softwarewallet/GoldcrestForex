// ============================================================================
// DIRECTION FUSION & CONFLICT DETECTION ENGINE (PHASES 17-36)
// ============================================================================

import {
  ComponentDirectionResult,
  QuantitativePredictionResult,
  DirectionType,
  MarketRegimeType
} from './types';
import { MomentumEngine } from './momentumEngine';
import { TrendEngine } from './trendEngine';
import { VolumeOrderFlowEngine } from './volumeOrderFlowEngine';
import { OrderBookEngine } from './orderBookEngine';
import { NewsRiskEngine } from './newsRiskEngine';
import { MultiTimeframeEngine } from './multiTimeframeEngine';

function unavailableComponent(componentName: string, explanation: string): ComponentDirectionResult {
  return {
    componentName,
    direction: 'NEUTRAL',
    score: 0,
    strength: 0,
    confidence: 0,
    dataQuality: 'UNAVAILABLE',
    timestamp: Date.now(),
    featureVersion: '3.0.0',
    explanation
  };
}

export interface FusionInputOptions {
  pair: string;
  horizon?: string;
  closes: number[];
  highs: number[];
  lows: number[];
  volumes?: number[];
  bidVolume?: number;
  askVolume?: number;
  newsSentiment?: number;
  newsImpactScore?: number;
  highImpactActive?: boolean;
  mtfData?: Record<string, { closes: number[] }>;
  spreadPips?: number;
  /** Explicitly indicate whether pair-relative news articles survived freshness/relevance filtering. */
  newsDataAvailable?: boolean;
  championPrediction?: { direction: string; probability: number };
}

export class DirectionFusionEngine {
  public static calculateQuantitativeDirection(options: FusionInputOptions): QuantitativePredictionResult {
    const pair = options.pair || 'EUR/USD';
    const horizon = options.horizon || '15M';
    const closes = options.closes || [];
    const highs = options.highs || [];
    const lows = options.lows || [];
    const volumes = options.volumes || closes.map(() => 100);

    // Only components with sufficient real inputs can vote. LOW_QUALITY or
    // fabricated defaults must not influence the composite direction.
    const momentum = closes.length >= 35
      ? MomentumEngine.evaluateMomentum(closes)
      : unavailableComponent('MomentumEngine', 'At least 35 actual candles are required for momentum evidence.');
    const trend = closes.length >= 50 && highs.length >= 50 && lows.length >= 50
      ? TrendEngine.evaluateTrend(highs, lows, closes)
      : unavailableComponent('TrendEngine', 'At least 50 actual candles are required for trend/EMA evidence.');
    const hasUsableVolume = closes.length >= 35
      && highs.length >= closes.length
      && lows.length >= closes.length
      && volumes.length >= closes.length
      && volumes.some(value => Number.isFinite(value) && value > 0);
    const vwap = hasUsableVolume
      ? VolumeOrderFlowEngine.evaluateVWAP(closes, highs, lows, volumes)
      : unavailableComponent('VolumeOrderFlowEngine', 'Genuine price and tick-volume history is insufficient for VWAP evidence.');
    const obi = OrderBookEngine.evaluateOrderBook(options.bidVolume, options.askVolume);

    // MacroEngine currently embeds fixed example rates. Keep the component visible
    // for diagnosis, but exclude it until timestamped authoritative rate data is wired.
    const macro = unavailableComponent('MacroEngine', 'No timestamped authoritative macro-rate snapshot was supplied; fixed rate constants are excluded.');
    const newsSupplied = options.newsDataAvailable ?? (
      options.newsSentiment !== undefined || options.newsImpactScore !== undefined
    );
    const news = newsSupplied
      ? NewsRiskEngine.evaluateNews(options.newsSentiment, options.newsImpactScore, options.highImpactActive)
      : unavailableComponent('NewsRiskEngine', 'No fresh pair-relative news evidence was supplied.');
    const mtf = MultiTimeframeEngine.evaluateMTF(options.mtfData || {});

    // MLDirectionEngine is currently a hand-weighted sigmoid, not a trained
    // calibrated model; its former fixed RSI/ADX/DI inputs are deliberately not
    // counted as model evidence.
    const ml = unavailableComponent('MLDirectionEngine', 'No trained and empirically calibrated ML model artifact is configured; placeholder features are excluded.');

    const components: Record<string, ComponentDirectionResult> = {
      Momentum: momentum,
      Trend: trend,
      VWAP: vwap,
      OrderBook: obi,
      Macro: macro,
      News: news,
      MTF: mtf,
      ML: ml
    };

    // 2. Conflict Detection & Evidence Tally
    let bullishEvidenceSum = 0;
    let bearishEvidenceSum = 0;
    let totalWeight = 0;

    const weights: Record<string, number> = {
      Trend: 0.25,
      Momentum: 0.20,
      ML: 0.20,
      MTF: 0.15,
      VWAP: 0.10,
      Macro: 0.05,
      News: 0.05,
      OrderBook: obi.dataQuality === 'AVAILABLE' ? 0.05 : 0.0
    };

    for (const [name, comp] of Object.entries(components)) {
      const w = weights[name] ?? 0;
      if (comp.dataQuality === 'AVAILABLE' && w > 0) {
        totalWeight += w;
        if (comp.score > 0) bullishEvidenceSum += comp.score * w;
        else if (comp.score < 0) bearishEvidenceSum += Math.abs(comp.score) * w;
      }
    }

    const netScore = totalWeight > 0 ? (bullishEvidenceSum - bearishEvidenceSum) / totalWeight : 0;
    const totalEvidence = bullishEvidenceSum + bearishEvidenceSum;
    const conflictRatio = totalEvidence > 0 ? Math.min(bullishEvidenceSum, bearishEvidenceSum) / totalEvidence : 0;

    // 3. Regime Detection
    let marketRegime: MarketRegimeType = 'RANGE';
    if (Math.abs(trend.score) > 0.4) {
      marketRegime = trend.score > 0 ? 'TREND_UP' : 'TREND_DOWN';
    } else if (options.highImpactActive) {
      marketRegime = 'NEWS_SHOCK';
    }

    // 4. Final Direction Determination & No-Edge Abstention (Phase 28)
    let finalDirection: DirectionType = 'NEUTRAL';
    if (conflictRatio > 0.40 || Math.abs(netScore) < 0.12) {
      finalDirection = conflictRatio > 0.45 ? 'CONFLICT' : 'NO_EDGE';
    } else if (netScore > 0.15) {
      finalDirection = 'BUY';
    } else if (netScore < -0.15) {
      finalDirection = 'SELL';
    }

    const probUp = Number((0.5 + netScore * 0.45).toFixed(3));
    const probDown = Number((0.5 - netScore * 0.45).toFixed(3));
    const probNeutral = Number((1 - Math.abs(netScore)).toFixed(3));

    const spreadPips = options.spreadPips || 1.2;
    const costAdjustedExpectedR = Number((Math.abs(netScore) * 2.5 - (spreadPips / 20)).toFixed(2));

    const predictionId = `quant_dir_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const championVsChallenger = options.championPrediction ? {
      championDirection: options.championPrediction.direction,
      championProbability: options.championPrediction.probability,
      challengerDirection: finalDirection,
      challengerProbability: probUp,
      agreement: options.championPrediction.direction === finalDirection
    } : undefined;

    return {
      predictionId,
      timestamp: Date.now(),
      pair,
      horizon,
      finalDirection,
      probabilityUp: Math.max(0, Math.min(1, probUp)),
      probabilityDown: Math.max(0, Math.min(1, probDown)),
      probabilityNeutral: Math.max(0, Math.min(1, probNeutral)),
      probabilityTPBeforeSL: Math.max(0, Math.min(1, probUp)),
      probabilitySLBeforeTP: Math.max(0, Math.min(1, probDown)),
      expectedR: costAdjustedExpectedR,
      confidence: Number(Math.abs(netScore).toFixed(3)),
      conflictRatio: Number(conflictRatio.toFixed(3)),
      signalAgreement: Number((1 - conflictRatio).toFixed(3)),
      marketRegime,
      components,
      costAdjustedSpreadPips: spreadPips,
      explanation: `Quantitative Direction: ${finalDirection} (uncalibrated evidence score: ${netScore.toFixed(2)}, Conflict: ${(conflictRatio * 100).toFixed(0)}%, Regime: ${marketRegime})`,
      ...(championVsChallenger ? { championVsChallenger } : {})
    };
  }
}
