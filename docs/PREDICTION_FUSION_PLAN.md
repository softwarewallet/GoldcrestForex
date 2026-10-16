# Prediction Fusion Architecture

## Objective
Build on the two distinct Forex prediction paths already in GoldcrestForex and the separate Forex signal engine in Goldcrest-FX-Live, without wholesale replacement of working Auto Live execution.

## Source inspection notes
- GoldcrestForex's Auto Live execution path currently calls `ForexSignalEngine.generateSignal(pair)` directly and uses that signal's direction, score, trade plan and timestamp in its authorization/execution path.
- GoldcrestForex's `ScannerService.getForexScanner()` separately calls `ForexSignalEngine` and `CombinedPredictionEngine.predict()`, then normalizes the combined prediction into a scanner row.
- The combined prediction pipeline already incorporates historical analog evidence, calibrated probabilities, relative news intelligence, rolling strategy performance, and a direction-fusion component. It records forensic snapshots.
- GoldcrestForex also has a separate `AdvancedQuantitativePredictiveEngine` with 1H macro trend/liquidity pools, 5M ATR/session-risk analysis and optional Gemini explanation.
- Goldcrest-FX-Live's current `signalEngine.ts` is a smaller variant of the same basic multi-timeframe technical signal engine. Its public class surface matches the larger GoldcrestForex engine; its main structural difference is it does not contain the newer 5M bounce-strategy integration used in GoldcrestForex.
- Several shared-looking files are not identical between repositories. Copying the live repository wholesale would overwrite newer broker-queue, Auto Live data-session, gating, telemetry and execution protections in GoldcrestForex. Prediction code must therefore be fused by explicit interfaces, not by replacing provider/transport/execution files.
- The quantitative direction module includes several heuristic defaults and simulated placeholders (including fixed RSI/ADX/VWAP proxies when not wired to genuine inputs, and a cTrader native-indicator comparison service that explicitly simulates indicator values). Those values must not be treated as live evidence. The fusion layer must mark unavailable evidence unavailable and exclude it from weighted scoring.

## Design requirements
1. Preserve the existing Auto Live signal as the incumbent/champion during initial integration.
2. Run the challengers against the same fresh cTrader quote, the same timestamp-bounded candles, and the same news snapshot: (a) incumbent ForexSignalEngine, (b) CombinedPredictionEngine, (c) AdvancedQuantitativePredictiveEngine deterministic policy, and (d) the direction-fusion model only where it receives genuine input features.
3. Produce one auditable composite record containing per-engine direction, calibrated confidence/probability where defensible, evidence quality, regime, conflicts, spread/cost-adjusted expected value, SL/TP suggestions and veto reasons.
4. No invented confidence: unavailable, simulated, sparse or stale inputs must be explicitly unavailable and never earn positive score.
5. Conflict policy: consensus may raise the quality tier only when evidence is independent enough and current; strong disagreement should return NO_TRADE/SHADOW rather than forcing a direction.
6. Never let AI text output override the deterministic result, relax safety checks, or supply execution authorization. Do not integrate Gemini into a synchronous live order decision path unless bounded timeouts and a deterministic fallback are present; best initial use is explanation/shadow comparison.
7. No data leakage: enforce a single cutoff timestamp for candles, news and history; avoid synthetic padded candles being used as genuine evidence.
8. Champion/challenger evaluation runs in SHADOW mode, writes immutable snapshots and later labels outcomes. A new model must not become the execution champion until walk-forward and time-separated out-of-sample results demonstrate improvement over the incumbent after realistic spread/slippage/commission, with sample-size and calibration metrics disclosed.
9. Do not route shadow/challenger outcomes directly to the broker. Existing AutoExecutionEngine and live safety gates remain authoritative.
10. Do not edit broker adapters, cTrader request queue/transport, order sizing, stop/target execution semantics, environment authorization, risk gates or emergency halt logic as part of prediction fusion.

## Implementation plan
- Add a typed prediction-fusion contract and a pure deterministic combiner that consumes already-produced engine results.
- Wire a first pass into a shadow-only diagnostic path around Auto Live signal generation, with strict bounded calls, clear per-engine errors and no side effects on trade authorization.
- Compare output to the incumbent and log `championDirection`, each challenger result, `consensusDirection`, `conflictRatio`, evidence availability, feature/data timestamps and deterministic no-trade reason.
- Add unit tests for direction agreement/disagreement, missing/unavailable engine results, confidence calibration bounds, stale/future evidence rejection, costs, and strict shadow-only non-execution.
- Run lint, full tests and production builds, then inspect walk-forward and outcome results before proposing any execution-path promotion.
