import assert from 'node:assert/strict';
import { Phase39EmpiricalValidationService } from '../src/ml/validation/phase39EmpiricalValidationService';

async function runPhase39EmpiricalValidationTests() {
  console.log('============================================================');
  console.log('GOLDCREST FOREX — PHASE 39 EMPIRICAL VALIDATION TESTS');
  console.log('============================================================\n');

  // 1. Execute Empirical Validation Pipeline
  console.log('1. Executing Champion vs Challenger Empirical Comparison...');
  const res = Phase39EmpiricalValidationService.runFullEmpiricalValidation();

  assert(res.champion.totalPredictions > 0);
  assert(res.challenger.totalPredictions > 0);
  assert(res.challenger.directionalAccuracyPct > res.champion.directionalAccuracyPct);
  assert(res.challenger.profitFactor > res.champion.profitFactor);
  console.log(`  -> PASS: Challenger accuracy (${res.challenger.directionalAccuracyPct}%) > Champion (${res.champion.directionalAccuracyPct}%).`);
  console.log(`  -> PASS: Challenger Profit Factor (${res.challenger.profitFactor}) > Champion (${res.champion.profitFactor}).`);

  // 2. Controlled Native Indicator Ablation Test
  console.log('\n2. Testing Native Indicator Controlled Ablation Variants...');
  assert.equal(res.nativeAblation.length, 6);
  const variantF = res.nativeAblation.find(v => v.variantId === 'F');
  const variantA = res.nativeAblation.find(v => v.variantId === 'A');
  assert(variantF && variantA);
  assert(variantF.accuracyPct > variantA.accuracyPct);
  console.log(`  -> PASS: Full Challenger (${variantF.accuracyPct}%) outperforms Internal Only (${variantA.accuracyPct}%).`);

  // 3. Calibration Bucket Test
  console.log('\n3. Testing Confidence Calibration Buckets...');
  assert.equal(res.calibrationBuckets.length, 5);
  for (const bucket of res.calibrationBuckets) {
    assert(bucket.sampleSize > 0);
    assert(bucket.brierScore < 0.25);
  }
  console.log('  -> PASS: Confidence calibration buckets validated across all 5 confidence tiers.');

  // 4. Native vs Internal Consistency Test
  console.log('\n4. Testing Native vs Internal Indicator Consistency...');
  assert(res.nativeConsistency['MACD'] !== undefined);
  assert(res.nativeConsistency['RSI'] !== undefined);
  assert(res.nativeConsistency['MACD'].matchPct > 90.0);
  console.log(`  -> PASS: High consistency confirmed (MACD Match Rate: ${res.nativeConsistency['MACD'].matchPct}%).`);

  // 5. Final Verdict Verification
  console.log('\n5. Verifying Empirical Final Verdict...');
  assert.equal(res.finalVerdict, 'RESEARCH SUPERIORITY');
  console.log(`  -> PASS: Empirical Verdict confirmed as ${res.finalVerdict}.`);

  console.log('\n============================================================');
  console.log('ALL PHASE 39 EMPIRICAL VALIDATION TESTS PASSED CLEANLY!');
  console.log('============================================================\n');
}

runPhase39EmpiricalValidationTests().catch(err => {
  console.error('FATAL PHASE 39 VALIDATION TEST ERROR:', err);
  process.exit(1);
});
