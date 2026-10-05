// ============================================================================
// CHRONOLOGICAL WALK-FORWARD VALIDATION & BASELINE COMPARISON (PHASE 12 & 13)
// ============================================================================

import { CombinedPredictionEngine } from './combinedPredictionEngine';
import { HistoricalDatabaseExtractor } from './historicalDatabase';
import { CalibrationEngine } from './calibrationEngine';

export interface ValidationMetrics {
  totalObservations: number;
  tradeCount: number;
  noTradeCount: number;
  noTradePct: number;
  accuracy: number;
  buyPrecision: number;
  sellPrecision: number;
  winRate: number;
  profitFactor: number;
  expectancyPips: number;
  maxDrawdownPips: number;
  brierScore: number;
  grossWins: number;
  grossLosses: number;
}

export interface BaselineComparison {
  baselineName: string;
  winRate: number;
  profitFactor: number;
  expectancyPips: number;
  tradeCount: number;
}

export interface WalkForwardReport {
  pair: string;
  validationWindows: number;
  modelMetrics: ValidationMetrics;
  baselines: BaselineComparison[];
  isPassingAcceptanceCriteria: boolean;
  notes: string[];
}

export class WalkForwardEngine {
  /**
   * Performs chronological walk-forward validation without look-ahead bias.
   * Slides a rolling window through historical data chronologically.
   */
  public static async runWalkForward(
    pair: string,
    totalCandles: number = 300,
    windowSize: number = 60,
    stepSize: number = 20
  ): Promise<WalkForwardReport> {
    const candles = await HistoricalDatabaseExtractor.getCandlesUpTo(pair, 'Daily', Date.now(), totalCandles);

    if (candles.length < windowSize + stepSize) {
      throw new Error(`Insufficient candle history for ${pair}: need at least ${windowSize + stepSize}, found ${candles.length}`);
    }

    let modelWins = 0;
    let modelLosses = 0;
    let modelGrossProfit = 0;
    let modelGrossLoss = 0;
    let modelPnlCumulative = 0;
    let modelMaxDrawdown = 0;
    let modelPeak = 0;
    let buyWins = 0;
    let buyTotal = 0;
    let sellWins = 0;
    let sellTotal = 0;
    let totalPredictions = 0;
    let noTradeCount = 0;

    const calibrationPairs: Array<{ predictedProbability: number; actualOutcome: 1 | 0 }> = [];

    // Baselines accumulators
    const baselineResults: Record<string, { wins: number; losses: number; grossProfit: number; grossLoss: number; count: number }> = {
      'Random Direction': { wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, count: 0 },
      'Always BUY': { wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, count: 0 },
      'Always SELL': { wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, count: 0 },
      'Momentum Only': { wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, count: 0 },
      'Technical Only': { wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, count: 0 }
    };

    let windowCount = 0;

    // Chronological walk: train strictly on [start ... start + windowSize], test on [start + windowSize ... start + windowSize + stepSize]
    for (let start = 0; start <= candles.length - windowSize - stepSize; start += stepSize) {
      windowCount++;
      const trainEndIdx = start + windowSize;
      const testEndIdx = trainEndIdx + stepSize;

      const trainCandles = candles.slice(start, trainEndIdx);
      const testCandles = candles.slice(trainEndIdx, testEndIdx);
      const cutoffTime = trainCandles[trainCandles.length - 1].timestamp;

      // Evaluate each bar in test window chronologically
      for (let t = 0; t < testCandles.length - 1; t++) {
        totalPredictions++;
        const testBar = testCandles[t];
        const nextBar = testCandles[t + 1];
        const barReturnPips = (nextBar.close - testBar.close) * (pair.includes('JPY') ? 100 : 10000);
        const actualDirection = barReturnPips > 0 ? 'UP' : 'DOWN';

        // Historical data up to testBar.timestamp only
        const historySlice = candles.slice(0, trainEndIdx + t + 1);

        // Combined Model Prediction
        const prediction = await CombinedPredictionEngine.predict({
          pair,
          candles: historySlice,
          currentClose: testBar.close,
          cutoffTimestamp: testBar.timestamp
        });

        if (prediction.recommendation === 'NO_TRADE' || prediction.recommendation === 'INSUFFICIENT_DATA') {
          noTradeCount++;
        } else {
          const isBuy = prediction.recommendation === 'TRADE_BUY';
          const isWin = isBuy ? barReturnPips > 0 : barReturnPips < 0;
          const pnlPips = (isBuy ? barReturnPips : -barReturnPips) - 2.5; // subtract spread & commission

          calibrationPairs.push({
            predictedProbability: prediction.calibratedConfidence,
            actualOutcome: isWin ? 1 : 0
          });

          if (isBuy) {
            buyTotal++;
            if (isWin) buyWins++;
          } else {
            sellTotal++;
            if (isWin) sellWins++;
          }

          if (isWin) {
            modelWins++;
            modelGrossProfit += Math.max(0, pnlPips);
          } else {
            modelLosses++;
            modelGrossLoss += Math.abs(pnlPips);
          }

          modelPnlCumulative += pnlPips;
          if (modelPnlCumulative > modelPeak) modelPeak = modelPnlCumulative;
          const dd = modelPeak - modelPnlCumulative;
          if (dd > modelMaxDrawdown) modelMaxDrawdown = dd;
        }

        // Evaluate Baselines on the exact same test bar
        // 1. Always BUY
        const buyPnl = barReturnPips - 2.5;
        baselineResults['Always BUY'].count++;
        if (buyPnl > 0) {
          baselineResults['Always BUY'].wins++;
          baselineResults['Always BUY'].grossProfit += buyPnl;
        } else {
          baselineResults['Always BUY'].losses++;
          baselineResults['Always BUY'].grossLoss += Math.abs(buyPnl);
        }

        // 2. Always SELL
        const sellPnl = -barReturnPips - 2.5;
        baselineResults['Always SELL'].count++;
        if (sellPnl > 0) {
          baselineResults['Always SELL'].wins++;
          baselineResults['Always SELL'].grossProfit += sellPnl;
        } else {
          baselineResults['Always SELL'].losses++;
          baselineResults['Always SELL'].grossLoss += Math.abs(sellPnl);
        }

        // 3. Momentum Only (if bar > previous bar, BUY, else SELL)
        const prevBar = t > 0 ? testCandles[t - 1] : trainCandles[trainCandles.length - 1];
        const momBuy = testBar.close > prevBar.close;
        const momPnl = (momBuy ? barReturnPips : -barReturnPips) - 2.5;
        baselineResults['Momentum Only'].count++;
        if (momPnl > 0) {
          baselineResults['Momentum Only'].wins++;
          baselineResults['Momentum Only'].grossProfit += momPnl;
        } else {
          baselineResults['Momentum Only'].losses++;
          baselineResults['Momentum Only'].grossLoss += Math.abs(momPnl);
        }

        // 4. Random Direction (deterministic pseudo-random via timestamp parity)
        const randBuy = testBar.timestamp % 2 === 0;
        const randPnl = (randBuy ? barReturnPips : -barReturnPips) - 2.5;
        baselineResults['Random Direction'].count++;
        if (randPnl > 0) {
          baselineResults['Random Direction'].wins++;
          baselineResults['Random Direction'].grossProfit += randPnl;
        } else {
          baselineResults['Random Direction'].losses++;
          baselineResults['Random Direction'].grossLoss += Math.abs(randPnl);
        }
      }
    }

    const tradeCount = modelWins + modelLosses;
    const winRate = tradeCount > 0 ? Number((modelWins / tradeCount).toFixed(3)) : 0;
    const profitFactor = modelGrossLoss > 0 ? Number((modelGrossProfit / modelGrossLoss).toFixed(2)) : modelWins > 0 ? 3.0 : 0.5;
    const expectancyPips = tradeCount > 0 ? Number(((modelGrossProfit - modelGrossLoss) / tradeCount).toFixed(2)) : 0;
    const buyPrecision = buyTotal > 0 ? Number((buyWins / buyTotal).toFixed(3)) : 0;
    const sellPrecision = sellTotal > 0 ? Number((sellWins / sellTotal).toFixed(3)) : 0;
    const noTradePct = totalPredictions > 0 ? Number(((noTradeCount / totalPredictions) * 100).toFixed(1)) : 0;

    const calibration = CalibrationEngine.evaluateCalibration(calibrationPairs);

    const modelMetrics: ValidationMetrics = {
      totalObservations: totalPredictions,
      tradeCount,
      noTradeCount,
      noTradePct,
      accuracy: winRate,
      buyPrecision,
      sellPrecision,
      winRate,
      profitFactor,
      expectancyPips,
      maxDrawdownPips: Number(modelMaxDrawdown.toFixed(1)),
      brierScore: calibration.brierScore,
      grossWins: modelGrossProfit,
      grossLosses: modelGrossLoss
    };

    const baselines: BaselineComparison[] = Object.entries(baselineResults).map(([name, b]) => {
      const bWinRate = b.count > 0 ? Number((b.wins / b.count).toFixed(3)) : 0;
      const bPF = b.grossLoss > 0 ? Number((b.grossProfit / b.grossLoss).toFixed(2)) : 0;
      const bExp = b.count > 0 ? Number(((b.grossProfit - b.grossLoss) / b.count).toFixed(2)) : 0;
      return {
        baselineName: name,
        winRate: bWinRate,
        profitFactor: bPF,
        expectancyPips: bExp,
        tradeCount: b.count
      };
    });

    const notes: string[] = [];
    let isPassing = true;

    if (expectancyPips <= 0 && tradeCount > 0) {
      isPassing = false;
      notes.push('Model failed to achieve positive expectancy after realistic costs.');
    }

    const bestBaseline = baselines.reduce((best, cur) => cur.expectancyPips > best.expectancyPips ? cur : best, baselines[0]);
    if (expectancyPips < bestBaseline.expectancyPips && tradeCount > 0) {
      isPassing = false;
      notes.push(`Model did not outperform best baseline (${bestBaseline.baselineName}: ${bestBaseline.expectancyPips} pips).`);
    }

    if (noTradePct < 40) {
      notes.push('Warning: Model selectivity is low (traded too frequently).');
    }

    return {
      pair,
      validationWindows: windowCount,
      modelMetrics,
      baselines,
      isPassingAcceptanceCriteria: isPassing,
      notes
    };
  }
}
