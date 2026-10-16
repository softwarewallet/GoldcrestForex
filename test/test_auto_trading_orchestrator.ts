import assert from 'node:assert/strict';
import { autoTradingService, mapWithConcurrency, mapAutoLiveSignalForCockpit } from '../src/services/autoTradingService';
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

const mappedAutoLiveSignal = mapAutoLiveSignalForCockpit({
  id: 'signal-usdcad-test',
  timestamp: 1_800_000_000_000,
  pair: 'USD/CAD',
  direction: 'STRONG_BUY',
  strategyVersion: 'fx_structure_v2a',
  score: 82,
  mlProbability: 0.73,
  status: 'WAITING_FOR_ENTRY',
  reasons: ['Bullish structure'],
  tradePlan: {
    entryMin: 1.35,
    entryMax: 1.351,
    entryPreferred: 1.3505,
    entryType: 'PULLBACK_ENTRY',
    entryCondition: 'Confirm pullback',
    stopLoss: 1.345,
    stopLossReason: 'Below structure',
    takeProfit1: { targetPrice: 1.36, targetReason: 'R multiple', expectedR: 2 },
    takeProfit2: { targetPrice: 1.365, targetReason: 'Extension', expectedR: 3 },
    takeProfit3: { targetPrice: 1.37, targetReason: 'Extension', expectedR: 4 },
    riskDistancePips: 55,
    rewardDistancePips: 95,
    riskReward: 1.73,
    isValid: true
  }
});
assert.equal(mappedAutoLiveSignal.instrument, 'USD/CAD');
assert.equal(mappedAutoLiveSignal.direction, 'BUY');
assert.equal(mappedAutoLiveSignal.rawDirection, 'STRONG_BUY');
assert.equal(mappedAutoLiveSignal.score, 82);
assert.equal(mappedAutoLiveSignal.hasTradePlan, true);
assert.equal(mappedAutoLiveSignal.stopLoss, 1.345);
assert.equal(mappedAutoLiveSignal.target1, 1.36);
assert.deepEqual(mappedAutoLiveSignal.entryZone, { min: 1.35, max: 1.351, preferred: 1.3505 });

const mappedNeutralSignal = mapAutoLiveSignalForCockpit({
  id: 'signal-euraud-neutral-test',
  timestamp: 1_800_000_000_100,
  pair: 'EUR/AUD',
  direction: 'NEUTRAL',
  strategyVersion: 'fx_structure_v2a',
  score: 48,
  mlProbability: null,
  status: 'NO_TRADE',
  reasons: ['Conflicting timeframes'],
  tradePlan: null
});
assert.equal(mappedNeutralSignal.direction, 'NO_TRADE');
assert.equal(mappedNeutralSignal.hasTradePlan, false);
assert.equal(mappedNeutralSignal.target1, undefined);

console.log('AUTO-TRADING ORCHESTRATOR SAFETY TEST PASSED');
