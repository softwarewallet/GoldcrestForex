import assert from 'node:assert/strict';
import { CTraderRequestQueue } from '../src/brokers/adapters/cTrader/requestQueue';

async function testResponseWaitDoesNotBlockDispatch(): Promise<void> {
  const queue = new CTraderRequestQueue({
    standardIntervalMs: 0,
    historicalIntervalMs: 0
  });
  let releaseFirst!: (value: string) => void;
  let firstSettled = false;
  let secondDispatched = false;

  const first = queue.enqueue(() => new Promise<string>(resolve => {
    releaseFirst = resolve;
  }), 10, 'HISTORICAL').then(value => {
    firstSettled = true;
    return value;
  });
  const second = queue.enqueue(async () => {
    secondDispatched = true;
    return 'second';
  }, 100, 'STANDARD');

  await Promise.race([
    second.then(() => undefined),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('second request was blocked by first response')), 500))
  ]);

  assert.equal(secondDispatched, true);
  assert.equal(firstSettled, false, 'first request should remain unresolved while second is dispatched');
  releaseFirst('first');
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
}

async function testPriorityAndRateClass(): Promise<void> {
  const queue = new CTraderRequestQueue({
    standardIntervalMs: 0,
    historicalIntervalMs: 0
  });
  const order: string[] = [];
  let releaseBlocker!: (value: string) => void;
  const blocker = queue.enqueue(() => new Promise<string>(resolve => { releaseBlocker = resolve; }), 1);
  const lowPriority = queue.enqueue(async () => { order.push('history'); return 'history'; }, 10, 'HISTORICAL');
  const highPriority = queue.enqueue(async () => { order.push('order'); return 'order'; }, 100, 'STANDARD');

  // The blocker begins first; waiting for its response must not block the queue's next choice.
  await Promise.race([
    Promise.all([lowPriority, highPriority]),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('priority requests were response-blocked')), 500))
  ]);
  assert.deepEqual(order, ['order', 'history']);
  releaseBlocker('blocker');
  assert.equal(await blocker, 'blocker');
}

async function main(): Promise<void> {
  await testResponseWaitDoesNotBlockDispatch();
  await testPriorityAndRateClass();
  console.log('PASS: cTrader request dispatch continues independently of response latency and honors priority.');
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
