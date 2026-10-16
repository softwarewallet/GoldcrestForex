/**
 * Bounded SHADOW comparison of the incumbent signal with the distinct statistical
 * and macro/volatility predictors. No component here can authorize an order.
 */
import type { ForexSignal, ForexCandle } from '../markets/forex/types';
import { getForexPairConfig } from '../markets/forex/instruments';
import type { LiveNewsSnapshot } from '../../services/liveNewsService';
import { CombinedPredictionEngine } from '../prediction/combinedPredictionEngine';
import { NewsIntelligenceEngine } from '../prediction/newsIntelligenceEngine';
import { AdvancedQuantitativePredictiveEngine } from '../../markets/forex/advancedPredictiveEngine';
import { evaluateLegacyForexSetup } from './legacyForexPredictionEngine';
import { fusePredictionObservations, normalizePredictionSide, PredictionFusionResult, PredictionEngineObservation } from './predictionFusionOrchestrator';
import { liveRuntimeLog } from '../../services/liveRuntimeLog';

const MAX_NEWS_AGE_MS = 5 * 60_000;
const MAX_QUOTE_AGE_MS = 10_000;
const MAX_5M_AGE_MS = 20 * 60_000;
const MAX_15M_AGE_MS = 35 * 60_000;
const MAX_1H_AGE_MS = 3 * 60 * 60_000;
const PREDICTION_TIMEOUT_MS = 12_000;
const SHADOW_REFRESH_COOLDOWN_MS = 5 * 60_000;

export interface AutoLiveShadowComparison {
  status: 'COMPLETE' | 'INSUFFICIENT_DATA' | 'PENDING' | 'ERROR';
  pair: string;
  startedAt: number;
  completedAt: number;
  incumbentSignalId: string;
  fusion?: PredictionFusionResult;
  message?: string;
}

export interface ShadowComparisonInput {
  pair: string;
  cutoffTimestamp: number;
  incumbent: ForexSignal;
  quote: { bid: number; ask: number; timestamp: number; spreadPips: number; dataStatus: string };
  candles5M: ForexCandle[];
  candles15M: ForexCandle[];
  candles1H: ForexCandle[];
  newsSnapshot: LiveNewsSnapshot | null;
}

export class AutoLivePredictionShadowService {
  private readonly inFlight = new Map<string, Promise<PredictionFusionResult>>();
  private readonly lastStartedAt = new Map<string, number>();

  /** Launch a single comparison per pair; never await this from the order path. */
  launch(input: ShadowComparisonInput, onComplete: (result: AutoLiveShadowComparison) => void): void {
    const pair = input.pair.toUpperCase();
    const now = Date.now();
    if (this.inFlight.has(pair)) return;
    if (now - (this.lastStartedAt.get(pair) || 0) < SHADOW_REFRESH_COOLDOWN_MS) return;

    this.lastStartedAt.set(pair, now);
    const startedAt = now;
    const pending: AutoLiveShadowComparison = {
      status: 'PENDING',
      pair,
      startedAt,
      completedAt: startedAt,
      incumbentSignalId: input.incumbent.id,
      message: 'Prediction challengers are evaluating in shadow mode; no order authorization is performed.'
    };
    onComplete(pending);

    const work = this.compare(input).finally(() => {
      if (this.inFlight.get(pair) === work) this.inFlight.delete(pair);
    });
    this.inFlight.set(pair, work);
    void Promise.race([
      work,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Shadow prediction deadline exceeded.')), PREDICTION_TIMEOUT_MS))
    ]).then(fusion => {
      onComplete({ ...pending, status: 'COMPLETE', completedAt: Date.now(), fusion, message: fusion.rationale.join(' ') || 'Shadow comparison complete.' });
    }).catch(error => {
      const message = error?.message || String(error);
      liveRuntimeLog('WARN', 'AUTO_LIVE_SHADOW_PREDICTION_FAILED', { pair, message, incumbentSignalId: input.incumbent.id });
      onComplete({ ...pending, status: /insufficient|unavailable|stale/i.test(message) ? 'INSUFFICIENT_DATA' : 'ERROR', completedAt: Date.now(), message });
    });
  }

