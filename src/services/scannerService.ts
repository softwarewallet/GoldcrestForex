import { LiveForexProvider } from '../markets/forex/provider';
import { ForexSignalEngine } from '../markets/forex/signalEngine';
import { getForexPairConfig } from '../markets/forex/instruments';
import { TradingSignal } from '../markets/common/types';
import { getSystemConfig } from './configService';
import { liveRuntimeLog } from './liveRuntimeLog';

const FOREX_SCAN_CONCURRENCY = 6;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export function mapForexSignal(signal: any): TradingSignal {
  const plan = signal.tradePlan;
  return {
    id: signal.id,
    timestamp: signal.timestamp,
    market: 'FOREX',
    instrument: signal.pair,
    underlying: undefined,
    direction: signal.direction,
    category: signal.signalCategory || signal.category,
    strategy: signal.strategyVersion || signal.strategy || 'Forex Structure',
    score: signal.score,
    scoreBreakdown: signal.scoreBreakdown,
    mlProbability: signal.mlProbability ?? 0,
    entryZone: plan ? {
      min: plan.entryMin,
      max: plan.entryMax,
      preferred: plan.entryPreferred
    } : (signal.entryZone || { min: signal.currentPrice || 0, max: signal.currentPrice || 0 }),
    stopLoss: plan ? plan.stopLoss : (signal.stopLoss ?? null),
    target1: plan ? (typeof plan.takeProfit1 === 'object' ? plan.takeProfit1.targetPrice : plan.takeProfit1) : (signal.target1 ?? null),
    target2: plan ? (typeof plan.takeProfit2 === 'object' ? plan.takeProfit2.targetPrice : plan.takeProfit2) : (signal.target2 ?? null),
    target3: plan ? (typeof plan.takeProfit3 === 'object' ? plan.takeProfit3.targetPrice : plan.takeProfit3) : (signal.target3 ?? null),
    riskReward: plan ? plan.riskReward : (signal.riskReward ?? 1.5),
    status: signal.status,
    invalidationConditions: signal.invalidationConditions,
    reasons: signal.reasons,
    noTradeReasons: signal.noTradeReasons || [],
    modelVersion: signal.modelVersion,
    expiry: undefined
  };
}

export class ScannerService {
  private forexProvider = new LiveForexProvider();
  private forexSignalEngine = new ForexSignalEngine(undefined, this.forexProvider);

  async getForexScanner(pairs?: string[]) {
    const results: any[] = [];
    const configuredPairs = pairs?.length
      ? pairs
      : getSystemConfig().autoLiveForexPairs;
    const selected = configuredPairs.length
      ? configuredPairs.map(symbol => getForexPairConfig(symbol))
      : this.forexProvider.getAvailablePairs();

    const scanned = await mapWithConcurrency(
      selected,
      FOREX_SCAN_CONCURRENCY,
      async pair => {
        try {
          await this.forexProvider.refreshPair(pair.symbol);
          const signal = await this.forexSignalEngine.generateSignal(pair.symbol);
          const quote = this.forexProvider.getQuote(pair.symbol);
          return {
            symbol: pair.symbol,
            description: pair.description,
            bid: quote.bid,
            ask: quote.ask,
            spreadPips: quote.spreadPips,
            changePips: quote.changePips24h,
            changePercent: quote.changePercent24h,
            digits: pair.digits,
            signal: mapForexSignal(signal),
            dataStatus: 'LIVE',
            dataSource: quote.provider
          };
        } catch (error: any) {
          return {
            symbol: pair.symbol,
            description: pair.description,
            signal: null,
            dataStatus: 'UNKNOWN',
            error: error?.message || String(error)
          };
        }
      }
    );

    results.push(...scanned);

    const actionableCount = scanned.filter(item =>
      item.signal && ['BUY', 'SELL'].includes(item.signal.direction)
    ).length;
    const noTradeCount = scanned.filter(item =>
      item.signal && item.signal.direction === 'NO_TRADE'
    ).length;
    const errorCount = scanned.filter(item => !item.signal || item.dataStatus !== 'LIVE').length;

    liveRuntimeLog('INFO', 'FOREX_SCANNER_COMPLETED', {
      configuredPairCount: selected.length,
      configuredPairs: selected.map(pair => pair.symbol),
      scannedPairCount: scanned.length,
      actionableCount,
      noTradeCount,
      errorCount,
      scanConcurrency: FOREX_SCAN_CONCURRENCY,
      failedPairs: scanned
        .filter(item => !item.signal)
        .map(item => ({ symbol: item.symbol, error: item.error }))
    });

    return results;
  }

  async getAllSignals(): Promise<TradingSignal[]> {
    const forex = await this.getForexScanner(getSystemConfig().autoLiveForexPairs);
    return forex.map(item => item.signal).filter(Boolean);
  }
}
