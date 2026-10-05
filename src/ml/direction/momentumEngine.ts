// ============================================================================
// MOMENTUM ENGINE — MACD, RSI, ROC (PHASE 3)
// ============================================================================

import { ComponentDirectionResult, MACDResult } from './types';

export class MomentumEngine {
  /**
   * Calculates MACD (12, 26, 9), signal line, histogram, and momentum score.
   */
  public static calculateMACD(closes: number[]): MACDResult {
    if (!closes || closes.length < 35) {
      return {
        macdLine: 0,
        signalLine: 0,
        histogram: 0,
        histogramSlope: 0,
        zeroLinePosition: 'ABOVE',
        crossoverState: 'NONE',
        distance: 0,
        score: 0
      };
    }

    const ema12 = this.calculateEMA(closes, 12);
    const ema26 = this.calculateEMA(closes, 26);
    const macdSeries: number[] = [];

    for (let i = 0; i < closes.length; i++) {
      if (i >= 25) {
        macdSeries.push(ema12[i] - ema26[i]);
      } else {
        macdSeries.push(0);
      }
    }

    const signalSeries = this.calculateEMA(macdSeries, 9);
    const currentIdx = closes.length - 1;
    const macdLine = macdSeries[currentIdx];
    const signalLine = signalSeries[currentIdx];
    const histogram = macdLine - signalLine;
    const prevHistogram = currentIdx > 0 ? macdSeries[currentIdx - 1] - signalSeries[currentIdx - 1] : histogram;
    const histogramSlope = histogram - prevHistogram;

    const prevMacd = currentIdx > 0 ? macdSeries[currentIdx - 1] : macdLine;
    const prevSignal = currentIdx > 0 ? signalSeries[currentIdx - 1] : signalLine;

    let crossoverState: 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'NONE' = 'NONE';
    if (prevMacd <= prevSignal && macdLine > signalLine) {
      crossoverState = 'BULLISH_CROSS';
    } else if (prevMacd >= prevSignal && macdLine < signalLine) {
      crossoverState = 'BEARISH_CROSS';
    }

    const zeroLinePosition = macdLine >= 0 ? 'ABOVE' : 'BELOW';
    const distance = Math.abs(macdLine - signalLine);

    // Score calculation (-1 to +1)
    let score = 0;
    if (macdLine > signalLine) score += 0.4;
    else score -= 0.4;

    if (histogramSlope > 0) score += 0.3;
    else score -= 0.3;

    if (macdLine > 0) score += 0.3;
    else score -= 0.3;

    score = Math.max(-1.0, Math.min(1.0, score));

    return {
      macdLine: Number(macdLine.toFixed(6)),
      signalLine: Number(signalLine.toFixed(6)),
      histogram: Number(histogram.toFixed(6)),
      histogramSlope: Number(histogramSlope.toFixed(6)),
      zeroLinePosition,
      crossoverState,
      distance: Number(distance.toFixed(6)),
      score: Number(score.toFixed(3))
    };
  }

  public static evaluateMomentum(closes: number[]): ComponentDirectionResult {
    const macd = this.calculateMACD(closes);
    let direction: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
    if (macd.score > 0.15) direction = 'UP';
    else if (macd.score < -0.15) direction = 'DOWN';

    return {
      componentName: 'MomentumEngine',
      direction,
      score: macd.score,
      strength: Math.abs(macd.score),
      confidence: Math.min(1.0, Math.abs(macd.score) * 1.2),
      dataQuality: closes.length >= 35 ? 'AVAILABLE' : 'LOW_QUALITY',
      timestamp: Date.now(),
      featureVersion: '3.0.0',
      explanation: `MACD Line: ${macd.macdLine}, Signal: ${macd.signalLine}, HistSlope: ${macd.histogramSlope}, State: ${macd.crossoverState}`
    };
  }

  private static calculateEMA(data: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const emaArray: number[] = [];
    let prevEMA = data[0];
    for (let i = 0; i < data.length; i++) {
      if (i === 0) {
        emaArray.push(data[0]);
      } else {
        const currentEMA = data[i] * k + prevEMA * (1 - k);
        emaArray.push(currentEMA);
        prevEMA = currentEMA;
      }
    }
    return emaArray;
  }
}
