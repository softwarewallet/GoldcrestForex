// ============================================================================
// HISTORICAL ANALOG & SIMILARITY ENGINE (PHASE 5)
// ============================================================================

import { HistoricalDatabaseExtractor } from './historicalDatabase';
import { HistoricalAnalogEvidence, HistoricalAnalogRecord, PredictionHorizon } from './types';

export interface MarketFeatureSnapshot {
  timestamp: number;
  close: number;
  returns1: number;
  returns5: number;
  returns15: number;
  rsi: number;
  macdHist: number;
  atrPct: number;
  ema20Dist: number;
  ema50Dist: number;
  vector: number[];
}

export class HistoricalAnalogEngine {
  public static readonly MIN_SAMPLE_SIZE = 25;
  public static readonly SIMILARITY_THRESHOLD = 0.70;

  /**
   * Evaluates historical analogs for a currency pair up to cutoffTimestamp.
   * GUARANTEE: Never uses candles or trades after cutoffTimestamp.
   */
  public static async findAnalogs(
    pair: string,
    horizon: PredictionHorizon = '15M',
    cutoffTimestamp: number = Date.now(),
    limitCandles: number = 500
  ): Promise<HistoricalAnalogEvidence> {
    const candles = await HistoricalDatabaseExtractor.getCandlesUpTo(pair, 'Daily', cutoffTimestamp, limitCandles);

    if (candles.length < 35) {
      return this.emptyEvidence('Insufficient historical candle count');
    }

    // Convert candles into sequential feature snapshots with forward outcomes
    const snapshots: Array<MarketFeatureSnapshot & {
      futureReturnPct: number;
      futureMaePct: number;
      futureMfePct: number;
      futureDirection: 'UP' | 'DOWN' | 'FLAT';
    }> = [];

    const horizonBars = horizon === '5M' ? 1 : horizon === '15M' ? 1 : horizon === '1H' ? 2 : horizon === '4H' ? 3 : 5;

    for (let i = 20; i < candles.length - horizonBars; i++) {
      const c = candles[i];
      const prev1 = candles[i - 1];
      const prev5 = candles[i - 5];
      const prev15 = candles[i - 15];

      const r1 = (c.close - prev1.close) / prev1.close;
      const r5 = (c.close - prev5.close) / prev5.close;
      const r15 = (c.close - prev15.close) / prev15.close;

      const rsi = this.calculateSimpleRSI(candles.slice(i - 14, i + 1));
      const atr = this.calculateSimpleATR(candles.slice(i - 14, i + 1));
      const atrPct = atr / c.close;

      const ema20 = this.calculateEMA(candles.slice(i - 20, i + 1), 20);
      const ema50 = this.calculateEMA(candles.slice(Math.max(0, i - 50), i + 1), 50);

      const ema20Dist = (c.close - ema20) / ema20;
      const ema50Dist = (c.close - ema50) / ema50;
      const macdHist = (c.close - ema20) - (c.close - ema50);

      // Normalized feature vector
      const vector = [
        r1 * 100,
        r5 * 50,
        r15 * 25,
        (rsi - 50) / 25,
        atrPct * 100,
        ema20Dist * 50,
        ema50Dist * 50,
        macdHist * 100
      ];

      // Forward outcome over horizonBars
      const futureCandles = candles.slice(i + 1, i + 1 + horizonBars);
      const targetClose = futureCandles[futureCandles.length - 1].close;
      const futureReturnPct = ((targetClose - c.close) / c.close) * 100;

      let minLow = c.close;
      let maxHigh = c.close;
      for (const fc of futureCandles) {
        if (fc.low < minLow) minLow = fc.low;
        if (fc.high > maxHigh) maxHigh = fc.high;
      }

      const futureMaePct = ((minLow - c.close) / c.close) * 100;
      const futureMfePct = ((maxHigh - c.close) / c.close) * 100;

      let futureDirection: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
      if (futureReturnPct > 0.12) futureDirection = 'UP';
      else if (futureReturnPct < -0.12) futureDirection = 'DOWN';

      snapshots.push({
        timestamp: c.timestamp,
        close: c.close,
        returns1: r1,
        returns5: r5,
        returns15: r15,
        rsi,
        macdHist,
        atrPct,
        ema20Dist,
        ema50Dist,
        vector,
        futureReturnPct,
        futureMaePct,
        futureMfePct,
        futureDirection
      });
    }

    if (snapshots.length < this.MIN_SAMPLE_SIZE) {
      return this.emptyEvidence('Insufficient historical snapshots for analog matching');
    }

    // Current market state is the latest available bar before cutoffTimestamp
    const currentSnapshot = snapshots[snapshots.length - 1];
    const candidateHistory = snapshots.slice(0, -horizonBars); // avoid forward overlap

    // Calculate similarity against historical records
    const scoredAnalogs: Array<{
      similarity: number;
      snapshot: (typeof snapshots)[0];
    }> = [];

    for (const hist of candidateHistory) {
      const sim = this.cosineSimilarity(currentSnapshot.vector, hist.vector);
      if (sim >= this.SIMILARITY_THRESHOLD) {
        scoredAnalogs.push({ similarity: sim, snapshot: hist });
      }
    }

    // Sort by descending similarity
    scoredAnalogs.sort((a, b) => b.similarity - a.similarity);

    const sampleSize = scoredAnalogs.length;
    const isSampleSufficient = sampleSize >= this.MIN_SAMPLE_SIZE;

    if (sampleSize === 0) {
      return this.emptyEvidence('No statistically similar historical situations found');
    }

    let upCount = 0;
    let downCount = 0;
    let flatCount = 0;
    let totalReturn = 0;
    let maxDrawdown = 0;
    let maxFavorable = 0;
    const returns: number[] = [];

    const topAnalogs: HistoricalAnalogRecord[] = scoredAnalogs.slice(0, 10).map(a => ({
      timestamp: a.snapshot.timestamp,
      similarity: Number(a.similarity.toFixed(3)),
      actualReturnPct: Number(a.snapshot.futureReturnPct.toFixed(3)),
      direction: a.snapshot.futureDirection,
      maePct: Number(a.snapshot.futureMaePct.toFixed(3)),
      mfePct: Number(a.snapshot.futureMfePct.toFixed(3)),
      holdingMinutes: horizonBars * 60
    }));

    for (const a of scoredAnalogs) {
      const ret = a.snapshot.futureReturnPct;
      returns.push(ret);
      totalReturn += ret;

      if (a.snapshot.futureDirection === 'UP') upCount++;
      else if (a.snapshot.futureDirection === 'DOWN') downCount++;
      else flatCount++;

      if (a.snapshot.futureMaePct < maxDrawdown) maxDrawdown = a.snapshot.futureMaePct;
      if (a.snapshot.futureMfePct > maxFavorable) maxFavorable = a.snapshot.futureMfePct;
    }

    const upProb = Number((upCount / sampleSize).toFixed(3));
    const downProb = Number((downCount / sampleSize).toFixed(3));
    const flatProb = Number((flatCount / sampleSize).toFixed(3));
    const avgReturn = Number((totalReturn / sampleSize).toFixed(3));

    returns.sort((a, b) => a - b);
    const medianReturn = Number((returns[Math.floor(returns.length / 2)] || 0).toFixed(3));

    // Win rate and profit factor based on dominant direction
    const dominantCount = Math.max(upCount, downCount);
    const winRate = Number((dominantCount / Math.max(1, upCount + downCount)).toFixed(3));

    let grossWin = 0;
    let grossLoss = 0;
    for (const r of returns) {
      if (r > 0) grossWin += r;
      else grossLoss += Math.abs(r);
    }
    const profitFactor = grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 3.0 : 0.5;
    const expectancy = Number(((winRate * (grossWin / Math.max(1, upCount))) - ((1 - winRate) * (grossLoss / Math.max(1, downCount)))).toFixed(3));

    // Confidence scales with sample size and edge magnitude
    const sampleFactor = Math.min(1, sampleSize / 80);
    const edgeMagnitude = Math.abs(upProb - downProb);
    const confidence = isSampleSufficient ? Number((edgeMagnitude * sampleFactor * 0.85 + 0.15).toFixed(3)) : 0.25;

    return {
      sampleSize,
      minRequiredSample: this.MIN_SAMPLE_SIZE,
      isSampleSufficient,
      historicalUpProbability: upProb,
      historicalDownProbability: downProb,
      historicalFlatProbability: flatProb,
      averageReturnPct: avgReturn,
      medianReturnPct: medianReturn,
      maxDrawdownPct: Number(maxDrawdown.toFixed(3)),
      maxFavorableExcursionPct: Number(maxFavorable.toFixed(3)),
      winRate,
      profitFactor,
      expectancy,
      confidence,
      topAnalogs
    };
  }

