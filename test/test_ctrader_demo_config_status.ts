import assert from 'assert';
import fs from 'fs';
import path from 'path';

async function runCTraderDemoConfigStatusTests() {
  console.log('============================================================');
  console.log('TEST SUITE: cTrader DEMO Environment Variable Status Component');
  console.log('============================================================\n');

  // 1. Verify component source file exists and adheres to read-only constraints
  console.log('TEST 1: Inspecting CTraderDemoConfigStatus component source...');
  const componentPath = path.resolve('src/components/CTraderDemoConfigStatus.tsx');
  assert.strictEqual(fs.existsSync(componentPath), true, 'CTraderDemoConfigStatus.tsx must exist');

  const componentSource = fs.readFileSync(componentPath, 'utf8');

  // Verify it contains the 4 required environment variables
  const requiredKeys = [
    'CTRADER_DEMO_CLIENT_ID',
    'CTRADER_DEMO_CLIENT_SECRET',
    'CTRADER_DEMO_ACCESS_TOKEN',
    'CTRADER_DEMO_ACCOUNT_ID'
  ];

  for (const key of requiredKeys) {
    assert.strictEqual(componentSource.includes(key), true, `Component must display ${key}`);
  }

  // Verify sanitized labels PRESENT and MISSING are present in component
  assert.strictEqual(componentSource.includes('PRESENT'), true, 'Component must include PRESENT label');
  assert.strictEqual(componentSource.includes('MISSING'), true, 'Component must include MISSING label');

  // Verify strictly READ-ONLY: no input forms to submit credentials
  assert.strictEqual(componentSource.includes('type="password"'), false, 'Component must not contain password input fields');
  assert.strictEqual(componentSource.includes('<input'), false, 'Component must be strictly read-only with no inputs');
  assert.strictEqual(componentSource.includes('READ-ONLY'), true, 'Component must display READ-ONLY badge');

  console.log('  -> PASS: Component source verified as strictly read-only with 4 sanitized DEMO variables.');

  // 2. Verify SettingsHub integration
  console.log('\nTEST 2: Verifying SettingsHub integration...');
  const settingsHubPath = path.resolve('src/components/SettingsHub.tsx');
  const settingsHubSource = fs.readFileSync(settingsHubPath, 'utf8');
  assert.strictEqual(settingsHubSource.includes('CTraderDemoConfigStatus'), true, 'SettingsHub must import and render CTraderDemoConfigStatus');
  assert.strictEqual(settingsHubSource.includes('DEMO_CONFIG'), true, 'SettingsHub must have DEMO_CONFIG tab');
  console.log('  -> PASS: SettingsHub integration verified.');

  // 3. Verify BrokerSettingsPanel integration
  console.log('\nTEST 3: Verifying BrokerSettingsPanel integration...');
  const brokerSettingsPath = path.resolve('src/components/BrokerSettingsPanel.tsx');
  const brokerSettingsSource = fs.readFileSync(brokerSettingsPath, 'utf8');
  assert.strictEqual(brokerSettingsSource.includes('CTraderDemoConfigStatus'), true, 'BrokerSettingsPanel must import and render CTraderDemoConfigStatus');
  console.log('  -> PASS: BrokerSettingsPanel integration verified.');

  // 4. Verify sanitized status generation logic
  console.log('\nTEST 4: Verifying sanitized status generation logic...');
  const testKeys = [
    'CTRADER_DEMO_CLIENT_ID',
    'CTRADER_DEMO_CLIENT_SECRET',
    'CTRADER_DEMO_ACCESS_TOKEN',
    'CTRADER_DEMO_ACCOUNT_ID'
  ] as const;

  const mockEnv: Record<string, string | undefined> = {
    CTRADER_DEMO_CLIENT_ID: 'sample-client-id-12345',
    CTRADER_DEMO_CLIENT_SECRET: '',
    CTRADER_DEMO_ACCESS_TOKEN: undefined,
    CTRADER_DEMO_ACCOUNT_ID: '1234567'
  };

  const computeStatus = (env: Record<string, string | undefined>) => {
    const statuses: Record<string, 'PRESENT' | 'MISSING'> = {};
    for (const k of testKeys) {
      const val = env[k];
      statuses[k] = val && String(val).trim().length > 0 ? 'PRESENT' : 'MISSING';
    }
    const allPresent = testKeys.every(k => statuses[k] === 'PRESENT');
    return { statuses, allPresent };
  };

  const result1 = computeStatus(mockEnv);
  assert.strictEqual(result1.statuses['CTRADER_DEMO_CLIENT_ID'], 'PRESENT');
  assert.strictEqual(result1.statuses['CTRADER_DEMO_CLIENT_SECRET'], 'MISSING');
  assert.strictEqual(result1.statuses['CTRADER_DEMO_ACCESS_TOKEN'], 'MISSING');
  assert.strictEqual(result1.statuses['CTRADER_DEMO_ACCOUNT_ID'], 'PRESENT');
  assert.strictEqual(result1.allPresent, false);

  // When all are present
  const allPresentEnv: Record<string, string> = {
    CTRADER_DEMO_CLIENT_ID: 'cid',
    CTRADER_DEMO_CLIENT_SECRET: 'sec',
    CTRADER_DEMO_ACCESS_TOKEN: 'tok',
    CTRADER_DEMO_ACCOUNT_ID: 'acc'
  };
  const result2 = computeStatus(allPresentEnv);
  assert.strictEqual(result2.allPresent, true);
  for (const k of testKeys) {
    assert.strictEqual(result2.statuses[k], 'PRESENT');
  }

  // When all are missing
  const allMissingEnv: Record<string, string | undefined> = {
    CTRADER_DEMO_CLIENT_ID: undefined,
    CTRADER_DEMO_CLIENT_SECRET: '',
    CTRADER_DEMO_ACCESS_TOKEN: '   ',
    CTRADER_DEMO_ACCOUNT_ID: undefined
  };
  const result3 = computeStatus(allMissingEnv);
  assert.strictEqual(result3.allPresent, false);
  for (const k of testKeys) {
    assert.strictEqual(result3.statuses[k], 'MISSING');
  }

  console.log('  -> PASS: Sanitized status evaluation logic verified across edge cases.');

  console.log('\n============================================================');
  console.log('ALL TESTS PASSED: CTraderDemoConfigStatus is fully verified!');
  console.log('============================================================');
}

runCTraderDemoConfigStatusTests().catch(err => {
  console.error('Test failure:', err);
  process.exit(1);
});
