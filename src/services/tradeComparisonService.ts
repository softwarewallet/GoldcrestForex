import { executeQuery } from '../database/db';
import { brokerRegistry } from '../brokers/registry';
import { BrokerType } from '../brokers/types';

export interface RawTradeRecord {
  id: string;
  broker: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  timestamp: number;
  pnl: number;
  commission: number;
  status: string;
}

export interface PairPerformance {
  pair: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number; // 0 to 100
  totalPnL: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  avgTradePnL: number;
  avgWin: number;
  avgLoss: number;
  buyTrades: number;
  buyWins: number;
  buyWinRate: number;
  sellTrades: number;
  sellWins: number;
  sellWinRate: number;
  bestTrade: number;
  worstTrade: number;
}

export interface HourlyPerformance {
  hour: number;
  hourLabel: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  netPnL: number;
  grossProfit: number;
  grossLoss: number;
  favorable: boolean;
  topPair: string | null;
}

export interface TradeComparisonReport {
  from: number;
  to: number;
  fromDateStr: string;
  toDateStr: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  overallWinRate: number;
  totalNetPnL: number;
  grossProfit: number;
  grossLoss: number;
  overallProfitFactor: number;
  pairBreakdown: PairPerformance[];
  hourlyBreakdown: HourlyPerformance[];
  rawTrades: RawTradeRecord[];
  insights: {
    bestPerformingPair: string | null;
    worstPerformingPair: string | null;
    mostActivePair: string | null;
    goldenHours: Array<{ hour: number; label: string; winRate: number; pnl: number; trades: number }>;
    riskHours: Array<{ hour: number; label: string; winRate: number; pnl: number; trades: number }>;
    bestTradingSession: string | null;
    recommendations: string[];
  };
}

const SYMBOL_ID_LOOKUP: Record<string, string> = {
  '1': 'EUR/USD',
  '2': 'GBP/USD',
  '3': 'EUR/JPY',
  '4': 'USD/JPY',
  '5': 'USD/CHF',
  '6': 'USD/JPY',
  '7': 'EUR/GBP',
  '8': 'EUR/CHF',
  '9': 'AUD/USD',
  '10': 'USD/CAD',
  '11': 'NZD/USD',
  '12': 'AUD/USD',
  '13': 'AUD/JPY',
  '14': 'GBP/JPY',
  '15': 'CHF/JPY',
  '16': 'XAU/USD',
  '17': 'XAG/USD',
  '18': 'EUR/CAD',
  '19': 'CAD/JPY',
  '20': 'EUR/AUD'
};

export function normalizePairSymbol(rawSymbol: string): string {
  const s = String(rawSymbol || '').trim();
  if (SYMBOL_ID_LOOKUP[s]) return SYMBOL_ID_LOOKUP[s];
  const upper = s.toUpperCase();
  if (SYMBOL_ID_LOOKUP[upper]) return SYMBOL_ID_LOOKUP[upper];
  if (upper.length === 6 && !upper.includes('/')) {
    return `${upper.slice(0, 3)}/${upper.slice(3, 6)}`;
  }
  return upper;
}

