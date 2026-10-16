import assert from 'node:assert/strict';
import {
  fusePredictionObservations,
  normalizePredictionSide,
  type PredictionEngineObservation
} from '../src/ml/fusion/predictionFusionOrchestrator';
import { evaluateLegacyForexSetup } from '../src/ml/fusion/legacyForexPredictionEngine';

const now = 1_800_000_000_000;

function obs(
  engine: PredictionEngineObservation['engine'],
  direction: PredictionEngineObservation['direction'],
  overrides: Partial<PredictionEngineObservation> = {}
): PredictionEngineObservation {
  return {
    engine,
    direction,
    evidenceState: 'AVAILABLE',
    timestamp: now,
    reason: `${engine} fixture`,
    ...overrides
  };
}

function runFusionTests() {
  assert.equal(normalizePredictionSide('STRONG_BUY'), 'BUY');
  assert.equal(normalizePredictionSide('STRONG_SELL'), 'SELL');
  assert.equal(normalizePredictionSide('WATCH_BUY'), 'NO_TRADE');
  assert.equal(normalizePredictionSide('NEUTRAL'), 'NO_TRADE');

  // The incumbent and a second, distinct technical method agree. Result is
  // explicitly observational and can never authorize live execution.
  const agreed = fusePredictionObservations({
    pair: 'EUR/USD',
    cutoffTimestamp: now,
    observations: [
      obs('FOREX_SIGNAL', 'BUY'),
      obs('LEGACY_TECHNICAL', 'BUY', {
        metadata: { source: 'GOLDCREST_FX_LIVE_LEGACY_BASELINE', candleCount: 80 }
      }),
      obs('COMBINED_STATISTICAL', 'NO_TRADE', { evidenceState: 'INSUFFICIENT_DATA' }),
      obs('ADVANCED_POLICY', 'NO_TRADE', { evidenceState: 'UNAVAILABLE' })
    ]
  });
  assert.equal(agreed.consensus, 'BUY');
  assert.equal(agreed.qualifiedVoteCount, 2);
  assert.equal(agreed.confidenceTier, 'HIGH_CONFLUENCE');
  assert.equal(agreed.executionAuthority, 'OBSERVATION_ONLY');

  // Missing legacy provenance means the method is not accepted as a vote.
  const unqualifiedLegacy = fusePredictionObservations({
    pair: 'EUR/USD',
    cutoffTimestamp: now,
    observations: [
      obs('FOREX_SIGNAL', 'BUY'),
      obs('LEGACY_TECHNICAL', 'BUY', { metadata: { candleCount: 80 } })
    ]
  });
  assert.equal(unqualifiedLegacy.consensus, 'NO_TRADE');
  assert.equal(unqualifiedLegacy.qualifiedVoteCount, 1);
  assert.equal(unqualifiedLegacy.confidenceTier, 'INSUFFICIENT_EVIDENCE');

  // Statistical signal must have enough actual analog samples and positive
  // cost-adjusted expectancy before contributing a directional vote.
  const statisticalNotEnoughSamples = fusePredictionObservations({
    pair: 'EUR/USD',
    cutoffTimestamp: now,
    observations: [
      obs('FOREX_SIGNAL', 'BUY'),
      obs('COMBINED_STATISTICAL', 'BUY', {
        confidence: 0.68,
        expectedValuePips: 3.2,
        sampleSize: 12
      })
    ]
  });
  assert.equal(statisticalNotEnoughSamples.consensus, 'NO_TRADE');
  assert.equal(statisticalNotEnoughSamples.qualifiedVoteCount, 1);

  const statisticalNegativeEv = fusePredictionObservations({
    pair: 'EUR/USD',
    cutoffTimestamp: now,
    observations: [
      obs('FOREX_SIGNAL', 'BUY'),
      obs('COMBINED_STATISTICAL', 'BUY', {
        confidence: 0.68,
        expectedValuePips: -0.4,
        sampleSize: 80
      })
    ]
  });
  assert.equal(statisticalNegativeEv.consensus, 'NO_TRADE');

  // Any future-dated evidence is discarded; it cannot cause look-ahead bias.
  const futureEvidence = fusePredictionObservations({
    pair: 'EUR/USD',
    cutoffTimestamp: now,
    observations: [
      obs('FOREX_SIGNAL', 'BUY'),
      obs('LEGACY_TECHNICAL', 'BUY', {
        timestamp: now + 1,
        metadata: { source: 'GOLDCREST_FX_LIVE_LEGACY_BASELINE', candleCount: 80 }
      })
    ]
  });
  assert.equal(futureEvidence.consensus, 'NO_TRADE');
  assert.equal(futureEvidence.observations.find(item => item.engine === 'LEGACY_TECHNICAL')?.evidenceState, 'STALE');

  // Stale evidence and champion disagreement must fail closed.
  const staleEvidence = fusePredictionObservations({
    pair: 'EUR/USD',
    cutoffTimestamp: now,
    observations: [
      obs('FOREX_SIGNAL', 'BUY'),
      obs('LEGACY_TECHNICAL', 'BUY', {
        timestamp: now - 120_000,
        metadata: { source: 'GOLDCREST_FX_LIVE_LEGACY_BASELINE', candleCount: 80 }
      })
    ]
  });
  assert.equal(staleEvidence.consensus, 'NO_TRADE');
  assert.equal(staleEvidence.qualifiedVoteCount, 1);

  const championDisagreement = fusePredictionObservations({
    pair: 'EUR/USD',
    cutoffTimestamp: now,
    observations: [
      obs('FOREX_SIGNAL', 'BUY'),
      obs('LEGACY_TECHNICAL', 'SELL', {
        metadata: { source: 'GOLDCREST_FX_LIVE_LEGACY_BASELINE', candleCount: 80 }
      }),
      obs('ADVANCED_POLICY', 'SELL', {
        confidence: 0.9,
        expectedValuePips: 5,
        metadata: { deterministicPolicy: true, executionGatePassed: true }
      })
    ]
  });
  assert.equal(championDisagreement.consensus, 'NO_TRADE');
  assert.equal(championDisagreement.confidenceTier, 'CONFLICT');

  const mixedVotes = fusePredictionObservations({
    pair: 'EUR/USD',
    cutoffTimestamp: now,
    observations: [
      obs('FOREX_SIGNAL', 'BUY'),
      obs('LEGACY_TECHNICAL', 'BUY', {
        metadata: { source: 'GOLDCREST_FX_LIVE_LEGACY_BASELINE', candleCount: 80 }
      }),
      obs('COMBINED_STATISTICAL', 'SELL', {
        confidence: 0.67, expectedValuePips: 2.1, sampleSize: 65
      }),
      obs('ADVANCED_POLICY', 'BUY', {
        confidence: 0.9, expectedValuePips: 4,
        metadata: { deterministicPolicy: true, executionGatePassed: true }
      })
    ]
  });
  assert.equal(mixedVotes.consensus, 'NO_TRADE', '25% opposing votes should force abstention');
  assert.equal(mixedVotes.confidenceTier, 'CONFLICT');

  // Legacy model is a separate rule-based baseline, not a calibrated ML model.
  const candles = Array.from({ length: 80 }, (_, index) => {
    const close = 1.08 + index * 0.0002 + Math.sin(index / 4) * 0.00008;
    return {
      timestamp: now - (79 - index) * 15 * 60_000,
      open: close - 0.00005,
      high: close + 0.00015,
      low: close - 0.00015,
      close,
      volume: 100 + index
    };
  });
  const baseline = evaluateLegacyForexSetup('EUR/USD', candles);
  assert(['BUY', 'SELL', 'WAIT', 'NO_TRADE'].includes(baseline.direction));
  assert(Number.isFinite(baseline.score));
  assert.equal(baseline.instrument, 'EUR/USD');
  assert.equal(baseline.modelVersion, 'xgboost_forex_v1.0.0_baseline');

  console.log('PREDICTION FUSION SHADOW TESTS PASSED');
}

runFusionTests();