  private async compare(input: ShadowComparisonInput): Promise<PredictionFusionResult> {
    const pair = input.pair.toUpperCase();
    const cutoff = input.cutoffTimestamp;
    const pairConfig = getForexPairConfig(pair);
    const observations: PredictionEngineObservation[] = [];
    const quoteAge = cutoff - Number(input.quote.timestamp);
    const currentQuoteOk = input.quote.dataStatus === 'LIVE'
      && Number.isFinite(quoteAge) && quoteAge >= 0 && quoteAge <= MAX_QUOTE_AGE_MS
      && Number(input.quote.bid) > 0 && Number(input.quote.ask) >= Number(input.quote.bid)
      && Number(input.quote.spreadPips) >= 0 && Number.isFinite(Number(input.quote.spreadPips));

    const boundedCandles = (candles: ForexCandle[], maxAge: number, minCount: number) => {
      const clean = (Array.isArray(candles) ? candles : []).filter(c =>
        Number.isFinite(c.timestamp) && c.timestamp <= cutoff
        && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close)
        && c.open > 0 && c.high >= Math.max(c.open, c.close, c.low)
        && c.low <= Math.min(c.open, c.close, c.high) && c.close > 0
      ).sort((a, b) => a.timestamp - b.timestamp);
      const fresh = clean.length > 0 && cutoff - clean[clean.length - 1].timestamp >= 0
        && cutoff - clean[clean.length - 1].timestamp <= maxAge;
      return { candles: clean, fresh, sufficient: clean.length >= minCount };
    };

    const five = boundedCandles(input.candles5M, MAX_5M_AGE_MS, 20);
    const fifteen = boundedCandles(input.candles15M, MAX_15M_AGE_MS, 35);
    const hourly = boundedCandles(input.candles1H, MAX_1H_AGE_MS, 15);
    const incumbentSide = normalizePredictionSide(input.incumbent.direction);
    const incumbentAvailable = currentQuoteOk && input.incumbent.dataStatus === 'LIVE'
      && five.fresh && fifteen.fresh && hourly.fresh;
    observations.push({
      engine: 'FOREX_SIGNAL',
      direction: incumbentSide,
      evidenceState: incumbentAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
      timestamp: input.incumbent.timestamp,
      confidence: Math.max(0, Math.min(1, Number(input.incumbent.score) / 100)),
      spreadPips: input.quote.spreadPips,
      reason: incumbentAvailable
        ? `Incumbent ${input.incumbent.direction}; score ${input.incumbent.score}; strategy ${input.incumbent.strategyVersion}.`
        : 'Incumbent exists, but current quote/candle freshness or live data quality is insufficient for cross-engine comparison.',
      metadata: { strategyVersion: input.incumbent.strategyVersion, candleCounts: { fiveM: five.candles.length, fifteenM: fifteen.candles.length, oneH: hourly.candles.length } }
    });

    if (!currentQuoteOk) {
      observations.push({
        engine: 'COMBINED_STATISTICAL', direction: 'NO_TRADE', evidenceState: 'UNAVAILABLE',
        timestamp: cutoff, reason: 'Current cTrader LIVE quote is missing, stale, future-dated, or has invalid spread.'
      });
      observations.push({
        engine: 'ADVANCED_POLICY', direction: 'NO_TRADE', evidenceState: 'UNAVAILABLE',
        timestamp: cutoff, reason: 'Advanced policy was not evaluated without a current authoritative cTrader quote.'
      });
      return fusePredictionObservations({ pair, cutoffTimestamp: cutoff, observations });
    }

