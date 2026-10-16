import { DataSourceStatus } from '../common/types';
import { FOREX_PAIRS, ForexPairConfig, getForexPairConfig } from './instruments';
import { ForexCandle, ForexMarketStatus, ForexQuote, ForexTimeframe } from './types';
import { getForexSessionState } from '../common/session';
import { brokerRegistry } from '../../brokers/registry';
import { persistHistoricalCandles } from '../../database/db';
import { liveRuntimeLog } from '../../services/liveRuntimeLog';

interface SharedForexPairSnapshot {
  candles: Map<string, ForexCandle[]>;
  quote: ForexQuote;
  candleFetchedAt: Map<string, number>;
  quoteFetchedAt: number;
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
  private readonly quoteCacheMs = Math.max(5_000, Number(process.env.GOLDCREST_FOREX_QUOTE_CACHE_MS || 8_000));

  private hydrateSharedSnapshot(symbol: string): SharedForexPairSnapshot | null {
    const snapshot = sharedForexSnapshots.get(symbol);
    if (!snapshot) return null;
    for (const [key, candles] of snapshot.candles) this.candles.set(key, candles);
    this.quotes.set(symbol, snapshot.quote);
    return snapshot;
  }

  async refreshPair(pair: string): Promise<void> {
    const symbol = getForexPairConfig(pair).symbol;
    const inflight = sharedForexRefreshes.get(symbol);
    if (inflight) {
      await inflight;
      if (!this.hydrateSharedSnapshot(symbol)) {
        throw new Error(`Shared broker refresh for ${symbol} completed without a market-data snapshot.`);
      }
      return;
    }

    const snapshot = this.hydrateSharedSnapshot(symbol);
    const now = Date.now();
    if (snapshot && now - snapshot.quoteFetchedAt < this.quoteCacheMs) {
      // Reuse the shared quote/candles snapshot across UI polling, signal
      // scanning and Auto Live while it is recent; order-time gates still
      // enforce the stricter 30-second authoritative quote limit.
      return;
    }

    const work = this.refreshPairFromBroker(symbol);
    sharedForexRefreshes.set(symbol, work);
    try {
      await work;
    } finally {
      if (sharedForexRefreshes.get(symbol) === work) sharedForexRefreshes.delete(symbol);
    }
  }

