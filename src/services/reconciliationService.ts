import { executeQuery, executeRun } from '../database/db';
import { brokerRegistry } from '../brokers/registry';
import { tradeContinuityService } from './tradeContinuityService';

export type ReconciliationStatus =
  | 'MATCHED' | 'RECONCILIATION_MISMATCH' | 'ORPHAN_INTERNAL'
  | 'ORPHAN_BROKER' | 'ORPHAN_SQLITE' | 'SQLITE_DIVERGENCE';

export interface InternalStateItem { id:string; symbol:string; quantity:number; direction:string; status:string; price:number; }
export interface BrokerStateItem { id:string; symbol:string; quantity:number; direction:string; status:string; price:number; }
export interface SqliteTradeTraceData {
  tradeTraceId: string;
  signalId?: string;
  status?: string;
  environment?: string;
  brokerOrderId?: string;
  [key: string]: any;
}
export interface ReconciliationDiscrepancy {
  entityId:string; type:ReconciliationStatus; field?:string;
  internalValue?:any; brokerValue?:any; sqliteValue?:any; message:string;
}
export interface ReconciliationRecord {
  reconciliationId:string; tradeTraceId:string; status:ReconciliationStatus;
  internalState:Record<string,any>; brokerState:Record<string,any>;
  sqliteState:Record<string,any>; discrepancies:ReconciliationDiscrepancy[];
  timestamp:number; userId?:string;
}

export class ReconciliationService {
  private localRecords = new Map<string, ReconciliationRecord>();

  public async reconcileThreeWay(
    tradeTraceId:string,
    internalItem?:InternalStateItem|null,
    brokerItem?:BrokerStateItem|null,
    sqliteTrace?:SqliteTradeTraceData|null
  ):Promise<ReconciliationRecord> {
    const reconciliationId = `RECON-${tradeTraceId}-${Date.now()}`;
    const discrepancies:ReconciliationDiscrepancy[] = [];
    let localTrace = sqliteTrace || null;
    if (!localTrace) {
      const rows = await executeQuery<any>(
        'SELECT payload_json FROM trade_traces WHERE trade_trace_id = ? LIMIT 1',
        [tradeTraceId]
      );
      if (rows.length) {
        try { localTrace = JSON.parse(rows[0].payload_json || '{}'); } catch { localTrace = null; }
      }
    }

    const count = (internalItem?1:0)+(brokerItem?1:0)+(localTrace?1:0);
    if (count === 1) {
      if (internalItem) discrepancies.push({entityId:tradeTraceId,type:'ORPHAN_INTERNAL',message:'Record exists in internal execution state but is missing from broker and SQLite trace persistence.'});
      else if (brokerItem) discrepancies.push({entityId:tradeTraceId,type:'ORPHAN_BROKER',message:'Record exists on broker but is missing from internal state and SQLite trace persistence.'});
      else discrepancies.push({entityId:tradeTraceId,type:'ORPHAN_SQLITE',message:'Trace record exists in SQLite but is missing from internal state and broker.'});
    } else if (count === 2 && internalItem && brokerItem && !localTrace) {
      discrepancies.push({entityId:tradeTraceId,type:'SQLITE_DIVERGENCE',message:'Record exists in internal state and broker but is missing from SQLite trace persistence.'});
    } else if (count === 2 && internalItem && localTrace && !brokerItem) {
      discrepancies.push({entityId:tradeTraceId,type:'RECONCILIATION_MISMATCH',message:'Record exists in internal state and SQLite but is missing from broker.'});
    } else if (count === 2 && brokerItem && localTrace && !internalItem) {
      discrepancies.push({entityId:tradeTraceId,type:'RECONCILIATION_MISMATCH',message:'Record exists on broker and SQLite but is missing from internal state.'});
    }

    if (internalItem && brokerItem) {
      const checks:[keyof InternalStateItem,string][]=[
        ['symbol','symbol'],['quantity','quantity'],['direction','direction'],['price','price'],['status','status']
      ];
      for (const [field,label] of checks) {
        const a=(internalItem as any)[field], b=(brokerItem as any)[field];
        const mismatch = field==='quantity' ? Math.abs(a-b)>0.0001 : field==='price' ? Math.abs(a-b)>0.001 : a!==b;
        if (mismatch) discrepancies.push({
          entityId:tradeTraceId,type:'RECONCILIATION_MISMATCH',field:label,
          internalValue:a,brokerValue:b,message:`${label} mismatch: Internal (${a}) vs Broker (${b})`
        });
      }
    }

    if (localTrace?.brokerOrderId && brokerItem?.id && localTrace.brokerOrderId !== brokerItem.id) {
      discrepancies.push({
        entityId:tradeTraceId,type:'SQLITE_DIVERGENCE',field:'brokerOrderId',
        brokerValue:brokerItem.id,sqliteValue:localTrace.brokerOrderId,
        message:`Broker Order ID in SQLite trace (${localTrace.brokerOrderId}) differs from Broker item (${brokerItem.id})`
      });
    }

    const record:ReconciliationRecord={
      reconciliationId, tradeTraceId,
      status:discrepancies.length ? discrepancies[0].type : 'MATCHED',
      internalState:internalItem?{...internalItem}:{},
      brokerState:brokerItem?{...brokerItem}:{},
      sqliteState:localTrace?{...localTrace}:{},
      discrepancies,timestamp:Date.now(),userId:'local_user'
    };
    this.localRecords.set(reconciliationId,record);
    await executeRun(
      'INSERT OR REPLACE INTO trade_trace_nodes (node_id, trade_trace_id, payload_json, timestamp) VALUES (?, ?, ?, ?)',
      [`recon-${reconciliationId}`, tradeTraceId, JSON.stringify(record), record.timestamp]
    );
    return record;
  }

