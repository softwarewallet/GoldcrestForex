import assert from 'node:assert/strict';
import { MomentumEngine } from '../src/ml/direction/momentumEngine';
import { TrendEngine } from '../src/ml/direction/trendEngine';
import { VolumeOrderFlowEngine } from '../src/ml/direction/volumeOrderFlowEngine';
import { OrderBookEngine } from '../src/ml/direction/orderBookEngine';
import { MacroEngine } from '../src/ml/direction/macroEngine';
import { NewsRiskEngine } from '../src/ml/direction/newsRiskEngine';
import { MultiTimeframeEngine } from '../src/ml/direction/multiTimeframeEngine';
import { MLDirectionEngine } from '../src/ml/direction/mlDirectionEngine';
import { DirectionFusionEngine } from '../src/ml/direction/directionFusionEngine';

async function runQuantitativeDirectionTests() {
  console.log('============================================================');
  console.log('GOLDCREST FOREX — QUANTITATIVE DIRECTION ENGINE TESTS');
  console.log('============================================================\n');

  const mockCloses = [
    1.0820, 1.0825, 1.0830, 1.0828, 1.0835, 1.0840, 1.0845, 1.0850,
    1.0848, 1.0855, 1.0860, 1.0865, 1.0870, 1.0875, 1.0880, 1.0885,
    1.0890, 1.0895, 1.0900, 1.0905, 1.0910, 1.0915, 1.0920, 1.0925,
    1.0930, 1.0935, 1.0940, 1.0945, 1.0950, 1.0955, 1.0960, 1.0965,
    1.0970, 1.0975, 1.0980, 1.0985, 1.0990, 1.0995, 1.1000
  ];
  const mockHighs = mockCloses.map(c => c + 0.0012);
  const mockLows = mockCloses.map(c => c - 0.0012);
  const mockVolumes = mockCloses.map(() => 150);

  // 1. Momentum Engine Test (MACD)
  console.log('1. Testing MomentumEngine (MACD)...');
  const macd = MomentumEngine.calculateMACD(mockCloses);
  assert(typeof macd.macdLine === 'number');
  assert(typeof macd.signalLine === 'number');
  assert(typeof macd.histogram === 'number');
  console.log(`  -> PASS: MACD Line=${macd.macdLine}, Signal=${macd.signalLine}, Score=${macd.score}`);

  // 2. Trend Engine Test (ADX & EMA Structure)
  console.log('2. Testing TrendEngine (ADX & EMA)...');
  const adxRes = TrendEngine.calculateADX(mockHighs, mockLows, mockCloses);
  const emaStruct = TrendEngine.calculateEMAStructure(mockCloses);
  assert(typeof adxRes.adx === 'number');
  assert(typeof emaStruct.structureScore === 'number');
  console.log(`  -> PASS: ADX=${adxRes.adx} (${adxRes.regime}), EMA Alignment=${emaStruct.alignment}`);

  // 3. Volume Order Flow Engine Test (VWAP)
  console.log('3. Testing VolumeOrderFlowEngine (VWAP)...');
  const vwapRes = VolumeOrderFlowEngine.calculateVWAP(mockCloses, mockHighs, mockLows, mockVolumes);
  assert.equal(vwapRes.status, 'AVAILABLE');
  assert(typeof vwapRes.vwap === 'number');
  console.log(`  -> PASS: TICK_VOLUME_VWAP=${vwapRes.vwap}, Distance=${vwapRes.distancePips} pips`);

  // 4. Order Book Engine Test (OBI)
  console.log('4. Testing OrderBookEngine (OBI)...');
  const obiUnavailable = OrderBookEngine.evaluateOrderBook(undefined, undefined);
  assert.equal(obiUnavailable.dataQuality, 'UNAVAILABLE');
  const obiAvailable = OrderBookEngine.evaluateOrderBook(1200, 800);
  assert.equal(obiAvailable.dataQuality, 'AVAILABLE');
  assert(obiAvailable.score > 0);
  console.log(`  -> PASS: OBI correctly handled (Unavailable fallback verified, Available OBI score: ${obiAvailable.score}).`);

  // 5. Macro Differential Engine Test
  console.log('5. Testing MacroEngine...');
  const macroRes = MacroEngine.evaluateMacro('EUR/USD');
  assert.equal(macroRes.dataQuality, 'AVAILABLE');
  assert(typeof macroRes.score === 'number');
  console.log(`  -> PASS: Macro differential score for EUR/USD: ${macroRes.score} (${macroRes.explanation})`);

  // 6. News Risk Engine Test
  console.log('6. Testing NewsRiskEngine...');
  const newsRes = NewsRiskEngine.evaluateNews(0.40, 0.50, false);
  assert.equal(newsRes.dataQuality, 'AVAILABLE');
  assert(newsRes.score > 0);
  console.log(`  -> PASS: News risk score: ${newsRes.score}`);

  // 7. Multi-Timeframe Engine Test
  console.log('7. Testing MultiTimeframeEngine...');
  const mtfRes = MultiTimeframeEngine.evaluateMTF({
    '5M': { closes: mockCloses },
    '15M': { closes: mockCloses },
    '1H': { closes: mockCloses }
  });
  assert.equal(mtfRes.dataQuality, 'AVAILABLE');
  assert(typeof mtfRes.score === 'number');
  console.log(`  -> PASS: MTF score: ${mtfRes.score}`);

  // 8. ML Direction Engine Test
  console.log('8. Testing MLDirectionEngine...');
  const mlRes = MLDirectionEngine.evaluateML({ rsi: 65, macdHist: 0.0005, adx: 32, diSpread: 8, emaAlignment: 0.8 });
  assert.equal(mlRes.dataQuality, 'AVAILABLE');
  assert(typeof mlRes.score === 'number');
  console.log(`  -> PASS: ML direction score: ${mlRes.score}`);

  // 9. Direction Fusion & Conflict Detection Test
  console.log('9. Testing DirectionFusionEngine...');
  const fusionRes = DirectionFusionEngine.calculateQuantitativeDirection({
    pair: 'EUR/USD',
    horizon: '15M',
    closes: mockCloses,
    highs: mockHighs,
    lows: mockLows,
    volumes: mockVolumes,
    newsSentiment: 0.35,
    spreadPips: 1.2,
    championPrediction: { direction: 'BUY', probability: 0.68 }
  });
  assert(fusionRes.finalDirection !== undefined);
  assert(typeof fusionRes.probabilityUp === 'number');
  assert(typeof fusionRes.expectedR === 'number');
  assert(fusionRes.championVsChallenger !== undefined);
  console.log(`  -> PASS: Direction fusion successful (Direction: ${fusionRes.finalDirection}, ProbUP: ${(fusionRes.probabilityUp * 100).toFixed(1)}%, Expected R: +${fusionRes.expectedR} R).`);

  console.log('\n============================================================');
  console.log('ALL QUANTITATIVE DIRECTION ENGINE TESTS PASSED CLEANLY!');
  console.log('============================================================\n');
}

runQuantitativeDirectionTests().catch(err => {
  console.error('FATAL DIRECTION TEST ERROR:', err);
  process.exit(1);
});
