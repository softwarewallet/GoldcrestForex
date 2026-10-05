import assert from 'node:assert/strict';
import {
  tradeContinuityService,
  LOSS_STREAK_PAUSE_THRESHOLD,
  PROFIT_STREAK_AUTO_CONTINUE_THRESHOLD
} from '../src/services/tradeContinuityService';
import { autoTradingService } from '../src/services/autoTradingService';

console.log('STARTING TRADE CONTINUITY & CIRCUIT BREAKER TESTS...');

// Reset service for clean testing state
tradeContinuityService.resetStreaks();

let status = tradeContinuityService.getStatus();
assert.equal(status.consecutiveLossCount, 0, 'Initial consecutiveLossCount should be 0');
assert.equal(status.consecutiveProfitCount, 0, 'Initial consecutiveProfitCount should be 0');
assert.equal(status.isContinuityPaused, false, 'Initial isContinuityPaused should be false');
assert.equal(status.requiresContinuityAuthorization, false, 'Initial requiresContinuityAuthorization should be false');
assert.equal(status.isProfitContinuityActive, false, 'Initial isProfitContinuityActive should be false');
assert.equal(tradeContinuityService.canExecuteNewTrade().allowed, true, 'Initial execution should be allowed');

// 1. Test 19 consecutive losses - system should NOT pause yet
for (let i = 1; i <= 19; i++) {
  status = tradeContinuityService.simulateTradeOutcome(-15, 'EUR/USD');
  assert.equal(status.consecutiveLossCount, i, `Loss count should be ${i}`);
  assert.equal(status.consecutiveProfitCount, 0, 'Profit count should remain 0');
  assert.equal(status.isContinuityPaused, false, `Should not be paused at ${i} losses`);
  assert.equal(tradeContinuityService.canExecuteNewTrade().allowed, true, `Execution should still be allowed at ${i} losses`);
}

// 2. Test 20th consecutive loss - system MUST pause for executing new trades and require authorization
status = tradeContinuityService.simulateTradeOutcome(-15, 'EUR/USD');
assert.equal(status.consecutiveLossCount, 20, 'Loss count should be 20');
assert.equal(status.isContinuityPaused, true, 'System MUST pause on constant 20 lose trades');
assert.equal(status.requiresContinuityAuthorization, true, 'User authorization MUST be required');
assert.equal(tradeContinuityService.canExecuteNewTrade().allowed, false, 'Execution MUST be blocked');
assert.match(
  tradeContinuityService.canExecuteNewTrade().reason || '',
  /20 consecutive losing trades/i,
  'Reason must explain 20 consecutive losses'
);

// Verify autoTradingService receives the status
const autoStatus = autoTradingService.getStatus();
assert.equal(autoStatus.continuity.isContinuityPaused, true, 'autoTradingService should report isContinuityPaused=true');
assert.equal(autoStatus.continuity.consecutiveLossCount, 20, 'autoTradingService should report 20 losses');

// 3. Test user authorization for continuity
status = tradeContinuityService.authorizeContinuity('TEST_OPERATOR', 'Operator approved market continuity');
assert.equal(status.isContinuityPaused, false, 'isContinuityPaused must be false after operator authorization');
assert.equal(status.requiresContinuityAuthorization, false, 'requiresContinuityAuthorization must be false');
assert.equal(status.consecutiveLossCount, 0, 'Consecutive loss counter should be reset');
assert.equal(tradeContinuityService.canExecuteNewTrade().allowed, true, 'Execution MUST be allowed after authorization');
assert.equal(status.lastAuthorization?.authorizedBy, 'TEST_OPERATOR', 'Operator ID should be recorded');

// 4. Test continuity of 10 profit trades - system should automatically continue executing trades
tradeContinuityService.resetStreaks();

for (let i = 1; i <= 9; i++) {
  status = tradeContinuityService.simulateTradeOutcome(30, 'GBP/USD');
  assert.equal(status.consecutiveProfitCount, i, `Profit count should be ${i}`);
  assert.equal(status.consecutiveLossCount, 0, 'Loss count should be 0');
  assert.equal(status.isProfitContinuityActive, false, `Auto continuity should not be active at ${i} wins`);
  assert.equal(tradeContinuityService.canExecuteNewTrade().allowed, true);
}

// 10th consecutive win
status = tradeContinuityService.simulateTradeOutcome(30, 'GBP/USD');
assert.equal(status.consecutiveProfitCount, 10, 'Profit count should be 10');
assert.equal(status.isProfitContinuityActive, true, 'Continuity of 10 profit trades MUST activate auto-continuity');
assert.equal(status.isContinuityPaused, false, 'Must not be paused');
assert.equal(tradeContinuityService.canExecuteNewTrade().allowed, true, 'Trade execution MUST continue automatically');

// 5. Test that 10 consecutive profit trades auto-clears any continuity pause if triggered
// Simulate 20 losses
tradeContinuityService.resetStreaks();
for (let i = 1; i <= 20; i++) {
  tradeContinuityService.simulateTradeOutcome(-10, 'USD/JPY');
}
assert.equal(tradeContinuityService.getStatus().isContinuityPaused, true);

// Now simulate 10 consecutive profit trades without manual authorization
for (let i = 1; i <= 10; i++) {
  status = tradeContinuityService.simulateTradeOutcome(20, 'USD/JPY');
}
assert.equal(status.consecutiveProfitCount, 10, 'Profit count should be 10');
assert.equal(status.isProfitContinuityActive, true, 'isProfitContinuityActive should be true');
assert.equal(status.isContinuityPaused, false, 'Continuity of 10 profits must auto-clear pause');
assert.equal(status.requiresContinuityAuthorization, false, 'Continuity of 10 profits must auto-clear authorization requirement');
assert.equal(tradeContinuityService.canExecuteNewTrade().allowed, true, 'Execution must continue automatically');

// Clean up
tradeContinuityService.resetStreaks();

console.log('TRADE CONTINUITY & CIRCUIT BREAKER TESTS PASSED CLEANLY!');
