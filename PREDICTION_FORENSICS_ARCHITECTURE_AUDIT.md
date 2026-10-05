# GOLDCREST FOREX — PREDICTION FORENSICS & ACCURACY INTELLIGENCE SYSTEM
## ARCHITECTURE & AUDIT REPORT (PHASE 1)

**Date:** October 5, 2026  
**System:** Goldcrest Forex Quantitative Architecture  
**Scope:** Forensic Auditing, Prediction Snapshots, Outcome Intelligence, Calibration & Diagnostics  

---

### 1. Current Prediction Flow & Components
1. **Signal & Candle Ingestion:**
   - Quotes and multi-timeframe candles (5M, 15M, 1H, 4H, Daily) are fetched by `LiveForexSignalProvider` / `LiveForexProvider` from the broker adapter.
   - Indicator feature arrays (RSI, ATR, EMAs, MACD, Support/Resistance levels) are generated in real-time.
2. **Multi-Factor Probabilistic Prediction (`CombinedPredictionEngine`):**
   - Ingests pair symbols, current quote, technical indicators, and currency-relative news articles.
   - Evaluates historical analogues via $k$-NN clustering on normalized feature distance ($N \ge 25$).
   - Computes base/quote sentiment differentials, news freshness decay, and macro event risk.
   - Applies Platt-calibrated confidence and friction-adjusted Net Expected Value:
     $$EV = P(\text{TP\_FIRST}) \times \text{RewardPips} - P(\text{SL\_FIRST}) \times \text{RiskPips} - \text{FrictionPips}$$
   - Generates recommendation (`TRADE_BUY`, `TRADE_SELL`, `NO_TRADE`, `INSUFFICIENT_DATA`).
3. **Execution & Auto Live Gate (`AutoTradingService`):**
   - Filters candidate signals by spread threshold, session status, risk limits, and max open positions.
   - Constructs explicit trade plans with dynamic Lot Sizing based on ATR Stop Loss.
   - Dispatches orders via broker execution protocols with trailing stop-loss configurations.

---

### 2. Audit of Prediction & Outcome Fields

#### Existing Captured Fields:
- `prediction_id`: Unique identifier (UUID).
- `timestamp`: Epoch millisecond at prediction generation.
- `pair`, `horizon`, `direction`, `regime`.
- `probability_up`, `probability_down`, `confidence`.
- `sample_size`, `expected_return`, `expected_risk`, `recommendation`.
- `target_price`, `actual_price`, `actual_outcome`, `actual_return`, `win_loss`, `prediction_error`.

#### Gaps & Lost Information (To Be Fixed in Phase 2):
1. **Immutable Feature Snapshots:** Granular numerical inputs (exact RSI-14, ATR pips, MACD histogram, EMA-9/21/50/200 distances, ADX/DI, VWAP spread, quote age, spread at prediction time) were stored only as high-level summary JSON strings.
2. **Outcome Granularity:** Resolution previously labeled only coarse binary `WIN`/`LOSS`/`BREAKEVEN`. It lacked multi-state outcome tracking: `TP_FIRST`, `SL_FIRST`, `TIME_EXIT`, `NO_ENTRY`, `INVALIDATED`, `PARTIAL_TARGET`.
3. **Excursion Metrics:** Maximum Adverse Excursion (MAE) and Maximum Favorable Excursion (MFE) during trade holding duration were not systematically stored.
4. **Failure Attribution:** When predictions or trades failed, root-cause attribution (`DIRECTION_FAILURE`, `ENTRY_TIMING_FAILURE`, `REGIME_FAILURE`, `NEWS_FAILURE`, `MTF_CONFLICT_FAILURE`, `VOLATILITY_FAILURE`, etc.) was not systematically recorded.
5. **Model Versioning:** `modelId`, `modelVersion`, `featureVersion`, `regimeVersion`, and `newsEngineVersion` need explicit columns to prevent version mixing.

---

### 3. Forensic Snapshot & Evaluation Architecture