  private async refreshPairFromBroker(symbol: string): Promise<void> {
    const config = getForexPairConfig(symbol);
    const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
    const configStatus = (adapter as any).getConfigStatus?.();
    if (!configStatus?.configured) {
      throw new Error('cTrader market data is unavailable for the selected API environment; configure matching credentials first.');
    }
    if (!adapter.getHistoricalCandles) {
      throw new Error('Authoritative cTrader historical market-data capability is unavailable.');
    }

    const snapshot = this.hydrateSharedSnapshot(symbol);
    const fetchedAt = new Map(snapshot?.candleFetchedAt || []);
    const requestedTimeframes: Array<{ timeframe: ForexTimeframe; limit: number; ttlMs: number }> = [
      { timeframe: '5M', limit: 80, ttlMs: 4 * 60_000 },
      { timeframe: '15M', limit: 500, ttlMs: 12 * 60_000 },
      { timeframe: '1H', limit: 80, ttlMs: 50 * 60_000 },
      { timeframe: '4H', limit: 80, ttlMs: 3.5 * 60 * 60_000 },
      { timeframe: 'Daily', limit: 500, ttlMs: 20 * 60 * 60_000 }
    ];
    const persistenceRows: Array<{
      symbol: string; timeframe: string; timestamp: number;
      open: number; high: number; low: number; close: number; volume: number;
    }> = [];
    const refreshedTimeframes: string[] = [];
    const refreshStartedAt = Date.now();
    liveRuntimeLog('INFO', 'CTRADER_MARKET_DATA_REFRESH_STARTED', {
      pair: symbol,
      timeframes: requestedTimeframes.map(item => item.timeframe)
    });

    // Re-request each timeframe only when its candle cadence requires it.
    // The 15M/Daily histories are large enough to support analog validation;
    // higher timeframes refresh much less frequently than every Auto Live cycle.
    for (const item of requestedTimeframes) {
      const key = `${symbol}:${item.timeframe}`;
      const cached = this.candles.get(key);
      const lastFetchedAt = fetchedAt.get(item.timeframe) || 0;
      const cacheAge = lastFetchedAt ? Date.now() - lastFetchedAt : null;
      const needsFetch = !cached || cached.length < 35 || cacheAge === null || cacheAge >= item.ttlMs;
      if (!needsFetch) {
        liveRuntimeLog('INFO', 'CTRADER_CANDLE_CACHE_HIT', {
          pair: symbol, timeframe: item.timeframe, candleCount: cached?.length || 0,
          cacheAgeMs: cacheAge, cacheTtlMs: item.ttlMs
        });
        continue;
      }

      const requestStartedAt = Date.now();
      liveRuntimeLog('INFO', 'CTRADER_CANDLE_REQUEST_STARTED', {
        pair: symbol, timeframe: item.timeframe, limit: item.limit,
        cacheAgeMs: cacheAge, cacheTtlMs: item.ttlMs
      });
      let data: any[];
      try {
        data = await adapter.getHistoricalCandles(symbol, item.timeframe, item.limit);
      } catch (error: any) {
        liveRuntimeLog('ERROR', 'CTRADER_CANDLE_REQUEST_FAILED', {
          pair: symbol, timeframe: item.timeframe,
          durationMs: Date.now() - requestStartedAt, error: error?.message || String(error)
        });
        throw error;
      }
      if (!Array.isArray(data) || data.length < 35) {
        const error = new Error(`Insufficient broker-confirmed ${item.timeframe} candle history for ${symbol}; received ${Array.isArray(data) ? data.length : 0}.`);
        liveRuntimeLog('ERROR', 'CTRADER_CANDLE_REQUEST_FAILED', {
          pair: symbol, timeframe: item.timeframe,
          durationMs: Date.now() - requestStartedAt, error: error.message
        });
        throw error;
      }
      refreshedTimeframes.push(item.timeframe);
      liveRuntimeLog('INFO', 'CTRADER_CANDLE_REQUEST_COMPLETED', {
        pair: symbol, timeframe: item.timeframe, candleCount: data.length,
        durationMs: Date.now() - requestStartedAt
      });
      const candles: ForexCandle[] = data.map((bar: any) => ({
        pair: symbol,
        timeframe: item.timeframe,
        timestamp: Number(bar.timestamp),
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
        bid: Number(bar.close),
        ask: Number(bar.close),
        spread: 0,
        volume: Number(bar.volume || 0),
        tickVolume: Number(bar.volume || 0),
        provider: 'CTRADER_HISTORICAL_CLOSE',
        dataStatus: 'DELAYED'
      }));
      this.candles.set(key, candles);
      fetchedAt.set(item.timeframe, Date.now());
      persistenceRows.push(...candles.map(bar => ({
        symbol,
        timeframe: item.timeframe,
        timestamp: bar.timestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume
      })));
    }

    if (persistenceRows.length) {
      const persisted = await persistHistoricalCandles(persistenceRows);
      liveRuntimeLog('INFO', 'BROKER_HISTORICAL_CANDLES_PERSISTED', {
        pair: symbol,
        broker: 'CTRADER',
        rowsReceived: persistenceRows.length,
        rowsPersisted: persisted,
        timeframes: [...new Set(persistenceRows.map(row => row.timeframe))]
      });
    }

    const quoteCandles = this.candles.get(`${symbol}:15M`) || [];
    const latest = quoteCandles[quoteCandles.length - 1];
    if (!latest || !(latest.close > 0)) {
      throw new Error(`No authoritative cTrader 15M candle is available for ${symbol}.`);
    }

    let brokerQuote: any = null;
    let quoteFetchedAt = snapshot?.quoteFetchedAt || 0;
    let quote = snapshot?.quote || null;
    const marketIsOpen = this.getMarketStatus().isOpen;
    if (marketIsOpen && (!quote || Date.now() - quoteFetchedAt >= this.quoteCacheMs)) {
      brokerQuote = await adapter.getQuote(symbol);
      quoteFetchedAt = Date.now();
      if (
        brokerQuote?.status === 'FRESH' &&
        Date.now() - Number(brokerQuote.timestamp) < 10_000 &&
        Number(brokerQuote.bid) > 0 &&
        Number(brokerQuote.ask) >= Number(brokerQuote.bid)
      ) {
        const spreadPips = (Number(brokerQuote.ask) - Number(brokerQuote.bid)) / config.pipSize;
        const first = quoteCandles[0];
        const change = first ? latest.close - first.open : 0;
        quote = {
          pair: symbol,
          timestamp: Number(brokerQuote.timestamp),
          bid: Number(brokerQuote.bid),
          ask: Number(brokerQuote.ask),
          spreadPips,
          digits: config.digits,
          pipSize: config.pipSize,
          changePips24h: Number((change / config.pipSize).toFixed(1)),
          changePercent24h: Number(first?.open ? (change / first.open * 100).toFixed(2) : '0'),
          high24h: Math.max(...quoteCandles.map(bar => bar.high)),
          low24h: Math.min(...quoteCandles.map(bar => bar.low)),
          provider: this.providerName,
          dataStatus: 'LIVE'
        };
      } else {
        quote = null;
      }
    }

    // If no fresh broker quote exists, expose only a delayed last candle close.
    // It is never relabelled as live and will fail the execution freshness gate.
    if (!quote) {
      quote = {
        pair: symbol,
        timestamp: Number(latest.timestamp),
        bid: latest.close,
        ask: latest.close,
        spreadPips: 0,
        digits: config.digits,
        pipSize: config.pipSize,
        changePips24h: 0,
        changePercent24h: 0,
        high24h: Math.max(...quoteCandles.map(bar => bar.high)),
        low24h: Math.min(...quoteCandles.map(bar => bar.low)),
        provider: 'CTRADER_HISTORICAL_CLOSE',
        dataStatus: 'DELAYED'
      };
      quoteFetchedAt = Date.now();
    }

    this.quotes.set(symbol, quote);
    liveRuntimeLog('INFO', 'CTRADER_MARKET_DATA_REFRESH_COMPLETED', {
      pair: symbol,
      durationMs: Date.now() - refreshStartedAt,
      refreshedTimeframes,
      cacheHitTimeframes: requestedTimeframes.map(item => item.timeframe).filter(timeframe => !refreshedTimeframes.includes(timeframe)),
      quoteStatus: quote.dataStatus,
      quoteAgeMs: Math.max(0, Date.now() - Number(quote.timestamp || 0))
    });
    sharedForexSnapshots.set(symbol, {
      candles: new Map<string, ForexCandle[]>(
        requestedTimeframes.reduce<Array<[string, ForexCandle[]]>>((entries, item) => {
          const rows = this.candles.get(`${symbol}:${item.timeframe}`);
          if (rows) entries.push([`${symbol}:${item.timeframe}`, rows]);
          return entries;
        }, [])
      ),
      quote,
      candleFetchedAt: fetchedAt,
      quoteFetchedAt
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
