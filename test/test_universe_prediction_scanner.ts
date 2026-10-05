import assert from 'node:assert/strict';
import { UniversePredictionScanner } from '../src/ml/prediction/universePredictionScanner';
import { getSystemConfig } from '../src/services/configService';

async function runTests() {
  console.log('STARTING UNIVERSE PREDICTION SCANNER & SETTINGS SYNCHRONIZATION TESTS...\n');

  // 1. Test scanning the complete universe
  console.log('1. Testing Universe Prediction Scan...');
  const scan = await UniversePredictionScanner.scanUniverse('15M', Date.now());
  assert(scan.totalUniversePairs > 0, 'Must contain Forex pairs');
  assert.equal(typeof scan.recommendedTradeCount, 'number');
  assert.equal(typeof scan.avoidNoTradeCount, 'number');
  assert(scan.recommendedTrades.length === scan.recommendedTradeCount);
  assert(scan.avoidPairs.length === scan.avoidNoTradeCount);
  console.log(`  -> PASS: Scanned ${scan.totalUniversePairs} pairs (${scan.recommendedTradeCount} tradeable, ${scan.avoidNoTradeCount} avoided).`);

  // 2. Test pair settings synchronization & mismatch detection
  console.log('2. Testing Settings Synchronization & Mismatch Detection...');
  const testPair = 'USD/JPY';
  
  // Disable USD/JPY
  UniversePredictionScanner.disablePairInSettings(testPair);
  let config = getSystemConfig();
  assert(!config.autoLiveForexPairs.includes(testPair), `${testPair} should be disabled in settings`);

  // Scan again to verify settings reflection
  const scanAfterDisable = await UniversePredictionScanner.scanUniverse('15M', Date.now());
  const usdjpyStatus = [...scanAfterDisable.recommendedTrades, ...scanAfterDisable.missedOpportunities, ...scanAfterDisable.avoidPairs].find(p => p.pair === testPair);
  assert(usdjpyStatus, 'USD/JPY must be present in scan');
  assert.equal(usdjpyStatus.isEnabledInSettings, false, 'USD/JPY must be marked as disabled in settings');
  console.log(`  -> PASS: Settings status reflected correctly for ${testPair} (Disabled).`);

  // Enable USD/JPY back
  UniversePredictionScanner.enablePairInSettings(testPair);
  config = getSystemConfig();
  assert(config.autoLiveForexPairs.includes(testPair), `${testPair} should be enabled in settings`);

  const scanAfterEnable = await UniversePredictionScanner.scanUniverse('15M', Date.now());
  const usdjpyStatusEnabled = [...scanAfterEnable.recommendedTrades, ...scanAfterEnable.missedOpportunities, ...scanAfterEnable.avoidPairs].find(p => p.pair === testPair);
  assert.equal(usdjpyStatusEnabled.isEnabledInSettings, true, 'USD/JPY must be marked as enabled in settings');
  console.log(`  -> PASS: 1-Click Settings alignment verified. ${testPair} re-enabled in Auto Live settings.`);

  console.log('\nALL UNIVERSE SCANNER & SETTINGS SYNCHRONIZATION TESTS PASSED CLEANLY!\n');
}

runTests().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