    if (fifteen.fresh && fifteen.candles.length >= 60) {
      try {
        const legacySignal = evaluateLegacyForexSetup(pair, fifteen.candles.map(c => ({
          timestamp: c.timestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume
        })));
        const legacyDirection = normalizePredictionSide(legacySignal.direction);
        observations.push({
          engine: 'LEGACY_TECHNICAL',
          direction: legacyDirection,
          evidenceState: 'AVAILABLE',
          timestamp: legacySignal.timestamp,
          spreadPips: input.quote.spreadPips,
          reason: `Goldcrest-FX-Live legacy technical baseline: ${legacySignal.direction}, score ${legacySignal.score}/100. ${(legacySignal.reasons || []).slice(0, 3).join(' ')}`,
          metadata: {
            source: 'GOLDCREST_FX_LIVE_LEGACY_BASELINE',
            candleCount: fifteen.candles.length,
            modelVersion: 'xgboost_forex_v1.0.0_baseline',
            heuristicProbability: legacySignal.mlProbability,
            calibratedProbability: false,
            noTradeReasons: legacySignal.noTradeReasons || []
          }
        });
      } catch (error: any) {
        observations.push({
          engine: 'LEGACY_TECHNICAL',
          direction: 'NO_TRADE',
          evidenceState: 'ERROR',
          timestamp: cutoff,
          reason: `Goldcrest-FX-Live legacy technical baseline failed: ${error?.message || String(error)}`
        });
      }
    } else {
      observations.push({
        engine: 'LEGACY_TECHNICAL',
        direction: 'NO_TRADE',
        evidenceState: fifteen.fresh ? 'INSUFFICIENT_DATA' : 'STALE',
        timestamp: cutoff,
        reason: `Legacy technical baseline requires 60 fresh, actual 15M candles; received ${fifteen.candles.length}.`,
        metadata: {
          source: 'GOLDCREST_FX_LIVE_LEGACY_BASELINE',
          candleCount: fifteen.candles.length
        }
      });
    }

