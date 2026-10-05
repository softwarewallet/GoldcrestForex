import { ForensicsAnalyticsService } from './forensicsAnalyticsService';
import { PredictionSnapshotService } from './predictionSnapshotService';
import { DailyPredictionMetrics } from './types';

export class ForensicsReportGenerator {
  /**
   * Generates a formal Markdown AI Prediction Forensics Report (Phase 14).
   */
  public static async generateMarkdownReport(
    dateStr: string,
    fromTimestamp?: number,
    toTimestamp?: number
  ): Promise<string> {
    const fromTs = fromTimestamp || new Date(`${dateStr}T00:00:00.000Z`).getTime();
    const toTs = toTimestamp || new Date(`${dateStr}T23:59:59.999Z`).getTime();

    const metrics: DailyPredictionMetrics = await ForensicsAnalyticsService.getPeriodMetrics(fromTs, toTs);
    const pairBreakdown = await ForensicsAnalyticsService.getBreakdown('pair', fromTs, toTs);
    const regimeBreakdown = await ForensicsAnalyticsService.getBreakdown('market_regime', fromTs, toTs);
    const sessionBreakdown = await ForensicsAnalyticsService.getBreakdown('session', fromTs, toTs);
    const calibration = await ForensicsAnalyticsService.getConfidenceCalibration(fromTs, toTs);
    const sampleItems = await PredictionSnapshotService.querySnapshots({ fromTimestamp: fromTs, toTimestamp: toTs, limit: 15 });

    let md = `# GOLDCREST FOREX — AI PREDICTION FORENSICS REPORT
**Period / Date:** ${dateStr}  
**Generated At:** ${new Date().toISOString()}  
**System Status:** LIVE GATED / SHADOW MODE ACTIVE  

---

## 1. Executive Summary
- **Total Predictions Recorded:** ${metrics.totalPredictions}
- **Completed & Resolved:** ${metrics.completedPredictions} (Pending: ${metrics.pendingPredictions})
- **Actionable (TRADE_BUY / TRADE_SELL):** ${metrics.actionablePredictions} | **Abstained (NO_TRADE):** ${metrics.abstainedPredictions}
- **Directional Prediction Accuracy:** **${metrics.accuracyPct}%**
- **Outcome Distribution:** TP First: ${metrics.tpFirstCount} | SL First: ${metrics.slFirstCount} | Time Exit: ${metrics.timeExitCount}
- **Average Expected R:** +${metrics.avgExpectedR} R | **Average Realized R:** ${metrics.avgRealizedR > 0 ? '+' : ''}${metrics.avgRealizedR} R
- **Realized Profit Factor:** **${metrics.realizedProfitFactor}**
- **Average Brier Calibration Score:** ${metrics.brierScore} (Target < 0.22)

---

## 2. Confidence Calibration & Reliability
| Bucket | Sample Size | Mean Predicted Prob | Realized Accuracy | Calibration Error | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
`;

    for (const b of calibration) {
      md += `| **${b.bucketName}** | ${b.predictionsCount} | ${(b.avgPredictedProbability * 100).toFixed(1)}% | ${(b.actualSuccessRate * 100).toFixed(1)}% | ${(b.calibrationError * 100).toFixed(1)}% | \`${b.status}\` |\n`;
    }

    md += `\n---

## 3. Performance Breakdown by Currency Pair
| Pair | Total Predictions | Accuracy | Avg Realized R | Gross PF | Warning Flags |
| :--- | :--- | :--- | :--- | :--- | :--- |
`;

    for (const p of pairBreakdown) {
      md += `| **${p.groupKey}** | ${p.totalPredictions} | ${p.accuracyPct}% | ${p.avgRealizedR > 0 ? '+' : ''}${p.avgRealizedR} R | ${p.profitFactor} | ${p.warningFlag || 'NORMAL'} |\n`;
    }

    md += `\n---

## 4. Market Regime Forensics
| Regime | Predictions | Accuracy | Avg Realized R | TP First | SL First |
| :--- | :--- | :--- | :--- | :--- | :--- |
`;

    for (const r of regimeBreakdown) {
      md += `| **${r.groupKey}** | ${r.totalPredictions} | ${r.accuracyPct}% | ${r.avgRealizedR > 0 ? '+' : ''}${r.avgRealizedR} R | ${r.tpFirstCount} | ${r.slFirstCount} |\n`;
    }

    md += `\n---

## 5. Trading Session Performance
| Session | Predictions | Accuracy | Avg Realized R | PF |
| :--- | :--- | :--- | :--- | :--- |
`;

    for (const s of sessionBreakdown) {
      md += `| **${s.groupKey}** | ${s.totalPredictions} | ${s.accuracyPct}% | ${s.avgRealizedR > 0 ? '+' : ''}${s.avgRealizedR} R | ${s.profitFactor} |\n`;
    }

    md += `\n---

## 6. Sample Forensic Audits & Failure Root Causes
`;

    if (sampleItems.length === 0) {
      md += `*No individual forensic items recorded in this window.*\n`;
    } else {
      for (const item of sampleItems.slice(0, 5)) {
        const s = item.snapshot;
        const o = item.outcome;
        const f = item.forensics;
        md += `
### Prediction ID: \`${s.predictionId.slice(0, 8)}...\` (${s.pair} ${s.horizon} - ${s.predictedDirection})
- **Timestamp:** ${new Date(s.timestamp).toISOString()}
- **Model Confidence:** ${(s.confidenceScore * 100).toFixed(1)}% | **Expected R:** +${s.expectedR} R
- **Outcome:** \`${o?.actualOutcome || 'PENDING'}\` (Realized: ${o?.actualRealizedR !== undefined ? `${o.actualRealizedR} R` : '—'})
- **MAE / MFE:** Adverse: ${o?.maePips || 0} pips (${o?.maeR || 0} R) | Favorable: ${o?.mfePips || 0} pips (${o?.mfeR || 0} R)
- **Primary Diagnosis:** \`${f?.primaryFailureReason || 'UNKNOWN_FAILURE'}\`
- **Evidence Notes:** ${f?.evidenceSummary?.join('; ') || 'Standard market variance'}
`;
      }
    }

    md += `
---

## 7. Recommended AI Investigation Areas
1. **Regime Vulnerabilities:** Monitor setups in \`TRANSITION\` and \`HIGH_VOLATILITY\` for potential higher abstention thresholds.
2. **Confidence Calibration:** Verify whether high-probability buckets (80-90%) exhibit overconfidence under news shocks.
3. **Execution Friction:** Cross-reference realized slippage vs modeled friction pips to ensure net EV calculations remain conservative.

*Notice: This forensic audit is purely analytical and never modifies live models or trading rules automatically.*
`;

    return md;
  }

