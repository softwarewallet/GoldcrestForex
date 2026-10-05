# GOLDCREST FOREX — PREDICTION FORENSICS USER GUIDE
**Date:** October 5, 2026  
**Audience:** Quantitative Traders, Risk Officers & ML Engineers  

---

## 1. Accessing Prediction Forensics in the Terminal

Navigate to the **Forensics** tab in the main terminal sidebar navigation or access Reports $\rightarrow$ Prediction Forensics.

### Available Time Ranges:
- **TODAY:** Real-time intraday snapshots from 00:00 UTC.
- **YESTERDAY:** Full 24-hour completed trading day review.
- **7D / 30D / 90D:** Multi-day rolling windows for statistical trend analysis.

---

## 2. Reading the Forensics Dashboard

### A. Top KPI Cards
- **Directional Accuracy:** The percentage of forecasts that moved in the intended direction.
- **Outcome Distribution:** Number of setups that reached TP First vs SL First vs Time Expiry.
- **Realized R:** The actual multiple of risk earned per trade.
- **Brier Score:** Calibration quality of probability estimates.

### B. Prediction Forensics Grid
- Click on any prediction row to open the **Individual Prediction Forensic Detail Drawer**.
- The drawer displays the exact numerical feature snapshot captured at prediction time $T$, along with the forward price path, MAE, MFE, and natural-language root-cause diagnostic notes.

### C. Confidence Calibration Tab
- Compares model confidence against actual win rates in 5 buckets (`50-60%` through `90-100%`).
- Highlights `OVERCONFIDENT` buckets where model probabilities exceeded real-world performance.

### D. Export Capabilities
- **MD (Markdown):** Formats an executive summary and full statistical tables for AI review.
- **JSON:** Exports machine-readable raw prediction snapshots and outcomes.
- **CSV:** Exports tabular data for spreadsheet modeling in Excel, Python, or R.

---

## 3. Resolving Pending Predictions
Click the **RESOLVE OUTCOMES** button in the header toolbar to trigger forward candle matching and evaluate pending in-flight predictions against historical price series.
