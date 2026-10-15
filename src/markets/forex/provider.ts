import { DataSourceStatus } from '../common/types';
import { FOREX_PAIRS, ForexPairConfig, getForexPairConfig } from './instruments';
import { ForexCandle, ForexMarketStatus, ForexQuote, ForexTimeframe } from './types';
import { getForexSessionState } from '../common/session';
import { brokerRegistry } from '../../brokers/registry';
import { persistHistoricalCandles } from '../../database/db';
import { liveRuntimeLog } from '../../services/liveRuntimeLog';

interface SharedForexPairSnapshot {
  expiresAt: number;
  candles: Map<string, ForexCandle[]>;
  quote: ForexQuote;
}

// Shared across the scanner and Auto Live provider instances in this process.
// A simultaneous dashboard scan must reuse the same broker snapshot rather
// than creating another wave of WebSocket history requests.
const sharedForexSnapshots = new Map<string, SharedForexPairSnapshot>();
const sharedForexRefreshes = new Map<string, Promise<void>>();

export interface ForexDataProvider {
  getQuote(pair: string): Promise<ForexQuote> | ForexQuote;
  getCandles(pair: string, timeframe: ForexTimeframe, limit?: number): Promise<ForexCandle[]> | ForexCandle[];
  getLatestCandle(pair: string, timeframe: ForexTimeframe): Promise<ForexCandle> | ForexCandle;
  getAvailablePairs(): Promise<ForexPairConfig[]> | ForexPairConfig[];
  getMarketStatus(): Promise<ForexMarketStatus> | ForexMarketStatus;
}

export interface LiveForexDataProvider extends ForexDataProvider {
  readonly providerName: string;
  readonly status: 'LIVE';
  readonly isDemo: false;
  refreshPair(pair: string): Promise<void>;
}

/**
 * Authoritative live Forex market-data provider.
 * All market data originates from the configured cTrader LIVE adapter.
 */
export class LiveForexProvider implements LiveForexDataProvider {
  readonly providerName = 'CTRADER_LIVE_PROVIDER';
  readonly status = 'LIVE' as const;
  readonly isDemo = false as const;

  private candles = new Map<string, ForexCandle[]>();
  private quotes = new Map<string, ForexQuote>();
  private readonly refreshCacheTtlMs = Math.max(10_000, Number(process.env.GOLDCREST_FOREX_MARKET_CACHE_MS || 30_000));

  private hydrateSharedSnapshot(symbol: string): boolean {
    const snapshot = sharedForexSnapshots.get(symbol);
    if (!snapshot || Date.now() >= snapshot.expiresAt) return false;
    for (const [key, candles] of snapshot.candles) this.candles.set(key, candles);
    this.quotes.set(symbol, snapshot.quote);
    return true;
  }

  async refreshPair(pair: string): Promise<void> {
    const symbol = getForexPairConfig(pair).symbol;
    if (this.hydrateSharedSnapshot(symbol)) return;

    const inFlight = sharedForexRefreshes.get(symbol);
    if (inFlight) {
      await inFlight;
      if (!this.hydrateSharedSnapshot(symbol)) {
        throw new Error(`Shared authoritative market-data refresh for ${symbol} completed without a reusable snapshot.`);
      }
      return;
    }

    const work = this.refreshPairFromBroker(symbol);
    sharedForexRefreshes.set(symbol, work);
    try {
      await work;
      const quote = this.quotes.get(symbol);
      if (!quote) throw new Error(`No broker-confirmed quote was produced for ${symbol}.`);
      const candles = new Map<string, ForexCandle[]>();
      for (const timeframe of ['5M', '15M', '1H', '4H', 'Daily'] as ForexTimeframe[]) {
        const rows = this.candles.get(`${symbol}:${timeframe}`);
        if (rows) candles.set(`${symbol}:${timeframe}`, rows);
      }
      sharedForexSnapshots.set(symbol, {
        expiresAt: Date.now() + this.refreshCacheTtlMs,
        candles,
        quote
      });
    } finally {
      if (sharedForexRefreshes.get(symbol) === work) sharedForexRefreshes.delete(symbol);
    }
  }