export async function generateTradeComparisonReport(from: number, to: number): Promise<TradeComparisonReport> {
  const LIVE_BROKERS: BrokerType[] = ['CTRADER', 'FIVE_PAISA'];
  const trades: RawTradeRecord[] = [];

  // 1. Load from broker adapter order history range
  await Promise.all(LIVE_BROKERS.map(async broker => {
    try {
      const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
      if (!adapter) return;
      const history = adapter.getOrderHistoryRange
        ? await adapter.getOrderHistoryRange(from, to)
        : await adapter.getOrderHistory();

      for (const order of history || []) {
        const timestamp = Number(order.timestamp || 0);
        if (timestamp < from || timestamp > to) continue;

        const entry = Number(order.price ?? 0);
        const exit = Number(order.averageFillPrice ?? order.price ?? 0);
        const qty = Number(order.filledQuantity ?? order.quantity ?? 0);
        const comm = Number(order.commission ?? 0);
        const side: 'BUY' | 'SELL' = (String(order.side || '').toUpperCase().includes('SELL')) ? 'SELL' : 'BUY';
        const symbol = normalizePairSymbol(String(order.symbol || 'UNKNOWN'));

        let pnl = 0;
        if (typeof (order as any).netAmount === 'number' && Number.isFinite((order as any).netAmount)) {
          pnl = (order as any).netAmount;
        } else if (typeof (order as any).pnl === 'number' && Number.isFinite((order as any).pnl)) {
          pnl = (order as any).pnl;
        } else if (typeof (order as any).realizedPnL === 'number' && Number.isFinite((order as any).realizedPnL)) {
          pnl = (order as any).realizedPnL;
        } else if (entry > 0 && exit > 0 && qty > 0 && Math.abs(exit - entry) > 0.00001) {
          pnl = side === 'SELL' ? (entry - exit) * qty : (exit - entry) * qty;
        }

        trades.push({
          id: String(order.id || `order-${timestamp}-${Math.random()}`),
          broker,
          symbol,
          side,
          entryPrice: entry,
          exitPrice: exit,
          quantity: qty,
          timestamp,
          pnl,
          commission: comm,
          status: String(order.status || 'FILLED')
        });
      }
    } catch {
      // Best-effort
    }
  }));

  // 2. Query SQLite persisted trades table for the date range
  try {
    const sqliteRows = await executeQuery<any>(
      `SELECT id, instrument, direction, entry_price, exit_price, size, pnl, status, entry_time, exit_time 
       FROM trades 
       WHERE (exit_time >= ? AND exit_time <= ?) OR (entry_time >= ? AND entry_time <= ?)`,
      [from, to, from, to]
    );

    for (const r of sqliteRows) {
      const id = String(r.id);
      if (!trades.some(t => t.id === id)) {
        const timestamp = Number(r.exit_time || r.entry_time || from);
        const entry = Number(r.entry_price || 0);
        const exit = Number(r.exit_price || entry);
        const qty = Number(r.size || 0);
        const side: 'BUY' | 'SELL' = String(r.direction || 'BUY').toUpperCase().includes('SELL') ? 'SELL' : 'BUY';
        const symbol = normalizePairSymbol(String(r.instrument || 'UNKNOWN'));
        let pnl = Number(r.pnl || 0);
        if (!Number.isFinite(pnl) && entry > 0 && exit > 0 && qty > 0 && Math.abs(exit - entry) > 0.00001) {
          pnl = side === 'SELL' ? (entry - exit) * qty : (exit - entry) * qty;
        }

        trades.push({
          id,
          broker: 'SQLITE',
          symbol,
          side,
          entryPrice: entry,
          exitPrice: exit,
          quantity: qty,
          timestamp,
          pnl: Number.isFinite(pnl) ? pnl : 0,
          commission: 0,
          status: String(r.status || 'CLOSED')
        });
      }
    }
  } catch {
    // Best-effort
  }

  // Sort trades chronologically
  trades.sort((a, b) => a.timestamp - b.timestamp);

  // 3. Round-trip FIFO matching for trades that have pnl == 0 (e.g. raw buy/sell deal streams)
  const openFillsPerSymbol = new Map<string, Array<{ side: 'BUY' | 'SELL'; price: number; qty: number; timestamp: number; tradeIndex: number }>>();

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (t.pnl === 0 && t.entryPrice > 0 && t.quantity > 0) {
      const fills = openFillsPerSymbol.get(t.symbol) || [];
      const oppositeIdx = fills.findIndex(f => f.side !== t.side && f.qty > 0);

      if (oppositeIdx >= 0) {
        const opp = fills[oppositeIdx];
        const matchedQty = Math.min(opp.qty, t.quantity);
        const calcPnl = opp.side === 'BUY'
          ? (t.entryPrice - opp.price) * matchedQty
          : (opp.price - t.entryPrice) * matchedQty;

        t.pnl = Math.round(calcPnl * 100) / 100;
        t.exitPrice = t.entryPrice;
        t.entryPrice = opp.price;

        opp.qty -= matchedQty;
        if (opp.qty <= 0.0001) {
          fills.splice(oppositeIdx, 1);
        }
      } else {
        fills.push({
          side: t.side,
          price: t.entryPrice,
          qty: t.quantity,
          timestamp: t.timestamp,
          tradeIndex: i
        });
        openFillsPerSymbol.set(t.symbol, fills);
      }
    }
  }

  // Aggregations
  let totalWins = 0;
  let totalLosses = 0;
  let totalBreakevens = 0;
  let totalGrossProfit = 0;
  let totalGrossLoss = 0;
  let totalNetPnL = 0;

  const pairMap = new Map<string, RawTradeRecord[]>();
  const hourlyMap = new Map<number, RawTradeRecord[]>();

  for (let h = 0; h < 24; h++) {
    hourlyMap.set(h, []);
  }

  for (const trade of trades) {
    const pnl = trade.pnl;
    totalNetPnL += pnl;

    if (pnl > 0.0001) {
      totalWins++;
      totalGrossProfit += pnl;
    } else if (pnl < -0.0001) {
      totalLosses++;
      totalGrossLoss += Math.abs(pnl);
    } else {
      totalBreakevens++;
    }

    // Pair grouping
    const pairKey = trade.symbol;
    if (!pairMap.has(pairKey)) pairMap.set(pairKey, []);
    pairMap.get(pairKey)!.push(trade);

    // Hourly grouping (by UTC / local hour of the trade timestamp)
    const date = new Date(trade.timestamp);
    const hour = date.getHours();
    if (hourlyMap.has(hour)) {
      hourlyMap.get(hour)!.push(trade);
    }
  }

  // Pair Performance Breakdown
  const pairBreakdown: PairPerformance[] = Array.from(pairMap.entries()).map(([pair, pTrades]) => {
    let wins = 0;
    let losses = 0;
    let breakevens = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let netPnL = 0;
    let buyTrades = 0;
    let buyWins = 0;
    let sellTrades = 0;
    let sellWins = 0;
    let bestTrade = -Infinity;
    let worstTrade = Infinity;

    for (const t of pTrades) {
      netPnL += t.pnl;
      if (t.pnl > bestTrade) bestTrade = t.pnl;
      if (t.pnl < worstTrade) worstTrade = t.pnl;

      if (t.pnl > 0.0001) {
        wins++;
        grossProfit += t.pnl;
      } else if (t.pnl < -0.0001) {
        losses++;
        grossLoss += Math.abs(t.pnl);
      } else {
        breakevens++;
      }

      if (t.side === 'BUY') {
        buyTrades++;
        if (t.pnl > 0.0001) buyWins++;
      } else {
        sellTrades++;
        if (t.pnl > 0.0001) sellWins++;
      }
    }

    const total = pTrades.length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const buyWinRate = buyTrades > 0 ? (buyWins / buyTrades) * 100 : 0;
    const sellWinRate = sellTrades > 0 ? (sellWins / sellTrades) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.99 : 0;
    const avgTradePnL = total > 0 ? netPnL / total : 0;
    const avgWin = wins > 0 ? grossProfit / wins : 0;
    const avgLoss = losses > 0 ? grossLoss / losses : 0;

    return {
      pair,
      totalTrades: total,
      winningTrades: wins,
      losingTrades: losses,
      breakevenTrades: breakevens,
      winRate: Math.round(winRate * 10) / 10,
      totalPnL: Math.round(netPnL * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      grossLoss: Math.round(grossLoss * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      avgTradePnL: Math.round(avgTradePnL * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      buyTrades,
      buyWins,
      buyWinRate: Math.round(buyWinRate * 10) / 10,
      sellTrades,
      sellWins,
      sellWinRate: Math.round(sellWinRate * 10) / 10,
      bestTrade: bestTrade === -Infinity ? 0 : Math.round(bestTrade * 100) / 100,
      worstTrade: worstTrade === Infinity ? 0 : Math.round(worstTrade * 100) / 100
    };
  });

  // Sort pair breakdown by total Net PnL descending
  pairBreakdown.sort((a, b) => b.totalPnL - a.totalPnL);

  // Hourly Performance Breakdown (00:00 to 23:00)
  const pad = (n: number) => String(n).padStart(2, '0');
  const hourlyBreakdown: HourlyPerformance[] = Array.from(hourlyMap.entries()).map(([hour, hTrades]) => {
    let wins = 0;
    let losses = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let netPnL = 0;
    const pairCounts = new Map<string, number>();

    for (const t of hTrades) {
      netPnL += t.pnl;
      if (t.pnl > 0.0001) {
        wins++;
        grossProfit += t.pnl;
      } else if (t.pnl < -0.0001) {
        losses++;
        grossLoss += Math.abs(t.pnl);
      }
      pairCounts.set(t.symbol, (pairCounts.get(t.symbol) || 0) + 1);
    }

    const total = hTrades.length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    let topPair: string | null = null;
    let maxPairCount = 0;
    for (const [p, c] of pairCounts.entries()) {
      if (c > maxPairCount) {
        maxPairCount = c;
        topPair = p;
      }
    }

    return {
      hour,
      hourLabel: `${pad(hour)}:00 - ${pad((hour + 1) % 24)}:00`,
      totalTrades: total,
      winningTrades: wins,
      losingTrades: losses,
      winRate: Math.round(winRate * 10) / 10,
      netPnL: Math.round(netPnL * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      grossLoss: Math.round(grossLoss * 100) / 100,
      favorable: netPnL > 0 && winRate >= 50,
      topPair
    };
  });

  // Insights & Golden Trading Windows
  const activeHours = hourlyBreakdown.filter(h => h.totalTrades > 0);
  const goldenHours = activeHours
    .filter(h => h.netPnL > 0 && h.winRate >= 50)
    .sort((a, b) => b.netPnL - a.netPnL)
    .slice(0, 3)
    .map(h => ({ hour: h.hour, label: h.hourLabel, winRate: h.winRate, pnl: h.netPnL, trades: h.totalTrades }));

  const riskHours = activeHours
    .filter(h => h.netPnL < 0 || h.winRate < 40)
    .sort((a, b) => a.netPnL - b.netPnL)
    .slice(0, 3)
    .map(h => ({ hour: h.hour, label: h.hourLabel, winRate: h.winRate, pnl: h.netPnL, trades: h.totalTrades }));

  const bestPerformingPair = pairBreakdown.length > 0 ? pairBreakdown[0].pair : null;
  const worstPerformingPair = pairBreakdown.length > 0 && pairBreakdown[pairBreakdown.length - 1].totalPnL < 0
    ? pairBreakdown[pairBreakdown.length - 1].pair
    : null;

  const mostActivePair = pairBreakdown.slice().sort((a, b) => b.totalTrades - a.totalTrades)[0]?.pair || null;

  const recommendations: string[] = [];
  if (goldenHours.length > 0) {
    recommendations.push(
      `Top executing window: ${goldenHours.map(g => `${g.label} (${g.winRate}% win rate, +$${g.pnl.toFixed(2)})`).join(', ')}.`
    );
  }
  if (riskHours.length > 0) {
    recommendations.push(
      `Caution hours with high drawdown: ${riskHours.map(r => `${r.label} (${r.winRate}% win rate, -$${Math.abs(r.pnl).toFixed(2)})`).join(', ')}.`
    );
  }
  if (bestPerformingPair) {
    const p = pairBreakdown.find(x => x.pair === bestPerformingPair);
    if (p) {
      recommendations.push(
        `Highest edge asset is ${bestPerformingPair} generating +$${p.totalPnL.toFixed(2)} across ${p.totalTrades} trades (${p.winRate}% success).`
      );
    }
  }
  if (worstPerformingPair) {
    const p = pairBreakdown.find(x => x.pair === worstPerformingPair);
    if (p) {
      recommendations.push(
        `Underperforming pair ${worstPerformingPair} generated -$${Math.abs(p.totalPnL).toFixed(2)}. Consider tightening stop loss margins or restricting universe during high volatility.`
      );
    }
  }
  if (recommendations.length === 0) {
    recommendations.push('No trades recorded within the selected date range. Select a broader date range or trade live to view historical edge comparisons.');
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  const padMonth = (m: number) => String(m).padStart(2, '0');

  return {
    from,
    to,
    fromDateStr: `${fromDate.getFullYear()}-${padMonth(fromDate.getMonth() + 1)}-${pad(fromDate.getDate())}`,
    toDateStr: `${toDate.getFullYear()}-${padMonth(toDate.getMonth() + 1)}-${pad(toDate.getDate())}`,
    totalTrades: trades.length,
    winningTrades: totalWins,
    losingTrades: totalLosses,
    breakevenTrades: totalBreakevens,
    overallWinRate: trades.length > 0 ? Math.round((totalWins / trades.length) * 1000) / 10 : 0,
    totalNetPnL: Math.round(totalNetPnL * 100) / 100,
    grossProfit: Math.round(totalGrossProfit * 100) / 100,
    grossLoss: Math.round(totalGrossLoss * 100) / 100,
    overallProfitFactor: totalGrossLoss > 0 ? Math.round((totalGrossProfit / totalGrossLoss) * 100) / 100 : totalGrossProfit > 0 ? 99.99 : 0,
    pairBreakdown,
    hourlyBreakdown,
    rawTrades: trades,
    insights: {
      bestPerformingPair,
      worstPerformingPair,
      mostActivePair,
      goldenHours,
      riskHours,
      bestTradingSession: goldenHours.length > 0 ? goldenHours[0].label : null,
      recommendations
    }
  };
}
