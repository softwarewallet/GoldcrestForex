# GOLDCREST FOREX — PREDICTION FORENSICS DATABASE SCHEMA
**Date:** October 5, 2026  
**Database:** SQLite (`trading_analyst.sqlite`)  
**Version:** 3.0.0 (Forensics & Accuracy Intelligence)  

---

## 1. Schema Architecture Overview

The Prediction Forensics system utilizes 5 dedicated, high-performance indexed tables to achieve complete immutability of historical prediction snapshots, multi-timeframe feature capture, path-based forward outcome evaluation, root-cause failure diagnosis, and daily calibration aggregations.

```
┌───────────────────────────┐         ┌─────────────────────────────────┐
│   prediction_snapshots    │ 1 ─── 1 │  prediction_feature_snapshots   │
│   (Immutable State at T)  │         │  (Exact Numerical Features)     │
└─────────────┬─────────────┘         └─────────────────────────────────┘
              │ 1
              │
              │ 1
┌─────────────▼─────────────┐         ┌─────────────────────────────────┐
│    prediction_outcomes    │ 1 ─── 1 │      prediction_forensics       │
│    (T_label > T Eval)     │         │      (Root Cause Diagnosis)     │
└───────────────────────────┘         └─────────────────────────────────┘
```

---

## 2. Table Definitions & DDL

### A. `prediction_snapshots`
Stores the immutable snapshot representing exactly what the system knew at prediction time $T$.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `prediction_id` | TEXT | PRIMARY KEY | Unique UUID for the prediction |
| `timestamp` | INTEGER | NOT NULL | Epoch millisecond at prediction generation |
| `pair` | TEXT | NOT NULL | Currency pair symbol (e.g., `EUR/USD`) |
| `timeframe` | TEXT | NOT NULL | Chart timeframe (e.g., `15M`) |
| `horizon` | TEXT | NOT NULL | Prediction horizon (e.g., `15M`, `1H`) |
| `model_id` | TEXT | NOT NULL | Model identifier |
| `model_version` | TEXT | NOT NULL | Semantic version string (`3.0.0`) |
| `feature_version` | TEXT | NOT NULL | Feature definition version (`3.0.0`) |
| `regime_version` | TEXT | NOT NULL | Regime classifier version (`2.1.0`) |
| `news_engine_version`| TEXT | NOT NULL | News intelligence version (`2.0.0`) |
| `predicted_direction`| TEXT | NOT NULL | `BUY`, `SELL`, `FLAT` |
| `prediction_class` | TEXT | NOT NULL | `STRONG_BUY`, `STRONG_SELL`, `NO_TRADE` |
| `prob_target_first` | REAL | NOT NULL | $P(\text{TP\_FIRST})$ |
| `prob_stop_first` | REAL | NOT NULL | $P(\text{SL\_FIRST})$ |
| `prob_time_exit` | REAL | NOT NULL | $P(\text{TIME\_EXIT})$ |
| `expected_r` | REAL | NOT NULL | Net friction-adjusted expected R multiple |
| `confidence_tier` | TEXT | NOT NULL | `LOW`, `MEDIUM`, `HIGH`, `VERY_HIGH` |
| `confidence_score` | REAL | NOT NULL | Platt-calibrated win probability (0.0 to 1.0) |
| `prediction_horizon_candles` | INTEGER | NOT NULL | Number of candles in evaluation window |
| `predicted_entry` | REAL | NOT NULL | Modeled entry price |
| `predicted_stop_loss` | REAL | NOT NULL | Modeled stop loss price |
| `predicted_take_profit` | REAL | NOT NULL | Modeled take profit price |
| `predicted_risk_reward` | REAL | NOT NULL | Planned Reward:Risk ratio |
| `predicted_position_size` | REAL | NOT NULL | Recommended lot sizing |
| `spread_at_prediction` | REAL | NOT NULL | Live broker spread in pips at prediction time |
| `bid` / `ask` / `mid_price` | REAL | NOT NULL | Market quotes at prediction time |
| `atr` / `atr_pips` | REAL | NOT NULL | 14-period Average True Range |
| `volatility` | REAL | NOT NULL | Microstructure volatility index |
| `market_regime` | TEXT | NOT NULL | `TREND_UP`, `RANGE`, `TRANSITION`, etc. |
| `trend_strength` | REAL | NOT NULL | ADX/RSI trend magnitude |
| `market_structure` | TEXT | NOT NULL | `bullish`, `bearish`, `neutral` |
| `session` | TEXT | NOT NULL | `LONDON`, `NEW_YORK`, `TOKYO`, `OVERLAP_LONDON_NY` |
| `final_decision` | TEXT | NOT NULL | `TRADE_BUY`, `TRADE_SELL`, `NO_TRADE` |
| `news_risk` | TEXT | NOT NULL | `LOW`, `MEDIUM`, `HIGH`, `EXTREME` |
| `high_impact_news` | INTEGER | NOT NULL | Boolean flag (1 = Active) |
| `news_sentiment` | REAL | NOT NULL | Relative currency pair sentiment (-1 to +1) |
| `news_shock_state` | INTEGER | NOT NULL | Boolean flag (1 = Shock detected) |
| `quote_age_ms` | INTEGER | NOT NULL | Age of quote in milliseconds |
| `created_at` | INTEGER | NOT NULL | Snapshot insertion timestamp |