  /**
   * Generates a machine-readable JSON forensic package.
   */
  public static async generateJsonReport(
    dateStr: string,
    fromTimestamp?: number,
    toTimestamp?: number
  ): Promise<any> {
    const fromTs = fromTimestamp || new Date(`${dateStr}T00:00:00.000Z`).getTime();
    const toTs = toTimestamp || new Date(`${dateStr}T23:59:59.999Z`).getTime();

    const metrics = await ForensicsAnalyticsService.getPeriodMetrics(fromTs, toTs);
    const pairBreakdown = await ForensicsAnalyticsService.getBreakdown('pair', fromTs, toTs);
    const regimeBreakdown = await ForensicsAnalyticsService.getBreakdown('market_regime', fromTs, toTs);
    const sessionBreakdown = await ForensicsAnalyticsService.getBreakdown('session', fromTs, toTs);
    const calibration = await ForensicsAnalyticsService.getConfidenceCalibration(fromTs, toTs);
    const rawItems = await PredictionSnapshotService.querySnapshots({ fromTimestamp: fromTs, toTimestamp: toTs, limit: 100 });

    return {
      reportType: 'AI_PREDICTION_FORENSICS_REPORT',
      period: dateStr,
      generatedAt: new Date().toISOString(),
      summaryMetrics: metrics,
      calibrationBuckets: calibration,
      breakdowns: {
        byPair: pairBreakdown,
        byRegime: regimeBreakdown,
        bySession: sessionBreakdown
      },
      predictions: rawItems
    };
  }

  /**
   * Generates CSV export for tabular analysis (Phase 22).
   */
  public static async generateCsvExport(fromTimestamp: number, toTimestamp: number): Promise<string> {
    const items = await PredictionSnapshotService.querySnapshots({ fromTimestamp, toTimestamp, limit: 500 });
    const headers = [
      'PredictionId', 'Timestamp', 'Pair', 'Timeframe', 'Horizon',
      'Direction', 'ConfidenceScore', 'ExpectedR', 'Entry', 'SL', 'TP',
      'Regime', 'Session', 'ActualOutcome', 'RealizedR', 'MAE_Pips', 'MFE_Pips',
      'PrimaryFailureReason', 'BrierScore'
    ];

    const rows = items.map(i => {
      const s = i.snapshot;
      const o = i.outcome;
      const f = i.forensics;
      return [
        s.predictionId,
        new Date(s.timestamp).toISOString(),
        s.pair,
        s.timeframe,
        s.horizon,
        s.predictedDirection,
        s.confidenceScore,
        s.expectedR,
        s.predictedEntry,
        s.predictedStopLoss,
        s.predictedTakeProfit,
        s.marketRegime,
        s.session,
        o?.actualOutcome || 'PENDING',
        o?.actualRealizedR ?? '',
        o?.maePips ?? '',
        o?.mfePips ?? '',
        f?.primaryFailureReason || '',
        f?.brierScore ?? ''
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }
}
