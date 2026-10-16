import assert from 'node:assert/strict';
import { autoTradingService, mapWithConcurrency } from '../src/services/autoTradingService';
import { LIVE_AUTO_EXECUTION_ALLOWED, refreshAutonomousExecutionPermission } from '../src/brokers/safety/AutoExecutionEngine';
import { getSystemConfig, updateSystemConfig } from '../src/services/configService';

const originalAuto = process.env.GOLDCREST_AUTO_TRADING_ENABLED;
const originalLiveAuto = process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION;
const originalLocalDevelopment = process.env.GOLDCREST_LOCAL_DEVELOPMENT;

process.env.GOLDCREST_LOCAL_DEVELOPMENT = 'false';
delete process.env.GOLDCREST_AUTO_TRADING_ENABLED;
delete process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION;

assert.equal(refreshAutonomousExecutionPermission(), false);
assert.equal(LIVE_AUTO_EXECUTION_ALLOWED, false);

const status = autoTradingService.start({ confirmWhenClosed: true });
assert.equal(status.state, 'BLOCKED');
assert.equal(status.enabledByEnvironment, false);
assert.match(status.lastCycleResult || '', /Autonomous execution is not enabled|production strategy has not been explicitly approved|blockers:/i);

autoTradingService.stop();

if (originalAuto === undefined) delete process.env.GOLDCREST_AUTO_TRADING_ENABLED;
else process.env.GOLDCREST_AUTO_TRADING_ENABLED = originalAuto;
if (originalLiveAuto === undefined) delete process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION;
else process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = originalLiveAuto;
if (originalLocalDevelopment === undefined) delete process.env.GOLDCREST_LOCAL_DEVELOPMENT;
else process.env.GOLDCREST_LOCAL_DEVELOPMENT = originalLocalDevelopment;


// Auto Live is sourced from Goldcrest-FX-Live and must never arm the adapter
// registered as CTRADER_LIVE when persisted cTrader settings route it to DEMO.
const originalConfig = getSystemConfig();
try {
  updateSystemConfig({ cTraderApiMode: 'DEMO' });
  process.env.GOLDCREST_LOCAL_DEVELOPMENT = 'false';
  process.env.GOLDCREST_AUTO_TRADING_ENABLED = 'true';
  process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = 'true';
  const demoStatus = autoTradingService.start({ confirmWhenClosed: true });
  assert.equal(/requires cTrader API mode LIVE/i.test(demoStatus.lastCycleResult || ''), false);
  // Mode itself must not be the blocker. Without valid DEMO credentials the
  // normal credential/readiness gate remains responsible for preventing orders.
  assert.equal(refreshAutonomousExecutionPermission(), false);
} finally {
  autoTradingService.stop('Restore test state');
  updateSystemConfig({
    cTraderApiMode: originalConfig.cTraderApiMode,
    liveTradingEnabled: originalConfig.liveTradingEnabled
  });
  if (originalAuto === undefined) delete process.env.GOLDCREST_AUTO_TRADING_ENABLED;
  else process.env.GOLDCREST_AUTO_TRADING_ENABLED = originalAuto;
  if (originalLiveAuto === undefined) delete process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION;
  else process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = originalLiveAuto;
  if (originalLocalDevelopment === undefined) delete process.env.GOLDCREST_LOCAL_DEVELOPMENT;
  else process.env.GOLDCREST_LOCAL_DEVELOPMENT = originalLocalDevelopment;
}

// Regression test: Auto Live market refreshes must be bounded so each pair
// cannot fan out history requests for the entire universe at the same time.
let activeWorkers = 0;
let maxActiveWorkers = 0;
const concurrencyResults = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async item => {
  activeWorkers += 1;
  maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
  await new Promise(resolve => setTimeout(resolve, 5));
  activeWorkers -= 1;
  return item * 2;
});
assert.deepEqual(concurrencyResults, [2, 4, 6, 8, 10]);
assert.ok(maxActiveWorkers <= 2, `expected at most 2 concurrent workers; observed ${maxActiveWorkers}`);

console.log('AUTO-TRADING ORCHESTRATOR SAFETY TEST PASSED');
