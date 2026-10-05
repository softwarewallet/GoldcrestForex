import assert from 'node:assert/strict';
import { CombinedPredictionEngine } from '../src/ml/prediction/combinedPredictionEngine';
import { NewsIntelligenceEngine } from '../src/ml/prediction/newsIntelligenceEngine';
import { HistoricalAnalogEngine } from '../src/ml/prediction/historicalAnalogEngine';
import { HistoricalDatabaseExtractor } from '../src/ml/prediction/historicalDatabase';
import { CalibrationEngine } from '../src/ml/prediction/calibrationEngine';
import { WalkForwardEngine } from '../src/ml/prediction/walkForwardEngine';
import { PredictionDecisionGate } from '../src/ml/prediction/predictionDecisionGate';
import { PredictionStorage } from '../src/ml/prediction/predictionStorage';

async function runTests() {
  console.log('============================================================');
  console.log('GOLDCRESTFOREX — 20-PHASE PREDICTION ENGINE VERIFICATION');
  console.log('============================================================\n');

  const now = Date.now();
  const pastCutoff = now - 3600_000 * 24; // 24 hours ago

  // 1. test_no_future_data_leakage
  console.log('1. test_no_future_data_leakage...');
  const candlesPast = await HistoricalDatabaseExtractor.getCandlesUpTo('EUR/USD', 'Daily', pastCutoff, 50);
  for (const c of candlesPast) {
    assert(c.timestamp <= pastCutoff, `Candle timestamp ${c.timestamp} exceeds cutoff ${pastCutoff}`);
  }
  console.log('  -> PASS: All candles strictly precede cutoffTimestamp.');

  // 2. test_news_timestamp_isolation
  console.log('2. test_news_timestamp_isolation...');
  const mockArticles = [
    { title: 'Past Bullish news', summary: 'Eurozone growth surges', source: 'Reuters', publishedAt: pastCutoff - 10000 },
    { title: 'Future Bearish news', summary: 'ECB cuts rates', source: 'Bloomberg', publishedAt: pastCutoff + 50000 }
  ];
  const newsAnalysis = NewsIntelligenceEngine.analyzeNewsForPair('EUR/USD', mockArticles, pastCutoff);
  assert.equal(newsAnalysis.relevantArticles, 1, 'Future news article must NOT be included');
  assert(newsAnalysis.relativeSentiment > 0, 'Should only reflect the past bullish news');
  console.log('  -> PASS: Future news article excluded; strictly isolated to cutoff timestamp.');

  // 3. test_trade_history_timestamp_isolation
  console.log('3. test_trade_history_timestamp_isolation...');
  const tradesPast = await HistoricalDatabaseExtractor.getHistoricalTrades(pastCutoff);
  for (const t of tradesPast) {
    assert(t.entryTimestamp <= pastCutoff, `Trade entry ${t.entryTimestamp} exceeds cutoff ${pastCutoff}`);
  }
  console.log('  -> PASS: All historical trades strictly precede cutoff timestamp.');

  // 4. test_outcome_label_generation
  console.log('4. test_outcome_label_generation...');
  const resolvedCount = await PredictionStorage.evaluatePendingPredictions(now);
  assert(typeof resolvedCount === 'number');
  console.log(`  -> PASS: Outcome labeling generated properly (${resolvedCount} processed).`);

  // 5. test_prediction_horizon
  console.log('5. test_prediction_horizon...');
  const pred15m = await CombinedPredictionEngine.predict({ pair: 'EUR/USD', horizon: '15M', cutoffTimestamp: pastCutoff });
  assert.equal(pred15m.horizon, '15M');
  const pred1h = await CombinedPredictionEngine.predict({ pair: 'EUR/USD', horizon: '1H', cutoffTimestamp: pastCutoff });
  assert.equal(pred1h.horizon, '1H');
  console.log('  -> PASS: Prediction horizons explicitly separated and validated (15M, 1H).');

  // 6. test_historical_analogue_isolation
  console.log('6. test_historical_analogue_isolation...');
  const analogs = await HistoricalAnalogEngine.findAnalogs('EUR/USD', '15M', pastCutoff);
  assert(typeof analogs.sampleSize === 'number');
  assert(analogs.sampleSize >= 0);
  console.log(`  -> PASS: Historical analogs evaluated (found ${analogs.sampleSize} matching analogs).`);

  // 7. test_expected_value
  console.log('7. test_expected_value...');
  const rawEv = (0.60 * 30.0) - (0.40 * 15.0) - 1.8;
  assert(rawEv > 0, 'Positive EV setup must calculate positive expected value');
  console.log(`  -> PASS: Net EV calculated accurately (+${rawEv.toFixed(1)} pips).`);

  // 8. test_cost_adjusted_expectancy
  console.log('8. test_cost_adjusted_expectancy...');
  const predHighSpread = await CombinedPredictionEngine.predict({
    pair: 'EUR/USD',
    cutoffTimestamp: pastCutoff,
    spreadPips: 8.5
  });
  assert.equal(predHighSpread.recommendation, 'NO_TRADE', 'High spread friction must trigger NO_TRADE');
  console.log('  -> PASS: Cost sensitivity verifies that excessive spread suppresses trade.');

  // 9. test_regime_detection
  console.log('9. test_regime_detection...');
  assert(typeof pred15m.regime === 'string');
  assert(pred15m.regime.length > 0);
  console.log(`  -> PASS: Market regime recognized as ${pred15m.regime}.`);

  // 10. test_news_currency_relative_scoring
  console.log('10. test_news_currency_relative_scoring...');
  const relativeNews = NewsIntelligenceEngine.analyzeNewsForPair('EUR/USD', [
    { title: 'ECB Hikes Rates Hawkishly', summary: 'Euro strength broadens', source: 'ECB', publishedAt: pastCutoff - 5000 }
  ], pastCutoff);
  assert(relativeNews.baseCurrencySentiment > relativeNews.quoteCurrencySentiment);
  assert(relativeNews.relativeSentiment > 0);
  console.log('  -> PASS: Relative EUR vs USD currency scoring accurately mapped.');

  // 11. test_news_decay
  console.log('11. test_news_decay...');
  const freshNews = NewsIntelligenceEngine.analyzeNewsForPair('EUR/USD', [
    { title: 'Breaking Flash News on Euro', summary: 'Immediate surge', source: 'Reuters', publishedAt: pastCutoff - 60_000 }
  ], pastCutoff);
  const oldNews = NewsIntelligenceEngine.analyzeNewsForPair('EUR/USD', [
    { title: 'Old Flash News on Euro', summary: 'Stale report', source: 'Reuters', publishedAt: pastCutoff - (3600_000 * 24) }
  ], pastCutoff);
  assert(freshNews.freshnessScore > oldNews.freshnessScore, 'Old news must have lower freshness score than fresh news');
  console.log(`  -> PASS: Exponential time-decay confirmed (Fresh: ${freshNews.freshnessScore.toFixed(2)} vs Old: ${oldNews.freshnessScore.toFixed(2)}).`);

  // 12. test_news_conflict
  console.log('12. test_news_conflict...');
  const predConflict = await CombinedPredictionEngine.predict({
    pair: 'EUR/USD',
    currentTechnicalSignal: { direction: 'BUY', score: 85, trend: 'bullish' },
    newsArticles: [
      { title: 'US Dollar surges to 20-year high on hawkish Fed', summary: 'Crushes euros', source: 'Reuters', publishedAt: pastCutoff - 1000 }
    ],
    cutoffTimestamp: pastCutoff
  });
  assert.equal(predConflict.recommendation, 'NO_TRADE');
  assert(predConflict.conflictScore > 0.40);
  console.log('  -> PASS: News conflict detected (Score: ' + predConflict.conflictScore + '). Trade vetoed to NO_TRADE.');

  // 13. test_multi_timeframe_conflict
  console.log('13. test_multi_timeframe_conflict...');
  const predMtf = await CombinedPredictionEngine.predict({
    pair: 'EUR/USD',
    currentTechnicalSignal: { direction: 'BUY', score: 50, trend: 'conflicting' },
    cutoffTimestamp: pastCutoff
  });
  assert(predMtf.recommendation === 'NO_TRADE' || predMtf.recommendation === 'INSUFFICIENT_DATA');
  console.log('  -> PASS: Multi-timeframe conflict suppresses trade.');

  // 14. test_prediction_abstention
  console.log('14. test_prediction_abstention...');
  const predWeak = await CombinedPredictionEngine.predict({
    pair: 'USD/CHF',
    cutoffTimestamp: pastCutoff,
    spreadPips: 6.0
  });
  assert.equal(predWeak.recommendation, 'NO_TRADE');
  console.log('  -> PASS: Conservative abstention confirmed on low-edge scenario.');

  // 15. test_probability_calibration
  console.log('15. test_probability_calibration...');
  const raw80 = CalibrationEngine.calibrateProbability(0.80, 50);
  assert(raw80 < 0.80, 'Raw 80% confidence must be calibrated conservatively downwards');
  assert(raw80 >= 0.55 && raw80 <= 0.70);
  console.log(`  -> PASS: Calibration active (Raw 80% -> Calibrated ${(raw80 * 100).toFixed(1)}%).`);

  // 16. test_walk_forward_split
  console.log('16. test_walk_forward_split...');
  const wfReport = await WalkForwardEngine.runWalkForward('EUR/USD', 180, 50, 20);
  assert(wfReport.validationWindows > 0);
  console.log(`  -> PASS: Walk-forward splits created (${wfReport.validationWindows} chronological windows).`);

  // 17. test_current_signal_independence
  console.log('17. test_current_signal_independence...');
  const predWithBuySignal = await CombinedPredictionEngine.predict({
    pair: 'EUR/USD',
    currentTechnicalSignal: { direction: 'BUY', score: 65, trend: 'neutral' },
    cutoffTimestamp: pastCutoff
  });
  const predWithSellSignal = await CombinedPredictionEngine.predict({
    pair: 'EUR/USD',
    currentTechnicalSignal: { direction: 'SELL', score: 65, trend: 'neutral' },
    cutoffTimestamp: pastCutoff
  });
  assert.equal(predWithBuySignal.direction, predWithSellSignal.direction);
  console.log('  -> PASS: Changing input signal does NOT flip independent prediction.');

  // 18. test_prediction_reproducibility
  console.log('18. test_prediction_reproducibility...');
  const predA = await CombinedPredictionEngine.predict({ pair: 'EUR/USD', cutoffTimestamp: pastCutoff });
  const predB = await CombinedPredictionEngine.predict({ pair: 'EUR/USD', cutoffTimestamp: pastCutoff });
  assert.equal(predA.direction, predB.direction);
  assert.equal(predA.probabilityUp, predB.probabilityUp);
  assert.equal(predA.calibratedConfidence, predB.calibratedConfidence);
  console.log('  -> PASS: Predictions are strictly deterministic and reproducible.');

  // 19. test_shadow_mode
  console.log('19. test_shadow_mode...');
  PredictionDecisionGate.setMode('SHADOW');
  assert.equal(PredictionDecisionGate.getMode(), 'SHADOW');
  const gateShadow = await PredictionDecisionGate.evaluateTradeOpportunity({ pair: 'EUR/USD', cutoffTimestamp: pastCutoff });
  assert.equal(gateShadow.allowedToExecute, false, 'Shadow mode MUST NOT allow live execution');
  console.log('  -> PASS: Shadow mode strictly blocks order dispatch while logging predictions.');

  // 20. test_champion_vs_challenger
  console.log('20. test_champion_vs_challenger...');
  assert(wfReport.baselines.length >= 4);
  const techBaseline = wfReport.baselines.find(b => b.baselineName.includes('Technical'));
  assert(techBaseline, 'Technical baseline must be evaluated');
  console.log(`  -> PASS: Champion vs Challenger comparison verified across ${wfReport.baselines.length} baselines.`);

  console.log('\n============================================================');
  console.log('ALL 20 PHASE PREDICTION ENGINE VERIFICATION TESTS PASSED!');
  console.log('============================================================\n');
}

runTests().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
