// ============================================================================
// UNIVERSE PREDICTION SCANNER & SETTINGS ALIGNMENT ENGINE (PHASE 21)
// ============================================================================

import { FOREX_PAIRS } from '../../markets/forex/instruments';
import { getSystemConfig, updateSystemConfig } from '../../services/configService';
import { fetchLiveForexNews } from '../../services/liveNewsService';
import { CombinedPredictionEngine } from './combinedPredictionEngine';
import { MultiFactorPredictionResult, PredictionHorizon } from './types';

export interface PairTradeStatus {
  pair: string;
  baseCurrency: string;
  quoteCurrency: string;
  isEnabledInSettings: boolean;
  statusCategory: 'RECOMMENDED_TRADE' | 'OPPORTUNITY_DISABLED_IN_SETTINGS' | 'AVOID_NO_TRADE' | 'INSUFFICIENT_DATA';
  recommendation: 'TRADE_BUY' | 'TRADE_SELL' | 'NO_TRADE' | 'INSUFFICIENT_DATA';
  direction: 'UP' | 'DOWN' | 'FLAT' | 'INSUFFICIENT_DATA';
  calibratedConfidence: number;
  expectedValuePips: number;
  newsSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  newsConflictScore: number;
  historicalSampleSize: number;
  historicalWinRate: number;
  regime: string;
  primaryReason: string;
  vetoReason?: string;
  actionRequired?: string;
  prediction: MultiFactorPredictionResult;
}

export interface UniverseScanResult {
  timestamp: number;
  horizon: PredictionHorizon;
  totalUniversePairs: number;
  enabledInSettingsCount: number;
  recommendedTradeCount: number;
  missedOpportunitiesCount: number;
  avoidNoTradeCount: number;
  recommendedTrades: PairTradeStatus[];
  missedOpportunities: PairTradeStatus[];
  avoidPairs: PairTradeStatus[];
  settingsMismatchAlert: boolean;
  summaryMessage: string;
}

