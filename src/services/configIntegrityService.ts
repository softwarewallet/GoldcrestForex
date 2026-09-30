export interface ConfigIntegrityResult {
  ok: boolean;
  checks: Record<string, 'PASS' | 'FAIL'>;
  failures: string[];
}

export function evaluateSystemConfigIntegrity(config: any): ConfigIntegrityResult {
  const checks: Record<string, 'PASS' | 'FAIL'> = {};
  const failures: string[] = [];

  const record = (key: string, pass: boolean) => {
    checks[key] = pass ? 'PASS' : 'FAIL';
    if (!pass) {
      failures.push(key);
    }
  };

  if (!config || typeof config !== 'object') {
    return { ok: false, checks: {}, failures: ['config'] };
  }

  // 1. tradingMode
  record('tradingMode', config.tradingMode === 'LIVE_ONLY');

  // 2. cTraderApiMode
  record('cTraderApiMode', config.cTraderApiMode === 'LIVE' || config.cTraderApiMode === 'DEMO');

  // 3. liveTradingEnabled
  record('liveTradingEnabled', typeof config.liveTradingEnabled === 'boolean');

  // 4. defaultRiskPct
  const isRiskValid = typeof config.defaultRiskPct === 'number' &&
    Number.isFinite(config.defaultRiskPct) &&
    config.defaultRiskPct > 0 &&
    config.defaultRiskPct <= 100;
  record('defaultRiskPct', isRiskValid);

  // 5. maxDailyLossPct
  const isDailyLossValid = typeof config.maxDailyLossPct === 'number' &&
    Number.isFinite(config.maxDailyLossPct) &&
    config.maxDailyLossPct > 0 &&
    config.maxDailyLossPct <= 100;
  record('maxDailyLossPct', isDailyLossValid);

  // 6. maxOpenPositions (integer > 0)
  const isMaxOpenValid = typeof config.maxOpenPositions === 'number' &&
    Number.isInteger(config.maxOpenPositions) &&
    config.maxOpenPositions > 0;
  record('maxOpenPositions', isMaxOpenValid);

  // 7. maxTradesPerDay (integer > 0)
  const isMaxTradesValid = typeof config.maxTradesPerDay === 'number' &&
    Number.isInteger(config.maxTradesPerDay) &&
    config.maxTradesPerDay > 0;
  record('maxTradesPerDay', isMaxTradesValid);

  // 8. maxConsecutiveLosses (integer > 0)
  const isMaxLossesValid = typeof config.maxConsecutiveLosses === 'number' &&
    Number.isInteger(config.maxConsecutiveLosses) &&
    config.maxConsecutiveLosses > 0;
  record('maxConsecutiveLosses', isMaxLossesValid);

  // 9. maxSpreadBps (>= 0)
  const isSpreadValid = typeof config.maxSpreadBps === 'number' &&
    Number.isFinite(config.maxSpreadBps) &&
    config.maxSpreadBps >= 0;
  record('maxSpreadBps', isSpreadValid);

  // 10. signalCooldownMs (> 0)
  const isCooldownValid = typeof config.signalCooldownMs === 'number' &&
    Number.isFinite(config.signalCooldownMs) &&
    config.signalCooldownMs > 0;
  record('signalCooldownMs', isCooldownValid);

  // 11. eventProximityThresholdMinutes (>= 0)
  const isEventProximityValid = typeof config.eventProximityThresholdMinutes === 'number' &&
    Number.isFinite(config.eventProximityThresholdMinutes) &&
    config.eventProximityThresholdMinutes >= 0;
  record('eventProximityThresholdMinutes', isEventProximityValid);

  // 12. strikeDepth (integer > 0)
  const isStrikeDepthValid = typeof config.strikeDepth === 'number' &&
    Number.isInteger(config.strikeDepth) &&
    config.strikeDepth > 0;
  record('strikeDepth', isStrikeDepthValid);

  // 13. maxTradeValueForexUsd (> 0)
  const isForexValueValid = typeof config.maxTradeValueForexUsd === 'number' &&
    Number.isFinite(config.maxTradeValueForexUsd) &&
    config.maxTradeValueForexUsd > 0;
  record('maxTradeValueForexUsd', isForexValueValid);

  // 14. maxTradeValueIndianInr (> 0)
  const isIndianValueValid = typeof config.maxTradeValueIndianInr === 'number' &&
    Number.isFinite(config.maxTradeValueIndianInr) &&
    config.maxTradeValueIndianInr > 0;
  record('maxTradeValueIndianInr', isIndianValueValid);

  // 15. autoLiveMinSignalScore (0 to 100)
  const isMinScoreValid = typeof config.autoLiveMinSignalScore === 'number' &&
    Number.isFinite(config.autoLiveMinSignalScore) &&
    config.autoLiveMinSignalScore >= 0 &&
    config.autoLiveMinSignalScore <= 100;
  record('autoLiveMinSignalScore', isMinScoreValid);

  // 16. autoLiveMaxTradesPerPair (integer > 0)
  const isMaxTradesPerPairValid = typeof config.autoLiveMaxTradesPerPair === 'number' &&
    Number.isInteger(config.autoLiveMaxTradesPerPair) &&
    config.autoLiveMaxTradesPerPair > 0;
  record('autoLiveMaxTradesPerPair', isMaxTradesPerPairValid);

  // 17. forexStopLossPips (> 0)
  const isStopLossValid = typeof config.forexStopLossPips === 'number' &&
    Number.isFinite(config.forexStopLossPips) &&
    config.forexStopLossPips > 0;
  record('forexStopLossPips', isStopLossValid);

  // 18. forexTakeProfitPips (> 0)
  const isTakeProfitValid = typeof config.forexTakeProfitPips === 'number' &&
    Number.isFinite(config.forexTakeProfitPips) &&
    config.forexTakeProfitPips > 0;
  record('forexTakeProfitPips', isTakeProfitValid);

  // 19. autoLiveForexPairs (non-empty array, format XXX/YYY)
  const isForexPairsValid = Array.isArray(config.autoLiveForexPairs) &&
    config.autoLiveForexPairs.length > 0 &&
    config.autoLiveForexPairs.every((p: unknown) => typeof p === 'string' && /^[A-Z0-9]{3}\/[A-Z0-9]{3}$/.test(p));
  record('autoLiveForexPairs', isForexPairsValid);

  // 20. autoLiveIndianUnderlyings (non-empty array, alphanumeric uppercase)
  const isIndianUnderlyingsValid = Array.isArray(config.autoLiveIndianUnderlyings) &&
    config.autoLiveIndianUnderlyings.length > 0 &&
    config.autoLiveIndianUnderlyings.every((u: unknown) => typeof u === 'string' && /^[A-Z0-9]+$/.test(u));
  record('autoLiveIndianUnderlyings', isIndianUnderlyingsValid);

  // 21. financialDisclaimer (non-empty string)
  const isDisclaimerValid = typeof config.financialDisclaimer === 'string' &&
    config.financialDisclaimer.trim().length > 0;
  record('financialDisclaimer', isDisclaimerValid);

  return {
    ok: failures.length === 0,
    checks,
    failures,
  };
}
