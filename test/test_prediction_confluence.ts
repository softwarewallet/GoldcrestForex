import assert from 'node:assert/strict';
import { ForexSignalEngine } from '../src/markets/forex/signalEngine';
import type { StructuredIndicators } from '../src/markets/forex/types';

function indicators(overrides: Partial<StructuredIndicators> = {}): StructuredIndicators {
  return {
    ema9: 1.1020,
    ema21: 1.1010,
    ema50: 1.1000,
    ema100: 1.0990,
    ema200: 1.0980,
    sma50: 1.1000,
    sma200: 1.0980,
    rsi: 58,
    macd: 0.002,
    macdSignal: 0.001,
    macdHistogram: 0.001,
    adx: 28,
    diPlus: 25,
    diMinus: 12,
    atr: 0.0012,
    bollingerUpper: 1.1040,
    bollingerMiddle: 1.1010,
    bollingerLower: 1.0980,
    stochastic: { k: 60, d: 55 },
    roc: 0.2,
    ...overrides
  };
}

const engine = new ForexSignalEngine();
const bullish = indicators();
const alignedBuy = engine.calculateMomentumConsensusScore(70, 'BUY', bullish);
assert(alignedBuy > 70, 'Aligned RSI, EMA and MACD should improve the BUY consensus score');

const opposedBuy = engine.calculateMomentumConsensusScore(70, 'BUY', indicators({
  rsi: 38,
  ema9: 1.1000,
  ema21: 1.1010,
  macd: -0.002,
  macdSignal: -0.001,
  macdHistogram: -0.001
}));
assert(opposedBuy < 70, 'Opposing momentum should reduce the BUY consensus score');

const neutral = engine.calculateMomentumConsensusScore(70, 'NEUTRAL', bullish);
assert.equal(neutral, 70, 'Neutral direction must preserve the existing score');

const missingIndicators = engine.calculateMomentumConsensusScore(70, 'BUY', indicators({
  rsi: null,
  ema9: null,
  ema21: null,
  macd: null,
  macdSignal: null,
  macdHistogram: null
}));
assert.equal(missingIndicators, 70, 'Insufficient momentum evidence must preserve the existing score');

console.log('PASS: prediction momentum consensus tests');