export class UniversePredictionScanner {
  /**
   * Scans all supported Forex pairs and categorizes them into:
   * 1. Pairs to trade (enabled in settings)
   * 2. High-conviction pairs to trade but DISABLED in settings (missed opportunity alert)
   * 3. Pairs to avoid (with explicit veto reasons)
   */
  public static async scanUniverse(
    horizon: PredictionHorizon = '15M',
    cutoffTimestamp: number = Date.now()
  ): Promise<UniverseScanResult> {
    const config = getSystemConfig();
    const enabledPairsSet = new Set(
      (config.autoLiveForexPairs || []).map(p => p.toUpperCase().trim())
    );

    // Fetch latest live news once for the whole universe
    let newsArticles: any[] = [];
    try {
      const newsSnapshot = await fetchLiveForexNews({ forceRefresh: false });
      newsArticles = newsSnapshot?.articles || [];
    } catch {
      // Fallback gracefully if news provider is offline
    }

    const allPairs = FOREX_PAIRS.map(p => p.symbol);
    const pairStatuses: PairTradeStatus[] = [];

    for (const pair of allPairs) {
      const parts = pair.split('/');
      const baseCurrency = parts[0] || 'EUR';
      const quoteCurrency = parts[1] || 'USD';
      const isEnabled = enabledPairsSet.has(pair.toUpperCase());

      try {
        const pred = await CombinedPredictionEngine.predict({
          pair,
          horizon,
          newsArticles,
          cutoffTimestamp
        });

        let statusCategory: PairTradeStatus['statusCategory'] = 'AVOID_NO_TRADE';
        let actionRequired: string | undefined;

        const isTradeable = (pred.recommendation === 'TRADE_BUY' || pred.recommendation === 'TRADE_SELL') && pred.expectedValue > 0.5;

        if (isTradeable) {
          if (isEnabled) {
            statusCategory = 'RECOMMENDED_TRADE';
          } else {
            statusCategory = 'OPPORTUNITY_DISABLED_IN_SETTINGS';
            actionRequired = `Prediction model suggests ${pred.recommendation} on ${pair} (EV=+${pred.expectedValue} pips, ${(pred.calibratedConfidence * 100).toFixed(1)}% conf), but this pair is currently disabled in Auto Live settings. Enable ${pair} to capture this setup.`;
          }
        } else if (pred.recommendation === 'INSUFFICIENT_DATA') {
          statusCategory = 'INSUFFICIENT_DATA';
        } else {
          statusCategory = 'AVOID_NO_TRADE';
        }

        const primaryReason = pred.reasons[0] || pred.vetoReasons[0] || 'Evaluated against multi-factor evidence.';
        const vetoReason = pred.vetoReasons[0];

        pairStatuses.push({
          pair,
          baseCurrency,
          quoteCurrency,
          isEnabledInSettings: isEnabled,
          statusCategory,
          recommendation: pred.recommendation,
          direction: pred.direction,
          calibratedConfidence: pred.calibratedConfidence,
          expectedValuePips: pred.expectedValue,
          newsSentiment: pred.evidence.news.direction,
          newsConflictScore: pred.evidence.news.conflictScore,
          historicalSampleSize: pred.evidence.historical.sampleSize,
          historicalWinRate: pred.evidence.historical.winRate,
          regime: pred.regime,
          primaryReason,
          vetoReason,
          actionRequired,
          prediction: pred
        });
      } catch (err: any) {
        pairStatuses.push({
          pair,
          baseCurrency,
          quoteCurrency,
          isEnabledInSettings: isEnabled,
          statusCategory: 'AVOID_NO_TRADE',
          recommendation: 'NO_TRADE',
          direction: 'FLAT',
          calibratedConfidence: 0.50,
          expectedValuePips: 0,
          newsSentiment: 'NEUTRAL',
          newsConflictScore: 0,
          historicalSampleSize: 0,
          historicalWinRate: 0,
          regime: 'ERROR',
          primaryReason: `Failed to evaluate pair: ${err.message}`,
          vetoReason: `Evaluation error: ${err.message}`,
          prediction: null as any
        });
      }
    }

    const recommendedTrades = pairStatuses.filter(p => p.statusCategory === 'RECOMMENDED_TRADE');
    const missedOpportunities = pairStatuses.filter(p => p.statusCategory === 'OPPORTUNITY_DISABLED_IN_SETTINGS');
    const avoidPairs = pairStatuses.filter(p => p.statusCategory === 'AVOID_NO_TRADE' || p.statusCategory === 'INSUFFICIENT_DATA');

    const settingsMismatchAlert = missedOpportunities.length > 0;
    const summaryMessage = settingsMismatchAlert
      ? `Attention: ${missedOpportunities.length} high-conviction trade setups detected on pairs that are DISABLED in Auto Live settings (${missedOpportunities.map(m => m.pair).join(', ')}).`
      : recommendedTrades.length > 0
      ? `${recommendedTrades.length} pairs qualified for execution with verified positive expectancy.`
      : 'All pairs safely filtered to NO_TRADE. Preserving capital until statistical edge is established.';

    return {
      timestamp: cutoffTimestamp,
      horizon,
      totalUniversePairs: allPairs.length,
      enabledInSettingsCount: pairStatuses.filter(p => p.isEnabledInSettings).length,
      recommendedTradeCount: recommendedTrades.length,
      missedOpportunitiesCount: missedOpportunities.length,
      avoidNoTradeCount: avoidPairs.length,
      recommendedTrades,
      missedOpportunities,
      avoidPairs,
      settingsMismatchAlert,
      summaryMessage
    };
  }

  /**
   * Quick 1-click enable pair in system settings
   */
  public static enablePairInSettings(pair: string): { success: boolean; activePairs: string[] } {
    const config = getSystemConfig();
    const current = new Set((config.autoLiveForexPairs || []).map(p => p.toUpperCase().trim()));
    const normalized = pair.toUpperCase().trim();

    current.add(normalized);
    const updatedList = Array.from(current);

    updateSystemConfig({ autoLiveForexPairs: updatedList });

    return {
      success: true,
      activePairs: updatedList
    };
  }

  /**
   * Quick 1-click disable pair in system settings
   */
  public static disablePairInSettings(pair: string): { success: boolean; activePairs: string[] } {
    const config = getSystemConfig();
    const current = new Set((config.autoLiveForexPairs || []).map(p => p.toUpperCase().trim()));
    const normalized = pair.toUpperCase().trim();

    current.delete(normalized);
    const updatedList = Array.from(current);

    updateSystemConfig({ autoLiveForexPairs: updatedList });

    return {
      success: true,
      activePairs: updatedList
    };
  }
}
