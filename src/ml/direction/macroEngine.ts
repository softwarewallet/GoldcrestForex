// ============================================================================
// MACRO INTEREST-RATE DIFFERENTIAL ENGINE (PHASES 14, 15)
// ============================================================================

import { ComponentDirectionResult, MacroDifferentialResult } from './types';

export class MacroEngine {
  // Central bank interest rate repository (Effective 2026)
  private static rates: Record<string, number> = {
    USD: 4.50,
    EUR: 3.25,
    GBP: 4.00,
    JPY: 0.50,
    AUD: 4.10,
    CAD: 3.75,
    NZD: 4.25,
    CHF: 1.00
  };

  public static evaluateMacro(pair: string): ComponentDirectionResult {
    const parts = pair.split('/');
    if (parts.length !== 2) {
      return {
        componentName: 'MacroEngine',
        direction: 'NEUTRAL',
        score: 0, strength: 0, confidence: 0,
        dataQuality: 'UNAVAILABLE',
        timestamp: Date.now(), featureVersion: '3.0.0',
        explanation: 'Invalid pair format for macro rate differential.'
      };
    }

    const base = parts[0];
    const quote = parts[1];
    const baseRate = this.rates[base];
    const quoteRate = this.rates[quote];

    if (baseRate === undefined || quoteRate === undefined) {
      return {
        componentName: 'MacroEngine',
        direction: 'NEUTRAL',
        score: 0, strength: 0, confidence: 0,
        dataQuality: 'UNAVAILABLE',
        timestamp: Date.now(), featureVersion: '3.0.0',
        explanation: `Macro rate unavailable for ${base} or ${quote}.`
      };
    }

    const rateDifferential = baseRate - quoteRate; // e.g. EUR (3.25) - USD (4.50) = -1.25
    // Normalized score (-1 to +1) where +3% differential = +1.0 score
    const score = Math.max(-1.0, Math.min(1.0, rateDifferential / 3.0));
    let direction: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
    if (score > 0.15) direction = 'UP';
    else if (score < -0.15) direction = 'DOWN';

    return {
      componentName: 'MacroEngine',
      direction,
      score: Number(score.toFixed(3)),
      strength: Math.abs(score),
      confidence: 0.60, // Macro rate differential is a lower weight for intraday
      dataQuality: 'AVAILABLE',
      timestamp: Date.now(),
      featureVersion: '3.0.0',
      explanation: `${base} Rate (${baseRate}%) - ${quote} Rate (${quoteRate}%) = Differential ${rateDifferential.toFixed(2)}%`
    };
  }
}