**Indexes:**
- `idx_psnap_pair_ts` ON `(pair, timestamp)`
- `idx_psnap_model_ver` ON `(model_version)`
- `idx_psnap_regime` ON `(market_regime)`
- `idx_psnap_session` ON `(session)`
- `idx_psnap_decision` ON `(final_decision)`

---

### B. `prediction_feature_snapshots`
Stores exact numerical features used by the engine without referencing mutable external data.

| Column | Type | Description |
| :--- | :--- | :--- |
| `prediction_id` | TEXT PRIMARY KEY | Foreign key to `prediction_snapshots` |
| `rsi` | REAL | Exact 14-period Relative Strength Index |
| `macd` / `macd_signal` / `macd_histogram` | REAL | MACD momentum triple |
| `ema9` / `ema21` / `ema50` / `ema200` | REAL | Moving average price coordinates |
| `adx` / `di_plus` / `di_minus` | REAL | Directional movement index components |
| `bollinger_upper` / `lower` / `width` | REAL | 20,2 Bollinger Bands structure |
| `stochastic_k` / `stochastic_d` | REAL | Fast & slow stochastics |
| `roc` | REAL | Rate of Change momentum |
| `vwap_distance` | REAL | Normalized distance to volume weighted average |
| `mtf_alignment` | TEXT | `BULLISH`, `BEARISH`, `CONFLICTING`, `NEUTRAL` |
| `mtf_conflict_score` | REAL | Disagreement penalty score (0.0 to 1.0) |

---

### C. `prediction_outcomes`
Stores forward path evaluation and excursion measurements.

| Column | Type | Description |
| :--- | :--- | :--- |
| `prediction_id` | TEXT PRIMARY KEY | Foreign key to `prediction_snapshots` |
| `evaluated_at` | INTEGER NOT NULL | Epoch millisecond of resolution |
| `actual_outcome` | TEXT NOT NULL | `TP_FIRST`, `SL_FIRST`, `TIME_EXIT`, `NO_ENTRY` |
| `trade_classification` | TEXT NOT NULL | `CORRECT_PREDICTION_WIN`, `CORRECT_PREDICTION_LOSS`, `WRONG_PREDICTION_WIN`, `WRONG_PREDICTION_LOSS` |
| `is_direction_correct` | INTEGER NOT NULL | Boolean flag (1 = Correct direction) |
| `is_trade_won` | INTEGER NOT NULL | Boolean flag (1 = Profit realized) |
| `entry_price_actual` | REAL | Initial price baseline |
| `exit_price_actual` | REAL | Final price at resolution |
| `actual_realized_r` | REAL NOT NULL | Realized R multiple (e.g., `+2.0 R`, `-1.0 R`) |
| `holding_duration_minutes` | REAL NOT NULL | Time trade held before exit |
| `mae_pips` / `mae_r` | REAL NOT NULL | Maximum Adverse Excursion |
| `mfe_pips` / `mfe_r` | REAL NOT NULL | Maximum Favorable Excursion |
| `closed_by` | TEXT NOT NULL | `TARGET_HIT`, `STOP_HIT`, `TIME_EXPIRY` |

---

### D. `prediction_forensics`
Stores evidence-based diagnostic attribution and calibration scoring.

| Column | Type | Description |
| :--- | :--- | :--- |
| `prediction_id` | TEXT PRIMARY KEY | Foreign key to `prediction_snapshots` |
| `primary_failure_reason` | TEXT NOT NULL | `DIRECTION_FAILURE`, `ENTRY_TIMING_FAILURE`, `REGIME_FAILURE`, `NEWS_FAILURE`, `MTF_CONFLICT_FAILURE`, etc. |
| `secondary_factors` | TEXT NOT NULL | JSON array of contributing secondary conditions |
| `evidence_summary` | TEXT NOT NULL | JSON array of natural language audit evidence |
| `confidence_bucket` | TEXT NOT NULL | `50-60%`, `60-70%`, `70-80%`, `80-90%`, `90-100%` |
| `is_overconfident` | INTEGER NOT NULL | Boolean flag (1 = Overconfident loss) |
| `calibration_error` | REAL NOT NULL | Absolute error $\|P(\text{pred}) - \text{Outcome}\|$ |
| `brier_score` | REAL NOT NULL | Squared error $(P(\text{pred}) - \text{Outcome})^2$ |

---

### E. `prediction_daily_metrics`
Stores aggregated daily metrics for ultra-fast reporting.

| Column | Type | Description |
| :--- | :--- | :--- |
| `date` | TEXT PRIMARY KEY | Date string (`YYYY-MM-DD`) |
| `total_predictions` | INTEGER NOT NULL | Total recorded count |
| `completed_predictions` | INTEGER NOT NULL | Resolved count |
| `accuracy_pct` | REAL NOT NULL | Directional accuracy percentage |
| `tp_first_count` / `sl_first_count` | INTEGER NOT NULL | Outcome counts |
| `avg_confidence` | REAL NOT NULL | Mean calibrated confidence |
| `avg_expected_r` / `avg_realized_r` | REAL NOT NULL | Mean R multiples |
| `realized_profit_factor` | REAL NOT NULL | Gross Realized Win R / Loss R |
| `brier_score` / `calibration_error` | REAL NOT NULL | Calibration reliability metrics |
