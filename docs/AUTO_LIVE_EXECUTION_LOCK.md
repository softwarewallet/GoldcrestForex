# Auto Live and Trade Execution — Locked Change Surface

**Status: LOCKED until the operator explicitly requests a change.**

The operator has confirmed that Auto Live and trade execution are working correctly. Treat the current behavior on `main` as the approved baseline.

## Required behavior for future work

- Do not refactor, optimize, clean up, reformat, or otherwise modify the protected execution paths as part of unrelated work.
- Inspection, diagnosis, and read-only analysis are allowed.
- Do not modify protected runtime files or their regression tests unless the operator explicitly asks for that change.
- An explicit request to change a protected path authorizes only the requested scope, not unrelated refactoring.
- Keep all existing broker, environment, risk, position, kill-switch, and live-order safety checks intact unless the operator specifically requests a change to one of them.
- Any authorized change must include focused regression tests and pass the repository's normal CI and production gates before merge.
- Do not claim that a trade was executed solely because CI passed; broker-side execution must be independently confirmed.

## Protected runtime surface

- Auto Live orchestration and market-data lifecycle:
  - `src/services/autoTradingService.ts`
  - `src/services/autoLiveMarketDataSession.ts`
  - `src/markets/forex/provider.ts`
  - `src/markets/forex/signalEngine.ts`
- Execution authorization, order validation, sizing, and risk:
  - `src/brokers/safety/AutoExecutionEngine.ts`
  - `src/brokers/safety/AutoTradeReadiness.ts`
  - `src/brokers/safety/LiveTradingGate.ts`
  - `src/brokers/safety/TradeValidator.ts`
  - `src/brokers/safety/TradeSizing.ts`
  - `src/brokers/safety/KillSwitch.ts`
- Broker transport, order submission, and queue:
  - `src/brokers/adapters/cTrader/CTraderBrokerAdapter.ts`
  - `src/brokers/adapters/cTrader/CTraderLiveAdapter.ts`
  - `src/brokers/adapters/cTrader/cTraderApiClient.ts`
  - `src/brokers/adapters/cTrader/requestQueue.ts`
- Trading continuity, reconciliation, and startup gates:
  - `src/services/tradeContinuityService.ts`
  - `src/services/reconciliationService.ts`
  - `src/services/executionReconciliationService.ts`
  - `server.ts`
- Regression tests that protect this behavior:
  - `test/test_auto_trading_orchestrator.ts`
  - `test/test_auto_trade_readiness.ts`
  - `test/test_live_only_audit.ts`
  - `test/test_local_auto_live_arm.ts`
  - `test/test_ctrader_request_queue.ts`
  - `test/test_ctrader_batched_spot_quotes.ts`
  - `test/test_auto_live_market_data_gate.ts`

## Repository enforcement

The `Protect Auto Live and Trade Execution` GitHub Actions workflow fails pull requests that change any protected path unless the PR has the `operator-approved-auto-live-change` label. Apply that label only after the operator has explicitly requested the protected-path change. The CODEOWNERS file assigns these paths to `@softwarewallet` for review routing.

This CI guard helps prevent accidental changes. For a strict GitHub-side lock, configure the `main` branch rules to require the protection workflow and CODEOWNERS review; repository rules are not changed by this document alone.
