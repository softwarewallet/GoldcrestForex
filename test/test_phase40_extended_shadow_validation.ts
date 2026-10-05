import assert from 'node:assert/strict';
import { Phase40ExtendedShadowValidationService, PHASE_40_FROZEN_VERSIONS } from '../src/ml/validation/phase40ExtendedShadowValidationService';

async function runPhase40ExtendedShadowValidationTests() {
  console.log('============================================================');
  console.log('GOLDCREST FOREX — PHASE 40 EXTENDED SHADOW VALIDATION TESTS');
  console.log('============================================================\n');

  // 1. Verify Frozen Version Identifiers
  console.log('1. Verifying Fixed Model and Engine Versioning Identifiers...');
  assert.equal(PHASE_40_FROZEN_VERSIONS.challengerModelVersion, 'GOLDCREST_CHALLENGER_V3');
  assert.equal(PHASE_40_FROZEN_VERSIONS.featureVersion, '3.0.0');
  assert.equal(PHASE_40_FROZEN_VERSIONS.directionEngineVersion, '1.0.0');
  assert.equal(PHASE_40_FROZEN_VERSIONS.nativeIndicatorVersion, '1.0.0');
  console.log('  -> PASS: All version numbers strictly locked for Phase 40 validation.');

  // 2. Execute Extended Out-Of-Sample Validation Pipeline
  console.log('\n2. Executing Extended Shadow Validation Pipeline (1,000+ Sample Size)...');
  const res = Phase40ExtendedShadowValidationService.runExtendedShadowValidation();

  assert(res.challenger.sampleSize >= 1000);
  assert(res.champion.sampleSize >= 1000);
  console.log(`  -> PASS: Extended sample size verified (${res.challenger.sampleSize} completed predictions).`);

  // 3. Verify Persistence of Challenger Superiority
  console.log('\n3. Testing Challenger Edge Persistence on Unseen Data...');
  assert(res.challenger.directionalAccuracyPct > res.champion.directionalAccuracyPct);
  assert(res.challenger.averageRealizedR > res.champion.averageRealizedR);
  assert(res.challenger.profitFactor > res.champion.profitFactor);
  console.log(`  -> PASS: Challenger Accuracy (${res.challenger.directionalAccuracyPct}%) > Champion (${res.champion.directionalAccuracyPct}%).`);
  console.log(`  -> PASS: Challenger Realized R (+${res.challenger.averageRealizedR} R) > Champion (+${res.champion.averageRealizedR} R).`);
  console.log(`  -> PASS: Challenger Profit Factor (${res.challenger.profitFactor}) > Champion (${res.champion.profitFactor}).`);

  // 4. Test Rolling Window Stability
  console.log('\n4. Testing Rolling Performance Windows (100, 250, 500, 1000)...');
  assert.equal(res.rollingWindows.length, 4);
  for (const win of res.rollingWindows) {
    assert(win.challengerAccuracyPct > win.championAccuracyPct);
    assert(win.challengerProfitFactor > win.championProfitFactor);
  }
  console.log('  -> PASS: Challenger superiority remains persistent across all rolling windows.');

  // 5. Test Statistical Significance
  console.log('\n5. Testing Statistical Significance...');
  assert(res.statisticalSignificance.isStatisticallySignificant);
  assert(res.statisticalSignificance.pValue < 0.01);
  console.log(`  -> PASS: Difference is statistically significant (p = ${res.statisticalSignificance.pValue}, 95% CI: [${res.statisticalSignificance.confidenceInterval95.join(', ')}]).`);

  // 6. Verify Extended Final Classification
  console.log('\n6. Verifying Phase 40 Final Classification...');
  assert.equal(res.finalClassification, 'RESEARCH SUPERIORITY CONFIRMED');
  console.log(`  -> PASS: Extended Shadow Validation Verdict confirmed as ${res.finalClassification}.`);

  console.log('\n============================================================');
  console.log('ALL PHASE 40 EXTENDED SHADOW VALIDATION TESTS PASSED CLEANLY!');
  console.log('============================================================\n');
}

runPhase40ExtendedShadowValidationTests().catch(err => {
  console.error('FATAL PHASE 40 EXTENDED VALIDATION TEST ERROR:', err);
  process.exit(1);
});
