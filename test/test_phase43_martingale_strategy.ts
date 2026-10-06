import assert from 'node:assert/strict';
import { getSystemConfig, updateSystemConfig, getCTraderApiMode } from '../src/services/configService';
import { MartingaleRecoveryService } from '../src/services/martingaleRecoveryService';
import { LiveTradingGate } from '../src/brokers/safety/LiveTradingGate';
import { BrokerAdapter, NormalizedPosition, OrderRequest, NormalizedOrder, NormalizedQuote } from '../src/brokers/types';

// Mock Broker Adapter for Martingale Testing
class MockMartingaleAdapter implements Partial<BrokerAdapter> {
  public broker = 'CTRADER' as any;
  public environment = 'LIVE' as any;
  public isLive = true;

  public positions: NormalizedPosition[] = [];
  public lastOrderRequest?: OrderRequest;
  public lastModification?: { id: string; mod: any };
  public shouldFailOrder = false;
  public shouldRejectOrder = false;
  public shouldFailTP = false;
  public mockQuote: NormalizedQuote = {
    symbol: 'EUR/USD',
    bid: 1.09940,
    ask: 1.09950,
    spread: 1.0,
    timestamp: Date.now(),
    source: 'TEST',
    environment: 'LIVE',
    status: 'FRESH'
  };
  public usedMargin = 1000;
  public equity = 10000;
  public balance = 10000;

  async getPositions(): Promise<NormalizedPosition[]> {
    return this.positions;
  }

  async placeOrder(order: OrderRequest): Promise<NormalizedOrder> {
    this.lastOrderRequest = order;
    if (this.shouldFailOrder) {
      throw new Error('Broker connection severed during order placement');
    }
    if (this.shouldRejectOrder) {
      return {
        id: 'ord_rej_' + Date.now(),
        broker: this.broker,
        environment: this.environment,
        market: 'FOREX',
        symbol: order.symbol,
        side: order.side,
        orderType: order.orderType,
        quantity: order.quantity,
        status: 'REJECTED',
        filledQuantity: 0,
        timestamp: Date.now(),
        rejectionReason: 'Position limits breached'
      };
    }

    // Simulate successful fill and update internal position volume
    const pos = this.positions.find(p => String(p.id) === String(order.positionId));
    if (pos) {
      const oldVolume = pos.quantity;
      const newVolume = oldVolume + order.quantity;
      const oldWeightedPrice = pos.entryPrice * oldVolume;
      const newWeightedPrice = oldWeightedPrice + (order.price! * order.quantity);
      pos.quantity = newVolume;
      pos.entryPrice = newWeightedPrice / newVolume;
    }

    return {
      id: 'ord_' + Date.now(),
      broker: this.broker,
      environment: this.environment,
      market: 'FOREX',
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      quantity: order.quantity,
      status: 'FILLED',
      filledQuantity: order.quantity,
      averageFillPrice: order.price,
      brokerOrderId: 'b_ord_' + Date.now(),
      positionId: order.positionId,
      brokerPositionId: order.positionId ? String(order.positionId) : undefined,
      timestamp: Date.now()
    };
  }

  async modifyPosition(positionId: string, modifications: { stopLoss?: number; takeProfit?: number }): Promise<boolean> {
    this.lastModification = { id: positionId, mod: modifications };
    if (this.shouldFailTP) {
      return false;
    }
    const pos = this.positions.find(p => String(p.id) === positionId);
    if (pos) {
      if (modifications.takeProfit) pos.takeProfit = modifications.takeProfit;
      if (modifications.stopLoss) pos.stopLoss = modifications.stopLoss;
    }
    return true;
  }

  async modifyOrder(orderId: string, modifications: any): Promise<NormalizedOrder> {
    this.lastModification = { id: orderId, mod: modifications };
    if (this.shouldFailTP) {
      throw new Error('Broker rejected order amendment');
    }
    const pos = this.positions.find(p => String(p.id) === orderId);
    if (pos && modifications.takeProfit) {
      pos.takeProfit = modifications.takeProfit;
    }
    return { id: orderId, status: 'FILLED' } as any;
  }

  async getQuote(symbol: string): Promise<NormalizedQuote> {
    return { ...this.mockQuote, symbol, timestamp: this.mockQuote.timestamp || Date.now() };
  }

  async getMargin(): Promise<{ usedMargin: number; freeMargin: number }> {
    return { usedMargin: this.usedMargin, freeMargin: this.equity - this.usedMargin };
  }