    if (!fifteen.sufficient || !fifteen.fresh) {
      observations.push({
        engine: 'COMBINED_STATISTICAL', direction: 'NO_TRADE', evidenceState: fifteen.fresh ? 'INSUFFICIENT_DATA' : 'STALE',
        timestamp: cutoff, reason: `Statistical predictor requires at least 35 valid, cutoff-bounded 15M candles with a fresh latest bar; received ${fifteen.candles.length}.`
      });
    } else {
      let articles = [];
      const snapshot = input.newsSnapshot;
      const fetchedAt = snapshot?.fetchedAt ? Date.parse(snapshot.fetchedAt) : NaN;
      if (snapshot?.status === 'LIVE' && Number.isFinite(fetchedAt) && fetchedAt <= cutoff && cutoff - fetchedAt <= MAX_NEWS_AGE_MS) {
        articles = snapshot.articles.filter(article => {
          const published = article.publishedAt ? Date.parse(article.publishedAt) : NaN;
          return Number.isFinite(published) && published <= cutoff;
        });
      }
      try {
        const prediction = await CombinedPredictionEngine.predict({
          pair,
          horizon: '15M',
          currentClose: (Number(input.quote.bid) + Number(input.quote.ask)) / 2,
          candles: fifteen.candles.map(c => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
          newsArticles: articles,
          spreadPips: input.quote.spreadPips,
          cutoffTimestamp: cutoff
        });
        const supported = prediction.recommendation === 'TRADE_BUY' || prediction.recommendation === 'TRADE_SELL';
        const historySufficient = prediction.evidence.historical.isSampleSufficient
          && Number(prediction.sampleSize) >= 25;
        const engineAvailable = historySufficient && articles.length > 0
          && snapshot?.status === 'LIVE' && Number.isFinite(fetchedAt)
          && cutoff - fetchedAt >= 0 && cutoff - fetchedAt <= MAX_NEWS_AGE_MS
          && prediction.evidence.news.relevantArticles > 0;
        observations.push({
          engine: 'COMBINED_STATISTICAL',
          direction: supported ? (prediction.recommendation === 'TRADE_BUY' ? 'BUY' : 'SELL') : 'NO_TRADE',
          evidenceState: engineAvailable ? 'AVAILABLE' : 'INSUFFICIENT_DATA',
          timestamp: prediction.timestamp,
          confidence: prediction.calibratedConfidence,
          expectedValuePips: prediction.expectedValue,
          spreadPips: input.quote.spreadPips,
          sampleSize: prediction.sampleSize,
          reason: !engineAvailable
            ? `Statistical engine is shadow-only without sufficient genuine history and fresh pair-relevant news (history=${prediction.sampleSize}; historical sufficient=${historySufficient}; fresh relevant articles=${prediction.evidence.news.relevantArticles}).`
            : supported
              ? `Statistical challenger ${prediction.recommendation}, calibrated confidence ${(prediction.calibratedConfidence * 100).toFixed(1)}%, after-cost EV ${prediction.expectedValue.toFixed(2)} pips.`
              : `Statistical challenger abstained (${prediction.direction}/${prediction.recommendation}): ${[...prediction.vetoReasons, ...prediction.reasons].slice(0, 3).join(' ')}.`,
          metadata: { modelVersion: 'GOLDCREST_CHALLENGER_V3', regime: prediction.regime, relevantNewsCount: prediction.evidence.news.relevantArticles, historySufficient }
        });
      } catch (error: any) {
        observations.push({
          engine: 'COMBINED_STATISTICAL', direction: 'NO_TRADE', evidenceState: 'ERROR',
          timestamp: cutoff, reason: `Statistical challenger failed: ${error?.message || String(error)}`
        });
      }
    }

    if (!five.sufficient || !five.fresh || !hourly.sufficient || !hourly.fresh) {
      observations.push({
        engine: 'ADVANCED_POLICY', direction: 'NO_TRADE',
        evidenceState: (!five.fresh || !hourly.fresh) ? 'STALE' : 'INSUFFICIENT_DATA',
        timestamp: cutoff,
        reason: `Advanced policy requires fresh real 5M (min 20) and 1H (min 15) candle histories; counts=${five.candles.length}/${hourly.candles.length}.`
      });
    } else {
      const newsSnapshot = input.newsSnapshot;
      const newsFetchedAt = newsSnapshot?.fetchedAt ? Date.parse(newsSnapshot.fetchedAt) : NaN;
      const freshNews = newsSnapshot?.status === 'LIVE' && Number.isFinite(newsFetchedAt)
        && newsFetchedAt <= cutoff && cutoff - newsFetchedAt <= MAX_NEWS_AGE_MS;
      const pairNews = freshNews ? NewsIntelligenceEngine.analyzeNewsForPair(
        pair, newsSnapshot!.articles, cutoff,
        input.incumbent.direction.includes('BUY') ? 'BUY' : input.incumbent.direction.includes('SELL') ? 'SELL' : 'NEUTRAL'
      ) : null;
      const policy = AdvancedQuantitativePredictiveEngine.evaluatePolicy({
        pair,
        candles5M: five.candles.map(c => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
        candles1H: hourly.candles.map(c => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
        currentPrice: (Number(input.quote.bid) + Number(input.quote.ask)) / 2,
        pipSize: pairConfig.pipSize,
        newsSentiment: pairNews ? {
          score: Number(((pairNews.relativeSentiment + 1) * 50).toFixed(1)),
          sentimentDelta: pairNews.relativeSentiment,
          dominantHeadlines: pairNews.dominantHeadlines,
          direction: pairNews.direction
        } : undefined
      });
      const engineAvailable = Boolean(pairNews && freshNews && pairNews.relevantArticles > 0);
      const directional = policy.orderAction === 'BUY' || policy.orderAction === 'SELL';
      observations.push({
        engine: 'ADVANCED_POLICY',
        direction: policy.orderAction,
        evidenceState: engineAvailable ? 'AVAILABLE' : 'INSUFFICIENT_DATA',
        timestamp: policy.timestamp,
        confidence: policy.confidenceScore,
        expectedValuePips: (policy.executionPlan.takeProfitPips * policy.confidenceScore)
          - (policy.executionPlan.stopLossPips * (1 - policy.confidenceScore))
          - input.quote.spreadPips,
        spreadPips: input.quote.spreadPips,
        reason: !engineAvailable
          ? 'Advanced deterministic policy result is not qualified because no fresh pair-relevant news snapshot was available.'
          : directional
            ? `Advanced deterministic policy ${policy.orderAction}, confidence ${(policy.confidenceScore * 100).toFixed(1)}%, 1H macro=${policy.macroStructure.timeframe_1H_trend}, session=${policy.marketVelocity.current_session}, RR=${policy.executionPlan.riskReward}.`
            : `Advanced deterministic policy abstained: ${policy.rejectionReasons.join(' ')}`,
        metadata: {
          deterministicPolicy: true,
          executionGatePassed: policy.executionGatePassed,
          macroTrend: policy.macroStructure.timeframe_1H_trend,
          session: policy.marketVelocity.current_session,
          dynamicStopLossPips: policy.executionPlan.stopLossPips,
          dynamicTakeProfitPips: policy.executionPlan.takeProfitPips,
          newsRelevantArticles: pairNews?.relevantArticles || 0,
          modelIncludesAI: false
        }
      });
    }

    return fusePredictionObservations({ pair, cutoffTimestamp: cutoff, observations });
  }
}

export const autoLivePredictionShadowService = new AutoLivePredictionShadowService();
