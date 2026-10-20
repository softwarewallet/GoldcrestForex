import assert from 'node:assert/strict';
import { compareResearchPredictions } from '../src/services/researchPredictionComparison';
import type { ResearchAiPrediction } from '../src/services/researchAiGateway';

function ai(direction: ResearchAiPrediction['direction'], confidence = 0.72): ResearchAiPrediction {
  return {
    direction,
    confidence,
    rationale: ['independent research output'],
    model: 'test-model',
    generatedAt: Date.now()
  };
}

const agree = compareResearchPredictions({ direction: 'UP', confidence: 0.8, recommendation: 'TRADE_BUY' }, ai('UP'));
assert.equal(agree.agreement, 'AGREE');
assert.equal(agree.actionable, false);
assert.equal(agree.scope, 'RESEARCH_ONLY');
assert.equal(agree.baseline.recommendation, 'TRADE_BUY');

const disagree = compareResearchPredictions({ direction: 'UP', confidence: 0.8 }, ai('DOWN'));
assert.equal(disagree.agreement, 'DISAGREE');
assert.equal(disagree.actionable, false);

const aiNeutral = compareResearchPredictions({ direction: 'DOWN', confidence: 0.7 }, ai('FLAT'));
assert.equal(aiNeutral.agreement, 'AI_NEUTRAL');

const insufficient = compareResearchPredictions({ direction: 'INSUFFICIENT_DATA', confidence: 0.3 }, ai('DOWN'));
assert.equal(insufficient.agreement, 'BASELINE_NEUTRAL');

const invalidConfidence = compareResearchPredictions({ direction: 'UP', confidence: Number.NaN }, {
  ...ai('UP', Number.POSITIVE_INFINITY),
  rationale: Array.from({ length: 10 }, (_, i) => `reason-${i}`).map(x => x.repeat(50))
});
assert.equal(invalidConfidence.baseline.confidence, 0);
assert.equal(invalidConfidence.ai.confidence, 0);
assert.equal(invalidConfidence.ai.rationale.length, 6);
assert.equal(invalidConfidence.ai.rationale.every(x => x.length <= 240), true);

console.log('PASS: research prediction comparison contract tests');
