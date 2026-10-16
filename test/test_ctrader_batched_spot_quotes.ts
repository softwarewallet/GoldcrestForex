import assert from 'node:assert/strict';
import {
  buildCTraderSpotSubscriptionPayload,
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
console.log('PASS: cTrader spot subscriptions use a deduplicated multi-symbol payload.');
