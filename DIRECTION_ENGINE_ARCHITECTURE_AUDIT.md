# GOLDCREST FOREX — DIRECTION ENGINE ARCHITECTURE & LEAKAGE AUDIT
## AUDIT REPORT (PHASE 1 & PHASE 26)

**Date:** October 5, 2026  
**System:** Goldcrest Forex Quantitative Architecture  
**Scope:** Directional Calculation Engine, Feature Pipelines, Data Availability & Future-Data Leakage Prevention  

---

### 1. Existing System Audit

#### What Already Exists:
- **Multi-Factor Prediction Engine (`CombinedPredictionEngine`):** Combines historical analogues, technical signals, and sentiment features with Platt calibration.
- **Forex Technical Indicators (`src/markets/forex/indicators.ts`):** RSI, ATR, EMAs, MACD calculations.
- **Multi-Timeframe Analysis (`src/markets/forex/multiTimeframe.ts`):** 5M, 15M, 1H, 4H alignment metrics.
- **News Intelligence (`src/services/liveNewsService.ts`, `MarketauxNewsService`):** Sentiment, relative currency risk, and shock state detection.
- **Prediction Forensics (`src/ml/forensics/`):** Immutable snapshots, feature snapshots, outcome evaluation, Brier scoring, and failure classification.
- **cTrader Broker & Tick Volume Adapter (`src/brokers/`):** Live tick volume and market data feeds.

#### Reusable Modules:
- Technical indicator math (`indicators.ts`)
- News sentiment engine (`newsIntelligenceEngine.ts`)
- Immutable prediction snapshot storage (`predictionSnapshotService.ts`)
- Calibration engine (`calibrationEngine.ts`)

#### Gaps Addressed by New Direction Engine:
1. **Explicit Multi-Framework Component Breakdown:** Moving from monolithic scoring to independent components (Momentum, Trend, Velocity, Structure, VWAP, OBI, Macro, MTF, News, ML).
2. **Advanced ADX/DI & VWAP Pipeline:** Full Wilder smoothing for ADX/DI and tick-volume weighted VWAP.
3. **Macro Interest-Rate Differential:** Central bank rate differentials for base/quote currencies.
4. **Conflict Detection & No-Edge Abstention:** Explicit tracking of bullish vs bearish evidence conflict to trigger `NO_EDGE` / `NEUTRAL` when ambiguity is high.
5. **Champion vs Challenger Parallel Tracking:** Running the new quantitative direction engine in shadow mode alongside the existing production model.

---

### 2. Data Availability Matrix (Phase 33)

| Component | Available? | Notes |
| :--- | :--- | :--- |
| **MACD** | YES | Fast=12, Slow=26, Signal=9 |
| **ADX / DI** | YES | Wilder smoothing, +DI/-DI spread |
| **EMA Structure** | YES | 9, 21, 50, 100, 200 EMA cascade |
| **Velocity / Inertia** | YES | Multi-candle returns, ATR normalization |
| **VWAP** | YES | Labeled explicitly as `TICK_VOLUME_VWAP` |
| **Tick Volume / VSA** | YES | Broker tick volume and spread range spread |
| **Order Book / OBI** | CONDITIONAL | Available via cTrader DOM if connected; marked `UNAVAILABLE` otherwise |
| **Macro Interest Rates** | YES | Central bank rate differentials (Fed, ECB, BOE, BOJ, RBA, etc.) |
| **News / Event Risk** | YES | Real-time news sentiment and shock detection |
| **Multi-Timeframe (MTF)** | YES | M5, M15, M30, H1, H4 alignment |

---

### 3. Future-Data Leakage Audit (Phase 26)

To guarantee zero future-data leakage:
1. **Timestamp Isolation:** All features at timestamp $T$ strictly utilize candles and tick data where $t \le T$.
2. **Rolling Normalization:** Indicators (RSI, ADX, MACD, VWAP) use strictly past window sizes.
3. **Macro Timestamps:** Macro interest rates use historical effective release dates prior to $T$.
4. **Supervised Labels:** Future return targets for ML training are computed as $R_{t \rightarrow t+H} = \frac{\text{Price}_{t+H} - \text{Price}_t}{\text{Price}_t}$ without intra-window lookahead.
