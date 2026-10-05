// ============================================================================
// NEWS & EVENT RISK ENGINE (PHASE 16)
// ============================================================================

import { ComponentDirectionResult } from './types';

export class NewsRiskEngine {
  public static evaluateNews(sentiment: number = 0, marketImpactScore: number = 0, highImpactActive: boolean = false): ComponentDirectionResult {
    const score = Math.max(-1.0, Math.min(1.0, sentiment));
    let direction: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
    if (score > 0.20) direction = 'UP';
    else if (score < -0.20) direction = 'DOWN';

    const quality = highImpactActive ? 'LOW_QUALITY' : 'AVAILABLE';

    return {
      componentName: 'NewsRiskEngine',
      direction,
      score: Number(score.toFixed(3)),
      strength: Math.abs(score),
      confidence: highImpactActive ? 0.30 : 0.70,
      dataQuality: quality,
      timestamp: Date.now(),
      featureVersion: '3.0.0',
      explanation: `News Sentiment: ${sentiment.toFixed(2)}, Impact Score: ${marketImpactScore.toFixed(2)}, HighImpact: ${highImpactActive}`
    };
  }
}
