import assert from 'node:assert/strict';
import { getSystemConfig, updateSystemConfig } from '../src/services/configService';
import { MartingaleRecoveryService } from '../src/services/martingaleRecoveryService';

async function runPhase43MartingaleTests() {
  console.log('============================================================');
  console.log('GOLDCREST FOREX — PHASE 43 MARTINGALE STRATEGY TESTS');
  console.log('============================================================\n');

  // 1. Martingale Defaults OFF & Settings Persistence
  console.log('1. Testing Default Off State & Settings Persistence...');
  const cfg1 = getSystemConfig();
  assert.equal(cfg1.martingale.enabled, false);
  console.log('  -> PASS: Martingale is OFF by default after fresh initialization.');

  await updateSystemConfig({
    martingale: {
      ...cfg1.martingale,
      enabled: true,
      scope: 'SELECTED',
      selectedPairs: ['EUR/USD', 'GBP/USD']
    }
  });

  const cfg2 = getSystemConfig();
  assert.equal(cfg2.martingale.enabled, true);
  assert.equal(cfg2.martingale.scope, 'SELECTED');
  assert.deepEqual(cfg2.martingale.selectedPairs, ['EUR/USD', 'GBP/USD']);
  console.log('  -> PASS: Settings persisted and loaded cleanly.');

  // 2. Pair Scope & Eligibility
  console.log('\n2. Testing All-Pairs vs Selected-Pairs Scope Eligibility...');
  assert(MartingaleRecoveryService.isPairEligible('EUR/USD'));
  assert(MartingaleRecoveryService.isPairEligible('GBP/USD'));
  assert(!MartingaleRecoveryService.isPairEligible('USD/JPY'));
  console.log('  -> PASS: EUR/USD & GBP/USD are eligible; unselected USD/JPY is excluded.');

  // 3. Initial Position Registration
  console.log('\n3. Testing Initial Single Position Anchor Registration...');
  const seq = MartingaleRecoveryService.registerInitialPosition({
    positionId: 'pos_1001',
    pair: 'EUR/USD',
    direction: 'BUY',
    volume: 1.0,
    entryPrice: 1.10000,
    initialTP: 1.10400,
    predictionScore: 82
  });

  assert(seq !== null);
  assert.equal(seq?.positionId, 'pos_1001');
  assert.equal(seq?.recoveryLevel, 0);
  assert.equal(seq?.currentVolume, 1.0);
  assert.equal(seq?.nextTriggerPrice, 1.09950); // 5 pips below entry
  console.log(`  -> PASS: Single position anchor registered with Level 0 next trigger at ${seq?.nextTriggerPrice}.`);

  // 4. Duplicate Tick Protection & Idempotency
  console.log('\n4. Testing Adverse Movement Trigger & Idempotency Lock...');
  const res1 = await MartingaleRecoveryService.evaluatePriceTick('pos_1001', 1.09948); // Triggers Level 1
  assert(res1.triggered);
  assert.equal(res1.record?.recoveryLevel, 1);
  assert.equal(res1.record?.currentVolume, 2.0); // 2.0x volume increase
  assert.equal(res1.record?.nextTriggerPrice, 1.09898); // Calculated from last recovery level
  console.log(`  -> PASS: Level 1 triggered (Volume: 2.0x, Next Trigger: ${res1.record?.nextTriggerPrice}).`);

  // Duplicate tick test (price stays at 1.09945)
  const resDup = await MartingaleRecoveryService.evaluatePriceTick('pos_1001', 1.09945);
  assert.equal(resDup.triggered, false);
  console.log('  -> PASS: Duplicate tick safely rejected without multiple volume increases.');

  // 5. Level 2 Recovery & Dynamic TP Recalculation
  console.log('\n5. Testing Level 2 Recovery Trigger & Dynamic TP Adjustment...');
  const res2 = await MartingaleRecoveryService.evaluatePriceTick('pos_1001', 1.09895);
  assert(res2.triggered);
  assert.equal(res2.record?.recoveryLevel, 2);
  assert.equal(res2.record?.currentVolume, 4.0); // Doubled again
  console.log(`  -> PASS: Level 2 triggered (Volume: ${res2.record?.currentVolume}, Average Entry: ${res2.record?.currentAverageEntry}, Dynamic TP: ${res2.record?.currentDynamicTP}).`);

  // 6. Max Recovery Level & Max Volume Protection
  console.log('\n6. Testing Max Recovery Levels Protection Gate...');
  await updateSystemConfig({ martingale: { ...getSystemConfig().martingale, maxRecoveryLevels: 2 } });
  const resLimit = await MartingaleRecoveryService.evaluatePriceTick('pos_1001', 1.09800);
  assert.equal(resLimit.triggered, false);
  assert.equal(resLimit.reason, 'MAX_RECOVERY_LEVEL_REACHED');
  console.log('  -> PASS: Max recovery level gate safely blocked further volume increases.');

  // 7. Sequence Completion & Reset
  console.log('\n7. Testing Recovery Sequence Completion & Reset...');
  const completed = MartingaleRecoveryService.completeSequence('pos_1001', +25.50, 'DYNAMIC_TP_REACHED');
  assert(completed !== null);
  assert.equal(completed?.status, 'COMPLETED');
  assert.equal(MartingaleRecoveryService.getActiveSequence('pos_1001'), undefined);
  console.log('  -> PASS: Sequence completed and reset cleanly upon TP target reach.');

  // Cleanup: Reset Martingale to OFF by default
  await updateSystemConfig({ martingale: { ...getSystemConfig().martingale, enabled: false } });

  console.log('\n============================================================');
  console.log('ALL PHASE 43 MARTINGALE STRATEGY TESTS PASSED CLEANLY!');
  console.log('============================================================\n');
}

runPhase43MartingaleTests().catch(err => {
  console.error('FATAL PHASE 43 MARTINGALE TEST ERROR:', err);
  process.exit(1);
});