  public async recordTradeTrace(tradeTraceId: string, payload: any): Promise<void> {
    const ts = Date.now();
    await executeRun(
      'INSERT OR REPLACE INTO trade_traces (trade_trace_id, payload_json, timestamp, updated_at) VALUES (?, ?, ?, ?)',
      [tradeTraceId, JSON.stringify(payload), ts, ts]
    );
  }

  public async recordBrokerConfirmedTrade(trade: {
    id: string;
    signalId?: string;
    instrument: string;
    direction: string;
    entryPrice: number;
    exitPrice?: number;
    size: number;
    pnl?: number;
    status: string;
    entryTime: number;
    exitTime?: number;
    tracePayload?: any;
  }): Promise<void> {
    await executeRun(
      'INSERT OR REPLACE INTO trades (id, signal_id, instrument, direction, entry_price, exit_price, size, pnl, status, entry_time, exit_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        trade.id,
        trade.signalId ?? null,
        trade.instrument,
        trade.direction,
        trade.entryPrice,
        trade.exitPrice ?? null,
        trade.size,
        trade.pnl ?? null,
        trade.status,
        trade.entryTime,
        trade.exitTime ?? null
      ]
    );

    const traceId = `TRACE-${trade.id}`;
    const payload = trade.tracePayload || {
      tradeId: trade.id,
      signalId: trade.signalId,
      instrument: trade.instrument,
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      size: trade.size,
      pnl: trade.pnl,
      status: trade.status,
      timestamp: trade.exitTime || trade.entryTime
    };
    await this.recordTradeTrace(traceId, payload);

