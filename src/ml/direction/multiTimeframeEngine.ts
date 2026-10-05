// ============================================================================
// MULTI-TIMEFRAME DIRECTION ENGINE (PHASE 11)
// ============================================================================

import { ComponentDirectionResult, MTFMatrixResult } from './types';

export class MultiTimeframeEngine {
  public static evaluateMTF(timeframesData: Record<string, { closes: number[] }>): ComponentDirectionResult {
    const timeframes = Object.keys(timeframesData);
    if (timeframes.length === 0) {
      return {
        componentName: 'MultiTimeframeEngine',
        direction: 'NEUTRAL',
        score: 0, strength: 0, confidence: 0,
        dataQuality: 'UNAVAILABLE',
        timestamp: Date.now(), featureVersion: '3.0.0',
        explanation: 'No MTF data supplied.'
      };
    }

    let bullishCount = 0;
    let bearishCount = 0;
    let neutralCount = 0;
    const tfResults: Record<string, { direction: 'UP' | 'DOWN' | 'NEUTRAL'; score: number; adx: number }> = {};

    for (const tf of timeframes) {
      const closes = timeframesData[tf].closes || [];
      if (closes.length < 20) {
        tfResults[tf] = { direction: 'NEUTRAL', score: 0, adx: 20 };
        neutralCount++;
        continue;
      }
      const last = closes[closes.length - 1];
      const prev = closes[closes.length - 10] || last;
      const diff = last - prev;
      let dir: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
      let score = 0;
      if (diff > 0.0005) { dir = 'UP'; bullishCount++; score = 0.8; }
      else if (diff < -0.0005) { dir = 'DOWN'; bearishCount++; score = -0.8; }
      else { neutralCount++; }

      tfResults[tf] = { direction: dir, score, adx: 28 };
    }

    const total = timeframes.length;
    const agreementRatio = total > 0 ? Math.max(bullishCount, bearishCount) / total : 0;
    const conflictRatio = 1 - agreementRatio;

    let netScore = 0;
    if (bullishCount > bearishCount) netScore = agreementRatio;
    else if (bearishCount > bullishCount) netScore = -agreementRatio;

    let direction: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
    if (netScore > 0.2) direction = 'UP';
    else if (netScore < -0.2) direction = 'DOWN';

    return {
      componentName: 'MultiTimeframeEngine',
      direction,
      score: Number(netScore.toFixed(3)),
      strength: agreementRatio,
      confidence: agreementRatio,
      dataQuality: 'AVAILABLE',
      timestamp: Date.now(),
      featureVersion: '3.0.0',
      explanation: `MTF Agreement: ${(agreementRatio * 100).toFixed(0)}% (Bullish: ${bullishCount}, Bearish: ${bearishCount}, Neutral: ${neutralCount})`
    };
  }
}
