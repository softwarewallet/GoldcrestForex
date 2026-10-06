// ============================================================================
// GOLDCREST FOREX — PHASE 44 SHORT-TP OPTIMIZATION ENGINE TEST SUITE
// ============================================================================

import assert from 'node:assert/strict';
import {
  ShortTpOptimizationEngine,
  SHORT_TP_CANDIDATES,
  HARD_MAX_SHORT_TP_PIPS
} from '../src/ml/direction/shortTpOptimizationEngine';
import { getSystemConfig, updateSystemConfig } from '../src/services/configService';

async function runPhase44ShortTPOptimizationTests() {
  console.log('============================================================');
  console.log('GOLDCREST FOREX — PHASE 44 SHORT-TP OPTIMIZATION ENGINE TESTS');
  console.log('============================================================\n');

  // 1. Candidate Pool & Discrete Range Audit
  console.log('1. Testing discrete 1–5 pip candidate pool and hard maximum constraints...');
  const candidates = ShortTpOptimizationEngine.getCandidates();
  assert.equal(candidates.length, 5);
  assert.deepEqual(Array.from(candidates), [1.0, 2.0, 3.0, 4.0, 5.0]);
  assert.equal(HARD_MAX_SHORT_TP_PIPS, 5.0);
  console.log('  -> PASS: Exactly 5 discrete candidates (1.0, 2.0, 3.0, 4.0, 5.0 pips) verified.');

  // 2. Pip-Aware Precision Verification (EUR/USD vs USD/JPY)
  console.log('\n2. Testing pip precision and target price computation for Non-JPY & JPY pairs...');
  const pipEur = ShortTpOptimizationEngine.getPipSize('EUR/USD');
  const pipJpy = ShortTpOptimizationEngine.getPipSize('USD/JPY');
  assert.equal(pipEur, 0.0001);
  assert.equal(pipJpy, 0.01);

  // BUY EUR/USD
  const buyEurTp3 = ShortTpOptimizationEngine.calculateTargetPrice(1.08500, 'BUY', 3.0, 'EUR/USD');
  assert.equal(buyEurTp3, 1.08530);

  // SELL EUR/USD
  const sellEurTp2 = ShortTpOptimizationEngine.calculateTargetPrice(1.08500, 'SELL', 2.0, 'EUR/USD');
  assert.equal(sellEurTp2, 1.08480);

  // BUY USD/JPY
  const buyJpyTp4 = ShortTpOptimizationEngine.calculateTargetPrice(150.250, 'BUY', 4.0, 'USD/JPY');
  assert.equal(buyJpyTp4, 150.290);

  // SELL USD/JPY
  const sellJpyTp5 = ShortTpOptimizationEngine.calculateTargetPrice(150.250, 'SELL', 5.0, 'USD/JPY');
  assert.equal(sellJpyTp5, 150.200);

  // Cap test: Requesting 10 pips must cap at 5.0 pips
  const cappedBuy = ShortTpOptimizationEngine.calculateTargetPrice(1.08500, 'BUY', 10.0, 'EUR/USD');
  assert.equal(cappedBuy, 1.08550); // Capped at +5 pips
  console.log('  -> PASS: Pip sizing, JPY/Non-JPY scaling, and 5-pip hard cap ceiling verified.');

  // 3. Cost-Aware Net Expectancy Evaluation
  console.log('\n3. Testing cost-aware net expectancy optimization & qualification...');
  const highQualityInput = {
    pair: 'EUR/USD',
    direction: 'BUY' as const,
    entryPrice: 1.08500,
    riskBoundaryPips: 15.0,
    confidence: 0.78,
    probabilityUp: 0.75,
    probabilityDown: 0.25,
    atrPips: 12.0,
    spreadPips: 1.0
  };

  const highQualityDecision = ShortTpOptimizationEngine.evaluateShortTP(highQualityInput);
  assert.equal(highQualityDecision.decision, 'SHORT_TP_QUALIFIED');
  assert(highQualityDecision.selectedTPPips !== null);
  assert(highQualityDecision.selectedTPPips <= HARD_MAX_SHORT_TP_PIPS);
  assert(highQualityDecision.expectedNetR > 0.15);
  assert(highQualityDecision.targetPrice !== null);
  assert.equal(Object.keys(highQualityDecision.candidateMetrics).length, 5);

  // Check candidate metric net reward deduction
  const tp2Metric = highQualityDecision.candidateMetrics[2.0];
  assert(tp2Metric);
  assert.equal(tp2Metric.grossRewardPips, 2.0);
  assert(tp2Metric.netRewardPips < 2.0); // Cost deducted
  assert(tp2Metric.targetHitProbability > 0.50);
  console.log(`  -> PASS: Candidate evaluated: Selected TP=${highQualityDecision.selectedTPPips}p, Expected Net R=+${highQualityDecision.expectedNetR.toFixed(3)} R.`);

  // 4. Near-Target Reversal Analysis
  console.log('\n4. Testing near-target reversal detection & proximity buckets (90%, 80%, 70%)...');
  const reversalSummary = highQualityDecision.nearTargetReversals[5.0];
  assert(reversalSummary);
  assert(reversalSummary.reversals80PctCount > 0);
  assert(reversalSummary.reversals70PctCount >= reversalSummary.reversals80PctCount);
  assert(reversalSummary.rescuedByShorterTP[2.0] > 0);
  console.log(`  -> PASS: Near-target reversal buckets verified (80% count: ${reversalSummary.reversals80PctCount}, Rescued by 2p TP: ${reversalSummary.rescuedByShorterTP[2.0]}).`);

  // 5. Low-Edge Abstention (NO_TRADE Test)
  console.log('\n5. Testing low edge abstention (NO_TRADE Return)...');
  const lowEdgeInput = {
    pair: 'EUR/USD',
    direction: 'BUY' as const,
    entryPrice: 1.08500,
    riskBoundaryPips: 15.0,
    confidence: 0.51,
    probabilityUp: 0.51,
    probabilityDown: 0.49,
    spreadPips: 3.5 // Excessive spread wipes out expectancy
  };

  const lowEdgeDecision = ShortTpOptimizationEngine.evaluateShortTP(lowEdgeInput);
  assert.equal(lowEdgeDecision.decision, 'NO_TRADE');
  assert.equal(lowEdgeDecision.selectedTPPips, null);
  assert(lowEdgeDecision.reason.includes('No TP candidate achieved minimum positive net expectancy'));
  console.log('  -> PASS: Engine cleanly returns NO_TRADE when friction exceeds edge.');

  // 6. Empirical Historical Walk-Forward Research Engine
  console.log('\n6. Testing empirical historical walk-forward research generator...');
  const researchResults = await ShortTpOptimizationEngine.runHistoricalResearch();
  assert(researchResults.totalObservations > 0);
  assert.equal(researchResults.riskBoundaryPips, 15.0);
  assert.equal(Object.keys(researchResults.candidatesSummary).length, 5);
  assert(researchResults.optimizedPolicySummary.avgNetR > researchResults.existingWideTPSummary.avgNetR);
  assert(researchResults.optimizedPolicySummary.avgHoldingTimeMin < researchResults.existingWideTPSummary.avgHoldingTimeMin);
  assert(researchResults.nearTargetReversalFindings.percentSavedByShorterTP > 70);
  assert(researchResults.walkForwardResults.isRobust);
  assert(researchResults.statisticalSignificance.pValueVsWideTP < 0.05);
  assert(researchResults.riskBoundarySensitivity.length >= 3);
  assert(researchResults.probabilityCurves.buy[2.0] > 0.5);
  console.log(`  -> PASS: Research confirms Short-TP policy: Holding time cut by ${(100 - (researchResults.optimizedPolicySummary.avgHoldingTimeMin / researchResults.existingWideTPSummary.avgHoldingTimeMin) * 100).toFixed(1)}%, Saved Reversals: ${researchResults.nearTargetReversalFindings.percentSavedByShorterTP}%.`);

  // 7. Shadow Validation Storage & Retrieval
  console.log('\n7. Testing shadow evaluation recording & database retrieval...');
  await ShortTpOptimizationEngine.recordShadowEvaluation(
    'test_pred_p44_001',
    'EUR/USD',
    'BUY',
    1.08500,
    highQualityDecision
  );

  const recentEvals = await ShortTpOptimizationEngine.getRecentEvaluations(10);
  assert(Array.isArray(recentEvals));
  const found = recentEvals.find(e => e.prediction_id === 'test_pred_p44_001');
  assert(found, 'Recorded shadow evaluation must be retrievable from database');
  assert.equal(found.decision, 'SHORT_TP_QUALIFIED');

  const shadowSummary = await ShortTpOptimizationEngine.getShadowSummary();
  assert(shadowSummary.totalEvaluations >= 1);
  console.log(`  -> PASS: Shadow evaluation recorded & retrieved successfully (Total shadow evals: ${shadowSummary.totalEvaluations}).`);

  // 8. Regression Safety Check: Default Disabled State
  console.log('\n8. Testing default safety configuration (shortTPOptimization.enabled = false)...');
  const sysConfig = getSystemConfig();
  assert(sysConfig.shortTPOptimization !== undefined);
  assert.equal(sysConfig.shortTPOptimization.enabled, false);
  assert.equal(sysConfig.shortTPOptimization.mode, 'SHADOW');
  assert.equal(sysConfig.shortTPOptimization.maxTpPips, 5.0);
  console.log('  -> PASS: Default safety rule enforced: shortTPOptimization.enabled is false by default.');

  console.log('\n============================================================');
  console.log('ALL PHASE 44 SHORT-TP OPTIMIZATION TESTS PASSED CLEANLY!');
  console.log('============================================================\n');
}

runPhase44ShortTPOptimizationTests().catch(err => {
  console.error('FATAL PHASE 44 SHORT-TP TEST ERROR:', err);
  process.exit(1);
});
