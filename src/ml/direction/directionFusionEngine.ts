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
import { MacroEngine } from './macroEngine';
import { NewsRiskEngine } from './newsRiskEngine';
import { MultiTimeframeEngine } from './multiTimeframeEngine';
import { MLDirectionEngine } from './mlDirectionEngine';

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

    // 1. Evaluate all independent components
    const momentum = MomentumEngine.evaluateMomentum(closes);
    const trend = TrendEngine.evaluateTrend(highs, lows, closes);
    const vwap = VolumeOrderFlowEngine.evaluateVWAP(closes, highs, lows, volumes);
    const obi = OrderBookEngine.evaluateOrderBook(options.bidVolume, options.askVolume);
    const macro = MacroEngine.evaluateMacro(pair);
    const news = NewsRiskEngine.evaluateNews(options.newsSentiment, options.newsImpactScore, options.highImpactActive);
    const mtf = MultiTimeframeEngine.evaluateMTF(options.mtfData || {});

    const ml = MLDirectionEngine.evaluateML({
      rsi: 55,
      macdHist: momentum.score,
      adx: 28,
      diSpread: 5,
      emaAlignment: trend.score,
      vwapDist: vwap.score,
      macroDiff: macro.score,
      newsSentiment: news.score
    });

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
      const w = weights[name] || 0.1;
      if (comp.dataQuality === 'AVAILABLE' || comp.dataQuality === 'LOW_QUALITY') {
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

    const championDir = options.championPrediction?.direction || 'BUY';
    const championProb = options.championPrediction?.probability || 0.65;

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
      explanation: `Quantitative Direction: ${finalDirection} (NetScore: ${netScore.toFixed(2)}, Conflict: ${(conflictRatio * 100).toFixed(0)}%, Regime: ${marketRegime})`,
      championVsChallenger: {
        championDirection: championDir,
        championProbability: championProb,
        challengerDirection: finalDirection,
        challengerProbability: probUp,
        agreement: championDir === finalDirection
      }
    };
  }
}
