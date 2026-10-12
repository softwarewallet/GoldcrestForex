
import { webSocketManager, ConnectionKey } from '../src/services/webSocketManager';
import WebSocket from 'ws';

async function testSingleFlight() {
  const key: ConnectionKey = { broker: 'cTrader', isLive: false, endpoint: 'wss://demo.ctraderapi.com:5036', accountId: 123 };
  let calls = 0;
  
  const connectFn = async () => {
    calls++;
    await new Promise(r => setTimeout(r, 100)); // Simulate delay
    return { 
      readyState: WebSocket.OPEN, 
      close: () => {}, 
      on: () => {} 
    } as any; 
  };

  const results = await Promise.all([
    webSocketManager.getConnection(key, connectFn),
    webSocketManager.getConnection(key, connectFn),
    webSocketManager.getConnection(key, connectFn)
  ]);

  if (calls !== 1) throw new Error(`Expected 1 call, got ${calls}`);
  if (results.length !== 3) throw new Error('Expected 3 results');
  console.log('Single-flight test passed');
}

async function runTests() {
  try {
    await testSingleFlight();
    console.log('All tests passed');
  } catch (e) {
    console.error('Test failed', e);
    process.exit(1);
  }
}

runTests();
