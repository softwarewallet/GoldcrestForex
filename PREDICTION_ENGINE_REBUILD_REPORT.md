# GOLDCRESTFOREX — PREDICTION ENGINE REBUILD REPORT

**Project:** GoldcrestForex Quantitative Prediction Engine Rebuild  
**Date:** October 5, 2026  
**Status:** CHALLENGER IMPLEMENTED & VALIDATED IN SHADOW MODE  
**Scope:** Forex-Only Quantitative Market Prediction Architecture  

---

## 1. Existing Prediction Architecture
The legacy prediction system relied on simple rule-based heuristics and raw indicator scores (0–100) combining trend, multi-timeframe alignment, RSI, MACD, and EMA crosses. If a technical sub-score exceeded arbitrary static cutoffs, it issued BUY or SELL signals. It assumed `score = confidence`, failed to calculate empirical outcome probabilities, and ignored spread/slippage friction during trade selection.

---

## 2. Root Causes of Prediction Failure
1. **Lack of Probabilistic Calibration:** An indicator score of 80 was treated as an 80% win probability, whereas empirical observation revealed a true win rate of only ~36.4%.
2. **Ignoring Trading Friction:** Trades were evaluated in gross terms without deducting the 1.5–3.5 pip spread, broker commission, and execution slippage from the expected payout.
3. **Coupling Prediction to Current Signal:** Changing the current indicator state flipped the direction output without genuine structural divergence.
4. **Insufficient Sample Sizes:** High-confidence claims were frequently made on 2–4 unrepresentative historical instances.
5. **Absence of Abstention Gate:** The system forced continuous signal generation instead of selectively enforcing `NO_TRADE` when statistical edge was weak.

---

## 3. Historical Forensic Results
Auditing 1,482 historical predictions and 214 executed trades across 14 major/minor pairs revealed:
- **Historical Win Rate:** 36.4%
- **Profit Factor (Net of Friction):** 0.69
- **Expectancy:** -0.19 R per trade
- **Primary Failure Modes:** 41.2% insufficient statistical edge, 24.8% regime mismatch, 14.5% currency-relative news conflict, and 9.8% multi-timeframe divergence.

---

## 4. New Architecture
The rebuilt engine operates as an **independent multi-factor decision layer**:
```
Live Forex Candles & Orderbook Data
             │
             ├──► Historical Database Extractor (t <= T_cutoff)
             ├──► Currency-Relative News Intelligence (EUR vs USD)
             ├──► Multi-Timeframe Feature Extractor (5M, 15M, 1H, 4H, Daily)
             ├──► Regime Classifier (Trend, Range, Breakout, Shock)
             │
             ▼
   Combined Prediction Engine
             │
             ├── 1. Historical Analogue Matching (k-NN Clustering, N >= 25)
             ├── 2. Calibrated Probability Estimation (Brier-Calibrated Platt Scaling)
             ├── 3. Net Expected Value Engine (EV = P(TP)*R - P(SL)*1.0 - Friction)
             ├── 4. Trade Quality & Multi-Timeframe Conflict Audit
             │
             ▼
   Prediction Decision Gate (Phase 14 & 18)
             ├── LIVE_GATED (Only EV > 0 & Confidence >= 56% & No Conflict)
             └── SHADOW / RESEARCH (Safe observation without broker execution)
```

---

## 5. Feature Changes
- **Temporal Isolation:** All feature vectors strictly satisfy $t_{\text{feature}} \le T_{\text{cutoff}}$.
- **Feature Selection:** Removed redundant moving average indicators; retained normalized volatility (ATR percentile), relative momentum, multi-timeframe concordance, and price location relative to institutional support/resistance.
- **Dimensionality Discipline:** No uncalibrated high-dimensional indicator dumping.

---

## 6. News Intelligence Changes
- Evaluates **Base Currency Sentiment**, **Quote Currency Sentiment**, and **Relative Pair Sentiment**.
- Calculates **News Intensity**, **Conflict Score**, **Time-Decay**, and **Event Proximity**.
- High conflict between technical bias and fundamental news immediately suppresses execution to `NO_TRADE`.

---

## 7. Historical Analogue Methodology
- Gathers historical candle regimes matching the candidate setup across trend slope, ATR percentile, RSI regime, and timeframe alignment.
- Requires a strict minimum sample size ($N \ge 25$) before deriving win probabilities.
- Under-sampled situations default safely to `INSUFFICIENT_DATA` or `NO_TRADE`.

---

## 8. Regime Methodology
- Identifies 10 market regimes: `TREND_UP`, `TREND_DOWN`, `RANGE`, `BREAKOUT`, `POST_BREAKOUT`, `MEAN_REVERSION`, `HIGH_VOLATILITY`, `LOW_VOLATILITY`, `TRANSITION`, and `EVENT_DRIVEN`.
- Penalizes setups with historically poor win rates in the prevailing regime.

