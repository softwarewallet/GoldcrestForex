import { executeQuery } from '../database/db';
import type { CurrentPairPredictionHorizon } from './currentPairPredictionOutcomeService';

export const WINDOWS_DAYS = [7, 14, 30, 60, 90] as const;
export const MIN_SAMPLE_COUNT = 30;
export const BOOTSTRAP_RESAMPLES = 2000;

export interface TemporalCalibrationBucket {
  lowerPct: number;
  upperPct: number;
  predictions: number;
  directionalEvaluated: number;
  correct: number;
  averageConfidencePct: number | null;
  accuracyPct: number | null;
  calibrationGapPct: number | null;
  accuracyConfidenceInterval95Pct: { lowerPct: number; upperPct: number } | null;
  sampleSufficient: boolean;
}

export interface TemporalCalibrationWindow {
  windowDays: number;
  predictions: number;
  directionalEvaluated: number;
  correct: number;
  accuracyPct: number | null;
  averageConfidencePct: number | null;
  expectedCalibrationErrorPct: number | null;
  maximumCalibrationErrorPct: number | null;
  sampleSufficient: boolean;
  calibrationBuckets: TemporalCalibrationBucket[];
}

export interface BootstrapCI {
  confidenceLevelPct: number;
  resamples: number;
  lower: number;
  upper: number;
}

export interface CurrentPairTemporalCalibrationRow {
  symbol: string;
  horizon: CurrentPairPredictionHorizon;
  windows: TemporalCalibrationWindow[];
  deltas: {
    accuracy7dVs90dPct: number | null;
    accuracy7dVs90d95Pct: BootstrapCI | null;
    confidence7dVs90d95Pct: BootstrapCI | null;
    ece7dVs90d95Pct: BootstrapCI | null;
  };
}

export interface CurrentPairTemporalCalibrationReport {
  windowsDays: readonly number[];
  minimumSampleCount: number;
  bootstrapResamples: number;
  generatedAt: number;
  rows: CurrentPairTemporalCalibrationRow[];
}

const conf = (v: unknown) => Math.max(0, Math.min(1, Number(v) || 0));

const wilson = (correct: number, total: number) => {
  if (total <= 0) return null;
  const z = 1.96;
  const p = correct / total;
  const den = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / den;
  const half = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / den;
  return {
    lowerPct: Math.max(0, center - half) * 100,
    upperPct: Math.min(1, center + half) * 100,
  };
};

const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};

function horizonToMs(horizon: string): number {
  if (horizon === '3D') return 3 * 86400000;
  if (horizon === '7D') return 7 * 86400000;
  return 86400000;
}

function calculateWindowMetrics(rows: any[], windowDays: number, now: number, horizonMs: number): TemporalCalibrationWindow {
  const windowStart = now - windowDays * 86400000;
  const maturityCutoff = now - horizonMs;

  const inWindow = rows.filter((r) => {
    const t = Number(r.predicted_at);
    return t >= windowStart && t <= now;
  });

  const buckets = Array.from({ length: 5 }, (_, i) => ({
    lowerPct: i * 20,
    upperPct: (i + 1) * 20,
    predictions: 0,
    evaluated: 0,
    correct: 0,
    confidenceSum: 0,
  }));

  let directionalEvaluated = 0;
  let correctCount = 0;
  let totalConfidence = 0;

  for (const r of inWindow) {
    const c = conf(r.confidence);
    totalConfidence += c;
    const bIdx = Math.min(4, Math.floor((c * 100) / 20));
    buckets[bIdx].predictions++;
    buckets[bIdx].confidenceSum += c;

    const t = Number(r.predicted_at);
    if (t > maturityCutoff || r.outcome_status !== 'EVALUATED' || !r.actual_direction) {
      continue;
    }
    if (r.predicted_direction === 'FLAT' || r.actual_direction === 'FLAT') {
      continue;
    }

    const isCorrect = r.predicted_direction === r.actual_direction ? 1 : 0;
    directionalEvaluated++;
    correctCount += isCorrect;
    buckets[bIdx].evaluated++;
    buckets[bIdx].correct += isCorrect;
  }

  const accuracyPct = directionalEvaluated ? (correctCount / directionalEvaluated) * 100 : null;
  const averageConfidencePct = inWindow.length ? (totalConfidence / inWindow.length) * 100 : null;

  const calibrationBuckets: TemporalCalibrationBucket[] = buckets.map((b) => {
    const avgConf = b.predictions ? (b.confidenceSum / b.predictions) * 100 : null;
    const acc = b.evaluated ? (b.correct / b.evaluated) * 100 : null;
    return {
      lowerPct: b.lowerPct,
      upperPct: b.upperPct,
      predictions: b.predictions,
      directionalEvaluated: b.evaluated,
      correct: b.correct,
      averageConfidencePct: avgConf,
      accuracyPct: acc,
      calibrationGapPct: avgConf != null && acc != null ? acc - avgConf : null,
      accuracyConfidenceInterval95Pct: wilson(b.correct, b.evaluated),
      sampleSufficient: b.evaluated >= MIN_SAMPLE_COUNT,
    };
  });

  let ece: number | null = null;
  let mce: number | null = null;
  if (directionalEvaluated) {
    const errors = calibrationBuckets
      .filter((b) => b.directionalEvaluated > 0)
      .map((b) => ({
        error: Math.abs((b.averageConfidencePct ?? 0) - (b.accuracyPct ?? 0)),
        weight: b.directionalEvaluated / directionalEvaluated,
        sufficient: b.sampleSufficient,
      }));

    ece = errors.reduce((sum, e) => sum + e.error * e.weight, 0);
    const suffErrors = errors.filter((e) => e.sufficient).map((e) => e.error);
    mce = suffErrors.length ? Math.max(...suffErrors) : null;
  }

  return {
    windowDays,
    predictions: inWindow.length,
    directionalEvaluated,
    correct: correctCount,
    accuracyPct,
    averageConfidencePct,
    expectedCalibrationErrorPct: ece,
    maximumCalibrationErrorPct: mce,
    sampleSufficient: directionalEvaluated >= MIN_SAMPLE_COUNT,
    calibrationBuckets,
  };
}