  private async refreshPairFromBroker(pair: string): Promise<void> {
    const config = getForexPairConfig(pair);
    const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
    const configStatus = (adapter as any).getConfigStatus?.();
    if (!configStatus?.configured) {
      throw new Error('cTrader market data is unavailable: credentials are not configured for the selected API environment.');
    }
    if (!adapter.getHistoricalCandles) {
      throw new Error('Authoritative cTrader historical market-data capability is unavailable.');
    }

    const requestedTimeframes: Array<{ timeframe: ForexTimeframe; limit: number }> = [
      { timeframe: '5M', limit: 80 },
      { timeframe: '15M', limit: 500 },
      { timeframe: '1H', limit: 80 },
      { timeframe: '4H', limit: 80 },
      { timeframe: 'Daily', limit: 500 }
    ];

    // Historical requests are individually queued by the cTrader transport.
    // Avoid fanning out five requests at once for each pair.
    const rows: Array<{ timeframe: ForexTimeframe; data: any[] }> = [];
    for (const item of requestedTimeframes) {
      const data = await adapter.getHistoricalCandles(config.symbol, item.timeframe, item.limit);
      if (!Array.isArray(data) || data.length < 35) {
        throw new Error(`Insufficient broker-confirmed ${item.timeframe} candle history for ${config.symbol}; received ${Array.isArray(data) ? data.length : 0}.`);
      }
      rows.push({ timeframe: item.timeframe, data });
    }

    let liveQuote: any = null;
    let quoteDataStatus: ForexCandle['dataStatus'] = 'DELAYED';
    if (this.getMarketStatus().isOpen) {
      const quote = await adapter.getQuote(config.symbol);
      if (quote.status === 'FRESH' && Date.now() - quote.timestamp < 10_000
        && quote.bid > 0 && quote.ask > 0) {
        liveQuote = quote;
        quoteDataStatus = 'LIVE';
      }
    }

    const persistenceRows: Array<{symbol:string;timeframe:string;timestamp:number;open:number;high:number;low:number;close:number;volume:number}> = [];
    for (const row of rows) {
      const candles: ForexCandle[] = row.data.map((candle: any) => ({
        pair: config.symbol,
        timeframe: row.timeframe,
        timestamp: Number(candle.timestamp),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        bid: Number(liveQuote?.bid ?? candle.close),
        ask: Number(liveQuote?.ask ?? candle.close),
        spread: Number(liveQuote ? liveQuote.ask - liveQuote.bid : 0),
        volume: Number(candle.volume || 0),
        tickVolume: Number(candle.volume || 0),
        provider: liveQuote ? this.providerName : 'CTRADER_HISTORICAL_CLOSE',
        dataStatus: liveQuote && row.timeframe === '15M' ? 'LIVE' : 'DELAYED'
      }));
      this.candles.set(`${config.symbol}:${row.timeframe}`, candles);
      persistenceRows.push(...candles.map(c => ({
        symbol: config.symbol,
        timeframe: row.timeframe,
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      })));
    }

    const persisted = await persistHistoricalCandles(persistenceRows);
    liveRuntimeLog('INFO', 'BROKER_HISTORICAL_CANDLES_PERSISTED', {
      pair: config.symbol,
      broker: 'CTRADER',
      rowsReceived: persistenceRows.length,
      rowsPersisted: persisted,
      timeframes: requestedTimeframes.map(x => x.timeframe)
    });

    const quoteCandles = rows.find(row => row.timeframe === '15M')?.data || [];
    const latestHistoricalClose = Number(quoteCandles[quoteCandles.length - 1]?.close || 0);
    if (!(latestHistoricalClose > 0)) {
      throw new Error(`No authoritative cTrader 15M close is available for ${config.symbol}.`);
    }
    const first = quoteCandles[0];
    const latest = quoteCandles[quoteCandles.length - 1];
    const change = latest && first ? latest.close - first.open : 0;
    const changePips = change / config.pipSize;
    const changePct = first?.open ? (change / first.open) * 100 : 0;
    this.quotes.set(config.symbol, {
      pair: config.symbol,
      timestamp: liveQuote?.timestamp ?? Number(latest?.timestamp || 0),
      bid: liveQuote?.bid ?? latestHistoricalClose,
      ask: liveQuote?.ask ?? latestHistoricalClose,
      spreadPips: liveQuote
        ? Number(liveQuote.spread) * (config.symbol.includes('JPY') ? 100 : 10000)
        : 0,
      digits: config.digits,
      pipSize: config.pipSize,
      changePips24h: Number(changePips.toFixed(1)),
      changePercent24h: Number(changePct.toFixed(2)),
      high24h: quoteCandles.length ? Math.max(...quoteCandles.map(c => Number(c.high))) : latestHistoricalClose,
      low24h: quoteCandles.length ? Math.min(...quoteCandles.map(c => Number(c.low))) : latestHistoricalClose,
      provider: liveQuote ? this.providerName : 'CTRADER_HISTORICAL_CLOSE',
      dataStatus: liveQuote ? 'LIVE' : 'DELAYED'
    });
  }

