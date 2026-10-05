import { executeQuery, executeRun } from '../../database/db';
import {
  ImmutablePredictionSnapshot,
  PredictionFeatureSnapshot,
  FullForensicPredictionItem
} from './types';

export class PredictionSnapshotService {
  /**
   * Records an immutable prediction snapshot and its associated feature snapshot.
   * Guarantees: Exact numerical capture at prediction time T, deduplicated by predictionId.
   */
  public static async recordSnapshot(
    snapshot: ImmutablePredictionSnapshot,
    features: PredictionFeatureSnapshot
  ): Promise<void> {
    const existing = await executeQuery<{ prediction_id: string }>(
      'SELECT prediction_id FROM prediction_snapshots WHERE prediction_id = ?',
      [snapshot.predictionId]
    );

    if (existing.length > 0) {
      // Strictly immutable: Do not overwrite once created
      return;
    }

    const snapSQL = `
      INSERT INTO prediction_snapshots (
        prediction_id, timestamp, pair, timeframe, horizon,
        model_id, model_version, feature_version, regime_version, news_engine_version,
        predicted_direction, prediction_class, prob_target_first, prob_stop_first, prob_time_exit,
        expected_r, confidence_tier, confidence_score, prediction_horizon_candles,
        predicted_entry, predicted_stop_loss, predicted_take_profit, predicted_risk_reward,
        predicted_position_size, spread_at_prediction,
        bid, ask, mid_price, atr, atr_pips, volatility,
        market_regime, trend_strength, market_structure, dist_to_support_pips, dist_to_resistance_pips,
        session, deterministic_signal, deterministic_score, ml_score, trade_quality_score,
        final_decision, news_risk, high_impact_news, elevated_news, news_sentiment,
        news_shock_state, relevant_news_count, top_contributing_features, conflicting_factors,
        quote_age_ms, data_quality, spread_quality, missing_feature_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const snapParams = [
      snapshot.predictionId,
      snapshot.timestamp,
      snapshot.pair,
      snapshot.timeframe,
      snapshot.horizon,
      snapshot.modelId,
      snapshot.modelVersion,
      snapshot.featureVersion,
      snapshot.regimeVersion,
      snapshot.newsEngineVersion,
      snapshot.predictedDirection,
      snapshot.predictionClass,
      snapshot.probabilityTargetBeforeStop,
      snapshot.probabilityStopBeforeTarget,
      snapshot.probabilityTimeExit,
      snapshot.expectedR,
      snapshot.confidenceTier,
      snapshot.confidenceScore,
      snapshot.predictionHorizonCandles,
      snapshot.predictedEntry,
      snapshot.predictedStopLoss,
      snapshot.predictedTakeProfit,
      snapshot.predictedRiskReward,
      snapshot.predictedPositionSize,
      snapshot.spreadAtPrediction,
      snapshot.bid,
      snapshot.ask,
      snapshot.midPrice,
      snapshot.atr,
      snapshot.atrPips,
      snapshot.volatility,
      snapshot.marketRegime,
      snapshot.trendStrength,
      snapshot.marketStructure,
      snapshot.distToSupportPips,
      snapshot.distToResistancePips,
      snapshot.session,
      snapshot.deterministicSignal,
      snapshot.deterministicScore,
      snapshot.mlScore,
      snapshot.tradeQualityScore,
      snapshot.finalDecision,
      snapshot.newsRisk,
      snapshot.highImpactNews ? 1 : 0,
      snapshot.elevatedNews ? 1 : 0,
      snapshot.newsSentiment,
      snapshot.newsShockState ? 1 : 0,
      snapshot.relevantNewsCount,
      JSON.stringify(snapshot.topContributingFeatures || []),
      JSON.stringify(snapshot.conflictingFactors || []),
      snapshot.quoteAgeMs,
      snapshot.dataQuality,
      snapshot.spreadQuality,
      snapshot.missingFeatureCount,
      Date.now()
    ];

    const featSQL = `
      INSERT INTO prediction_feature_snapshots (
        prediction_id, rsi, macd, macd_signal, macd_histogram,
        ema9, ema21, ema50, ema200, adx, di_plus, di_minus,
        bollinger_upper, bollinger_lower, bollinger_width,
        stochastic_k, stochastic_d, roc, vwap_distance,
        mtf_alignment, mtf_conflict_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const featParams = [
      features.predictionId,
      features.rsi,
      features.macd,
      features.macdSignal,
      features.macdHistogram,
      features.ema9,
      features.ema21,
      features.ema50,
      features.ema200,
      features.adx,
      features.diPlus,
      features.diMinus,
      features.bollingerUpper,
      features.bollingerLower,
      features.bollingerWidth,
      features.stochasticK,
      features.stochasticD,
      features.roc,
      features.vwapDistance,
      features.mtfAlignment,
      features.mtfConflictScore
    ];

    await executeRun(snapSQL, snapParams);
    await executeRun(featSQL, featParams);
  }

  /**
   * Retrieves full prediction item with snapshot, features, outcome, and forensics.
   */
  public static async getPredictionById(predictionId: string): Promise<FullForensicPredictionItem | null> {
    const snaps = await executeQuery<any>(
      'SELECT * FROM prediction_snapshots WHERE prediction_id = ?',
      [predictionId]
    );
    if (!snaps.length) return null;

    const feats = await executeQuery<any>(
      'SELECT * FROM prediction_feature_snapshots WHERE prediction_id = ?',
      [predictionId]
    );

    const outcomes = await executeQuery<any>(
      'SELECT * FROM prediction_outcomes WHERE prediction_id = ?',
      [predictionId]
    );

    const forensics = await executeQuery<any>(
      'SELECT * FROM prediction_forensics WHERE prediction_id = ?',
      [predictionId]
    );

    const s = snaps[0];
    const snapshot: ImmutablePredictionSnapshot = {
      predictionId: s.prediction_id,
      timestamp: s.timestamp,
      pair: s.pair,
      timeframe: s.timeframe,
      horizon: s.horizon,
      modelId: s.model_id,
      modelVersion: s.model_version,
      featureVersion: s.feature_version,
      regimeVersion: s.regime_version,
      newsEngineVersion: s.news_engine_version,
      predictedDirection: s.predicted_direction,
      predictionClass: s.prediction_class,
      probabilityTargetBeforeStop: s.prob_target_first,
      probabilityStopBeforeTarget: s.prob_stop_first,
      probabilityTimeExit: s.prob_time_exit,
      expectedR: s.expected_r,
      confidenceTier: s.confidence_tier,
      confidenceScore: s.confidence_score,
      predictionHorizonCandles: s.prediction_horizon_candles,
      predictedEntry: s.predicted_entry,
      predictedStopLoss: s.predicted_stop_loss,
      predictedTakeProfit: s.predicted_take_profit,
      predictedRiskReward: s.predicted_risk_reward,
      predictedPositionSize: s.predicted_position_size,
      spreadAtPrediction: s.spread_at_prediction,
      bid: s.bid,
      ask: s.ask,
      midPrice: s.mid_price,
      atr: s.atr,
      atrPips: s.atr_pips,
      volatility: s.volatility,
      marketRegime: s.market_regime,
      trendStrength: s.trend_strength,
      marketStructure: s.market_structure,
      distToSupportPips: s.dist_to_support_pips,
      distToResistancePips: s.dist_to_resistance_pips,
      session: s.session,
      deterministicSignal: s.deterministic_signal,
      deterministicScore: s.deterministic_score,
      mlScore: s.ml_score,
      tradeQualityScore: s.trade_quality_score,
      finalDecision: s.final_decision,
      newsRisk: s.news_risk,
      highImpactNews: s.high_impact_news === 1,
      elevatedNews: s.elevated_news === 1,
      newsSentiment: s.news_sentiment,
      newsShockState: s.news_shock_state === 1,
      relevantNewsCount: s.relevant_news_count,
      topContributingFeatures: JSON.parse(s.top_contributing_features || '[]'),
      conflictingFactors: JSON.parse(s.conflicting_factors || '[]'),
      quoteAgeMs: s.quote_age_ms,
      dataQuality: s.data_quality,
      spreadQuality: s.spread_quality,
      missingFeatureCount: s.missing_feature_count
    };

    const f = feats[0] || {};
    const features: PredictionFeatureSnapshot = {
      predictionId,
      rsi: f.rsi || 50,
      macd: f.macd || 0,
      macdSignal: f.macd_signal || 0,
      macdHistogram: f.macd_histogram || 0,
      ema9: f.ema9 || 0,
      ema21: f.ema21 || 0,
      ema50: f.ema50 || 0,
      ema200: f.ema200 || 0,
      adx: f.adx || 25,
      diPlus: f.di_plus || 20,
      diMinus: f.di_minus || 20,
      bollingerUpper: f.bollinger_upper || 0,
      bollingerLower: f.bollinger_lower || 0,
      bollingerWidth: f.bollinger_width || 0,
      stochasticK: f.stochastic_k || 50,
      stochasticD: f.stochastic_d || 50,
      roc: f.roc || 0,
      vwapDistance: f.vwap_distance || 0,
      mtfAlignment: f.mtf_alignment || 'NEUTRAL',
      mtfConflictScore: f.mtf_conflict_score || 0
    };

    let outcome = undefined;
    if (outcomes.length > 0) {
      const o = outcomes[0];
      outcome = {
        predictionId,
        evaluatedAt: o.evaluated_at,
        actualOutcome: o.actual_outcome,
        tradeClassification: o.trade_classification,
        isDirectionCorrect: o.is_direction_correct === 1,
        isTradeWon: o.is_trade_won === 1,
        entryReached: o.entry_reached === 1,
        entryPriceActual: o.entry_price_actual,
        exitPriceActual: o.exit_price_actual,
        actualRealizedR: o.actual_realized_r,
        holdingDurationMinutes: o.holding_duration_minutes,
        maePips: o.mae_pips,
        mfePips: o.mfe_pips,
        maeR: o.mae_r,
        mfeR: o.mfe_r,
        closedBy: o.closed_by
      };
    }

    let forensicAudit = undefined;
    if (forensics.length > 0) {
      const fr = forensics[0];
      forensicAudit = {
        predictionId,
        primaryFailureReason: fr.primary_failure_reason,
        secondaryFactors: JSON.parse(fr.secondary_factors || '[]'),
        evidenceSummary: JSON.parse(fr.evidence_summary || '[]'),
        confidenceBucket: fr.confidence_bucket,
        isOverconfident: fr.is_overconfident === 1,
        isUnderconfident: fr.is_underconfident === 1,
        calibrationError: fr.calibration_error,
        brierScore: fr.brier_score
      };
    }

    return {
      snapshot,
      features,
      outcome,
      forensics: forensicAudit
    };
  }

  /**
   * Retrieves all snapshots matching query criteria.
   */
  public static async querySnapshots(filter: {
    pair?: string;
    marketRegime?: string;
    session?: string;
    modelVersion?: string;
    fromTimestamp?: number;
    toTimestamp?: number;
    limit?: number;
  } = {}): Promise<FullForensicPredictionItem[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter.pair && filter.pair !== 'ALL') {
      conditions.push('s.pair = ?');
      params.push(filter.pair);
    }
    if (filter.marketRegime && filter.marketRegime !== 'ALL') {
      conditions.push('s.market_regime = ?');
      params.push(filter.marketRegime);
    }
    if (filter.session && filter.session !== 'ALL') {
      conditions.push('s.session = ?');
      params.push(filter.session);
    }
    if (filter.modelVersion && filter.modelVersion !== 'ALL') {
      conditions.push('s.model_version = ?');
      params.push(filter.modelVersion);
    }
    if (filter.fromTimestamp) {
      conditions.push('s.timestamp >= ?');
      params.push(filter.fromTimestamp);
    }
    if (filter.toTimestamp) {
      conditions.push('s.timestamp <= ?');
      params.push(filter.toTimestamp);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit || 100;

    const sql = `
      SELECT s.prediction_id
      FROM prediction_snapshots s
      ${whereClause}
      ORDER BY s.timestamp DESC
      LIMIT ?
    `;
    params.push(limit);

    const rows = await executeQuery<{ prediction_id: string }>(sql, params);
    const items: FullForensicPredictionItem[] = [];

    for (const r of rows) {
      const item = await this.getPredictionById(r.prediction_id);
      if (item) items.push(item);
    }

    return items;
  }
}
