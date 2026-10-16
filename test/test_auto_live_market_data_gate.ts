import assert from 'node:assert/strict';
import { LiveForexProvider } from '../src/markets/forex/provider';
import {
  disableAutoLiveMarketDataSession,
  enableAutoLiveMarketDataSession,
  getAutoLiveMarketDataSessionStatus,
  isAutoLiveMarketDataEnabled,
  isAutoLiveMarketDataSessionCurrent
} from '../src/services/autoLiveMarketDataSession';

async function run() {
  console.log('AUTO LIVE MARKET-DATA START GATE TEST');

  disableAutoLiveMarketDataSession('test idle baseline');
  assert.equal(isAutoLiveMarketDataEnabled(), false, 'Market data must start disabled after application boot.');
  assert.equal(getAutoLiveMarketDataSessionStatus().enabled, false);

  const provider = new LiveForexProvider();
  await assert.rejects(
    () => provider.refreshPair('EUR/USD'),
    /paused until Start Auto Live/i,
    'Provider must refuse historical/candle refresh before Start Auto Live.'
  );

  // Idle subscription sync must return without connecting to the broker.
  await provider.syncActiveQuoteSubscriptions();
  assert.equal(isAutoLiveMarketDataEnabled(), false);

  const firstGeneration = enableAutoLiveMarketDataSession('test start');
  assert.equal(isAutoLiveMarketDataEnabled(), true, 'Start Auto Live opens the market-data session.');
  assert.equal(isAutoLiveMarketDataSessionCurrent(firstGeneration), true);

  disableAutoLiveMarketDataSession('test stop');
  assert.equal(isAutoLiveMarketDataEnabled(), false, 'Stop Auto Live closes the market-data session.');
  assert.equal(isAutoLiveMarketDataSessionCurrent(firstGeneration), false, 'Stop invalidates the prior session.');

  const restartedGeneration = enableAutoLiveMarketDataSession('test restart');
  assert.ok(restartedGeneration > firstGeneration, 'Restart must use a new generation token.');
  assert.equal(isAutoLiveMarketDataSessionCurrent(firstGeneration), false, 'Old in-flight work must not join a later run.');
  assert.equal(isAutoLiveMarketDataSessionCurrent(restartedGeneration), true);
  disableAutoLiveMarketDataSession('test cleanup');

  console.log('PASS: Broker candle/history work is blocked until Start Auto Live; Stop invalidates prior work.');
}

run().catch(error => {
  console.error('FAIL: Auto Live market-data gate test', error);
  process.exitCode = 1;
});
