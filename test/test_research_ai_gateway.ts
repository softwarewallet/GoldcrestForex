import assert from 'node:assert/strict';
import { sanitizeResearchFeatures, ResearchAiGateway } from '../src/services/researchAiGateway';

const asOf = Date.now();
const snapshot = sanitizeResearchFeatures({
  pair: 'eur/usd',
  horizon: '15M',
  asOf,
  features: {
    rsi14: 54.2,
    trend: 'bullish',
    newsStrength: 0.4,
    realizedPnl: 99999,
    actualOutcome: 'WIN',
    holdingDuration: 300,
    brokerAccessToken: 'must-not-pass',
    nested: { secret: true }
  }
});

assert.equal(snapshot.pair, 'EUR/USD');
assert.equal(snapshot.features.rsi14, 54.2);
assert.equal(snapshot.features.trend, 'bullish');
assert.equal('realizedPnl' in snapshot.features, false);
assert.equal('actualOutcome' in snapshot.features, false);
assert.equal('holdingDuration' in snapshot.features, false);
assert.equal('brokerAccessToken' in snapshot.features, false);
assert.equal('nested' in snapshot.features, false);

assert.throws(() => sanitizeResearchFeatures({
  pair: 'EURUSD',
  horizon: '15M',
  asOf,
  features: { rsi14: 50 }
}), /INVALID_PAIR/);

assert.throws(() => sanitizeResearchFeatures({
  pair: 'EUR/USD',
  horizon: '15M',
  asOf,
  features: { realizedPnl: 10 }
}), /NO_ALLOWED_FEATURES/);

const status = ResearchAiGateway.getStatus();
assert.equal(status.executionAccess, false);
assert.equal(status.provider, 'LLAMA_GATEWAY');

const configuredUrl = process.env.LLAMA_GATEWAY_URL;
process.env.LLAMA_GATEWAY_URL = '';
await assert.rejects(
  ResearchAiGateway.predict({
    pair: 'EUR/USD',
    horizon: '15M',
    asOf,
    features: { rsi14: 50 }
  }),
  /AI_GATEWAY_NOT_CONFIGURED/
);
if (configuredUrl === undefined) delete process.env.LLAMA_GATEWAY_URL;
else process.env.LLAMA_GATEWAY_URL = configuredUrl;

console.log('PASS: research AI gateway isolation, sanitization, and fail-closed tests');
