import assert from 'assert';
import { executeQuery, getDatabase } from '../src/database/db';
import { getCTraderApiMode, getSystemConfig, updateSystemConfig } from '../src/services/configService';
import { getCTraderRequestHosts } from '../src/brokers/adapters/cTrader/cTraderApiClient';
import { brokerRegistry } from '../src/brokers/registry';
import { CTraderLiveAdapter } from '../src/brokers/adapters/cTrader/CTraderLiveAdapter';
import { LIVE_AUTO_EXECUTION_ALLOWED } from '../src/brokers/safety/AutoExecutionEngine';
import { killSwitch } from '../src/brokers/safety/KillSwitch';
import { LiveTradingGate } from '../src/brokers/safety/LiveTradingGate';

async function runPhase58TestSuite() {
  console.log('============================================================');
  console.log('PHASE 58: SECURE CTRADER DEMO CONFIGURATION & CONNECTIVITY AUDIT');
  console.log('============================================================\n');

  await getDatabase();

  // --------------------------------------------------------------------------
  // TEST 1: Sanitized Credential Presence Verification
  // --------------------------------------------------------------------------
  console.log('TEST 1: Inspecting cTrader DEMO Credential Presence (Sanitized)...');
  const requiredDemoKeys = [
    'CTRADER_DEMO_CLIENT_ID',
    'CTRADER_DEMO_CLIENT_SECRET',
    'CTRADER_DEMO_ACCESS_TOKEN',
    'CTRADER_DEMO_ACCOUNT_ID'
  ];

  const sanitizedStatuses: Record<string, string> = {};
  for (const k of requiredDemoKeys) {
    const val = process.env[k];
    const status = val && String(val).trim().length > 0 ? 'PRESENT' : 'MISSING';
    sanitizedStatuses[k] = status;
    console.log(`  -> ${k}: ${status}`);
  }

  const allPresent = requiredDemoKeys.every(k => sanitizedStatuses[k] === 'PRESENT');
  console.log(`  -> Overall DEMO Credential Configuration State: ${allPresent ? 'ALL_PRESENT' : 'CREDENTIALS_MISSING'}`);

  // --------------------------------------------------------------------------
  // TEST 2: Active Transport Endpoint & Environment Isolation
  // --------------------------------------------------------------------------
  console.log('\nTEST 2: Verifying Transport Isolation & DEMO Endpoint Selection...');
  assert.strictEqual(getCTraderApiMode(), 'DEMO', 'DEMO mode must be selected by default');
  const demoHosts = getCTraderRequestHosts(false);
  assert.strictEqual(demoHosts.length, 1, 'Exactly one DEMO host must be resolved');
  assert.strictEqual(demoHosts[0], 'wss://demo.ctraderapi.com:5036', 'DEMO host must route to demo.ctraderapi.com:5036');

  // Verify LIVE host is completely separate
  updateSystemConfig({ cTraderApiMode: 'LIVE' });
  const liveHosts = getCTraderRequestHosts(true);
  assert.strictEqual(liveHosts[0], 'wss://live.ctraderapi.com:5036', 'LIVE host must route to live.ctraderapi.com:5036');
  assert.notStrictEqual(demoHosts[0], liveHosts[0], 'DEMO and LIVE hosts must be strictly isolated');
  updateSystemConfig({ cTraderApiMode: 'DEMO' });
  assert.strictEqual(getCTraderApiMode(), 'DEMO', 'Mode must be restored to DEMO');
  console.log('  -> PASS: Transport isolation verified. DEMO routes to demo.ctraderapi.com:5036.');

  // --------------------------------------------------------------------------
  // TEST 3: Dynamic DEMO Credential Loader in Adapter
  // --------------------------------------------------------------------------
  console.log('\nTEST 3: Verifying Dynamic DEMO Credential Loading & Sanitized Masking...');
  const testAdapter = new CTraderLiveAdapter();
  testAdapter.syncConfig();
  const initialStatus = testAdapter.getConfigStatus();
  assert.strictEqual(initialStatus.environment, 'DEMO', 'Adapter must report active environment as DEMO');

  // Test masked credential update without exposing secret values
  testAdapter.updateCredentials({
    clientId: 'sample_demo_client_9876',
    clientSecret: 'secret_demo_value_xyz',
    accessToken: 'token_demo_sample_abc',
    accountId: '12345678'
  });
  const updatedStatus = testAdapter.getConfigStatus();
  assert.strictEqual(updatedStatus.configured, true, 'Adapter must indicate configured=true');
  assert.strictEqual(updatedStatus.environment, 'DEMO');
  assert.strictEqual(updatedStatus.maskedAccountId, '****5678', 'Account ID must be properly masked');
  assert.strictEqual(updatedStatus.maskedClientId, '****9876', 'Client ID must be properly masked');
  assert.strictEqual(updatedStatus.maskedClientSecret, '•••••••• (Saved)', 'Secret must never be exposed');
  assert.strictEqual(updatedStatus.maskedAccessToken, '•••••••• (Saved)', 'Token must never be exposed');

  // Clear credentials
  testAdapter.clearCredentials();
  const clearedStatus = testAdapter.getConfigStatus();
  assert.strictEqual(clearedStatus.configured, false, 'Cleared adapter must indicate configured=false');
  console.log('  -> PASS: Dynamic credential loading, secret redaction, and masked status verified.');

  // --------------------------------------------------------------------------
  // TEST 4: Missing Credentials Error Handling
  // --------------------------------------------------------------------------
  console.log('\nTEST 4: Verifying Graceful Error Handling on Missing Credentials...');
  try {
    const unconfiguredAdapter = new CTraderLiveAdapter();
    unconfiguredAdapter.clearCredentials();
    await unconfiguredAdapter.getAccount();
    assert.fail('Unconfigured adapter must throw AUTHENTICATION_FAILED');
  } catch (err: any) {
    assert.strictEqual(err.code, 'AUTHENTICATION_FAILED', 'Expected AUTHENTICATION_FAILED code');
    assert(err.message.includes('credentials missing'), 'Error message must specify credentials missing');
    console.log('  -> PASS: Missing credentials throw clean AUTHENTICATION_FAILED without crashing.');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Readiness Gate & LIVE Lock Verification
  // --------------------------------------------------------------------------
  console.log('\nTEST 5: Verifying Readiness Gates & LIVE Execution Lock...');
  assert.strictEqual(LIVE_AUTO_EXECUTION_ALLOWED, false, 'LIVE_AUTO_EXECUTION_ALLOWED must remain false');
  assert.strictEqual(getSystemConfig().liveTradingEnabled, false, 'liveTradingEnabled must remain false');
  assert.strictEqual(killSwitch.isHalted(), false, 'KillSwitch must be armed and not halted');

  // Verify LiveTradingGate Condition 9 (mandatory Stop-Loss)
  const gate = new LiveTradingGate();
  (testAdapter as any).getInstrument = async (symbol: string) => ({
    symbol,
    market: 'FOREX',
    pipSize: 0.0001,
    minQuantity: 1000,
    maxQuantity: 10000000,
    stepQuantity: 1000,
    digits: 5,
    supportedOrderTypes: ['MARKET', 'LIMIT', 'STOP']
  });
  (testAdapter as any).getAccount = async () => ({
    accountId: 'demo_acc_123',
    balance: 10000,
    equity: 10000,
    currency: 'USD',
    permissions: ['TRADE', 'TRADING']
  });
  const gateEvaluationNoSL = await gate.evaluate(testAdapter, {
    order: { market: 'FOREX', symbol: 'EUR/USD', side: 'BUY', orderType: 'MARKET', quantity: 1000 },
    signalAgeMs: 2000,
    currentQuote: { symbol: 'EUR/USD', bid: 1.0850, ask: 1.0851, spread: 1.0, timestamp: Date.now(), source: 'DEMO', environment: 'DEMO', status: 'FRESH' },
    isMarketOpen: true,
    dailyRealizedLoss: 0,
    dailyLossLimit: 500,
    totalAccountExposure: 1000,
    maxAllowedExposure: 50000,
    activePositionsCount: 0,
    maxOpenPositions: 5,
    activePairPositionsCount: 0,
    maxPairPositions: 2
  });
  assert.strictEqual(gateEvaluationNoSL.passed, false, 'Order without SL must fail Condition 9');
  assert(gateEvaluationNoSL.failedReasons.some(r => r.includes('Condition 9 Failed')), 'Condition 9 Failed reason expected');
  console.log('  -> PASS: Readiness gates and mandatory Stop-Loss enforcement remain 100% active.');

  // --------------------------------------------------------------------------
  // TEST 6: SQLite Persistence Clean Ledger Verification
  // --------------------------------------------------------------------------
  console.log('\nTEST 6: Verifying SQLite Persistence Clean State (No Fabricated Trades)...');
  const tradeRows = await executeQuery<any>('SELECT count(*) as cnt FROM trades');
  assert.strictEqual(Number(tradeRows[0].cnt), 0, 'trades table must have 0 rows (zero fabricated trades)');
  const posRows = await executeQuery<any>('SELECT count(*) as cnt FROM positions');
  assert.strictEqual(Number(posRows[0].cnt), 0, 'positions table must have 0 rows');
  console.log('  -> PASS: Clean ledger verified. Database contains zero fabricated or mock trades.');

  console.log('\n============================================================');
  console.log('ALL PHASE 58 AUDIT & READINESS TESTS PASSED SUCCESSFULLY!');
  console.log(' - Sanitized credential inspection certified');
  console.log(' - DEMO endpoint isolation certified');
  console.log(' - Invariant LIVE_AUTO_EXECUTION_ALLOWED === false certified');
  console.log(' - Zero synthetic trades certified');
  console.log('============================================================\n');
}

runPhase58TestSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Phase 58 Test Suite Failure:', err);
  process.exit(1);
});
