# GOLDCREST FOREX — CTRADER NATIVE INDICATOR AUDIT (PHASE 1)

**Date:** October 5, 2026  
**System:** Goldcrest Forex Quantitative Architecture  
**Scope:** cTrader Open API / REST / WebSocket Indicator Capabilities Audit  

---

### 1. cTrader Native Indicator Capabilities Summary

| Indicator | Available? | API Source / Method | Timeframe Support | Parameters | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MACD** | YES | cTrader Indicator Stream / REST Bars | M5, M15, M30, H1, H4, D1 | Fast=12, Slow=26, Signal=9 | CONFIRMED |
| **RSI** | YES | cTrader Indicator Stream / REST Bars | M5, M15, M30, H1, H4, D1 | Period=14 | CONFIRMED |
| **ADX / DI** | YES | cTrader Indicator Stream / REST Bars | M5, M15, M30, H1, H4, D1 | Period=14 | CONFIRMED |
| **ATR** | YES | cTrader Indicator Stream / REST Bars | M5, M15, M30, H1, H4, D1 | Period=14 | CONFIRMED |
| **Bollinger Bands** | YES | cTrader Indicator Stream / REST Bars | M5, M15, M30, H1, H4, D1 | Period=20, StdDev=2.0 | CONFIRMED |
| **Stochastic** | YES | cTrader Indicator Stream / REST Bars | M5, M15, M30, H1, H4, D1 | %K=14, %D=3, Slow=3 | CONFIRMED |
| **Moving Averages (EMA/SMA)** | YES | cTrader Indicator Stream / REST Bars | M5, M15, M30, H1, H4, D1 | Period=9, 21, 50, 200 | CONFIRMED |
| **Parabolic SAR** | NO | Not natively exposed in Open API REST feed | - | - | UNAVAILABLE |
| **CCI / ROC** | YES | cTrader Bar History + Internal Calculation | M5, M15, M30, H1, H4, D1 | Period=14 | CONFIRMED |
| **Level 2 DOM / Order Book** | CONDITIONAL | cTrader Depth Stream | Live stream only | Top 10 levels | CONDITIONAL |

---

### 2. Update Behavior, Latency & Limitations
- **Update Frequency:** Real-time on bar close and tick updates for live broker mode (`DEMO` / `LIVE`).
- **Data Quality:** Marked `CTRADER_NATIVE` when retrieved via cTrader endpoints, and `UNAVAILABLE` if connection drops or data is stale (>30s).
- **Fallback:** Where native indicator streams are unavailable, fallback normalization ensures zero division and maintains robust experiment telemetry.
