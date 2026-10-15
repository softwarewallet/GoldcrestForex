# Goldcrest Auto Live Reference Audit

## Repositories compared
- Reference implementation: `softwarewallet/Goldcrest-FX-Live`
- Target implementation: `softwarewallet/GoldcrestForex`

This audit compares source code, not live broker telemetry. The reference app is reported by its operator to perform more reliably; that does not by itself prove every implementation detail is universally superior.

## Findings

### Core Auto Live orchestration is already substantially shared
Both services use:
- a single in-flight cycle guard;
- pre-open preparation separated from order execution;
- bounded worker concurrency for pre-open pair analysis;
- parallel per-pair signal evaluation with account-level execution serialized through an execution queue;
- the same durable execution-intent/idempotency service;
- required live-news and market/risk checks before new entries.

The target also contains additional controls (prediction evaluation, trading-window scheduler, trade continuity, Martingale handling, India-market support, and reconciliation). Replacing the target's complete `autoTradingService.ts` with the reference file would remove those controls and change its trading behavior. The full file was therefore not copied wholesale.

### cTrader transport implementation
The reference client uses direct WebSocket sessions and simple request timeouts. The target has a more developed transport layer: a shared `WebSocketManager`, serialized request queue, connection-scoped rate-limit cooldown/retries, and explicit live/demo routing. The newer target transport was preserved rather than replaced with the older reference implementation.

### Confirmed dashboard/API risk
The target's `GET /api/forex/pairs` endpoint could return an empty/poorly-formed fallback universe if broker instrument discovery returned a non-Forex instrument ordering or broker-specific symbols. It also previously could wait on slow scanning/quote requests. The screenshot showed zero pairs and a blank market table, which is consistent with this class of failure but is not proof of the runtime cause.

## Changes in this branch

1. Bound slow requests used to populate the Control Center; one pending telemetry request no longer holds the whole refresh open.
2. Bound Auto Live start/stop HTTP calls. If a call times out, refresh the authoritative backend status before another operator click, because a browser timeout does not prove the server failed to arm/stop the service.
3. Display Auto Live control errors in the UI instead of only writing them to the browser console.
4. Added server-side timeouts for Forex scanner, instrument discovery, fallback candles, quotes, live news, and Auto Live status continuity synchronization.
5. Changed Forex pairs fallback to the application's supported Forex universe instead of blindly slicing the first eight broker instruments. The fallback may show delayed broker historical prices, but it no longer invents a one-pip ask price or labels historical prices as live.
6. Shortened cache lifetime when the Forex-pairs snapshot has no valid price or only degraded data, so a recovered provider is checked again promptly.
7. Added bounded timeouts to pre-open market refresh and news work, and to broker readiness checks. Timeouts block readiness; they never authorize execution.

## Safety and rollout
- No live-trading gate was bypassed.
- No order-submission retry was added. An order with an unknown outcome must be reconciled before retry, to avoid duplicate live orders.
- The branch must pass TypeScript, production build, automated test, and production-gate workflows before merge.
- After deployment, verify `/api/forex/pairs`, `/api/forex/news`, `/api/brokers/status`, and `/api/auto-trading/status` with credentials kept private. Confirm the data timestamps are fresh and that a timeout becomes a visible error with recovery rather than a permanent spinner.

## Remaining diagnostic uncertainty
Without runtime response bodies and audit logs from the affected instance, we cannot yet conclude whether the production root cause is cTrader connectivity, provider configuration, endpoint authorization, stale instruments, or another backend operation. This branch makes the failure bounded and more observable while addressing the confirmed fallback weakness.