    if (trade.pnl !== undefined && trade.pnl !== null) {
      tradeContinuityService.recordTradeOutcome({
        id: trade.id,
        symbol: trade.instrument,
        pnl: trade.pnl,
        timestamp: trade.exitTime || trade.entryTime
      });
    }
  }

  public async synchronizeBrokerExecutions(
    broker: 'CTRADER' | 'FIVE_PAISA',
    fromTimestamp?: number,
    toTimestamp?: number
  ): Promise<{ syncedTradesCount: number; syncedPositionsCount: number; syncedOrdersCount: number }> {
    const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
    if (!adapter) return { syncedTradesCount: 0, syncedPositionsCount: 0, syncedOrdersCount: 0 };

    let syncedTradesCount = 0;
    let syncedPositionsCount = 0;
    let syncedOrdersCount = 0;

    const from = fromTimestamp ?? (Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = toTimestamp ?? Date.now();

    try {
      // 1. Synchronize positions
      const positions = await adapter.getPositions();
      if (Array.isArray(positions)) {
        for (const pos of positions) {
          await executeRun(
            'INSERT OR REPLACE INTO positions (id, instrument, direction, entry_price, current_price, quantity, unrealized_pnl, stop_loss, take_profit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              String(pos.id),
              String(pos.symbol),
              String(pos.side),
              Number(pos.entryPrice || 0),
              Number(pos.currentPrice || pos.entryPrice || 0),
              Number(pos.quantity || 0),
              Number(pos.unrealizedPnL || 0),
              pos.stopLoss !== undefined ? Number(pos.stopLoss) : null,
              pos.takeProfit !== undefined ? Number(pos.takeProfit) : null
            ]
          );
          syncedPositionsCount++;
        }
      }

      // 2. Synchronize open orders
      const orders = await adapter.getOpenOrders();
      if (Array.isArray(orders)) {
        for (const ord of orders) {
          await executeRun(
            'INSERT OR REPLACE INTO orders (id, instrument, order_type, direction, price, quantity, status, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
              String(ord.brokerOrderId || ord.id),
              String(ord.symbol),
              String(ord.orderType || 'MARKET'),
              String(ord.side || 'BUY'),
              ord.price !== undefined ? Number(ord.price) : null,
              Number(ord.quantity || 0),
              String(ord.status || 'NEW'),
              Number(ord.timestamp || Date.now())
            ]
          );
          syncedOrdersCount++;
        }
      }

      // 3. Synchronize closed deals into trades
      const history = adapter.getOrderHistoryRange
        ? await adapter.getOrderHistoryRange(from, to)
        : await adapter.getOrderHistory();

      if (Array.isArray(history)) {
        for (const order of history) {
          if (order.isClosedDeal !== undefined && !order.isClosedDeal) continue;
          if (order.status && order.status !== 'FILLED') continue;

          let pnl: number | null = null;
          if (typeof (order as any).netAmount === 'number' && Number.isFinite((order as any).netAmount)) {
            pnl = (order as any).netAmount;
          } else if (typeof (order as any).realizedPnL === 'number' && Number.isFinite((order as any).realizedPnL)) {
            pnl = (order as any).realizedPnL;
          } else if (typeof (order as any).pnl === 'number' && Number.isFinite((order as any).pnl)) {
            pnl = (order as any).pnl;
          }

          const entry = Number(order.price ?? 0);
          const exit = Number(order.averageFillPrice ?? 0);
          const qty = Number(order.filledQuantity ?? order.quantity ?? 0);
          const side = String(order.side || 'BUY').toUpperCase().includes('SELL') ? 'SELL' : 'BUY';
          const sym = String(order.symbol || 'UNKNOWN');

          if (pnl === null && order.isClosedDeal && entry > 0 && exit > 0 && qty > 0 && Math.abs(exit - entry) > 0.00001) {
            const rawDiff = side === 'SELL' ? (entry - exit) : (exit - entry);
            if (sym.includes('JPY') && !sym.startsWith('JPY')) {
              pnl = (rawDiff * qty) / (exit > 50 ? exit : 150.0);
            } else {
              pnl = rawDiff * qty;
            }
          }

          if (pnl !== null) {
            const dealId = String(order.id);
            const ts = Number(order.timestamp || Date.now());
            await this.recordBrokerConfirmedTrade({
              id: dealId,
              signalId: (order as any).signalId,
              instrument: sym,
              direction: side,
              entryPrice: entry,
              exitPrice: exit,
              size: qty,
              pnl: Math.round(pnl * 100) / 100,
              status: 'CLOSED',
              entryTime: ts,
              exitTime: ts,
              tracePayload: order
            });
            syncedTradesCount++;
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Goldcrest] synchronizeBrokerExecutions for ${broker} failed:`, err?.message || err);
    }

    return { syncedTradesCount, syncedPositionsCount, syncedOrdersCount };
  }

  public async captureBrokerSnapshot(broker: 'CTRADER' | 'FIVE_PAISA'): Promise<any> {
    const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
    if (!adapter) return null;
    try {
      const [account, positions, orders] = await Promise.all([
        adapter.getAccount(), adapter.getPositions(), adapter.getOpenOrders()
      ]);
      const timestamp = Date.now();
      const snapshot = { id:`BROKER-SNAPSHOT-${broker}-${timestamp}`, broker, environment:'LIVE', timestamp, account, positions, orders, status:'CAPTURED' };
      await executeRun(
        'INSERT INTO broker_reconciliation_snapshots (id, broker, environment, timestamp, account_json, positions_json, orders_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [snapshot.id, broker, 'LIVE', timestamp, JSON.stringify(account), JSON.stringify(positions), JSON.stringify(orders), snapshot.status]
      );
      // Synchronize durable tables in background without throwing
      this.synchronizeBrokerExecutions(broker, timestamp - 24 * 60 * 60 * 1000, timestamp).catch(() => {});
      return snapshot;
    } catch (err:any) {
      const isUnconfigured = err?.code === 'AUTHENTICATION_FAILED' ||
        err?.message?.includes('access token is unavailable') ||
        err?.message?.includes('credentials missing') ||
        err?.message?.includes('ACCOUNT_NOT_FOUND');
      const timestamp = Date.now();
      const snapshot = { id:`BROKER-SNAPSHOT-${broker}-${timestamp}`, broker, environment:'LIVE', timestamp, account:null, positions:[], orders:[], status:isUnconfigured?'UNCONFIGURED':'FAILED', reason:err?.message||String(err) };
      await executeRun(
        'INSERT INTO broker_reconciliation_snapshots (id, broker, environment, timestamp, account_json, positions_json, orders_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [snapshot.id, broker, 'LIVE', timestamp, JSON.stringify(null), JSON.stringify([]), JSON.stringify([]), snapshot.status]
      );
      return snapshot;
    }
  }

  public async loadBrokerSnapshots(limit=50): Promise<any[]> {
    const rows = await executeQuery<any>(
      'SELECT id, broker, environment, timestamp, account_json, positions_json, orders_json, status FROM broker_reconciliation_snapshots ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );
    return rows.map(r => ({
      id:r.id, broker:r.broker, environment:r.environment, timestamp:Number(r.timestamp),
      account:JSON.parse(r.account_json), positions:JSON.parse(r.positions_json), orders:JSON.parse(r.orders_json), status:r.status
    }));
  }

  public async getDailyLoss(broker:'CTRADER'|'FIVE_PAISA', currentBalance:number):Promise<number> {
    const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
    if (typeof adapter.getDailyRealizedPnL === 'function') {
      try {
        const realizedPnL = await adapter.getDailyRealizedPnL();
        if (Number.isFinite(realizedPnL)) return Math.max(0, -Number(realizedPnL));
      } catch (err:any) {
        console.warn('[Goldcrest] authoritative daily PnL unavailable; using reconciliation baseline:', err?.message||err);
      }
    }
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const rows = await executeQuery<any>(
      'SELECT account_json FROM broker_reconciliation_snapshots WHERE broker = ? AND environment = ? AND timestamp >= ? AND status = ? ORDER BY timestamp ASC LIMIT 1',
      [broker,'LIVE',startOfDay.getTime(),'CAPTURED']
    );
    if (!rows.length) return 0;
    try {
      const baselineBalance = Number(JSON.parse(rows[0].account_json || '{}')?.balance);
      if (!Number.isFinite(baselineBalance) || !Number.isFinite(currentBalance)) return 0;
      return Math.max(0, baselineBalance-currentBalance);
    } catch { return 0; }
  }

  public getLocalRecord(id:string){ return this.localRecords.get(id); }
  public getAllLocalRecords(){ return Array.from(this.localRecords.values()); }

  public async loadRecentRecords(limit=100):Promise<ReconciliationRecord[]> {
    const rows=await executeQuery<any>(
      'SELECT payload_json FROM trade_trace_nodes WHERE node_id LIKE ? ORDER BY timestamp DESC LIMIT ?',
      ['recon-RECON-%',limit]
    );
    return rows.map(r=>JSON.parse(r.payload_json) as ReconciliationRecord);
  }
}

export const reconciliationService = new ReconciliationService();
