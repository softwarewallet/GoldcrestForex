# GOLDCREST FOREX — PREDICTION FORENSICS METRIC DEFINITIONS
**Date:** October 5, 2026  
**Module:** Quantitative Intelligence & Forensic Evaluation  

---

## 1. Primary Accuracy & Trading Metrics

### A. Directional Prediction Accuracy ($\text{Acc}_{\text{dir}}$)
$$\text{Acc}_{\text{dir}} = \frac{\text{Correct Direction Predictions}}{\text{Total Resolved Predictions}} \times 100$$
A prediction is directionally correct if price moved in the predicted direction over the horizon window ($T \rightarrow T_{\text{expiry}}$), regardless of whether premature stop-outs occurred.

### B. Outcome Accuracy & Trade Classification
- **$\text{P(TP\_FIRST)}$ Rate:** Percentage of candidate setups that hit Take Profit before Stop Loss.
- **$\text{P(SL\_FIRST)}$ Rate:** Percentage of candidate setups that hit Stop Loss first.
- **$\text{P(TIME\_EXIT)}$ Rate:** Percentage that reached horizon expiration without hitting either boundary.

| Classification | Direction Result | Trade Profit Result | Interpretation |
| :--- | :--- | :--- | :--- |
| `CORRECT_PREDICTION_WIN` | Correct | Won | Model correctly forecasted direction and trade captured profit. |
| `CORRECT_PREDICTION_LOSS` | Correct | Lost | Direction was right, but stop was too tight or timing was early (Entry Timing Failure). |
| `WRONG_PREDICTION_WIN` | Wrong | Won | False move captured profit or trailing stop saved position. |
| `WRONG_PREDICTION_LOSS` | Wrong | Lost | Structural directional invalidation. |

---

## 2. Excursion Metrics

### A. Maximum Favorable Excursion (MFE)
The maximum profit distance reached in pips and R-multiples during the entire lifecycle of the trade:
$$\text{MFE}_{\text{pips}} = \max_{t \in [T_{\text{entry}}, T_{\text{exit}}]} (\text{Price}_t - \text{Entry})$$
$$\text{MFE}_R = \frac{\text{MFE}_{\text{pips}}}{\text{RiskPips}}$$

### B. Maximum Adverse Excursion (MAE)
The maximum drawdown distance reached against the position before exit:
$$\text{MAE}_{\text{pips}} = \max_{t \in [T_{\text{entry}}, T_{\text{exit}}]} (\text{Entry} - \text{Price}_t)$$
$$\text{MAE}_R = \frac{\text{MAE}_{\text{pips}}}{\text{RiskPips}}$$

---

## 3. Probability Calibration & Reliability Metrics

### A. Brier Score ($BS$)
Measures the mean squared difference between predicted probabilities and actual binary outcomes ($y_i \in \{0, 1\}$):
$$BS = \frac{1}{N} \sum_{i=1}^N (P_i - y_i)^2$$
- $BS = 0.00$: Perfect calibration.
- $BS < 0.22$: Strong production calibration.
- $BS > 0.35$: Severe uncalibrated distortion.

### B. Expected Calibration Error (ECE)
Weighted average of the absolute difference between predicted confidence and empirical accuracy across $K=5$ buckets:
$$\text{ECE} = \sum_{k=1}^K \frac{|B_k|}{N} \left| \text{acc}(B_k) - \text{conf}(B_k) \right|$$

---

## 4. Net Expected Value (EV)
$$\text{EV} = \left( P(\text{TP\_FIRST}) \times \text{RewardPips} \right) - \left( P(\text{SL\_FIRST}) \times \text{RiskPips} \right) - \text{FrictionPips}$$
Where **FrictionPips** represents the sum of live spread, expected execution slippage, and broker commissions.
