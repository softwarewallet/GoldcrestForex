import type { ResearchAiPrediction } from './researchAiGateway';

export interface DeterministicPredictionSummary {
  direction: string;
  confidence: number;
  recommendation?: string;
}

export interface ResearchPredictionComparison {
  scope: 'RESEARCH_ONLY';
  actionable: false;
  agreement: 'AGREE' | 'DISAGREE' | 'BASELINE_NEUTRAL' | 'AI_NEUTRAL';
  baseline: DeterministicPredictionSummary;
  ai: ResearchAiPrediction;
  observation: string;
}

/**
 * Compares independent research outputs without blending their scores or
 * creating an execution recommendation. This contract must never feed orders.
 */
export function compareResearchPredictions(
  baseline: DeterministicPredictionSummary,
  ai: ResearchAiPrediction
): ResearchPredictionComparison {
  const baselineDirection = normalizeDirection(baseline.direction);
  const aiDirection = normalizeDirection(ai.direction);

  let agreement: ResearchPredictionComparison['agreement'];
  if (baselineDirection === 'FLAT' || baselineDirection === 'INSUFFICIENT_DATA') {
    agreement = 'BASELINE_NEUTRAL';
  } else if (aiDirection === 'FLAT') {
    agreement = 'AI_NEUTRAL';
  } else {
    agreement = baselineDirection === aiDirection ? 'AGREE' : 'DISAGREE';
  }

  const observation = agreement === 'AGREE'
    ? 'Independent research models agree on direction; this is not an execution signal.'
    : agreement === 'DISAGREE'
      ? 'Research models disagree; preserve the disagreement for evaluation and do not infer a trade.'
      : agreement === 'AI_NEUTRAL'
        ? 'AI model abstained directionally; retain the deterministic baseline separately.'
        : 'Deterministic baseline is neutral or lacks sufficient evidence; do not infer a direction.';

  return {
    scope: 'RESEARCH_ONLY',
    actionable: false,
    agreement,
    baseline: {
      direction: String(baseline.direction),
      confidence: clampConfidence(baseline.confidence),
      ...(baseline.recommendation ? { recommendation: baseline.recommendation } : {})
    },
    ai: {
      direction: ai.direction,
      confidence: clampConfidence(ai.confidence),
      rationale: ai.rationale.slice(0, 6).map(item => item.slice(0, 240)),
      model: ai.model.slice(0, 100),
      generatedAt: ai.generatedAt
    },
    observation
  };
}

function normalizeDirection(direction: string): string {
  const value = direction.trim().toUpperCase();
  if (value === 'UP' || value === 'DOWN' || value === 'FLAT' || value === 'INSUFFICIENT_DATA') {
    return value;
  }
  return 'FLAT';
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