  private static cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const mag = Math.sqrt(magA) * Math.sqrt(magB);
    return mag > 0 ? Math.max(0, Math.min(1, dot / mag)) : 0;
  }

  private static calculateSimpleRSI(candles: Array<{ close: number }>): number {
    if (candles.length < 2) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < candles.length; i++) {
      const diff = candles[i].close - candles[i - 1].close;
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }

  private static calculateSimpleATR(candles: Array<{ high: number; low: number; close: number }>): number {
    if (candles.length < 2) return 0.001;
    let sum = 0;
    for (let i = 1; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      sum += tr;
    }
    return sum / (candles.length - 1);
  }

  private static calculateEMA(candles: Array<{ close: number }>, period: number): number {
    if (candles.length === 0) return 0;
    const k = 2 / (period + 1);
    let ema = candles[0].close;
    for (let i = 1; i < candles.length; i++) {
      ema = candles[i].close * k + ema * (1 - k);
    }
    return ema;
  }

  private static emptyEvidence(reason: string): HistoricalAnalogEvidence {
    return {
      sampleSize: 0,
      minRequiredSample: this.MIN_SAMPLE_SIZE,
      isSampleSufficient: false,
      historicalUpProbability: 0.33,
      historicalDownProbability: 0.33,
      historicalFlatProbability: 0.34,
      averageReturnPct: 0,
      medianReturnPct: 0,
      maxDrawdownPct: 0,
      maxFavorableExcursionPct: 0,
      winRate: 0,
      profitFactor: 1.0,
      expectancy: 0,
      confidence: 0,
      topAnalogs: []
    };
  }
}