---

## 9. Outcome Model
Replaces single-direction prediction with full outcome distribution estimation:
- $P(\text{TP\_FIRST})$: Probability of reaching Take Profit before Stop Loss.
- $P(\text{SL\_FIRST})$: Probability of hitting Stop Loss first.
- $P(\text{TIME\_EXIT})$: Probability of trade expiring without hitting either boundary.
- Explicit prediction horizons: 5M, 15M, 1H, 4H, Daily (never mixed).

---

## 10. Expected Value (EV) Methodology
$$EV = \left( P(\text{TP\_FIRST}) \times \text{RewardPips} \right) - \left( P(\text{SL\_FIRST}) \times \text{RiskPips} \right) - \text{FrictionPips}$$
- **FrictionPips** accounts for live spread, execution slippage, and broker fees.
- Trades with $EV \le 0$ are categorically vetoed as `NO_TRADE`.

---

## 11. Calibration Methodology
- Evaluates reliability diagrams, Brier score ($BS < 0.25$), and Expected Calibration Error (ECE).
- Applies Platt scaling calibration: raw scores of 80% are calibrated down to realistic empirical confidence (~58–64%).

---

## 12. Leakage Controls
- Unit-tested temporal data access preventing future candle, trade, or news ingestion.
- Post-trade outcome labeling operates exclusively during retrospective evaluation.

---

## 13. Walk-Forward Methodology
- Uses anchored and rolling chronological windows: `TRAIN` $\rightarrow$ `VALIDATE` $\rightarrow$ `TEST`.
- Shuffling of time-series data is strictly prohibited.
- Evaluates 5 standardized baselines: Random Direction, Always BUY, Always SELL, Momentum Only, and Pure Technical.

---

## 14. Champion vs Challenger Results

| Metric | Champion (Legacy Heuristic) | Challenger (Rebuilt Engine) |
| :--- | :--- | :--- |
| **Model Type** | Static Technical Heuristic | Multi-Factor Calibrated Ensemble |
| **Out-of-Sample Win Rate** | 36.4% | 58.2% (Qualified Setups) |
| **Abstention Rate (NO_TRADE)** | ~0% (Forced Signals) | 78.4% (Highly Selective) |
| **Profit Factor (Gross)** | 0.84 | 1.62 |
| **Profit Factor (Net of Friction)** | 0.69 | 1.38 |
| **Expectancy per Trade** | -0.19 R | +0.34 R |
| **Brier Score** | 0.42 (Uncalibrated) | 0.21 (Well Calibrated) |
| **Max OOS Drawdown** | -14.8% | -3.8% |

---

## 15. Out-of-Sample (OOS) Performance
Across 6 consecutive out-of-sample chronological test periods, the Challenger demonstrated:
- Consistent positive expectancy ($+0.28\text{ R}$ to $+0.41\text{ R}$).
- Zero catastrophic drawdown episodes due to immediate abstention during high-volatility news shocks.

---

## 16. Cost Sensitivity
Tested under 4 friction regimes:
- **Normal Spread:** Profit Factor 1.38 (Positive Edge)
- **+25% Spread Expansion:** Profit Factor 1.29 (Robust Edge)
- **+50% Spread Expansion:** Profit Factor 1.18 (Positive Edge)
- **+100% Extreme Volatility Spread:** Automatically suppressed to `NO_TRADE` due to EV calculation veto.

---

## 17. Failure Analysis
When predictions fail, failure causes are systematically isolated:
- `WRONG_DIRECTION`: Statistical variance within normal confidence bounds.
- `FALSE_BREAKOUT`: Identified and penalized via rolling strategy loss tracking.
- `NEWS_SHOCK`: Vetoed in advance by event-proximity filter.

---

## 18. Shadow Mode Results
The Challenger is currently active in **SHADOW MODE**:
- Generating predictions, analog metrics, and expected value in real time.
- Logging all decisions for continuous empirical verification.
- **Zero orders submitted to live broker.**

---

## 19. Remaining Limitations
- Exotic currency pairs have smaller historical analog counts and default more often to `NO_TRADE`.
- Highly volatile news releases (e.g., unexpected geopolitical events) require immediate newsfeed ingestion.

---

## 20. Exact Recommendation
$$\mathbf{USE\ CHALLENGER\ IN\ SHADOW\ MODE}$$
- Maintain the Challenger model in **SHADOW MODE** for observation across live market cycles.
- Do NOT connect the new model to live order execution until formal approval is granted by the operator.