```
                                  [ PREDICTION TIME T ]
                                            │
                       ┌────────────────────┴────────────────────┐
                       ▼                                         ▼
            prediction_snapshots                   prediction_feature_snapshots
            - Immutable Prediction ID              - Exact Numerical Technical Inputs
            - Model & Version Specs                - Currency Sentiment Metrics
            - Probabilities & Calibrated EV        - Multi-Timeframe Alignment
            - Planned Entry, SL, TP, RR            - Market Microstructure Snapshot
                       │
                       ▼
            [ FORWARD MARKET EVOLUTION (T_label > T) ]
                       │
                       ▼
            prediction_outcomes
            - Forward Price Path Trajectory
            - TP_FIRST / SL_FIRST / TIME_EXIT / NO_ENTRY
            - Realized R vs Expected R
            - Max Adverse Excursion (MAE) / Max Favorable Excursion (MFE)
            - Holding Duration (Minutes)
                       │
                       ▼
            prediction_forensics
            - Failure Attribution Classification (e.g. ENTRY_TIMING_FAILURE)
            - Evidence Synthesis & Root Cause Audit
            - Calibration Bucket Evaluation
```

---

### 4. Database Schema Expansion Plan
We will introduce 5 dedicated, indexed SQLite tables alongside the existing `predictions` ledger:
1. `prediction_snapshots`: Immutable representation of every prediction generated.
2. `prediction_feature_snapshots`: Complete numerical matrix of technical, fundamental, and microstructure features.
3. `prediction_outcomes`: Forward outcome evaluation, excursion measurements (MAE/MFE), and realized R multiples.
4. `prediction_forensics`: Comprehensive failure classification and evidence audit log.
5. `prediction_daily_metrics`: Pre-aggregated daily calibration, accuracy, and expectancy rollups for fast reporting.

---

### 5. Services & Components to Modify / Add

| Module | Action | Description |
| :--- | :--- | :--- |
| `src/database/db.ts` | **Extend** | Add tables for snapshots, feature snapshots, outcomes, forensics, and daily metrics with proper indexing. |
| `src/ml/forensics/types.ts` | **Create** | Define full TypeScript interfaces for snapshots, outcomes, failure classifications, and forensics. |
| `src/ml/forensics/predictionSnapshotService.ts` | **Create** | Immutable snapshot writer capturing exact numerical states at prediction time. |
| `src/ml/forensics/outcomeEvaluator.ts` | **Create** | Path evaluator calculating `TP_FIRST`, `SL_FIRST`, `TIME_EXIT`, `MAE`, `MFE`, and realized R. |
| `src/ml/forensics/failureClassifier.ts` | **Create** | Evidence-based failure classifier (14 diagnostic classes with fallback to `UNKNOWN_FAILURE`). |
| `src/ml/forensics/forensicsAnalyticsService.ts` | **Create** | Aggregations by pair, regime, session, news, confidence calibration, feature drift, and rolling windows. |
| `src/ml/forensics/forensicsReportGenerator.ts` | **Create** | Generates daily Markdown and JSON reports (`prediction_forensics_YYYY-MM-DD.md/.json`). |
| `server.ts` | **Extend** | Add REST API endpoints for forensic grids, reports, exports (CSV, JSON, Markdown), and calibration curves. |
| `src/components/PredictionForensicsPage.tsx` | **Create** | Comprehensive interactive Forensics & Accuracy Intelligence dashboard with drawers, filters, and charts. |
| `src/components/GlobalAppShell.tsx` | **Extend** | Integrate navigation to Reports → Prediction Forensics & Accuracy. |
| `test/test_prediction_forensics_system.ts` | **Create** | Comprehensive test suite covering all 25 validation criteria. |

---

### 6. Data Integrity & Safety Invariants
1. **Strict Immutability:** Historical prediction inputs cannot be modified after insertion.
2. **Temporal Isolation:** Outcome evaluator only runs retrospectively on completed horizons ($T_{\text{eval}} > T_{\text{prediction}}$) and never leaks forward price information into prediction features.
3. **No Indian Market Data:** Confined strictly to supported Forex currency pairs.
4. **Trading Safety Gate:** Forensic evaluation runs asynchronously in the background and NEVER alters live risk gates, cTrader orders, or broker safety rules.
