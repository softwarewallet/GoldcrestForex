import assert from 'node:assert/strict';
import {
  buildCTraderSpotSubscriptionPayload,
  buildCTraderSpotUnsubscriptionPayload,
  getCTraderSpotSubscriptionRecoveryMode,
  normalizeCTraderSpotSymbolIds
} from '../src/brokers/adapters/cTrader/cTraderApiClient';

assert.deepEqual(normalizeCTraderSpotSymbolIds([101, 202, 101, 0, -4, Number.NaN, 303]), [101, 202, 303]);
assert.deepEqual(buildCTraderSpotSubscriptionPayload(789, [101, 202, 101]), {
  ctidTraderAccountId: 789,
  symbolId: [101, 202],
  subscribeToSpotTimestamp: true
});
assert.throws(() => buildCTraderSpotSubscriptionPayload(789, [0, -2]), /at least one valid symbol ID/);
assert.throws(() => buildCTraderSpotSubscriptionPayload(0, [101]), /valid cTrader account ID/);
assert.deepEqual(buildCTraderSpotUnsubscriptionPayload(789, [101, 202, 101]), {
  ctidTraderAccountId: 789,
  symbolId: [101, 202]
});

// A single already-active subscription is idempotently accepted, while a mixed
// batch is retried per symbol to avoid silently losing symbols from the batch.
assert.equal(getCTraderSpotSubscriptionRecoveryMode('SUBSCRIBE', 1, 'ALREADY_SUBSCRIBED'), 'SUCCESS');
assert.equal(getCTraderSpotSubscriptionRecoveryMode('SUBSCRIBE', 3, 'ALREADY_SUBSCRIBED'), 'SPLIT_RETRY');
assert.equal(getCTraderSpotSubscriptionRecoveryMode('SUBSCRIBE', 3, 'ACK_TIMEOUT'), 'SPLIT_RETRY');
assert.equal(getCTraderSpotSubscriptionRecoveryMode('SUBSCRIBE', 1, 'ACK_TIMEOUT'), 'FAIL');
assert.equal(getCTraderSpotSubscriptionRecoveryMode('SUBSCRIBE', 3, 'SYMBOL_NOT_FOUND'), 'FAIL');
assert.equal(getCTraderSpotSubscriptionRecoveryMode('UNSUBSCRIBE', 1, 'ALREADY_SUBSCRIBED'), 'FAIL');
console.log('PASS: cTrader spot subscriptions deduplicate payloads and recover idempotently.');
