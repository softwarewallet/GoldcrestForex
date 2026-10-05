import assert from 'node:assert/strict';
import { CTraderNativeIndicatorService } from '../src/services/cTraderNativeIndicatorService';

async function runCTraderNativeIndicatorTests() {
  console.log('============================================================');
  console.log('GOLDCREST FOREX — CTRADER NATIVE INDICATOR INTELLIGENCE TESTS');
  console.log('============================================================\n');

  const closes = [
    1.0820, 1.0825, 1.0830, 1.0835, 1.0840, 1.0845, 1.0850, 1.0855, 1.0860, 1.0865,
    1.0870, 1.0875, 1.0880, 1.0885, 1.0890, 1.0895, 1.0900, 1.0905, 1.0910, 1.0915,
    1.0920, 1.0925, 1.0930, 1.0935, 1.0940
  ];
  const highs = closes.map(c => c + 0.0010);
  const lows = closes.map(c => c - 0.0010);

  // 1. Snapshot Generation Test
  console.log('1. Testing Native Indicator Snapshot Retrieval...');
  const snapshot = CTraderNativeIndicatorService.getNativeSnapshot('EUR/USD', '15M', closes, highs, lows);
  assert.equal(snapshot.quality, 'AVAILABLE');
  assert(snapshot.indicators['MACD'] !== undefined);
  assert(snapshot.indicators['RSI'] !== undefined);
  assert(snapshot.indicators['ADX'] !== undefined);
  console.log(`  -> PASS: Snapshot retrieved successfully with ${Object.keys(snapshot.indicators).length} native indicators.`);

  // 2. Native vs Internal Comparison Test
  console.log('2. Testing Native vs Internal Calculation Comparison...');
  const comp = CTraderNativeIndicatorService.compareNativeVsInternal('MACD', 'EUR/USD', '15M', 0.0012, 0.00118);
  assert.equal(comp.indicator, 'MACD');
  assert(typeof comp.absoluteDifference === 'number');
  assert(typeof comp.relativeDifference === 'number');
  assert(comp.classification === 'MATCH' || comp.classification === 'MINOR_DIFFERENCE');
  console.log(`  -> PASS: Comparison successful (Native: ${comp.nativeValue}, Internal: ${comp.internalValue}, Diff: ${comp.relativeDifference}%, Class: ${comp.classification}).`);

  // 3. MTF Matrix Test
  console.log('3. Testing Native Multi-Timeframe Matrix...');
  const mtf = CTraderNativeIndicatorService.buildNativeMTFMatrix('EUR/USD', ['M5', 'M15', 'H1', 'H4']);
  assert.equal(mtf.pair, 'EUR/USD');
  assert(mtf.matrix['MACD'] !== undefined);
  assert(typeof mtf.nativeBullishEvidence === 'number');
  console.log(`  -> PASS: Native MTF Matrix built successfully (Bullish: ${mtf.nativeBullishEvidence}, Conflict: ${(mtf.nativeConflictScore * 100).toFixed(0)}%).`);

  console.log('\n============================================================');
  console.log('ALL CTRADER NATIVE INDICATOR TESTS PASSED CLEANLY!');
  console.log('============================================================\n');
}

runCTraderNativeIndicatorTests().catch(err => {
  console.error('FATAL NATIVE INDICATOR TEST ERROR:', err);
  process.exit(1);
});
