import assert from 'node:assert/strict';
import { DynamicExitEngine } from '../src/ml/exits/dynamicExitEngine';

async function runPhase41DynamicExitEngineTests() {
  console.log('============================================================');
  console.log('GOLDCREST FOREX — PHASE 41 DYNAMIC EXIT ENGINE TESTS');
  console.log('============================================================\n');

  // 1. Candidate Pool Generation & Optimization
  console.log('1. Testing Candidate TP/SL Pool Generation & Expected Net R Optimization...');
  const inputBUY = {
    pair: 'EUR/USD',
    direction: 'UP' as const,
    horizon: '15M' as const,
    currentBid: 1.0850,
    currentAsk: 1.0851,
    spreadPips: 1.0,
    atrPips: 12.0,
    probabilityUp: 0.75,
    probabilityDown: 0.25,
    confidence: 0.75,
    nearestResistancePips: 15.0,
    nearestSupportPips: 20.0
  };

  const rec = DynamicExitEngine.calculateDynamicExit(inputBUY);
  assert.equal(rec.recommendation, 'EXECUTE_DYNAMIC_EXIT');
  assert(rec.candidatePool.length >= 25);
  assert(rec.expectedNetR > 0);
  assert(rec.tpDistancePips > 0);
  assert(rec.slDistancePips > 0);
  console.log(`  -> PASS: Generated ${rec.candidatePool.length} exit candidates. Best Net Expected R: +${rec.expectedNetR} R.`);

  // 2. Structure Barrier Constraints
  console.log('\n2. Testing Structural Resistance & Support Barrier Suppression...');
  const inputResistanceBlocked = {
    ...inputBUY,
    nearestResistancePips: 4.0 // Resistance extremely close
  };

  const recBlocked = DynamicExitEngine.calculateDynamicExit(inputResistanceBlocked);
  assert(recBlocked.tpDistancePips <= 12.0 || recBlocked.tpProbability < rec.tpProbability);
  console.log('  -> PASS: Structural resistance barrier correctly suppressed target reach probability for distant TPs.');

  // 3. Near-Target Reversal Detection
  console.log('\n3. Testing Near-Target Reversal Forensic Detection...');
  const reversalRecord = DynamicExitEngine.detectNearTargetReversal(
    'pred_123',
    'EUR/USD',
    10.0, // TP = 10 pips
    9.2,  // Reached +9.2 pips
    -5.0  // Reversed to -5.0 pips loss
  );

  assert(reversalRecord.isNearTargetReversal);
  assert.equal(reversalRecord.distanceRemainingToTpPips, 0.8);
  console.log(`  -> PASS: Near-target reversal correctly classified (MFE: +${reversalRecord.maxFavorableExcursionPips} pips, Distance to TP: ${reversalRecord.distanceRemainingToTpPips} pips).`);

  // 4. Exit Failure Classifier Diagnosis
  console.log('\n4. Testing Exit Failure Classification Diagnosis...');
  const failClass = DynamicExitEngine.classifyExitFailure(10.0, 10.0, 9.1, 10.0, -10.0);
  assert.equal(failClass, 'NEAR_TARGET_REVERSAL');
  console.log(`  -> PASS: Failure classified accurately as ${failClass}.`);

  // 5. No Edge Abstention Test
  console.log('\n5. Testing Low Edge Abstention (NO_EDGE Return)...');
  const lowEdgeInput = {
    ...inputBUY,
    probabilityUp: 0.35, // Low direction probability
    spreadPips: 4.5       // Excessive spread
  };

  const recNoEdge = DynamicExitEngine.calculateDynamicExit(lowEdgeInput);
  assert.equal(recNoEdge.recommendation, 'NO_EDGE');
  console.log('  -> PASS: Conservative NO_EDGE returned when no candidate produces positive net expected value after costs.');

  console.log('\n============================================================');
  console.log('ALL PHASE 41 DYNAMIC EXIT ENGINE TESTS PASSED CLEANLY!');
  console.log('============================================================\n');
}

runPhase41DynamicExitEngineTests().catch(err => {
  console.error('FATAL PHASE 41 DYNAMIC EXIT TEST ERROR:', err);
  process.exit(1);
});