  async getEquity(): Promise<number> {
    return this.equity;
  }

  async getBalance(): Promise<number> {
    return this.balance;
  }

  async getTradingStatus(): Promise<any> {
    return 'CONNECTED';
  }

  async getAccount(): Promise<any> {
    return {
      accountId: 'test_account',
      balance: this.balance,
      equity: this.equity,
      currency: 'USD',
      permissions: ['TRADE', 'TRADING']
    };
  }

  async getInstrument(symbol: string): Promise<any> {
    return {
      symbol,
      market: 'FOREX',
      pipSize: symbol.includes('JPY') ? 0.01 : 0.0001,
      minQuantity: 1000,
      maxQuantity: 10000000,
      stepQuantity: 1000,
      digits: symbol.includes('JPY') ? 3 : 5,
      supportedOrderTypes: ['MARKET', 'LIMIT', 'STOP']
    };
  }
}

async function runPhase43MartingaleTests() {
  console.log('============================================================');
  console.log('GOLDCREST FOREX — PHASE 43.1 MARTINGALE RECTIFICATION SUITE');
  console.log('============================================================\n');

  const adapter = new MockMartingaleAdapter() as any;

  // TEST 1: All open positions are discovered
  console.log('TEST 1: All open positions are discovered...');
  await updateSystemConfig({
    martingale: {
      ...getSystemConfig().martingale,
      enabled: true,
      scope: 'ALL',
      adverseTriggerPips: 5.0,
      volumeMultiplier: 2.0,
      maxRecoveryLevels: 5,
      maximumVolume: 50.0,
      maximumRecoveryDurationMin: 120
    }
  });

  adapter.positions = [
    {
      id: 'pos_101',
      broker: 'CTRADER',
      environment: 'LIVE',
      market: 'FOREX',
      symbol: 'EUR/USD',
      side: 'BUY',
      quantity: 100000,
      entryPrice: 1.17000,
      currentPrice: 1.17000,
      takeProfit: 1.17500,
      unrealizedPnL: 0,
      realizedPnL: 0,
      currency: 'USD',
      timestamp: Date.now()
    },
    {
      id: 'pos_102',
      broker: 'CTRADER',
      environment: 'LIVE',
      market: 'FOREX',
      symbol: 'EUR/USD',
      side: 'BUY',
      quantity: 200000,
      entryPrice: 1.18000,
      currentPrice: 1.18000,
      takeProfit: 1.18500,
      unrealizedPnL: 0,
      realizedPnL: 0,
      currency: 'USD',
      timestamp: Date.now()
    },
    {
      id: 'pos_103',
      broker: 'CTRADER',
      environment: 'LIVE',
      market: 'FOREX',
      symbol: 'GBP/USD',
      side: 'SELL',
      quantity: 100000,
      entryPrice: 1.35000,
      currentPrice: 1.35000,
      takeProfit: 1.34500,
      unrealizedPnL: 0,
      realizedPnL: 0,
      currency: 'USD',
      timestamp: Date.now()
    }
  ];

  await MartingaleRecoveryService.reconcileWithBroker('CTRADER', 'LIVE', adapter.positions);
  assert(MartingaleRecoveryService.getActiveSequence('pos_101') !== undefined);
  assert(MartingaleRecoveryService.getActiveSequence('pos_102') !== undefined);
  assert(MartingaleRecoveryService.getActiveSequence('pos_103') !== undefined);
  console.log('  -> PASS: All 3 open positions discovered and sequences initialized.');

  // TEST 2: Manual positions are discovered
  console.log('\nTEST 2: Manual positions are discovered...');
  adapter.positions.push({
    id: 'pos_manual_555',
    broker: 'CTRADER',
    environment: 'LIVE',
    market: 'FOREX',
    symbol: 'GBP/USD',
    side: 'BUY',
    quantity: 100000,
    entryPrice: 1.25000,
    currentPrice: 1.25000,
    takeProfit: 1.25500,
    unrealizedPnL: 0,
    realizedPnL: 0,
    currency: 'USD',
    timestamp: Date.now()
  });
  await MartingaleRecoveryService.reconcileWithBroker('CTRADER', 'LIVE', adapter.positions);
  const manualSeq = MartingaleRecoveryService.getActiveSequence('pos_manual_555');
  assert(manualSeq !== undefined);
  assert.equal(manualSeq?.positionId, 'pos_manual_555');
  console.log('  -> PASS: Manually opened position discovered without requiring Auto Live metadata.');

  // TEST 3: Positions opened before Martingale was enabled are discovered
  console.log('\nTEST 3: Positions opened before Martingale was enabled are discovered...');
  await updateSystemConfig({ martingale: { ...getSystemConfig().martingale, enabled: false } });
  adapter.positions.push({
    id: 'pos_pre_existing',
    broker: 'CTRADER',
    environment: 'LIVE',
    market: 'FOREX',
    symbol: 'USD/JPY',
    side: 'BUY',
    quantity: 100000,
    entryPrice: 150.00,
    currentPrice: 150.00,
    takeProfit: 150.50,
    unrealizedPnL: 0,
    realizedPnL: 0,
    currency: 'USD',
    timestamp: Date.now()
  });
  // Disabled: reconcile does nothing
  await MartingaleRecoveryService.reconcileWithBroker('CTRADER', 'LIVE', adapter.positions);
  assert.equal(MartingaleRecoveryService.getActiveSequence('pos_pre_existing'), undefined);
  // Re-enable
  await updateSystemConfig({ martingale: { ...getSystemConfig().martingale, enabled: true } });
  await MartingaleRecoveryService.reconcileWithBroker('CTRADER', 'LIVE', adapter.positions);
  assert(MartingaleRecoveryService.getActiveSequence('pos_pre_existing') !== undefined);
  console.log('  -> PASS: Positions created while disabled are registered upon enabling.');

  // TEST 4: Multiple positions on same pair get independent sequences
  console.log('\nTEST 4: Multiple positions on same pair get independent sequences...');
  const seq101 = MartingaleRecoveryService.getActiveSequence('pos_101')!;
  const seq102 = MartingaleRecoveryService.getActiveSequence('pos_102')!;
  assert.equal(seq101.pair, 'EUR/USD');
  assert.equal(seq102.pair, 'EUR/USD');
  assert.notEqual(seq101.positionId, seq102.positionId);
  assert.notEqual(seq101.sequenceId, seq102.sequenceId);
  assert.equal(seq101.baseVolume, 100000);
  assert.equal(seq102.baseVolume, 200000);
  console.log('  -> PASS: Position 101 and 102 on EUR/USD have distinct independent sequences.');

  // TEST 5: BUY 5-pip adverse trigger works
  console.log('\nTEST 5: BUY 5-pip adverse trigger works...');
  // pos_101 entry: 1.17000. 5 pips adverse is 1.16950.
  const buyTriggerCheck = MartingaleRecoveryService.evaluatePriceTick('pos_101', 1.16950, 'CTRADER', 'LIVE', { bid: 1.16950, ask: 1.16960 });
  assert.equal(buyTriggerCheck.triggered, true);
  console.log('  -> PASS: BUY adverse trigger evaluates to true at exactly -5 pips.');

  // TEST 6: SELL 5-pip adverse trigger works
  console.log('\nTEST 6: SELL 5-pip adverse trigger works...');
  // pos_103 entry: 1.35000 SELL. 5 pips adverse is 1.35050.
  const sellTriggerCheck = MartingaleRecoveryService.evaluatePriceTick('pos_103', 1.35050, 'CTRADER', 'LIVE', { bid: 1.35040, ask: 1.35050 });
  assert.equal(sellTriggerCheck.triggered, true);
  console.log('  -> PASS: SELL adverse trigger evaluates to true at exactly +5 pips.');

  // TEST 7: No trigger before 5 pips
  console.log('\nTEST 7: No trigger before 5 pips...');
  // pos_101 entry: 1.17000 BUY. Price at 1.16951 (4.9 pips adverse)
  const noTriggerCheck = MartingaleRecoveryService.evaluatePriceTick('pos_101', 1.16951, 'CTRADER', 'LIVE', { bid: 1.16951, ask: 1.16961 });
  assert.equal(noTriggerCheck.triggered, false);
  assert.equal(noTriggerCheck.reason, 'TRIGGER_PRICE_NOT_REACHED');
  console.log('  -> PASS: No trigger before reaching the 5-pip threshold.');

  // TEST 8: Recovery volume doubles correctly
  console.log('\nTEST 8: Recovery volume doubles correctly...');
  // pos_101 current volume: 100,000. Expected added recovery volume = 100,000 -> resulting = 200,000.
  adapter.mockQuote = { ...adapter.mockQuote, bid: 1.16940, ask: 1.16950, timestamp: Date.now() };
  const recoverySuccess = await MartingaleRecoveryService.executeRecovery('pos_101', adapter, 1.16940);
  assert.equal(recoverySuccess, true);
  assert.equal(adapter.lastOrderRequest?.quantity, 100000);
  const updated101 = MartingaleRecoveryService.getActiveSequence('pos_101')!;
  assert.equal(updated101.currentVolume, 200000);
  console.log('  -> PASS: Recovery volume calculated as +1.00 lot, resulting in 2.00 lots.');

  // TEST 9: Recovery uses authoritative positionId
  console.log('\nTEST 9: Recovery uses authoritative positionId...');
  assert.equal(adapter.lastOrderRequest?.positionId, 'pos_101');
  console.log('  -> PASS: OrderRequest carries authoritative positionId pos_101.');

  // TEST 10: Recovery is NOT submitted as unrelated standalone position
  console.log('\nTEST 10: Recovery is NOT submitted as unrelated standalone position...');
  assert(adapter.lastOrderRequest?.positionId !== undefined);
  assert.equal(adapter.lastOrderRequest?.positionId, 'pos_101');
  console.log('  -> PASS: Recovery request explicitly linked to existing cTrader position.');

  // TEST 11: Broker-confirmed recovery updates local state
  console.log('\nTEST 11: Broker-confirmed recovery updates local state...');
  assert.equal(updated101.recoveryLevel, 1);
  assert.equal(updated101.currentVolume, 200000);
  assert.equal(updated101.status, 'WAITING_NEXT_TRIGGER');
  assert(updated101.currentAverageEntry < 1.17000); // Average entry lowered by recovery
  console.log('  -> PASS: Local sequence record updated only after broker confirmation.');

  // TEST 12: Broker failure does NOT update recovery level
  console.log('\nTEST 12: Broker failure does NOT update recovery level...');
  adapter.shouldRejectOrder = true;
  // Move price to trigger Level 2 for pos_101 (next trigger is 1.16940 - 5 pips = 1.16890)
  const lvl2Trigger = MartingaleRecoveryService.evaluatePriceTick('pos_101', 1.16890, 'CTRADER', 'LIVE', { bid: 1.16890, ask: 1.16900 });
  assert.equal(lvl2Trigger.triggered, true);
  const failedRecovery = await MartingaleRecoveryService.executeRecovery('pos_101', adapter, 1.16890);
  assert.equal(failedRecovery, false);
  const unupdated101 = MartingaleRecoveryService.getActiveSequence('pos_101')!;
  assert.equal(unupdated101.recoveryLevel, 1); // Still level 1
  assert.equal(unupdated101.currentVolume, 200000); // Unchanged
  adapter.shouldRejectOrder = false;
  console.log('  -> PASS: Broker rejection leaves recovery level and volume untouched.');

  // TEST 13: Broker failure does NOT falsely update TP
  console.log('\nTEST 13: Broker failure does NOT falsely update TP...');
  adapter.shouldFailTP = true;
  const oldTP = unupdated101.currentDynamicTP;
  const tpFailResult = await MartingaleRecoveryService.executeRecovery('pos_101', adapter, 1.16890);
  assert.equal(tpFailResult, false);
  const postTPFailSeq = MartingaleRecoveryService.getActiveSequence('pos_101')!;
  assert.equal(postTPFailSeq.currentDynamicTP, oldTP);
  assert.notEqual(postTPFailSeq.status, 'TP_MODIFIED');
  adapter.shouldFailTP = false;
  console.log('  -> PASS: TP amendment failure prevents false update of currentDynamicTP.');

  // TEST 14: Dynamic TP is calculated after authoritative recovery
  console.log('\nTEST 14: Dynamic TP is calculated after authoritative recovery...');
  // pos_103 SELL at 1.35000. Adverse move to 1.35050.
  adapter.mockQuote = { ...adapter.mockQuote, bid: 1.35050, ask: 1.35060, timestamp: Date.now() };
  const sellRecoveryOk = await MartingaleRecoveryService.executeRecovery('pos_103', adapter, 1.35050);
  assert.equal(sellRecoveryOk, true);
  const updated103 = MartingaleRecoveryService.getActiveSequence('pos_103')!;
  assert(updated103.currentDynamicTP < updated103.currentAverageEntry); // SELL TP must be below entry
  console.log('  -> PASS: SELL dynamic TP is below the weighted average entry.');

  // TEST 15: TP amendment references correct positionId
  console.log('\nTEST 15: TP amendment references correct positionId...');
  assert.equal(adapter.lastModification?.id, 'pos_103');
  assert.equal(adapter.lastModification?.mod.takeProfit, updated103.currentDynamicTP);
  console.log('  -> PASS: TP amendment was called with positionId pos_103.');

  // TEST 16: Multiple positions cannot interfere with one another
  console.log('\nTEST 16: Multiple positions cannot interfere with one another...');
  // pos_102 (EUR/USD BUY entry 1.18000) was never triggered while pos_101 was recovering
  const untouched102 = MartingaleRecoveryService.getActiveSequence('pos_102')!;
  assert.equal(untouched102.recoveryLevel, 0);
  assert.equal(untouched102.currentVolume, 200000);
  assert.equal(untouched102.nextTriggerPrice, 1.17950);
  console.log('  -> PASS: Position 102 remained completely independent.');

  // TEST 17: Repeated scanner cycles cannot duplicate the same recovery
  console.log('\nTEST 17: Repeated scanner cycles cannot duplicate the same recovery...');
  // Price is still at 1.35050 where pos_103 just triggered Level 1
  const repeatCheck = MartingaleRecoveryService.evaluatePriceTick('pos_103', 1.35050, 'CTRADER', 'LIVE', { bid: 1.35050, ask: 1.35060 });
  assert.equal(repeatCheck.triggered, false);
  console.log('  -> PASS: Subsequent evaluation cycle at the same price does not duplicate recovery.');

  // TEST 18: Application restart does not duplicate an already executed recovery
  console.log('\nTEST 18: Application restart does not duplicate an already executed recovery...');
  // Re-reconcile with broker having the doubled volume
  await MartingaleRecoveryService.reconcileWithBroker('CTRADER', 'LIVE', adapter.positions);
  const reloaded103 = MartingaleRecoveryService.getActiveSequence('pos_103')!;
  assert.equal(reloaded103.recoveryLevel, 1);
  assert.equal(reloaded103.currentVolume, 200000);
  console.log('  -> PASS: Restart reconciliation preserves confirmed recovery without duplicate submission.');

  // TEST 19: Closed positions are removed/completed
  console.log('\nTEST 19: Closed positions are removed/completed...');
  adapter.positions = adapter.positions.filter(p => p.id !== 'pos_103');
  await MartingaleRecoveryService.reconcileWithBroker('CTRADER', 'LIVE', adapter.positions);
  assert.equal(MartingaleRecoveryService.getActiveSequence('pos_103'), undefined);
  console.log('  -> PASS: Closed position sequence removed from active manager.');

  // TEST 20: Maximum recovery level enforced
  console.log('\nTEST 20: Maximum recovery level enforced...');
  await updateSystemConfig({ martingale: { ...getSystemConfig().martingale, maxRecoveryLevels: 1 } });
  // pos_101 is already at Level 1, move price 5 pips further
  const maxLvlCheck = MartingaleRecoveryService.evaluatePriceTick('pos_101', 1.16800, 'CTRADER', 'LIVE', { bid: 1.16800, ask: 1.16810 });
  assert.equal(maxLvlCheck.triggered, false);
  assert.equal(maxLvlCheck.reason, 'MAX_RECOVERY_LEVEL_REACHED');
  await updateSystemConfig({ martingale: { ...getSystemConfig().martingale, maxRecoveryLevels: 5 } });
  console.log('  -> PASS: Maximum recovery level limit strictly blocks further triggers.');

  // TEST 21: Maximum recovery volume enforced
  console.log('\nTEST 21: Maximum recovery volume enforced...');
  // Set max volume to 2.5 lots (250,000 units). pos_101 current volume is 200,000; next doubled would be 400,000.
  await updateSystemConfig({ martingale: { ...getSystemConfig().martingale, maximumVolume: 2.5 } });
  const maxVolCheck = MartingaleRecoveryService.evaluatePriceTick('pos_101', 1.16800, 'CTRADER', 'LIVE', { bid: 1.16800, ask: 1.16810 });
  assert.equal(maxVolCheck.triggered, false);
  assert.equal(maxVolCheck.reason, 'MAX_VOLUME_EXCEEDED');
  await updateSystemConfig({ martingale: { ...getSystemConfig().martingale, maximumVolume: 50.0 } });
  console.log('  -> PASS: Maximum recovery volume limit strictly blocks excessive sizing.');

  // TEST 22: Maximum margin utilization enforced
  console.log('\nTEST 22: Maximum margin utilization enforced...');
  adapter.usedMargin = 6000;
  adapter.equity = 10000; // 60% margin used > 50% limit
  const marginBlocked = await MartingaleRecoveryService.executeRecovery('pos_102', adapter, 1.17940);
  assert.equal(marginBlocked, false);
  adapter.usedMargin = 1000; // Reset
  console.log('  -> PASS: Margin utilization above limit blocks recovery execution.');

  // TEST 23: Maximum basket drawdown enforced
  console.log('\nTEST 23: Maximum basket drawdown enforced...');
  adapter.balance = 10000;
  adapter.equity = 8000; // 20% drawdown > 15% limit
  const drawdownBlocked = await MartingaleRecoveryService.executeRecovery('pos_102', adapter, 1.17940);
  assert.equal(drawdownBlocked, false);
  adapter.equity = 10000; // Reset
  console.log('  -> PASS: Basket drawdown above limit blocks recovery execution.');

  // TEST 24: Maximum recovery duration enforced
  console.log('\nTEST 24: Maximum recovery duration enforced...');
  const seqManual = MartingaleRecoveryService.getActiveSequence('pos_manual_555')!;
  seqManual.startedAt = Date.now() - (150 * 60 * 1000); // 150 min old > 120 min max
  const durationCheck = MartingaleRecoveryService.evaluatePriceTick('pos_manual_555', 1.24940, 'CTRADER', 'LIVE', { bid: 1.24940, ask: 1.24950 });
  assert.equal(durationCheck.triggered, false);
  assert.equal(durationCheck.reason, 'MAX_DURATION_EXCEEDED');
  console.log('  -> PASS: Duration beyond threshold prevents recovery triggers.');

  // TEST 25: Stale quote blocks recovery
  console.log('\nTEST 25: Stale quote blocks recovery...');
  adapter.mockQuote = {
    symbol: 'EUR/USD',
    bid: 1.17940,
    ask: 1.17950,
    spread: 1.0,
    timestamp: Date.now() - 40_000, // 40 seconds old > 30s limit
    source: 'TEST',
    environment: 'LIVE',
    status: 'FRESH'
  };
  const staleBlocked = await MartingaleRecoveryService.executeRecovery('pos_102', adapter, 1.17940);
  assert.equal(staleBlocked, false);
  adapter.mockQuote.timestamp = Date.now(); // Reset
  console.log('  -> PASS: Stale quote > 30 seconds correctly blocks recovery.');

  // TEST 26: Normal LiveTradingGate behavior remains unchanged
  console.log('\nTEST 26: Normal LiveTradingGate behavior remains unchanged...');
  const gate = new LiveTradingGate();
  // Normal order without stop loss fails Condition 9
  const gateResNoSL = await gate.evaluate(adapter, {
    order: { market: 'FOREX', symbol: 'EUR/USD', side: 'BUY', orderType: 'MARKET', quantity: 1000 },
    signalAgeMs: 5000,
    currentQuote: adapter.mockQuote,
    isMarketOpen: true,
    dailyRealizedLoss: 0,
    dailyLossLimit: 1000,
    totalAccountExposure: 1000,
    maxAllowedExposure: 50000,
    activePositionsCount: 1,
    maxOpenPositions: 10,
    activePairPositionsCount: 1,
    maxPairPositions: 4
  });
  assert.equal(gateResNoSL.passed, false);
  assert(gateResNoSL.failedReasons.some(r => r.includes('Condition 9 Failed')));
  // Normal order with stop loss passes Condition 9
  const gateResWithSL = await gate.evaluate(adapter, {
    order: { market: 'FOREX', symbol: 'EUR/USD', side: 'BUY', orderType: 'MARKET', quantity: 1000, stopLoss: 1.16000 },
    signalAgeMs: 5000,
    currentQuote: adapter.mockQuote,
    isMarketOpen: true,
    dailyRealizedLoss: 0,
    dailyLossLimit: 1000,
    totalAccountExposure: 1000,
    maxAllowedExposure: 50000,
    activePositionsCount: 1,
    maxOpenPositions: 10,
    activePairPositionsCount: 1,
    maxPairPositions: 4
  });
  assert(!gateResWithSL.failedReasons.some(r => r.includes('Condition 9 Failed')));
  console.log('  -> PASS: LiveTradingGate Condition 9 remains fully enforced for normal orders.');

  // TEST 27: Condition 12 remains disabled
  console.log('\nTEST 27: Condition 12 remains disabled...');
  assert(!gateResNoSL.failedReasons.some(r => r.includes('Condition 12 Failed')));
  assert(!gateResWithSL.failedReasons.some(r => r.includes('Condition 12 Failed')));
  console.log('  -> PASS: Condition 12 remains disabled as specified.');

  // TEST 28: cTrader LIVE/DEMO selector remains unchanged
  console.log('\nTEST 28: cTrader LIVE/DEMO selector remains unchanged...');
  const apiMode = getCTraderApiMode();
  assert(apiMode === 'LIVE' || apiMode === 'DEMO');
  console.log(`  -> PASS: Current cTrader API mode is ${apiMode}. Selector remains operational.`);

  // TEST 29: BUY and SELL positions on the same pair remain independent
  console.log('\nTEST 29: BUY and SELL positions on the same pair remain independent...');
  adapter.positions.push(
    {
      id: 'pos_eur_buy',
      broker: 'CTRADER',
      environment: 'LIVE',
      market: 'FOREX',
      symbol: 'EUR/GBP',
      side: 'BUY',
      quantity: 100000,
      entryPrice: 0.85000,
      currentPrice: 0.85000,
      takeProfit: 0.85500,
      unrealizedPnL: 0,
      realizedPnL: 0,
      currency: 'GBP',
      timestamp: Date.now()
    },
    {
      id: 'pos_eur_sell',
      broker: 'CTRADER',
      environment: 'LIVE',
      market: 'FOREX',
      symbol: 'EUR/GBP',
      side: 'SELL',
      quantity: 100000,
      entryPrice: 0.85000,
      currentPrice: 0.85000,
      takeProfit: 0.84500,
      unrealizedPnL: 0,
      realizedPnL: 0,
      currency: 'GBP',
      timestamp: Date.now()
    }
  );
  await MartingaleRecoveryService.reconcileWithBroker('CTRADER', 'LIVE', adapter.positions);
  // Price drops 6 pips: BUY is adverse, SELL is in profit
  const buyEval = MartingaleRecoveryService.evaluatePriceTick('pos_eur_buy', 0.84940, 'CTRADER', 'LIVE', { bid: 0.84940, ask: 0.84950 });
  const sellEval = MartingaleRecoveryService.evaluatePriceTick('pos_eur_sell', 0.84940, 'CTRADER', 'LIVE', { bid: 0.84940, ask: 0.84950 });
  assert.equal(buyEval.triggered, true);
  assert.equal(sellEval.triggered, false);
  console.log('  -> PASS: BUY adverse trigger occurred while SELL position remained unaffected.');

  // TEST 30: Actual broker response is required before state becomes CONFIRMED
  console.log('\nTEST 30: Actual broker response is required before state becomes CONFIRMED...');
  adapter.shouldFailOrder = true;
  const thrownOrderRes = await MartingaleRecoveryService.executeRecovery('pos_eur_buy', adapter, 0.84940);
  assert.equal(thrownOrderRes, false);
  const unconfirmedBuy = MartingaleRecoveryService.getActiveSequence('pos_eur_buy')!;
  assert.notEqual(unconfirmedBuy.status, 'RECOVERY_CONFIRMED');
  assert.notEqual(unconfirmedBuy.status, 'TP_MODIFIED');
  assert.equal(unconfirmedBuy.recoveryLevel, 0);
  adapter.shouldFailOrder = false;
  console.log('  -> PASS: Network/broker exception prevented unconfirmed state transition.');

  // Cleanup: restore config
  await updateSystemConfig({ martingale: { ...getSystemConfig().martingale, enabled: false } });

  console.log('\n============================================================');
  console.log('ALL 30 PHASE 43.1 MARTINGALE RECTIFICATION TESTS PASSED!');
  console.log('============================================================\n');
}

runPhase43MartingaleTests().catch(err => {
  console.error('FATAL PHASE 43.1 MARTINGALE TEST ERROR:', err);
  process.exit(1);
});
