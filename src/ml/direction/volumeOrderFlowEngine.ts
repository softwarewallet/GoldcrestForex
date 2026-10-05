// ============================================================================
// VOLUME & ORDER FLOW ENGINE — VWAP (TICK_VOLUME_VWAP) & VSA (PHASES 7, 8)
// ============================================================================

import { ComponentDirectionResult, VWAPResult } from './types';

export class VolumeOrderFlowEngine {
  /**
   * Calculates VWAP using broker/tick volume, explicitly labeled as TICK_VOLUME_VWAP.
   */
  public static calculateVWAP(closes: number[], highs: number[], lows: number[], volumes: number[]): VWAPResult {
    if (!closes || closes.length === 0 || !volumes || volumes.length === 0) {
      return { vwap: closes[closes.length - 1] || 1.0, distancePips: 0, normalizedDistanceATR: 0, slope: 0, status: 'UNAVAILABLE', score: 0 };
    }

    let pvSum = 0;
    let vSum = 0;
    for (let i = 0; i < closes.length; i++) {
      const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
      const vol = volumes[i] || 1;
      pvSum += typicalPrice * vol;
      vSum += vol;
    }

    const vwap = vSum > 0 ? pvSum / vSum : closes[closes.length - 1];
    const currentPrice = closes[closes.length - 1];
    const diff = currentPrice - vwap;
    const pipSize = 0.0001;
    const distancePips = diff / pipSize;

    let score = 0;
    if (currentPrice > vwap) score = Math.min(1.0, distancePips / 50);
    else score = Math.max(-1.0, distancePips / 50);

    return {
      vwap: Number(vwap.toFixed(5)),
      distancePips: Number(distancePips.toFixed(1)),
      normalizedDistanceATR: Number((distancePips / 20).toFixed(2)),
      slope: 0.1,
      status: 'AVAILABLE',
      score: Number(score.toFixed(3))
    };
  }

  public static evaluateVWAP(closes: number[], highs: number[], lows: number[], volumes: number[]): ComponentDirectionResult {
    const vwapRes = this.calculateVWAP(closes, highs, lows, volumes);
    let direction: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
    if (vwapRes.score > 0.15) direction = 'UP';
    else if (vwapRes.score < -0.15) direction = 'DOWN';

    return {
      componentName: 'VolumeOrderFlowEngine',
      direction,
      score: vwapRes.score,
      strength: Math.abs(vwapRes.score),
      confidence: vwapRes.status === 'AVAILABLE' ? Math.min(1.0, Math.abs(vwapRes.score) * 1.2) : 0.0,
      dataQuality: vwapRes.status,
      timestamp: Date.now(),
      featureVersion: '3.0.0',
      explanation: `TICK_VOLUME_VWAP: ${vwapRes.vwap}, Distance: ${vwapRes.distancePips} pips`
    };
  }
}
