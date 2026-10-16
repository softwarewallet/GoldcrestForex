/**
 * Typed, deterministic and fail-closed comparison of the incumbent ForexSignalEngine
 * with the independent statistical prediction engines.
 *
 * This module is observational only. Its result MUST NOT authorize or submit orders.
 * Unavailable, stale, synthetic or insufficient evidence contributes no vote.
 */
export type PredictionSide = 'BUY' | 'SELL' | 'NO_TRADE';
export type PredictionEvidenceState = 'AVAILABLE' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE' | 'STALE' | 'ERROR';
export type ChallengerStatus = 'AGREES' | 'CONFLICTS' | 'NO_TRADE' | 'UNAVAILABLE' | 'INSUFFICIENT_DATA' | 'ERROR';

export interface PredictionEngineObservation {
  engine: 'FOREX_SIGNAL' | 'LEGACY_TECHNICAL' | 'COMBINED_STATISTICAL' | 'QUANTITATIVE_DIRECTION' | 'ADVANCED_POLICY';
  direction: PredictionSide;
  evidenceState: PredictionEvidenceState;
  timestamp: number;
  confidence?: number;
  expectedValuePips?: number;
  spreadPips?: number;
  sampleSize?: number;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface PredictionFusionInput {
  pair: string;
  cutoffTimestamp: number;
  observations: PredictionEngineObservation[];
}

export interface PredictionFusionResult {
  pair: string;
  timestamp: number;
  champion: PredictionEngineObservation | null;
  observations: PredictionEngineObservation[];
  qualifiedVoteCount: number;
  agreementCount: number;
  conflictCount: number;
  conflictRatio: number;
  consensus: PredictionSide;
  confidenceTier: 'HIGH_CONFLUENCE' | 'PARTIAL_AGREEMENT' | 'CONFLICT' | 'INSUFFICIENT_EVIDENCE' | 'NO_TRADE';
  rationale: string[];
  executionAuthority: 'OBSERVATION_ONLY';
}

const MAX_EVIDENCE_AGE_MS = 60_000;
const MIN_COMBINED_SAMPLE_SIZE = 25;
const ACTIONABLE_ENGINE_COUNT = 2;

/**
 * Normalizes raw signal-engine directions without converting WATCH to a trade.
 * Watch-only setups intentionally abstain from the directional consensus.
 */
export function normalizePredictionSide(direction: unknown): PredictionSide {
  const raw = String(direction || '').toUpperCase();
  if (raw === 'BUY' || raw === 'STRONG_BUY' || raw === 'WATCH_BUY') {
    return raw === 'WATCH_BUY' ? 'NO_TRADE' : 'BUY';
  }
  if (raw === 'SELL' || raw === 'STRONG_SELL' || raw === 'WATCH_SELL') {
    return raw === 'WATCH_SELL' ? 'NO_TRADE' : 'SELL';
  }
  if (raw === 'TRADE_BUY' || raw === 'QUALIFIED_BUY') return 'BUY';
  if (raw === 'TRADE_SELL' || raw === 'QUALIFIED_SELL') return 'SELL';
  return 'NO_TRADE';
}

function validProbability(value: unknown): number | undefined {
  const probability = Number(value);
  return Number.isFinite(probability) && probability >= 0 && probability <= 1
    ? probability
    : undefined;
}

/** Build a bounded, deterministic summary for shadow comparison and audits. */
export function fusePredictionObservations(input: PredictionFusionInput): PredictionFusionResult {
  const now = Number.isFinite(input.cutoffTimestamp) ? input.cutoffTimestamp : Date.now();
  const rationale: string[] = [];
  const deduped = new Map<PredictionEngineObservation['engine'], PredictionEngineObservation>();

  for (const source of input.observations || []) {
    const observedAt = Number(source.timestamp);
    let evidenceState = source.evidenceState;
    let reason = source.reason || 'No engine rationale supplied.';
    if (!Number.isFinite(observedAt) || observedAt > now) {
      evidenceState = 'STALE';
      reason += ' Rejected: observation timestamp is after the fusion cutoff.';
    } else if (now - observedAt > MAX_EVIDENCE_AGE_MS) {
      evidenceState = 'STALE';
      reason += ' Rejected: observation exceeded the evidence-freshness window.';
    }

    const normalized: PredictionEngineObservation = {
      ...source,
      direction: normalizePredictionSide(source.direction),
      evidenceState,
      timestamp: observedAt,
      reason
    };
    const existing = deduped.get(source.engine);
    if (!existing || normalized.timestamp > existing.timestamp) deduped.set(source.engine, normalized);
  }

  const observations = [...deduped.values()].sort((a, b) => a.engine.localeCompare(b.engine));
  const champion = observations.find(item => item.engine === 'FOREX_SIGNAL') || null;
  if (!champion) rationale.push('Incumbent ForexSignalEngine observation is missing.');
  if (champion && champion.evidenceState !== 'AVAILABLE') rationale.push('Incumbent signal evidence is not current and available.');

  const qualified = observations.filter(item => {
    if (item.evidenceState !== 'AVAILABLE') return false;
    if (item.direction === 'NO_TRADE') return false;
    if (now - item.timestamp < 0 || now - item.timestamp > MAX_EVIDENCE_AGE_MS) return false;
    if (item.engine === 'LEGACY_TECHNICAL') {
      return Number(item.metadata?.candleCount) >= 60
        && item.metadata?.source === 'GOLDCREST_FX_LIVE_LEGACY_BASELINE';
    }
    if (item.engine === 'COMBINED_STATISTICAL') {
      return Number(item.sampleSize) >= MIN_COMBINED_SAMPLE_SIZE
        && validProbability(item.confidence) !== undefined
        && Number.isFinite(Number(item.expectedValuePips))
        && Number(item.expectedValuePips) > 0;
    }
    if (item.engine === 'QUANTITATIVE_DIRECTION') {
      return validProbability(item.confidence) !== undefined
        && validProbability(item.metadata?.probability) !== undefined
        && Number.isFinite(Number(item.expectedValuePips))
        && Number(item.expectedValuePips) > 0
        && Number(item.metadata?.evidenceComponentCount) >= 3;
    }
    if (item.engine === 'ADVANCED_POLICY') {
      return validProbability(item.confidence) !== undefined
        && item.metadata?.deterministicPolicy === true
        && item.metadata?.executionGatePassed === true;
    }
    return true;
  });

  const buys = qualified.filter(item => item.direction === 'BUY').length;
  const sells = qualified.filter(item => item.direction === 'SELL').length;
  const conflicts = Math.min(buys, sells);
  const directionTotal = buys + sells;
  const conflictRatio = directionTotal > 0 ? conflicts / directionTotal : 0;
  const consensus: PredictionSide =
    directionTotal < ACTIONABLE_ENGINE_COUNT || conflictRatio > 0.25 || buys === sells
      ? 'NO_TRADE'
      : buys > sells ? 'BUY' : 'SELL';

  if (qualified.length < ACTIONABLE_ENGINE_COUNT) {
    rationale.push(`Only ${qualified.length} independent, fresh, evidence-qualified directional engine(s); ${ACTIONABLE_ENGINE_COUNT} required for consensus.`);
  }
  if (buys > 0 && sells > 0) {
    rationale.push(`Directional disagreement: ${buys} BUY vs ${sells} SELL evidence-qualified engines.`);
  }
  if (consensus !== 'NO_TRADE' && (!champion || champion.evidenceState !== 'AVAILABLE' || champion.direction !== consensus)) {
    rationale.push('Consensus does not match a current, available incumbent signal; fusion remains observational and abstains.');
  }
  if (consensus === 'NO_TRADE') rationale.push('No sufficiently supported directional consensus; abstain.');
  if (qualified.length >= ACTIONABLE_ENGINE_COUNT && consensus !== 'NO_TRADE') {
    rationale.push(`Shadow consensus ${consensus}: ${buys} BUY, ${sells} SELL qualified engine votes.`);
  }

  const executionQualified = consensus !== 'NO_TRADE'
    && Boolean(champion)
    && champion!.evidenceState === 'AVAILABLE'
    && champion!.direction === consensus;
  const confidenceTier: PredictionFusionResult['confidenceTier'] =
    consensus === 'NO_TRADE' ? (qualified.length < ACTIONABLE_ENGINE_COUNT ? 'INSUFFICIENT_EVIDENCE' : buys > 0 && sells > 0 ? 'CONFLICT' : 'NO_TRADE')
      : !executionQualified ? 'CONFLICT'
      : conflictRatio === 0 ? 'HIGH_CONFLUENCE' : 'PARTIAL_AGREEMENT';

  return {
    pair: input.pair,
    timestamp: now,
    champion,
    observations,
    qualifiedVoteCount: qualified.length,
    agreementCount: consensus === 'BUY' ? buys : consensus === 'SELL' ? sells : 0,
    conflictCount: conflicts,
    conflictRatio,
    consensus: executionQualified ? consensus : 'NO_TRADE',
    confidenceTier,
    rationale,
    executionAuthority: 'OBSERVATION_ONLY'
  };
}
