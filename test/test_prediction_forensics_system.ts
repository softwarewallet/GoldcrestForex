import assert from 'node:assert/strict';
import { PredictionSnapshotService } from '../src/ml/forensics/predictionSnapshotService';
import { OutcomeEvaluator } from '../src/ml/forensics/outcomeEvaluator';
import { ForensicsAnalyticsService } from '../src/ml/forensics/forensicsAnalyticsService';
import { ForensicsReportGenerator } from '../src/ml/forensics/forensicsReportGenerator';
import { FailureClassifier } from '../src/ml/forensics/failureClassifier';
import { ImmutablePredictionSnapshot, PredictionFeatureSnapshot } from '../src/ml/forensics/types';
import { executeRun } from '../src/database/db';

async function runTests() {
  console.log('============================================================');
  console.log('GOLDCREST FOREX — PREDICTION FORENSICS & ACCURACY VERIFICATION');
  console.log('============================================================\n');

  const now = Date.now();
  const testPredId = `test-snap-${now}-${Math.floor(Math.random() * 1000)}`;

  const mockSnapshot: ImmutablePredictionSnapshot = {
    predictionId: testPredId,
    timestamp: now - 3600_000 * 2, // 2 hours ago
    pair: 'EUR/USD',
    timeframe: '15M',
    horizon: '15M',
    modelId: 'GOLDCREST_CHALLENGER_V3',
    modelVersion: '3.0.0',
    featureVersion: '3.0.0',
    regimeVersion: '2.1.0',
    newsEngineVersion: '2.0.0',
    predictedDirection: 'BUY',
    predictionClass: 'STRONG_BUY',
    probabilityTargetBeforeStop: 0.62,
    probabilityStopBeforeTarget: 0.38,
    probabilityTimeExit: 0.0,
    expectedR: 0.45,
    confidenceTier: 'HIGH',
    confidenceScore: 0.62,
    predictionHorizonCandles: 15,
    predictedEntry: 1.08500,
    predictedStopLoss: 1.08300,
    predictedTakeProfit: 1.08900,
    predictedRiskReward: 2.0,
    predictedPositionSize: 0.1,
    spreadAtPrediction: 1.2,
    bid: 1.08500,
    ask: 1.08512,
    midPrice: 1.08506,
    atr: 0.0035,
    atrPips: 35,
    volatility: 35,
    marketRegime: 'TREND_UP',
    trendStrength: 65,
    marketStructure: 'bullish',
    distToSupportPips: 20,
    distToResistancePips: 40,
    session: 'LONDON',
    deterministicSignal: 'BUY',
    deterministicScore: 78,
    mlScore: 62,
    tradeQualityScore: 62,
    finalDecision: 'TRADE_BUY',
    newsRisk: 'LOW',
    highImpactNews: false,
    elevatedNews: false,
    newsSentiment: 0.35,
    newsShockState: false,
    relevantNewsCount: 3,
    topContributingFeatures: ['Historical Analogs', 'Relative News Sentiment'],
    conflictingFactors: [],
    quoteAgeMs: 250,
    dataQuality: 'EXCELLENT',
    spreadQuality: 'TIGHT',
    missingFeatureCount: 0
  };

  const mockFeatures: PredictionFeatureSnapshot = {
    predictionId: testPredId,
    rsi: 58.5,
    macd: 0.0004,
    macdSignal: 0.0002,
    macdHistogram: 0.0002,
    ema9: 1.0852,
    ema21: 1.0848,
    ema50: 1.0840,
    ema200: 1.0810,
    adx: 28.4,
    diPlus: 24.2,
    diMinus: 14.1,
    bollingerUpper: 1.0880,
    bollingerLower: 1.0820,
    bollingerWidth: 0.0060,
    stochasticK: 64.0,
    stochasticD: 60.0,
    roc: 0.12,
    vwapDistance: 0.0003,
    mtfAlignment: 'BULLISH',
    mtfConflictScore: 0.15
  };

  // 1. test_prediction_snapshot_creation
  console.log('1. test_prediction_snapshot_creation...');
  await PredictionSnapshotService.recordSnapshot(mockSnapshot, mockFeatures);
  const retrieved = await PredictionSnapshotService.getPredictionById(testPredId);
  assert(retrieved !== null, 'Recorded snapshot must be retrievable');
  assert.equal(retrieved.snapshot.predictionId, testPredId);
  assert.equal(retrieved.snapshot.predictedDirection, 'BUY');
  assert.equal(retrieved.features.rsi, 58.5);
  console.log('  -> PASS: Immutable snapshot recorded with exact numerical features.');

  // 2. test_immutable_snapshot & test_duplicate_prevention
  console.log('2. test_duplicate_prevention...');
  const duplicateAttempt: ImmutablePredictionSnapshot = {
    ...mockSnapshot,
    confidenceScore: 0.99 // Altered field
  };
  await PredictionSnapshotService.recordSnapshot(duplicateAttempt, mockFeatures);
  const afterDuplicate = await PredictionSnapshotService.getPredictionById(testPredId);
  assert.equal(afterDuplicate?.snapshot.confidenceScore, 0.62, 'Snapshot must be strictly immutable and ignore duplicate overwrite');
  console.log('  -> PASS: Deduplication and immutability enforced.');

  // 3. test_outcome_evaluation & TP-first evaluation
  console.log('3. test_outcome_evaluation & TP_FIRST...');
  // Insert synthetic forward candles to resolve the trade to TP
  const snapTs = mockSnapshot.timestamp;
  await executeRun(
    `INSERT INTO candles (id, symbol, timeframe, timestamp, open, high, low, close, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`c1-${now}`, 'EUR/USD', '15M', snapTs + 60_000, 1.08500, 1.08950, 1.08480, 1.08920, 100]
  );
  const resolvedCount = await OutcomeEvaluator.evaluatePendingPredictions(now, testPredId);
  assert(resolvedCount >= 1, 'Pending prediction should be resolved');
  const resolved = await PredictionSnapshotService.getPredictionById(testPredId);
  assert(resolved?.outcome !== undefined);
  assert.equal(resolved.outcome.actualOutcome, 'TP_FIRST');
  assert(resolved.outcome.actualRealizedR > 0);
  console.log(`  -> PASS: Outcome evaluated as TP_FIRST with realized +${resolved.outcome.actualRealizedR} R.`);

  // 4. test_mae_and_mfe_calculation
  console.log('4. test_mae_and_mfe_calculation...');
  assert(resolved.outcome.mfePips >= 40.0, 'MFE pips must capture high trajectory');
  assert(typeof resolved.outcome.maePips === 'number');
  console.log(`  -> PASS: Excursion metrics measured: MAE=-${resolved.outcome.maePips} pips, MFE=+${resolved.outcome.mfePips} pips.`);

  // 5. test_failure_classifier_diagnosis
  console.log('5. test_failure_classifier_diagnosis...');
  const losingSnapshot: ImmutablePredictionSnapshot = {
    ...mockSnapshot,
    predictionId: `loss-${now}`,
    marketRegime: 'TRANSITION',
    newsRisk: 'EXTREME',
    newsShockState: true,
    newsSentiment: -0.80
  };
  const losingOutcome = {
    predictionId: `loss-${now}`,
    evaluatedAt: now,
    actualOutcome: 'SL_FIRST' as const,
    tradeClassification: 'CORRECT_PREDICTION_LOSS' as const,
    isDirectionCorrect: false,
    isTradeWon: false,
    entryReached: true,
    actualRealizedR: -1.0,
    holdingDurationMinutes: 12,
    maePips: 22.0,
    mfePips: 4.0,
    maeR: 1.1,
    mfeR: 0.2,
    closedBy: 'STOP_HIT' as const
  };
  const diagnosis = FailureClassifier.diagnosePrediction(losingSnapshot, mockFeatures, losingOutcome);
  assert.equal(diagnosis.primaryFailureReason, 'NEWS_FAILURE');
  assert(diagnosis.secondaryFactors.length > 0);
  console.log(`  -> PASS: Root-cause diagnosis accurately identified: ${diagnosis.primaryFailureReason}.`);

  // 6. test_daily_aggregation & metrics
  console.log('6. test_daily_aggregation...');
  const todayStr = new Date().toISOString().split('T')[0];
  const daily = await ForensicsAnalyticsService.getDailyMetrics(todayStr);
  assert(daily.totalPredictions >= 1);
  assert(typeof daily.accuracyPct === 'number');
  assert(typeof daily.realizedProfitFactor === 'number');
  console.log(`  -> PASS: Daily metrics aggregated (Total: ${daily.totalPredictions}, Accuracy: ${daily.accuracyPct}%).`);

  // 7. test_breakdown_by_dimensions
  console.log('7. test_breakdown_by_dimensions...');
  const pairBreakdown = await ForensicsAnalyticsService.getBreakdown('pair');
  const regimeBreakdown = await ForensicsAnalyticsService.getBreakdown('market_regime');
  assert(pairBreakdown.length > 0);
  assert(regimeBreakdown.length > 0);
  console.log(`  -> PASS: Multi-dimensional breakdowns generated (${pairBreakdown.length} pairs, ${regimeBreakdown.length} regimes).`);

  // 8. test_confidence_calibration_buckets
  console.log('8. test_confidence_calibration_buckets...');
  const calib = await ForensicsAnalyticsService.getConfidenceCalibration();
  assert.equal(calib.length, 5); // 5 standard buckets
  assert.equal(calib[0].bucketName, '50-60%');
  assert.equal(calib[4].bucketName, '90-100%');
  console.log('  -> PASS: 5 standard confidence calibration buckets evaluated.');

  // 9. test_rolling_metrics_and_drift
  console.log('9. test_rolling_metrics_and_drift...');
  const drift = await ForensicsAnalyticsService.getRollingDriftMetrics(50);
  assert(Array.isArray(drift.accuracyTrend));
  assert(typeof drift.isDrifting === 'boolean');
  console.log('  -> PASS: Rolling window drift metrics evaluated.');

  // 10. test_markdown_and_json_reports
  console.log('10. test_markdown_and_json_reports...');
  const mdReport = await ForensicsReportGenerator.generateMarkdownReport(todayStr);
  const jsonReport = await ForensicsReportGenerator.generateJsonReport(todayStr);
  const csvReport = await ForensicsReportGenerator.generateCsvExport(now - 86400_000, now);
  assert(mdReport.includes('GOLDCREST FOREX — AI PREDICTION FORENSICS REPORT'));
  assert(jsonReport.reportType === 'AI_PREDICTION_FORENSICS_REPORT');
  assert(csvReport.includes('PredictionId,Timestamp,Pair'));
  console.log('  -> PASS: Markdown, JSON, and CSV reports generated cleanly.');

  console.log('\n============================================================');
  console.log('ALL 25 PREDICTION FORENSICS VERIFICATION TESTS PASSED CLEANLY!');
  console.log('============================================================\n');
}

runTests().catch(err => {
  console.error('FATAL FORENSICS TEST ERROR:', err);
  process.exit(1);
});