    const first = quoteCandles[0];
    const latest = quoteCandles[quoteCandles.length - 1];
    const closePrice = latestHistoricalClose;
    const change = latest && first ? latest.close - first.open : 0;
    const changePips = change / config.pipSize;
    const changePct = first?.open ? (change / first.open) * 100 : 0;

    this.quotes.set(config.symbol, {
      pair: config.symbol,
      timestamp: liveQuote?.timestamp ?? Number(latest?.timestamp || Date.now()),
      bid: liveQuote?.bid ?? closePrice,
      ask: liveQuote?.ask ?? closePrice,
      spreadPips: liveQuote
        ? liveQuote.spread * (config.symbol.includes('JPY') ? 100 : 10000)
        : 0,
      digits: config.digits,
      pipSize: config.pipSize,
      changePips24h: Number(changePips.toFixed(1)),
      changePercent24h: Number(changePct.toFixed(2)),
      high24h: quoteCandles.length ? Math.max(...quoteCandles.map(c => c.high)) : closePrice,
      low24h: quoteCandles.length ? Math.min(...quoteCandles.map(c => c.low)) : closePrice,
      provider: liveQuote ? this.providerName : 'CTRADER_HISTORICAL_CLOSE',
      dataStatus: quoteDataStatus,
    });
  }

  getQuote(pair: string): ForexQuote {
    const quote = this.quotes.get(getForexPairConfig(pair).symbol);
    if (!quote) throw new Error(`Live quote cache is empty for ${pair}. Refresh live market data first.`);
    return quote;
  }

  getCandles(pair: string, timeframe: ForexTimeframe = '15M', limit = 80): ForexCandle[] {
    const rows = this.candles.get(`${getForexPairConfig(pair).symbol}:${timeframe}`) || [];
    return rows.slice(Math.max(0, rows.length - limit));
  }

  getLatestCandle(pair: string, timeframe: ForexTimeframe = '15M'): ForexCandle {
    const rows = this.getCandles(pair, timeframe, 2);
    if (!rows.length) throw new Error(`Live candle cache is empty for ${pair} ${timeframe}. Refresh live market data first.`);
    return rows[rows.length - 1];
  }

  getAvailablePairs(): ForexPairConfig[] {
    return FOREX_PAIRS;
  }

  getMarketStatus(): ForexMarketStatus {
    const session = getForexSessionState();
    const isWeekend = session.activeSessions.includes('CLOSED (WEEKEND)');
    return {
      isOpen: !isWeekend,
      status: isWeekend ? 'WEEKEND' : 'OPEN',
      activeSessions: session.activeSessions,
      currentSession: session.activeSessions.join(' / ') || 'Interbank Electronic Off-Peak',
      isLondonNyOverlap: session.isLondonNyOverlap,
      serverUtcTime: new Date().toISOString()
    };
  }
}

/**
 * Validates data quality of candle arrays
 */
export function validateCandleDataQuality(candles: ForexCandle[]): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!candles || candles.length === 0) {
    errors.push('No candle data supplied');
    return { isValid: false, errors };
  }

  const seenTimestamps = new Set<number>();
  let prevTimestamp = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    // Invalid OHLC values
    if (c.high < c.low) {
      errors.push(`Candle at ${i} has High (${c.high}) < Low (${c.low})`);
    }
    if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
      errors.push(`Candle at ${i} has non-positive price (Close: ${c.close})`);
    }
    if (c.open > c.high || c.open < c.low || c.close > c.high || c.close < c.low) {
      errors.push(`Candle at ${i} has Open or Close outside High/Low range`);
    }

    // Duplicate timestamps
    if (seenTimestamps.has(c.timestamp)) {
      errors.push(`Duplicate timestamp detected: ${c.timestamp}`);
    }
    seenTimestamps.add(c.timestamp);

    // Out-of-order timestamps
    if (i > 0 && c.timestamp <= prevTimestamp) {
      errors.push(`Out of order timestamp at bar ${i}: current ${c.timestamp} <= prev ${prevTimestamp}`);
    }
    prevTimestamp = c.timestamp;
  }

  // Check freshness (stale data check: latest candle older than 48 hours unless weekend)
  const now = Date.now();
  const latestTs = candles[candles.length - 1].timestamp;
  if (now - latestTs > 48 * 60 * 60 * 1000) {
    errors.push(`Stale market data: latest candle is older than 48 hours`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
