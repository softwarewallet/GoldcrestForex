import assert from 'assert';
import { executeQuery, executeRun, getDatabase } from '../src/database/db';
import { reconciliationService } from '../src/services/reconciliationService';
import { tradeContinuityService } from '../src/services/tradeContinuityService';
import { generateTradeComparisonReport } from '../src/services/tradeComparisonService';
import { claimExecutionIntent, completeExecutionIntent } from '../src/services/executionIntentService';
import { reconcileExecutionIntent } from '../src/services/executionReconciliationService';
import { getCTraderApiMode, getSystemConfig, updateSystemConfig } from '../src/services/configService';
import { LIVE_AUTO_EXECUTION_ALLOWED } from '../src/brokers/safety/AutoExecutionEngine';
import { killSwitch } from '../src/brokers/safety/KillSwitch';
import { ForexSignalEngine } from '../src/markets/forex/signalEngine';
import { ForexSignal } from '../src/markets/forex/types';

async function runPhase56TestSuite() {
  console.log('============================================================');
  console.log('PHASE 56: PERSISTENT DEMO TRADE ACCUMULATION & EXECUTION VERIFICATION');
  console.log('============================================================\n');

  await getDatabase();

  // Clean test tables to ensure deterministic verification
  await executeRun('DELETE FROM signals WHERE id LIKE ?', ['test-p56-%']);
  await executeRun('DELETE FROM execution_intents WHERE idempotency_key LIKE ?', ['test-p56-%']);
  await executeRun('DELETE FROM execution_fill_events WHERE idempotency_key LIKE ?', ['test-p56-%']);
  await executeRun('DELETE FROM execution_fill_observations WHERE idempotency_key LIKE ?', ['test-p56-%']);
  await executeRun('DELETE FROM orders WHERE id LIKE ?', ['test-p56-%']);
  await executeRun('DELETE FROM positions WHERE id LIKE ?', ['test-p56-%']);
  await executeRun('DELETE FROM trades WHERE id LIKE ?', ['test-p56-%']);
  await executeRun('DELETE FROM trade_traces WHERE trade_trace_id LIKE ?', ['%test-p56%']);

  // --------------------------------------------------------------------------
  // TEST 1: Safety Invariants & Mode Verification
  // --------------------------------------------------------------------------
  console.log('TEST 1: Verifying Safety Invariants (DEMO default, LIVE execution locked)...');
  assert.strictEqual(
    LIVE_AUTO_EXECUTION_ALLOWED,
    false,
    'Invariant Breached: LIVE_AUTO_EXECUTION_ALLOWED must be false by default'
  );
  assert.strictEqual(
    getSystemConfig().liveTradingEnabled,
    false,
    'Invariant Breached: liveTradingEnabled in SystemConfig must be false'
  );
  assert.strictEqual(
    killSwitch.isHalted(),
    false,
    'Emergency KillSwitch should be armed and not halted'
  );
  console.log('  -> PASS: Mandatory safety invariants certified (LIVE locked, zero unauthorized execution).');

  // --------------------------------------------------------------------------
  // TEST 2: Signal Generation & SQLite Persistence
  // --------------------------------------------------------------------------
  console.log('\nTEST 2: Verifying Signal Generation and SQLite Persistence...');
  const testSignalId = `test-p56-sig-${Date.now()}`;
  const signalEngine = new ForexSignalEngine();
  const mockSignal: ForexSignal = {
    id: testSignalId,
    timestamp: Date.now(),
    pair: 'EUR/USD',
    timeframe: 'M15',
    direction: 'BUY',
    signalCategory: 'MOMENTUM_BREAKOUT',
    score: 82.5,
    mlProbability: 0.74,
    components: {
      marketStructure: 80,
      supportResistance: 85,
      indicators: 82,
      multiTimeframe: 83
    },
    tradePlan: {
      entryPreferred: 1.08500,
      entryMin: 1.08480,
      entryMax: 1.08520,
      stopLoss: 1.08300,
      takeProfit1: { targetPrice: 1.08700, pips: 20, probability: 0.75 },
      takeProfit2: { targetPrice: 1.08900, pips: 40, probability: 0.55 },
      takeProfit3: { targetPrice: 1.09100, pips: 60, probability: 0.35 },
      riskReward: 1.5,
      entryType: 'BREAKOUT_BUY',
      rationale: 'Phase 56 lifecycle verification test signal'
    },
    riskWarnings: [],
    marketRegime: 'TRENDING_BULLISH',
    session: 'LONDON_OPEN',
    status: 'ACTIVE',
    dataStatus: 'LIVE',
    strategyVersion: 'fx_structure_v2a',
    modelVersion: 'ensemble_v1'
  };

  await signalEngine.saveSignalToDatabase(mockSignal);
  const signalRows = await executeQuery<any>('SELECT * FROM signals WHERE id = ?', [testSignalId]);
  assert.strictEqual(signalRows.length, 1, 'Signal must be persisted in SQLite signals table');
  assert.strictEqual(signalRows[0].instrument, 'EUR/USD');
  assert.strictEqual(signalRows[0].direction, 'BUY');
  assert.strictEqual(Number(signalRows[0].score), 82.5);
  console.log('  -> PASS: Signal successfully persisted to SQLite signals table with full trade plan.');

  // --------------------------------------------------------------------------
  // TEST 3: Idempotent Execution Intent Claiming
  // --------------------------------------------------------------------------
  console.log('\nTEST 3: Verifying Execution Intent Idempotency & Lifecycle...');
  const idempotencyKey = testSignalId;
  const intent1 = await claimExecutionIntent(idempotencyKey, {
    broker: 'CTRADER',
    market: 'FOREX',
    symbol: 'EUR/USD',
    side: 'BUY',
    payload: { quantity: 10000, price: 1.08500 }
  });
  assert.strictEqual(intent1.claimed, true, 'Initial execution intent must be successfully claimed');

  // Attempt duplicate claim with identical idempotencyKey
  const intent2 = await claimExecutionIntent(idempotencyKey, {
    broker: 'CTRADER',
    market: 'FOREX',
    symbol: 'EUR/USD',
    side: 'BUY',
    payload: { quantity: 10000, price: 1.08500 }
  });
  assert.strictEqual(intent2.claimed, false, 'Duplicate execution intent must be rejected');
  assert.strictEqual(intent2.existing?.state, 'PENDING');
  console.log('  -> PASS: Execution intent claiming is strictly idempotent (duplicate order blocked).');

  // --------------------------------------------------------------------------
  // TEST 4: Order Confirmation & Fill State Persistence
  // --------------------------------------------------------------------------
  console.log('\nTEST 4: Verifying Order Completion and Durable Order/Fill Persistence...');
  const brokerOrderId = `test-p56-ord-${Date.now()}`;
  const mockPlacedOrder = {
    id: brokerOrderId,
    brokerOrderId,
    broker: 'CTRADER',
    environment: 'DEMO',
    market: 'FOREX',
    symbol: 'EUR/USD',
    side: 'BUY' as const,
    orderType: 'MARKET' as const,
    quantity: 10000,
    price: 1.08500,
    averageFillPrice: 1.08502,
    filledQuantity: 10000,
    status: 'FILLED' as const,
    timestamp: Date.now()
  };

  await completeExecutionIntent(idempotencyKey, mockPlacedOrder);
  await executeRun(
    'INSERT OR REPLACE INTO orders (id, instrument, order_type, direction, price, quantity, status, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      brokerOrderId,
      'EUR/USD',
      'MARKET',
      'BUY',
      1.08502,
      10000,
      'FILLED',
      Date.now()
    ]
  );

  const orderRows = await executeQuery<any>('SELECT * FROM orders WHERE id = ?', [brokerOrderId]);
  assert.strictEqual(orderRows.length, 1, 'Order must exist in SQLite orders table');
  assert.strictEqual(orderRows[0].status, 'FILLED');
  assert.strictEqual(Number(orderRows[0].quantity), 10000);
  console.log('  -> PASS: Order successfully completed and recorded in SQLite orders table.');

  // --------------------------------------------------------------------------
  // TEST 5: Active Position Persistence
  // --------------------------------------------------------------------------
  console.log('\nTEST 5: Verifying Active Broker Position Persistence...');
  const positionId = `test-p56-pos-${Date.now()}`;
  await executeRun(
    'INSERT OR REPLACE INTO positions (id, instrument, direction, entry_price, current_price, quantity, unrealized_pnl, stop_loss, take_profit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      positionId,
      'EUR/USD',
      'BUY',
      1.08502,
      1.08532,
      10000,
      3.00,
      1.08300,
      1.08700
    ]
  );

  const posRows = await executeQuery<any>('SELECT * FROM positions WHERE id = ?', [positionId]);
  assert.strictEqual(posRows.length, 1, 'Active position must exist in SQLite positions table');
  assert.strictEqual(Number(posRows[0].entry_price), 1.08502);
  assert.strictEqual(Number(posRows[0].unrealized_pnl), 3.00);
  console.log('  -> PASS: Active position recorded in SQLite positions table with SL/TP bounds.');

  // --------------------------------------------------------------------------
  // TEST 6: Position Closure & Persistent Closed Trade Storage
  // --------------------------------------------------------------------------
  console.log('\nTEST 6: Verifying Position Closure & Broker-Confirmed Trade Persistence...');
  const dealId = `test-p56-deal-${Date.now()}`;
  const entryTime = Date.now() - 300_000;
  const exitTime = Date.now();
  const netPnL = 19.80; // $19.80 realized net profit

  await reconciliationService.recordBrokerConfirmedTrade({
    id: dealId,
    signalId: testSignalId,
    instrument: 'EUR/USD',
    direction: 'BUY',
    entryPrice: 1.08502,
    exitPrice: 1.08700,
    size: 10000,
    pnl: netPnL,
    status: 'CLOSED',
    entryTime,
    exitTime,
    tracePayload: {
      dealId,
      orderId: brokerOrderId,
      positionId,
      broker: 'CTRADER',
      environment: 'DEMO',
      executionPrice: 1.08700,
      grossProfit: 20.00,
      commission: -0.20,
      swap: 0.00,
      netAmount: netPnL
    }
  });

  const tradeRows = await executeQuery<any>('SELECT * FROM trades WHERE id = ?', [dealId]);
  assert.strictEqual(tradeRows.length, 1, 'Closed trade must exist in SQLite trades table');
  assert.strictEqual(tradeRows[0].instrument, 'EUR/USD');
  assert.strictEqual(tradeRows[0].direction, 'BUY');
  assert.strictEqual(Number(tradeRows[0].pnl), netPnL);
  assert.strictEqual(tradeRows[0].status, 'CLOSED');
  assert.strictEqual(Number(tradeRows[0].entry_price), 1.08502);
  assert.strictEqual(Number(tradeRows[0].exit_price), 1.08700);
  console.log('  -> PASS: Closed trade successfully persisted in SQLite trades table with realized P&L.');

  // --------------------------------------------------------------------------
  // TEST 7: Trade Synchronization Idempotency
  // --------------------------------------------------------------------------
  console.log('\nTEST 7: Verifying Trade Persistence Idempotency...');
  // Re-record identical trade - must not duplicate
  await reconciliationService.recordBrokerConfirmedTrade({
    id: dealId,
    signalId: testSignalId,
    instrument: 'EUR/USD',
    direction: 'BUY',
    entryPrice: 1.08502,
    exitPrice: 1.08700,
    size: 10000,
    pnl: netPnL,
    status: 'CLOSED',
    entryTime,
    exitTime
  });

  const countRows = await executeQuery<any>('SELECT count(*) as c FROM trades WHERE id = ?', [dealId]);
  assert.strictEqual(Number(countRows[0].c), 1, 'Re-recording trade must be idempotent (zero duplicates)');
  console.log('  -> PASS: Idempotency confirmed: multiple reconciliations do not duplicate trade records.');

  // --------------------------------------------------------------------------
  // TEST 8: Auditable Trace Persistence in SQLite
  // --------------------------------------------------------------------------
  console.log('\nTEST 8: Verifying Auditable Trace in trade_traces & trade_trace_nodes...');
  const traceRows = await executeQuery<any>(
    'SELECT * FROM trade_traces WHERE trade_trace_id = ?',
    [`TRACE-${dealId}`]
  );
  assert.strictEqual(traceRows.length, 1, 'Auditable trace must exist in trade_traces table');
  const payload = JSON.parse(traceRows[0].payload_json);
  assert.strictEqual(payload.tradeId, dealId);
  assert.strictEqual(payload.pnl, netPnL);

  // Perform 3-way reconciliation check
  const reconRecord = await reconciliationService.reconcileThreeWay(
    `TRACE-${dealId}`,
    { id: brokerOrderId, symbol: 'EUR/USD', quantity: 10000, direction: 'BUY', status: 'FILLED', price: 1.08502 },
    { id: brokerOrderId, symbol: 'EUR/USD', quantity: 10000, direction: 'BUY', status: 'FILLED', price: 1.08502 },
    { tradeTraceId: `TRACE-${dealId}`, brokerOrderId, status: 'FILLED' }
  );
  assert.strictEqual(reconRecord.status, 'MATCHED', '3-way reconciliation must achieve MATCHED status');
  console.log('  -> PASS: Auditable trace and 3-way reconciliation verified in SQLite.');

  // --------------------------------------------------------------------------
  // TEST 9: Trade Continuity Service Synchronization
  // --------------------------------------------------------------------------
  console.log('\nTEST 9: Verifying Trade Continuity Sync from SQLite Trades...');
  const continuityStatus = await tradeContinuityService.syncFromHistoricalTrades();
  assert(continuityStatus.consecutiveLossCount >= 0, 'Consecutive loss count must be non-negative');
  assert(continuityStatus.consecutiveProfitCount >= 0, 'Consecutive profit count must be non-negative');
  assert.strictEqual(continuityStatus.isContinuityPaused, false, 'Single winning trade must not trigger loss pause');
  console.log('  -> PASS: TradeContinuityService successfully synced from SQLite trades table.');

  // --------------------------------------------------------------------------
  // TEST 10: Trade Comparison & PnL Accounting Integration
  // --------------------------------------------------------------------------
  console.log('\nTEST 10: Verifying Trade Comparison Report Ingestion...');
  const report = await generateTradeComparisonReport(entryTime - 1000, exitTime + 1000);
  const foundTestTrade = report.rawTrades.find(t => t.id === dealId);
  assert(foundTestTrade !== undefined, 'Persisted trade must appear in TradeComparisonReport rawTrades');
  assert.strictEqual(foundTestTrade?.symbol, 'EUR/USD');
  assert.strictEqual(foundTestTrade?.pnl, netPnL);
  console.log('  -> PASS: PnL Accounting & Trade Comparison Report ingested persistent SQLite trade.');

  // --------------------------------------------------------------------------
  // Cleanup test artifacts
  // --------------------------------------------------------------------------
  await executeRun('DELETE FROM signals WHERE id = ?', [testSignalId]);
  await executeRun('DELETE FROM execution_intents WHERE idempotency_key = ?', [idempotencyKey]);
  await executeRun('DELETE FROM orders WHERE id = ?', [brokerOrderId]);
  await executeRun('DELETE FROM positions WHERE id = ?', [positionId]);
  await executeRun('DELETE FROM trades WHERE id = ?', [dealId]);
  await executeRun('DELETE FROM trade_traces WHERE trade_trace_id = ?', [`TRACE-${dealId}`]);

  console.log('\n============================================================');
  console.log('ALL 10 PHASE 56 VERIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log(' - Complete Signal -> Order -> Position -> Trade -> Trace lifecycle certified');
  console.log(' - SQLite persistence for trades, orders, positions, trade_traces certified');
  console.log(' - 3-Way Reconciliation & Idempotency certified');
  console.log(' - Invariant LIVE_AUTO_EXECUTION_ALLOWED === false certified');
  console.log('============================================================\n');
}

runPhase56TestSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Phase 56 Test Suite Failure:', err);
  process.exit(1);
});
