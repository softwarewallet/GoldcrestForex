// ============================================================================
// ORDER BOOK ENGINE — OBI (PHASE 9)
// ============================================================================

import { ComponentDirectionResult, OrderBookImbalanceResult } from './types';

export class OrderBookEngine {
  /**
   * Evaluates Order Book Imbalance (OBI). If DOM is absent, returns UNAVAILABLE without fabricating zero.
   */
  public static evaluateOrderBook(bidVolume?: number, askVolume?: number): ComponentDirectionResult {
    if (bidVolume === undefined || askVolume === undefined || (bidVolume === 0 && askVolume === 0)) {
      return {
        componentName: 'OrderBookEngine',
        direction: 'NEUTRAL',
        score: 0,
        strength: 0,
        confidence: 0,
        dataQuality: 'UNAVAILABLE',
        timestamp: Date.now(),
        featureVersion: '3.0.0',
        explanation: 'DOM / Level 2 order book data unavailable; marked UNAVAILABLE without proxy fabrication.'
      };
    }

    const total = bidVolume + askVolume;
    const obi = total > 0 ? (bidVolume - askVolume) / total : 0;
    let direction: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
    if (obi > 0.15) direction = 'UP';
    else if (obi < -0.15) direction = 'DOWN';

    return {
      componentName: 'OrderBookEngine',
      direction,
      score: Number(obi.toFixed(3)),
      strength: Math.abs(obi),
      confidence: Math.min(1.0, Math.abs(obi)),
      dataQuality: 'AVAILABLE',
      timestamp: Date.now(),
      featureVersion: '3.0.0',
      explanation: `Bid Depth: ${bidVolume}, Ask Depth: ${askVolume}, OBI: ${obi.toFixed(2)}`
    };
  }
}
