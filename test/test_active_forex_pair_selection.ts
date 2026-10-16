import assert from 'node:assert/strict';
import { FOREX_PAIRS } from '../src/markets/forex/instruments';
import { resolveConfiguredActiveForexPairs } from '../src/markets/forex/activePairs';

const selected = resolveConfiguredActiveForexPairs(['eur/usd', 'GBP/USD', 'EURUSD', 'UNKNOWN/PAIR', 'GBP/USD']);
assert.deepEqual(selected.map(pair => pair.symbol), ['EUR/USD', 'GBP/USD']);
assert.deepEqual(resolveConfiguredActiveForexPairs([]), []);
assert.deepEqual(resolveConfiguredActiveForexPairs(null), []);
assert.deepEqual(resolveConfiguredActiveForexPairs(['NOT-A-PAIR']).map(pair => pair.symbol), []);
const knownPair = FOREX_PAIRS[0];
assert.deepEqual(
  resolveConfiguredActiveForexPairs([knownPair.symbol.toLowerCase()]).map(pair => pair.symbol),
  [knownPair.symbol]
);
console.log('PASS: active Forex selection preserves only supported, selected, unique pairs; empty means no pairs.');