export async function getCurrentPairTemporalCalibrationMatrix(params: {
  symbol?: string;
  horizon?: CurrentPairPredictionHorizon;
  now?: number;
  modelVersion?: string;
} = {}): Promise<CurrentPairTemporalCalibrationReport> {
  const now = Number(params.now) || Date.now();
  const conditions = ["prediction_context = 'CURRENT_PAIR'", 'predicted_at >= ?', 'predicted_at <= ?'];
  const values: unknown[] = [now - 90 * 86400000, now];

  if (params.symbol?.trim()) {
    conditions.push('symbol = ?');
    values.push(params.symbol.trim().toUpperCase());
  }
  if (params.horizon) {
    conditions.push('horizon = ?');
    values.push(params.horizon);
  }
  if (params.modelVersion) {
    conditions.push('model_version = ?');
    values.push(params.modelVersion);
  }

  const rows = await executeQuery<any>(
    `SELECT symbol, horizon, predicted_at, predicted_direction, confidence, actual_direction, outcome_status
     FROM live_trade_research_predictions
     WHERE ${conditions.join(' AND ')}
     ORDER BY symbol, horizon, predicted_at`,
    values
  );

  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const key = `${r.symbol}|${r.horizon}`;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(r);
  }

  const resultRows: CurrentPairTemporalCalibrationRow[] = [];

  for (const [key, groupRows] of groups) {
    const [symbol, horizon] = key.split('|') as [string, CurrentPairPredictionHorizon];
    const horizonMs = horizonToMs(horizon);

    const windows = WINDOWS_DAYS.map((days) => calculateWindowMetrics(groupRows, days, now, horizonMs));

    const w7 = windows[0];
    const w90 = windows[4];

    const accDelta = w7.accuracyPct != null && w90.accuracyPct != null ? w7.accuracyPct - w90.accuracyPct : null;

    // Bootstrap resamples between 7d and 90d
    let accCI: BootstrapCI | null = null;
    let confCI: BootstrapCI | null = null;
    let eceCI: BootstrapCI | null = null;

    if (w7.directionalEvaluated > 0 && w90.directionalEvaluated > 0) {
      const diffAcc: number[] = [];
      const diffConf: number[] = [];
      const diffEce: number[] = [];

      let state = 42;
      const rnd = () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 4294967296;
      };

      for (let b = 0; b < BOOTSTRAP_RESAMPLES; b++) {
        // Sample with replacement
        const sample7 = Array.from({ length: groupRows.length }, () => groupRows[Math.floor(rnd() * groupRows.length)]);
        const m7 = calculateWindowMetrics(sample7, 7, now, horizonMs);
        const m90 = calculateWindowMetrics(sample7, 90, now, horizonMs);

        if (m7.accuracyPct != null && m90.accuracyPct != null) {
          diffAcc.push(m7.accuracyPct - m90.accuracyPct);
        }
        if (m7.averageConfidencePct != null && m90.averageConfidencePct != null) {
          diffConf.push(m7.averageConfidencePct - m90.averageConfidencePct);
        }
        if (m7.expectedCalibrationErrorPct != null && m90.expectedCalibrationErrorPct != null) {
          diffEce.push(m7.expectedCalibrationErrorPct - m90.expectedCalibrationErrorPct);
        }
      }

      if (diffAcc.length) {
        accCI = {
          confidenceLevelPct: 95,
          resamples: BOOTSTRAP_RESAMPLES,
          lower: percentile(diffAcc, 0.025),
          upper: percentile(diffAcc, 0.975),
        };
      }
      if (diffConf.length) {
        confCI = {
          confidenceLevelPct: 95,
          resamples: BOOTSTRAP_RESAMPLES,
          lower: percentile(diffConf, 0.025),
          upper: percentile(diffConf, 0.975),
        };
      }
      if (diffEce.length) {
        eceCI = {
          confidenceLevelPct: 95,
          resamples: BOOTSTRAP_RESAMPLES,
          lower: percentile(diffEce, 0.025),
          upper: percentile(diffEce, 0.975),
        };
      }
    }

    resultRows.push({
      symbol,
      horizon,
      windows,
      deltas: {
        accuracy7dVs90dPct: accDelta,
        accuracy7dVs90d95Pct: accCI,
        confidence7dVs90d95Pct: confCI,
        ece7dVs90d95Pct: eceCI,
      },
    });
  }

  return {
    windowsDays: WINDOWS_DAYS,
    minimumSampleCount: MIN_SAMPLE_COUNT,
    bootstrapResamples: BOOTSTRAP_RESAMPLES,
    generatedAt: now,
    rows: resultRows,
  };
}
