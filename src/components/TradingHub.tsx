import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Activity, 
  ShieldCheck, 
  Radio, 
  ArrowRight, 
  AlertTriangle, 
  Play, 
  Pause, 
  Save, 
  Terminal as TerminalIcon, 
  Cpu, 
  Sparkles, 
  Send,
  CheckCircle2,
  XCircle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Target,
  X,
  ShieldAlert,
  Lock,
  Unlock,
  Flame,
  Check
} from 'lucide-react';
import { TradingEnvironment, BrokerType } from '../brokers/types';
import { OptionsTradingPanel } from './OptionsTradingPanel';

interface TradingHubProps {
  environment: TradingEnvironment;
  selectedBroker?: string;
  maskedAccount?: string;
  balance?: number;
  currency?: string;
  isEmergencyHalted: boolean;
  onRequestEnvironmentChange: (env: TradingEnvironment) => void;
}

interface TerminalLog {
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'warning' | 'nlp';
  message: string;
}

// Representing genuine live broker positions from /api/brokers/positions
interface RealPosition {
  id: string;
  broker: BrokerType;
  environment: TradingEnvironment;
  market: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  unrealizedPnL: number;
  realizedPnL: number;
  currency: string;
  timestamp: number;
}

// Representing actual scanned system signals from /api/signals
interface RealSignal {
  id: string;
  timestamp: number;
  market: string;
  instrument: string;
  direction: 'BUY' | 'SELL' | 'NO_TRADE';
  strategy: string;
  score: number;
  mlProbability: number;
  entryZone: { min: number; max: number; preferred: number };
  stopLoss: number;
  target1: number;
  status: string;
  reasons: string[];
}

export const TradingHub: React.FC<TradingHubProps> = ({ 
  environment, 
  selectedBroker = 'cTrader', 
  maskedAccount = 'ID-8849-LIVE', 
  balance = 148500.00, 
  currency = 'USD', 
  isEmergencyHalted 
}) => {
  // Manual Order Form States
  const [market, setMarket] = useState<string>('FOREX');
  const [symbol, setSymbol] = useState<string>('EUR/USD');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [quantity, setQuantity] = useState<number>(10000);
  const [price, setPrice] = useState<string>('');
  const [stopLoss, setStopLoss] = useState<string>('');
  const [takeProfit, setTakeProfit] = useState<string>('');
  const [isPlacingOrder, setIsPlacingOrder] = useState<boolean>(false);
  
  // Real Data Feeds State
  const [runningTrades, setRunningTrades] = useState<RealPosition[]>([]);
  const [plannedTrades, setPlannedTrades] = useState<RealSignal[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState<boolean>(true);
  const [isLoadingSignals, setIsLoadingSignals] = useState<boolean>(true);
  const [signalsAgeNow, setSignalsAgeNow] = useState<number>(Date.now());
  const [signalsScanCompletedAt, setSignalsScanCompletedAt] = useState<number | null>(null);
  const [signalScanStats, setSignalScanStats] = useState({ total: 0, actionable: 0, noTrade: 0, errors: 0 });

  const [logs, setLogs] = useState<TerminalLog[]>([
    {
      timestamp: new Date().toLocaleTimeString(),
      type: 'info',
      message: 'Autonomous Trading console connected to active Live adapters.'
    },
    {
      timestamp: new Date().toLocaleTimeString(),
      type: 'info',
      message: 'Background scanners synchronized with system scanner services.'
    }
  ]);

  // System Auto-Execution Instructions States
  const [autoInstruction, setAutoInstruction] = useState<string>(
    'Monitor multi-timeframe breakout patterns on key currency pairs (EUR/USD, GBP/USD) and execute buyer positions on RSI breakouts above 60 with strict trailing stop-losses.'
  );
  const [isAutoTradingActive, setIsAutoTradingActive] = useState<boolean>(true);
  const [isSavingInstructions, setIsSavingInstructions] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Triggering State & Notifications
  const [triggeringSignalId, setTriggeringSignalId] = useState<string | null>(null);
  const [triggerNotification, setTriggerNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  type AutoExecutionStage = 'IDLE' | 'SCANNING_MARKET' | 'ANALYZING_SIGNAL' | 'PREPARING_ORDER' | 'SAFETY_GATE' | 'SUBMITTING_ORDER' | 'TRADE_EXECUTED' | 'REJECTED';
  interface AutoTradingStatusSnapshot {
    state: 'STOPPED' | 'PREPARING' | 'RUNNING' | 'BLOCKED';
    autonomousPermission: boolean;
    minSignalScore: number;
    maxTradesPerPair: number;
    maxOpenPositions: number;
    lastCycleAt: number | null;
    lastCycleResult: string | null;
    lastActions: Array<{
      pair: string;
      result: string;
      signalId?: string;
      reason?: string;
      orderId?: string;
    }>;
    currentExecution: {
      stage: AutoExecutionStage;
      pair: string | null;
      side: 'BUY' | 'SELL' | null;
      signalId: string | null;
      message: string;
      updatedAt: number;
    };
    lastExecution: {
      stage: AutoExecutionStage;
      pair: string | null;
      side: 'BUY' | 'SELL' | null;
      signalId: string | null;
      message: string;
      updatedAt: number;
    } | null;
    continuity?: {
      consecutiveLossCount: number;
      consecutiveProfitCount: number;
      lossLimitThreshold: number;
      profitAutoContinuityThreshold: number;
      isContinuityPaused: boolean;
      requiresContinuityAuthorization: boolean;
      isProfitContinuityActive: boolean;
      lastAuthorization: {
        authorizedAt: number | null;
        authorizedBy: string | null;
        note?: string | null;
      } | null;
      lastOutcome: {
        id: string;
        symbol: string;
        pnl: number;
        outcome: 'PROFIT' | 'LOSS' | 'BREAKEVEN';
        timestamp: number;
      } | null;
      message: string;
    };
  }
  const [activeTab, setActiveTab] = useState<'cockpit' | 'positions' | 'signals' | 'options' | 'execution' | 'controls' | 'predictions'>('cockpit');
  const [autoStatus, setAutoStatus] = useState<AutoTradingStatusSnapshot | null>(null);
  const [autoStatusError, setAutoStatusError] = useState<string | null>(null);
  const [dailyLossLimitPct, setDailyLossLimitPct] = useState<number>(3);
  const [dailyLossSaving, setDailyLossSaving] = useState<boolean>(false);
  const [dailyLossSaveMessage, setDailyLossSaveMessage] = useState<string | null>(null);
  const [isAuthorizingContinuity, setIsAuthorizingContinuity] = useState<boolean>(false);
  const [continuityOperatorNote, setContinuityOperatorNote] = useState<string>('');
  const [continuityNotification, setContinuityNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Predictions & Evidence state
  const [predictionPair, setPredictionPair] = useState<string>('EUR/USD');
  const [predictionHorizon, setPredictionHorizon] = useState<string>('15M');
  const [predictionResult, setPredictionResult] = useState<any | null>(null);
  const [evaluatingPrediction, setEvaluatingPrediction] = useState<boolean>(false);
  const [walkForwardPair, setWalkForwardPair] = useState<string>('EUR/USD');
  const [walkForwardReport, setWalkForwardReport] = useState<any | null>(null);
  const [runningWalkForward, setRunningWalkForward] = useState<boolean>(false);
  const [predictionHistory, setPredictionHistory] = useState<any[]>([]);
  const [predictionMode, setPredictionMode] = useState<string>('SHADOW');
  const [universeScan, setUniverseScan] = useState<any | null>(null);
  const [scanningUniverse, setScanningUniverse] = useState<boolean>(false);
  const [togglingPair, setTogglingPair] = useState<string | null>(null);

  // Helper to append telemetry console logs
  const addLog = useCallback((type: 'info' | 'success' | 'error' | 'warning' | 'nlp', message: string) => {
    setLogs(prev => [
      {
        timestamp: new Date().toLocaleTimeString(),
        type,
        message
      },
      ...prev
    ].slice(0, 100)); // Maintain last 100 entries
  }, []);

  // Safe JSON parsing helper to prevent unexpected token '<' exceptions from non-JSON gateway error pages
  const safeParseJson = useCallback(async (res: Response): Promise<any> => {
    const text = await res.text();
    const contentType = res.headers.get('content-type') || 'unknown';
    const goldcrestRoute = res.headers.get('x-goldcrest-route');
    try {
      return JSON.parse(text);
    } catch {
      if (text.includes('<!DOCTYPE') || text.includes('<!doctype') || text.includes('<html')) {
        throw new Error(
          goldcrestRoute === 'broker-order-live'
            ? `Goldcrest order endpoint returned HTTP ${res.status} HTML unexpectedly (content-type: ${contentType}).`
            : `HTTP ${res.status} returned HTML instead of the Goldcrest API JSON route (content-type: ${contentType}). The request may be hitting a stale/proxy/Vite process.`
        );
      }
      throw new Error(text.substring(0, 150) || `Server returned status ${res.status}`);
    }
  }, []);

  // Fetch positions from /api/brokers/positions
  const fetchRealPositions = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoadingPositions(true);
    try {
      const res = await fetch('/api/brokers/positions');
      if (res.ok) {
        const data = await safeParseJson(res);
        if (Array.isArray(data)) {
          setRunningTrades(data);
        }
      } else {
        throw new Error('Positions endpoint returned non-ok status');      }
    } catch (err: any) {
      console.warn('Failed to load real broker positions:', err);
    } finally {
      setIsLoadingPositions(false);
    }
  }, [safeParseJson]);

  // Fetch signals from /api/signals
  const fetchRealSignals = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoadingSignals(true);
    try {
      const res = await fetch('/api/signals');
      if (res.ok) {
        const data = await safeParseJson(res);
        if (Array.isArray(data)) {
          const actionable = data.filter((signal: RealSignal) => ['BUY', 'SELL'].includes(String(signal.direction || '').toUpperCase()));
          const noTrade = data.filter((signal: RealSignal) => String(signal.direction || '').toUpperCase() === 'NO_TRADE');
          const errors = data.filter((signal: RealSignal) => !signal || !signal.direction || String(signal.status || '').toUpperCase() === 'ERROR');
          setSignalScanStats({ total: data.length, actionable: actionable.length, noTrade: noTrade.length, errors: errors.length });
          setPlannedTrades(actionable);
          // Start the freshness counter only after the complete signal scan/fetch has finished.
          // This measures scanner-result age, not the timestamp embedded in an individual signal.
          setSignalsScanCompletedAt(Date.now());
        }
      } else {
        throw new Error('Signals endpoint returned non-ok status');
      }
    } catch (err: any) {
      console.warn('Failed to load real trading signals:', err);
    } finally {
      setIsLoadingSignals(false);
    }
  }, [safeParseJson]);

  // Synchronize with backend system controls
  const syncAutoControls = useCallback(async (enabled: boolean) => {
    try {
      const res = await fetch('/api/brokers/controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoExecutionEnabled: enabled })
      });
      if (res.ok) {
        addLog('info', `Autonomous execution mode toggled on backend: ${enabled ? 'ACTIVE' : 'INACTIVE'}`);
      }
    } catch (err: any) {
      addLog('error', `Failed to sync autonomous status with system: ${err.message}`);
    }
  }, [addLog]);

  // Poll the authoritative Auto Live lifecycle so the cockpit reflects the server-side execution state.
  useEffect(() => {
    let mounted = true;
    const fetchAutoStatus = async () => {
      try {
        const res = await fetch('/api/brokers/controls', { cache: 'no-store' });
        if (!res.ok) throw new Error('Auto Live status endpoint returned HTTP ' + res.status);
        const data = await safeParseJson(res);
        if (mounted && data?.autoTrading) {
          setAutoStatus(data.autoTrading);
          setAutoStatusError(null);
        }
      } catch (err: any) {
        if (mounted) setAutoStatusError(err?.message || 'Auto Live status unavailable');
      }
    };
    void fetchAutoStatus();
    const statusTimer = setInterval(fetchAutoStatus, 2000);
    return () => { mounted = false; clearInterval(statusTimer); };
  }, [safeParseJson]);

  const saveDailyLossLimit = useCallback(async () => {
    const value = Number(dailyLossLimitPct);
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      setDailyLossSaveMessage('Daily loss limit must be greater than 0% and no greater than 100%.');
      return;
    }
    setDailyLossSaving(true);
    setDailyLossSaveMessage(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxDailyLossPct: value })
      });
      const data = await safeParseJson(res);
      if (!res.ok) throw new Error(data?.error || data?.message || 'Failed to save daily loss limit.');
      setDailyLossLimitPct(Number(data.maxDailyLossPct));
      setDailyLossSaveMessage(`Saved: ${Number(data.maxDailyLossPct).toFixed(2)}% of account balance.`);
      addLog('success', `Daily loss limit updated to ${Number(data.maxDailyLossPct).toFixed(2)}%.`);
    } catch (err: any) {
      setDailyLossSaveMessage(err?.message || 'Failed to save daily loss limit.');
      addLog('error', `Daily loss limit update failed: ${err?.message || String(err)}`);
    } finally {
      setDailyLossSaving(false);
    }
  }, [dailyLossLimitPct, safeParseJson, addLog]);

  // Load the persisted risk setting once. Do not refresh it from the backend
  // on the 2-second Auto Live status poll, otherwise an unsaved operator edit
  // would be overwritten by the persisted value.
  useEffect(() => {
    let mounted = true;
    fetch('/api/config', { cache: 'no-store' })
      .then(async (res) => res.ok ? await safeParseJson(res) : null)
      .then((config) => {
        const configuredLimit = Number(config?.maxDailyLossPct);
        if (mounted && Number.isFinite(configuredLimit) && configuredLimit > 0) {
          setDailyLossLimitPct(configuredLimit);
        }
      })
      .catch((err) => console.warn('Failed to load persisted daily loss limit:', err))
    return () => { mounted = false; };
  }, [safeParseJson]);

  const handleAuthorizeContinuity = useCallback(async () => {
    setIsAuthorizingContinuity(true);
    setContinuityNotification(null);
    try {
      const res = await fetch('/api/auto-trading/authorize-continuity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operatorId: maskedAccount || 'OPERATOR',
          note: continuityOperatorNote || 'User authorized continuity from Cockpit'
        })
      });
      const data = await safeParseJson(res);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || data?.message || 'Failed to authorize continuity.');
      }
      setContinuityNotification({
        type: 'success',
        message: 'Continuity authorized. Auto Live trade execution has resumed.'
      });
      addLog('success', 'TRADE CONTINUITY AUTHORIZED: Circuit breaker cleared by operator. Auto-execution resumed.');
      if (data?.autoTrading) {
        setAutoStatus(data.autoTrading);
      }
      setContinuityOperatorNote('');
    } catch (err: any) {
      const msg = err?.message || 'Authorization failed';
      setContinuityNotification({ type: 'error', message: msg });
      addLog('error', `Continuity Authorization Error: ${msg}`);
    } finally {
      setIsAuthorizingContinuity(false);
    }
  }, [maskedAccount, continuityOperatorNote, safeParseJson, addLog]);

  const handleSimulateStreak = useCallback(async (pnl: number, count = 1) => {
    try {
      let latestAutoTrading = null;
      for (let i = 0; i < count; i++) {
        const res = await fetch('/api/auto-trading/simulate-outcome', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pnl, symbol: 'EUR/USD' })
        });
        const data = await safeParseJson(res);
        if (data?.autoTrading) latestAutoTrading = data.autoTrading;
      }
      if (latestAutoTrading) {
        setAutoStatus(latestAutoTrading);
      }
      addLog(pnl > 0 ? 'success' : 'warning', `Simulated ${count} trade outcome(s): ${pnl > 0 ? '+' : ''}$${pnl}`);
    } catch (err: any) {
      addLog('error', `Simulation failed: ${err?.message || String(err)}`);
    }
  }, [safeParseJson, addLog]);

  // Initial load and polling setup
  useEffect(() => {
    fetchRealPositions();
    fetchRealSignals();

    const positionsInterval = setInterval(() => {
      fetchRealPositions(true);
    }, 10000);

    const signalsInterval = setInterval(() => {
      fetchRealSignals(true);
    }, 30000);

    return () => {
      clearInterval(positionsInterval);
      clearInterval(signalsInterval);
    };
  }, [fetchRealPositions, fetchRealSignals]);

  const handleEvaluatePrediction = useCallback(async (pairToEval: string = predictionPair) => {
    setEvaluatingPrediction(true);
    try {
      const res = await fetch('/api/prediction/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair: pairToEval, horizon: predictionHorizon })
      });
      const data = await safeParseJson(res);
      if (data?.success && data?.prediction) {
        setPredictionResult(data.prediction);
        addLog('info', `Multi-factor prediction generated for ${pairToEval}: ${data.prediction.direction} (${(data.prediction.calibratedConfidence * 100).toFixed(1)}% conf, EV=${data.prediction.expectedValue} pips) -> ${data.prediction.recommendation}`);
      } else {
        throw new Error(data?.error || 'Failed to evaluate prediction');
      }
    } catch (err: any) {
      addLog('error', `Prediction error for ${pairToEval}: ${err.message}`);
    } finally {
      setEvaluatingPrediction(false);
    }
  }, [predictionPair, predictionHorizon, safeParseJson, addLog]);

  const handleRunWalkForward = useCallback(async (pairToTest: string = walkForwardPair) => {
    setRunningWalkForward(true);
    setWalkForwardReport(null);
    try {
      const res = await fetch('/api/prediction/walk-forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair: pairToTest, candlesCount: 200, windowSize: 50, stepSize: 20 })
      });
      const data = await safeParseJson(res);
      if (data?.success && data?.report) {
        setWalkForwardReport(data.report);
        addLog('success', `Walk-forward validation completed for ${pairToTest} across ${data.report.validationWindows} windows.`);
      } else {
        throw new Error(data?.error || 'Failed to execute walk-forward validation');
      }
    } catch (err: any) {
      addLog('error', `Walk-forward validation error: ${err.message}`);
    } finally {
      setRunningWalkForward(false);
    }
  }, [walkForwardPair, safeParseJson, addLog]);

  const handleScanUniverse = useCallback(async () => {
    setScanningUniverse(true);
    try {
      const res = await fetch(`/api/prediction/universe-scan?horizon=${predictionHorizon}`);
      const data = await safeParseJson(res);
      if (data?.success && data?.scan) {
        setUniverseScan(data.scan);
        addLog('info', `Universe prediction scan complete: ${data.scan.recommendedTradeCount} tradeable, ${data.scan.missedOpportunitiesCount} disabled opportunities, ${data.scan.avoidNoTradeCount} avoided.`);
      } else {
        throw new Error(data?.error || 'Failed to scan universe');
      }
    } catch (err: any) {
      addLog('error', `Universe scan error: ${err.message}`);
    } finally {
      setScanningUniverse(false);
    }
  }, [predictionHorizon, safeParseJson, addLog]);

  const handleTogglePairInSettings = useCallback(async (pair: string, currentEnabled: boolean) => {
    setTogglingPair(pair);
    try {
      const endpoint = currentEnabled ? '/api/prediction/disable-pair' : '/api/prediction/enable-pair';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair })
      });
      const data = await safeParseJson(res);
      if (data?.success) {
        addLog('success', `Settings updated: ${pair} is now ${currentEnabled ? 'DISABLED' : 'ENABLED'} in Auto Live settings.`);
        // Dispatch global event so Settings tab reloads immediately
        window.dispatchEvent(new CustomEvent('goldcrest:settings-updated'));
        // Refresh universe scan and autoStatus
        handleScanUniverse();
        try {
          const controlsRes = await fetch('/api/brokers/controls', { cache: 'no-store' });
          const controlsData = await safeParseJson(controlsRes);
          if (controlsData?.autoTrading) setAutoStatus(controlsData.autoTrading);
        } catch {}
      } else {
        throw new Error(data?.error || 'Failed to update pair setting');
      }
    } catch (err: any) {
      addLog('error', `Error updating setting for ${pair}: ${err.message}`);
    } finally {
      setTogglingPair(null);
    }
  }, [handleScanUniverse, safeParseJson, addLog]);

  const fetchPredictionStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/prediction/status');
      const data = await safeParseJson(res);
      if (data?.mode) setPredictionMode(data.mode);
      if (Array.isArray(data?.recentPredictions)) setPredictionHistory(data.recentPredictions);
    } catch {}
  }, [safeParseJson]);

  useEffect(() => {
    if (activeTab === 'predictions') {
      fetchPredictionStatus();
      if (!predictionResult) {
        handleEvaluatePrediction(predictionPair);
      }
      if (!universeScan) {
        handleScanUniverse();
      }
    }
  }, [activeTab, fetchPredictionStatus, handleEvaluatePrediction, handleScanUniverse, predictionPair, predictionResult, universeScan]);

  // Keep the displayed record-age counter moving once per second without refetching.
  useEffect(() => {
    const ageTimer = setInterval(() => setSignalsAgeNow(Date.now()), 1000);
    return () => clearInterval(ageTimer);
  }, []);

  const formatAge = useCallback((timestamp: number | undefined | null): string => {
    if (!timestamp || !Number.isFinite(Number(timestamp))) return 'N/A';
    const ageSeconds = Math.max(0, Math.floor((signalsAgeNow - Number(timestamp)) / 1000));
    if (ageSeconds < 60) return ageSeconds + 's';
    const minutes = Math.floor(ageSeconds / 60);
    const seconds = ageSeconds % 60;
    if (minutes < 60) return minutes + 'm ' + seconds + 's';
    const hours = Math.floor(minutes / 60);
    return hours + 'h ' + (minutes % 60) + 'm';
  }, [signalsAgeNow]);

  const visiblePlannedTrades = useMemo(
    () => plannedTrades.filter(signal => String(signal.direction || '').toUpperCase() !== 'NO_TRADE'),
    [plannedTrades]
  );

  // All rows belong to the same completed scanner pass, so their displayed age is
  // measured from the time that pass completed. This prevents an old signal timestamp
  // from consuming the execution freshness window before the scanner has finished.

  // Handle market change configuration
  const handleMarketChange = (newMarket: string) => {
    setMarket(newMarket);
    if (newMarket === 'FOREX') {
      setSymbol('EUR/USD');
      setQuantity(10000);
    } else if (newMarket === 'INDIAN_EQUITY') {
      setSymbol('RELIANCE');
      setQuantity(50);
    } else {
      setSymbol('NIFTY');
      setQuantity(1);
    }
  };

  // Submit direct manual trade order
  const handleExecuteTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEmergencyHalted) {
      addLog('error', 'Execution Intercepted: Emergency Kill Switch is ACTIVE. New orders are blocked.');
      return;
    }

    setIsPlacingOrder(true);
    const idempotencyKey = globalThis.crypto.randomUUID();
    addLog('info', `Routing manual order: ${side} ${quantity} ${symbol} via ${market} gateway...`);

    try {
      // Verify that this browser is talking to the current Goldcrest Express
      // backend before submitting a live order. Do not retry an order blindly:
      // the idempotency key must remain unique for every operator action.
      const runtimeRes = await fetch('/api/runtime', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const runtimeContentType = runtimeRes.headers.get('content-type') || '';
      if (!runtimeRes.ok || !runtimeContentType.includes('application/json')) {
        throw new Error(
          `Goldcrest backend runtime probe failed (HTTP ${runtimeRes.status}, content-type: ${runtimeContentType || 'unknown'}). Restart the current Node server on port 3000.`
        );
      }

      const payload = {
        market,
        symbol,
        side,
        orderType,
        quantity: Number(quantity),
        price: orderType === 'LIMIT' && price ? Number(price) : undefined,
        stopLoss: stopLoss ? Number(stopLoss) : undefined,
        takeProfit: takeProfit ? Number(takeProfit) : undefined,
        environment,
        signalId: idempotencyKey,
        executionSource: 'TRIGGER_NOW'
      };

      const res = await fetch('/api/brokers/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      const data = await safeParseJson(res);

      if (!res.ok) {
        throw new Error(data.error || data.reason || 'Failed to execute order');
      }

      const executionStatus = String(data.order?.status || data.executionState || 'UNKNOWN').toUpperCase();
      addLog(
        executionStatus === 'FILLED' ? 'success' : 'info',
        `ORDER ${executionStatus}: Ref ID ${data.order?.id || data.executionId || idempotencyKey} - Dispatched to ${data.broker || 'Live Adapter'}`
      );
      
      // Instantly trigger re-fetch to show new position/orders
      fetchRealPositions();
    } catch (err: any) {
      addLog('error', `Execution Failed: ${err.message}`);    } finally {
      setIsPlacingOrder(false);
    }
  };

  // Compile instructions and update auto execution state
  const handleSaveAutoInstructions = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingInstructions(true);
    setSaveMessage(null);

    addLog('info', '[NLP ENGINE] Analyzing natural language parameters...');
    addLog('info', `[NLP ENGINE] Actively registering rules for: "${autoInstruction.slice(0, 60)}..."`);

    try {
      // Post actual configuration updates to the backend controls API
      const res = await fetch('/api/brokers/controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoExecutionEnabled: isAutoTradingActive,
          autonomousLiveExecutionAllowed: isAutoTradingActive
        })
      });

      if (!res.ok) {
        throw new Error('Failed to save controls');
      }

      setSaveMessage('System Instructions successfully compiled and active on the backend processor!');
      addLog('success', 'AUTO SYSTEM CONFIGURED: Target scanner active using the persisted Auto Live execution rules.');
      fetchRealSignals();
    } catch (err: any) {
      addLog('error', `Failed to apply strategy parameters: ${err.message}`);
    } finally {
      setIsSavingInstructions(false);
    }
  };

  // Close live broker position
  const handleClosePosition = async (positionId: string, broker: BrokerType) => {
    addLog('info', `Sending close request for Position ${positionId} on ${broker}...`);
    try {
      const res = await fetch(`/api/brokers/position/${encodeURIComponent(positionId)}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker })
      });
      const data = await safeParseJson(res);
      if (res.ok && data.success) {
        addLog('success', `Position ${positionId} closed successfully. Real-time liquidation confirmed.`);
        fetchRealPositions();
      } else {
        throw new Error(data.error || 'Failed to close position on broker gateway');
      }
    } catch (err: any) {
      addLog('error', `Liquidation Failed: ${err.message}`);
    }
  };

  // Execute immediate order placement directly from a planned signal
  const triggerSignalExecution = async (signal: RealSignal) => {
    // 1. Resolve effective trade direction from signal direction, SL/TP structure, or strategy bias
    let orderSide: 'BUY' | 'SELL' = 'BUY';
    const rawDir = String(signal.direction || '').toUpperCase();
    if (rawDir.includes('BUY') || rawDir.includes('LONG')) {
      orderSide = 'BUY';
    } else if (rawDir.includes('SELL') || rawDir.includes('SHORT')) {
      orderSide = 'SELL';
    } else if (signal.stopLoss && signal.target1 && signal.stopLoss > 0 && signal.target1 > 0) {
      // If stopLoss > target1, it's a short (SELL) setup; if below, it's a long (BUY) setup
      orderSide = signal.stopLoss > signal.target1 ? 'SELL' : 'BUY';
    } else if (Array.isArray(signal.reasons) && signal.reasons.some(r => /bear|short|sell|down/i.test(r))) {
      orderSide = 'SELL';
    } else {
      orderSide = 'BUY';
    }

    addLog('nlp', `[SIGNAL DISPATCH] Operator triggered immediate execution for ${signal.instrument} (${orderSide})`);
    setTriggeringSignalId(signal.id);
    setTriggerNotification(null);

    const idempotencyKey = `${signal.id}:${globalThis.crypto.randomUUID()}`;
    try {
      // Trigger Now uses the same live order API as the manual ticket. Verify the
      // browser is connected to the current Express backend before dispatching.
      // Never retry a live order automatically after an ambiguous response.
      const runtimeRes = await fetch('/api/runtime', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const runtimeContentType = runtimeRes.headers.get('content-type') || '';
      if (!runtimeRes.ok || !runtimeContentType.includes('application/json')) {
        throw new Error(
          `Goldcrest backend runtime probe failed (HTTP ${runtimeRes.status}, content-type: ${runtimeContentType || 'unknown'}). Restart the current Node server on port 3000.`
        );
      }

      const payload = {
        market: signal.market,
        symbol: signal.instrument,
        side: orderSide,
        orderType: 'MARKET',
        quantity: signal.market === 'FOREX' ? 10000 : 25,
        stopLoss: signal.stopLoss && signal.stopLoss > 0 ? signal.stopLoss : undefined,
        takeProfit: signal.target1 && signal.target1 > 0 ? signal.target1 : undefined,
        environment,
        signalId: idempotencyKey
      };

      const res = await fetch('/api/brokers/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      const data = await safeParseJson(res);
      if (!res.ok) {
        const errorMsg = data?.error || data?.message || `Signal trigger submission rejected (HTTP ${res.status})`;
        const detailsMsg = data.details?.length ? ` (${data.details.join(', ')})` : '';
        throw new Error(`${errorMsg}${detailsMsg}`);
      }

      const executionStatus = String(data.order?.status || data.executionState || 'SUBMITTED').toUpperCase();
      const orderRef = data.order?.id || data.executionId || idempotencyKey;
      
      addLog(
        executionStatus === 'FILLED' || executionStatus === 'EXECUTED' ? 'success' : 'info',
        `SIGNAL ORDER ${executionStatus}: ${signal.instrument} ${orderSide} - Ref ID ${orderRef}`
      );

      setTriggerNotification({
        type: 'success',
        message: `Order submitted for ${signal.instrument} [${orderSide}] (Status: ${executionStatus}, Ref: ${orderRef})`
      });

      fetchRealPositions();
    } catch (err: any) {
      const errMsg = err.message || 'Failed to dispatch signal order';
      addLog('error', `Trigger Dispatch Error (${signal.instrument}): ${errMsg}`);
      setTriggerNotification({
        type: 'error',
        message: `${signal.instrument}: ${errMsg}`
      });
    } finally {
      setTriggeringSignalId(null);
    }
  };

  const executionStage: AutoExecutionStage = autoStatus?.currentExecution?.stage || 'IDLE';
  const executionPair = autoStatus?.currentExecution?.pair;
  const executionSide = autoStatus?.currentExecution?.side;
  const executionMessage = autoStatus?.currentExecution?.message || 'Waiting for the next Auto Live cycle.';
  const stageLabel: Record<AutoExecutionStage, string> = {
    IDLE: 'STANDBY',
    SCANNING_MARKET: 'SCANNING MARKET',
    ANALYZING_SIGNAL: 'ANALYZING SIGNAL',
    PREPARING_ORDER: 'PREPARING ORDER',
    SAFETY_GATE: 'SAFETY GATE',
    SUBMITTING_ORDER: 'SUBMITTING ORDER',
    TRADE_EXECUTED: 'TRADE EXECUTED',
    REJECTED: 'REJECTED'
  };
  const renderTabs = () => (
    <div className="flex flex-wrap gap-2 border-b border-slate-800" style={{ paddingBottom: '5px', marginBottom: '5px' }}>
      {[
        ['cockpit', 'Auto Live'],
        ['positions', 'Positions'],
        ['signals', 'Signals'],
        ['predictions', 'Predictions & Evidence'],
        ['execution', 'Execution Log'],
        ['controls', 'Controls']
      ].map(([id, label]) => (
        <button key={id} type="button" onClick={() => setActiveTab(id as typeof activeTab)}
          className={"px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition " +
            (activeTab === id ? "bg-cyan-950 text-cyan-300 border-cyan-700" : "bg-slate-950 text-slate-400 border-slate-800 hover:text-white")}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div id="unified_trading_hub" className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg" style={{ paddingTop: '5px', paddingBottom: '5px', marginBottom: '5px' }}>
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <div className="text-white font-bold text-base">Auto Live Trading Cockpit</div>
            <div className="text-slate-500 text-xs font-mono mt-1">Operational view for live execution only.</div>
          </div>
          <div className="flex flex-wrap gap-2 font-mono text-[11px]">
            <span className={"px-3 py-1 rounded-lg border font-bold " +
              (autoStatus?.continuity?.isContinuityPaused ? "text-rose-300 bg-rose-950/80 border-rose-600 animate-pulse" :
               autoStatus?.state === 'RUNNING' ? "text-emerald-300 bg-emerald-950/60 border-emerald-800" :
               autoStatus?.state === 'BLOCKED' ? "text-rose-300 bg-rose-950/60 border-rose-800" :
               "text-amber-300 bg-amber-950/60 border-amber-800")}>
              {autoStatus?.continuity?.isContinuityPaused ? 'AUTO LIVE: PAUSED (20 LOSSES)' : `AUTO LIVE: ${autoStatus?.state || 'LOADING'}`}
            </span>
            <span className="px-3 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300">{selectedBroker} · LIVE</span>
          </div>
        </div>
      </div>

      {renderTabs()}

      {activeTab === 'cockpit' && (
        <>
          {/* SECTION: TRADE CONTINUITY & CONSECUTIVE CIRCUIT BREAKER */}
          {autoStatus?.continuity?.isContinuityPaused ? (
            <div className="bg-rose-950/30 border-2 border-rose-600 rounded-xl p-5 shadow-2xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-rose-800/60 pb-3">
                <div className="flex items-center space-x-3">
                  <AlertTriangle className="w-6 h-6 text-rose-400 animate-pulse shrink-0" />
                  <div>
                    <h3 className="text-base font-bold text-white uppercase tracking-wider font-mono">
                      Consecutive Loss Circuit Breaker Activated
                    </h3>
                    <p className="text-xs text-rose-300 font-mono mt-0.5">
                      New trade execution is paused: constant 20 losing trades reached.
                    </p>
                  </div>
                </div>
                <div className="px-3 py-1 rounded-full text-xs font-bold font-mono bg-rose-900 border border-rose-500 text-rose-200 shrink-0">
                  AUTHORIZATION REQUIRED
                </div>
              </div>

              <div className="bg-slate-950/70 border border-rose-900/60 rounded-lg p-3 text-xs text-slate-300 leading-relaxed font-mono">
                The autonomous engine recorded <strong>{autoStatus.continuity.consecutiveLossCount} consecutive losing trades</strong>.
                In accordance with system invariants, the system has paused executing new trades.
                An operator must review current market conditions and authorize continuity to resume automated trading.
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
                <div className="bg-slate-900/80 border border-rose-800/80 p-3 rounded-xl">
                  <div className="text-slate-400 text-[10px]">LOSING STREAK</div>
                  <div className="text-xl font-bold text-rose-400 mt-1">{autoStatus.continuity.consecutiveLossCount} / 20</div>
                  <div className="text-[10px] text-rose-300 mt-0.5">Limit Hit (Paused)</div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl">
                  <div className="text-slate-400 text-[10px]">WINNING STREAK</div>
                  <div className="text-xl font-bold text-white mt-1">{autoStatus.continuity.consecutiveProfitCount} / 10</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Auto-Continue @ 10</div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl">
                  <div className="text-slate-400 text-[10px]">CIRCUIT RULE</div>
                  <div className="text-xs font-bold text-amber-400 mt-1">20 LOSSES = PAUSE</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">10 Wins = Auto-Resume</div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl">
                  <div className="text-slate-400 text-[10px]">EXECUTION STATUS</div>
                  <div className="text-xs font-bold text-rose-400 mt-1">LOCKED</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Pending Authorization</div>
                </div>
              </div>

              {continuityNotification && (
                <div className={`p-3 rounded-lg border text-xs font-mono ${
                  continuityNotification.type === 'success'
                    ? 'border-emerald-700 bg-emerald-950/60 text-emerald-200'
                    : 'border-rose-700 bg-rose-950/60 text-rose-200'
                }`}>
                  {continuityNotification.message}
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
                <input
                  type="text"
                  placeholder="Optional operator notes (e.g. Market volatility settled; authorizing continuity)..."
                  value={continuityOperatorNote}
                  onChange={e => setContinuityOperatorNote(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-rose-500"
                />
                <button
                  type="button"
                  onClick={handleAuthorizeContinuity}
                  disabled={isAuthorizingContinuity}
                  className="px-5 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs font-mono shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <Unlock className="w-4 h-4" />
                  <span>{isAuthorizingContinuity ? 'AUTHORIZING...' : 'AUTHORIZE CONTINUITY & RESUME TRADING'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3 font-mono text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <div className="flex items-center space-x-2">
                  {autoStatus?.continuity?.isProfitContinuityActive ? (
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  )}
                  <span className="font-bold text-slate-200 uppercase tracking-wider text-xs">
                    Trade Continuity & Streak Circuit Breaker
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {autoStatus?.continuity?.isProfitContinuityActive ? (
                    <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-emerald-950 border border-emerald-600 text-emerald-300">
                      10+ PROFIT TRADES ACTIVE (AUTO-CONTINUITY)
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-slate-950 border border-slate-700 text-slate-300">
                      MONITORED: 20-LOSS PAUSE / 10-PROFIT AUTO-CONTINUE
                    </span>
                  )}
                </div>
              </div>

              {autoStatus?.continuity?.isProfitContinuityActive && (
                <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    Continuity of 10+ profit trades achieved ({autoStatus.continuity.consecutiveProfitCount} consecutive wins).
                    System is continuing to execute trades automatically.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-slate-500 text-[10px]">LOSING STREAK</div>
                  <div className="text-base font-bold text-white mt-0.5">
                    {autoStatus?.continuity?.consecutiveLossCount ?? 0} / 20
                  </div>
                  <div className="text-[9px] text-slate-500">Pauses at 20</div>
                </div>
                <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-slate-500 text-[10px]">WINNING STREAK</div>
                  <div className="text-base font-bold text-emerald-400 mt-0.5">
                    {autoStatus?.continuity?.consecutiveProfitCount ?? 0} / 10
                  </div>
                  <div className="text-[9px] text-slate-500">Auto-continues at 10</div>
                </div>
                <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-slate-500 text-[10px]">CIRCUIT ACTION</div>
                  <div className="text-xs font-bold text-cyan-300 mt-0.5">AUTO-GUARDED</div>
                  <div className="text-[9px] text-slate-500">20L: Pause · 10W: Auto</div>
                </div>
                <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-slate-500 text-[10px]">TEST CONTROLS</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <button
                      type="button"
                      onClick={() => handleSimulateStreak(-10, 1)}
                      className="px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-800 text-[9px] text-rose-300 hover:bg-rose-900"
                      title="Simulate 1 losing trade"
                    >
                      +1 Loss
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSimulateStreak(25, 1)}
                      className="px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800 text-[9px] text-emerald-300 hover:bg-emerald-900"
                      title="Simulate 1 winning trade"
                    >
                      +1 Win
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSimulateStreak(-10, 20)}
                      className="px-1.5 py-0.5 rounded bg-rose-900/80 border border-rose-600 text-[9px] text-white hover:bg-rose-800 font-bold"
                      title="Simulate 20 consecutive losing trades to trigger circuit breaker"
                    >
                      Test 20 Losses
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSimulateStreak(25, 10)}
                      className="px-1.5 py-0.5 rounded bg-emerald-900/80 border border-emerald-600 text-[9px] text-white hover:bg-emerald-800 font-bold"
                      title="Simulate 10 consecutive winning trades to trigger auto-continue"
                    >
                      Test 10 Wins
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5" style={{ paddingTop: '5px', paddingBottom: '5px', marginBottom: '5px' }}>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Current Activity</div>
            <div className="mt-2 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <div className={"text-xl font-black font-mono " +
                  (executionStage === 'TRADE_EXECUTED' ? "text-emerald-400" :
                   executionStage === 'REJECTED' ? "text-rose-400" :
                   executionStage === 'IDLE' ? "text-slate-300" : "text-cyan-300")}>
                  {stageLabel[executionStage]}
                </div>
                <div className="text-slate-300 text-sm mt-1">
                  {executionPair ? executionPair + (executionSide ? " · " + executionSide : "") : "No trade currently being prepared"}
                </div>
                <div className="text-slate-500 text-xs mt-2">{executionMessage}</div>
              </div>
              <div className="px-4 py-3 rounded-xl border border-cyan-800 bg-cyan-950/40 text-cyan-300 font-mono text-xs font-bold">
                {executionStage === 'SUBMITTING_ORDER' ? 'BROKER REQUEST IN PROGRESS' :
                 executionStage === 'TRADE_EXECUTED' ? 'BROKER CONFIRMATION RECEIVED' :
                 executionStage === 'REJECTED' ? 'TRADE NOT EXECUTED' : 'AUTO LIVE MONITORING'}
              </div>
            </div>
            <div className="grid grid-cols-5 gap-1 mt-5" style={{ marginTop: '10px' }}>
              {['SCANNING_MARKET','ANALYZING_SIGNAL','PREPARING_ORDER','SAFETY_GATE','SUBMITTING_ORDER'].map(stage => (
                <div key={stage} className={"h-1.5 rounded " +
                  (executionStage === stage ? "bg-cyan-400 animate-pulse" :
                   (executionStage === 'TRADE_EXECUTED' || executionStage === 'REJECTED') ? "bg-slate-700" : "bg-slate-800")} />
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-3" style={{ marginBottom: '5px' }}>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4" style={{ paddingTop: '5px', paddingBottom: '5px' }}><div className="text-[10px] text-slate-500 font-mono uppercase">Active Positions</div><div className="text-2xl font-bold text-white mt-1">{runningTrades.length}</div></div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4" style={{ paddingTop: '5px', paddingBottom: '5px' }}><div className="text-[10px] text-slate-500 font-mono uppercase">Actionable Signals</div><div className="text-2xl font-bold text-white mt-1">{visiblePlannedTrades.length}</div></div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4" style={{ paddingTop: '5px', paddingBottom: '5px' }}><div className="text-[10px] text-slate-500 font-mono uppercase">Last Cycle</div><div className="text-xs text-slate-300 mt-2">{autoStatus?.lastCycleResult || 'Waiting.'}</div></div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div><div className="text-xs font-bold text-white font-mono uppercase">Active Positions</div><div className="text-[10px] text-slate-500 mt-1">Broker-authoritative · refreshes every 10 seconds</div></div>
              <button type="button" onClick={() => fetchRealPositions(false)} className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 text-[11px] font-mono">Refresh</button>
            </div>
            {runningTrades.length === 0 ? <div className="py-7 text-center text-xs text-slate-500 font-mono">No active live positions.</div> : (
              <div className="overflow-x-auto"><table className="w-full text-xs font-mono">
                <thead><tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 text-left">Symbol</th><th>Side</th><th className="text-right">Qty</th><th className="text-right">Entry</th><th className="text-right">Current</th><th className="text-right">Stop Loss</th><th className="text-right">Take Profit</th><th className="text-right">Floating P&L</th><th>Action</th>
                </tr></thead>
                <tbody>{runningTrades.map(trade => (
                  <tr key={trade.id} className="border-b border-slate-800/60">
                    <td className="py-2 text-white font-bold">{trade.symbol}</td><td className={trade.side === 'BUY' ? "text-emerald-400" : "text-rose-400"}>{trade.side}</td>
                    <td className="text-right">{trade.quantity.toLocaleString()}</td><td className="text-right">{trade.entryPrice.toLocaleString()}</td><td className="text-right text-cyan-300">{trade.currentPrice.toLocaleString()}</td>
                    <td className="text-right text-rose-300">{trade.stopLoss ? trade.stopLoss.toLocaleString() : 'N/A'}</td><td className="text-right text-emerald-300">{trade.takeProfit ? trade.takeProfit.toLocaleString() : 'N/A'}</td>
                    <td className={"text-right font-bold " + (trade.unrealizedPnL >= 0 ? "text-emerald-400" : "text-rose-400")}>{trade.unrealizedPnL >= 0 ? '+' : ''}{trade.unrealizedPnL.toLocaleString()}</td>
                    <td className="text-center"><button type="button" onClick={() => handleClosePosition(trade.id, trade.broker)} className="text-[10px] px-2 py-1 rounded border border-slate-700 text-rose-300">Exit</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </>
      )}

      {activeTab === 'positions' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex justify-between mb-3"><div><div className="text-sm font-bold text-white font-mono">Live Positions</div><div className="text-[10px] text-slate-500">Complete broker data</div></div><button type="button" onClick={() => fetchRealPositions(false)} className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 text-[11px] font-mono">Refresh</button></div>
          <div className="overflow-x-auto"><table className="w-full text-xs font-mono"><thead><tr className="text-slate-500 border-b border-slate-800">
            <th className="py-2 text-left">ID</th><th>Broker</th><th>Symbol</th><th>Side</th><th className="text-right">Qty</th><th className="text-right">Entry</th><th className="text-right">Current</th><th className="text-right">Stop Loss</th><th className="text-right">Take Profit</th><th className="text-right">Floating P&L</th><th></th>
          </tr></thead><tbody>{runningTrades.map(trade => (
            <tr key={trade.id} className="border-b border-slate-800/60"><td className="py-2 text-slate-500">{trade.id}</td><td>{trade.broker}</td><td className="text-white font-bold">{trade.symbol}</td><td className={trade.side === 'BUY' ? "text-emerald-400" : "text-rose-400"}>{trade.side}</td><td className="text-right">{trade.quantity.toLocaleString()}</td><td className="text-right">{trade.entryPrice.toLocaleString()}</td><td className="text-right text-cyan-300">{trade.currentPrice.toLocaleString()}</td><td className="text-right text-rose-300">{trade.stopLoss ? trade.stopLoss.toLocaleString() : 'N/A'}</td><td className="text-right text-emerald-300">{trade.takeProfit ? trade.takeProfit.toLocaleString() : 'N/A'}</td><td className={"text-right font-bold " + (trade.unrealizedPnL >= 0 ? "text-emerald-400" : "text-rose-400")}>{trade.unrealizedPnL >= 0 ? '+' : ''}{trade.unrealizedPnL.toLocaleString()}</td><td className="text-center"><button type="button" onClick={() => handleClosePosition(trade.id, trade.broker)} className="text-[10px] px-2 py-1 rounded border border-slate-700 text-rose-300">Exit</button></td></tr>
          ))}</tbody></table></div>
        </div>
      )}

      {activeTab === 'signals' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap justify-between gap-2"><div><div className="text-sm font-bold text-white font-mono">Actionable Signals</div><div className="text-[10px] text-slate-500">Scanned: <span className="text-cyan-300">{signalScanStats.total}</span> · Actionable: <span className="text-emerald-300">{signalScanStats.actionable}</span> · NO_TRADE: <span className="text-slate-400">{signalScanStats.noTrade}</span> · Errors: <span className="text-rose-300">{signalScanStats.errors}</span> · Auto Live minimum score: <span className="text-cyan-300">{autoStatus?.minSignalScore ?? '—'}</span></div></div><div className="flex gap-2 items-center"><span className="text-[11px] font-mono text-slate-400">Scan Age: <b className="text-cyan-300">{signalsScanCompletedAt ? formatAge(signalsScanCompletedAt) : 'N/A'}</b></span><button type="button" onClick={() => fetchRealSignals(false)} disabled={isLoadingSignals} className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 text-[11px] font-mono">Refresh</button></div></div>
          {triggerNotification && <div className={"p-3 rounded-lg border text-xs font-mono " + (triggerNotification.type === 'error' ? "border-rose-800 bg-rose-950/40 text-rose-300" : "border-emerald-800 bg-emerald-950/40 text-emerald-300")}>{triggerNotification.message}</div>}
          <div className="overflow-x-auto"><table className="w-full text-xs font-mono"><thead><tr className="text-slate-500 border-b border-slate-800"><th className="py-2 text-left">Market</th><th>Symbol</th><th>Side</th><th>Strategy</th><th className="text-right">SL</th><th className="text-right">TP</th><th>Score</th><th>ML</th><th>Age</th><th>Action</th></tr></thead>
          <tbody>{visiblePlannedTrades.map(signal => <tr key={signal.id} className="border-b border-slate-800/60"><td className="py-2 text-slate-500">{signal.market}</td><td className="text-white font-bold">{signal.instrument}</td><td className={signal.direction === 'BUY' ? "text-emerald-400" : "text-rose-400"}>{signal.direction}</td><td className="max-w-xs truncate" title={signal.reasons?.join(', ') || signal.strategy}>{signal.strategy}</td><td className="text-right text-rose-300">{signal.stopLoss?.toLocaleString() || 'N/A'}</td><td className="text-right text-emerald-300">{signal.target1?.toLocaleString() || 'N/A'}</td><td className="text-center">{signal.score}</td><td className="text-center text-emerald-400">{(signal.mlProbability * 100).toFixed(0)}%</td><td className="text-center text-cyan-300">{formatAge(signalsScanCompletedAt)}</td><td className="text-center"><button type="button" onClick={() => triggerSignalExecution(signal)} disabled={triggeringSignalId === signal.id} className="text-[10px] px-2.5 py-1 rounded bg-emerald-700 text-white disabled:opacity-50">{triggeringSignalId === signal.id ? 'Triggering...' : 'Trigger Now'}</button></td></tr>)}</tbody></table></div>
        </div>
      )}

      {activeTab === 'options' && (
        <OptionsTradingPanel
          isEmergencyHalted={isEmergencyHalted}
          onPositionsRefresh={() => { void fetchRealPositions(true); }}
          onLog={addLog}
        />
      )}

      {activeTab === 'execution' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="text-sm font-bold text-white font-mono mb-3">Execution Lifecycle</div><div className="space-y-2">
            {['SCANNING_MARKET','ANALYZING_SIGNAL','PREPARING_ORDER','SAFETY_GATE','SUBMITTING_ORDER','TRADE_EXECUTED','REJECTED'].map(stage => <div key={stage} className={"flex items-center justify-between px-3 py-2 rounded border " + (executionStage === stage ? "border-cyan-700 bg-cyan-950/40 text-cyan-300" : "border-slate-800 bg-slate-950 text-slate-500")}><span className="font-mono text-xs">{stageLabel[stage as AutoExecutionStage]}</span>{executionStage === stage && <span className="text-[10px]">CURRENT</span>}</div>)}
          </div></div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="text-sm font-bold text-white font-mono">Execution Decision</div>
            <div className={"rounded-lg border p-3 text-xs font-mono " + (executionStage === 'REJECTED' ? "border-rose-800 bg-rose-950/30 text-rose-300" : executionStage === 'TRADE_EXECUTED' ? "border-emerald-800 bg-emerald-950/30 text-emerald-300" : "border-cyan-800 bg-cyan-950/30 text-cyan-300")}>
              <div className="font-bold">{executionPair ? executionPair : 'AUTO LIVE'}{executionSide ? " · " + executionSide : ""}</div>
              <div className="mt-1">{executionMessage}</div>
            </div>
            <div className="text-sm font-bold text-white font-mono">Pair Decisions</div>
            <div className="bg-slate-950 rounded-lg p-3 max-h-72 overflow-y-auto font-mono text-[11px] space-y-2">
              {!autoStatus?.lastActions?.length ? <div className="text-slate-600">No pair decisions recorded yet.</div> : autoStatus.lastActions.slice(-12).map((action, i) => (
                <div key={i} className="border-b border-slate-800 pb-2 last:border-b-0">
                  <div><span className="text-white font-bold">{action.pair}</span> <span className="text-cyan-400">[{action.result}]</span></div>
                  {action.reason && <div className="text-rose-300 mt-1">{action.reason}</div>}
                  {action.orderId && <div className="text-emerald-300 mt-1">Order: {action.orderId}</div>}
                </div>
              ))}
            </div>
            <div className="text-sm font-bold text-white font-mono">Runtime Output</div>
            <div className="bg-slate-950 rounded-lg p-3 max-h-72 overflow-y-auto font-mono text-[11px] space-y-1">{logs.length === 0 ? <div className="text-slate-600">No UI telemetry.</div> : logs.map((log, i) => <div key={i}><span className="text-slate-600">[{log.timestamp}]</span> <span className={log.type === 'error' ? "text-rose-400" : log.type === 'success' ? "text-emerald-400" : "text-cyan-400"}>[{log.type.toUpperCase()}]</span> <span className="text-slate-300">{log.message}</span></div>)}</div>
          </div>
        </div>
      )}

      {activeTab === 'predictions' && (
        <div className="space-y-4 font-mono text-xs">
          {/* Top Safety Status Banner */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow">
            <div>
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-cyan-400" />
                <span className="text-white font-bold text-sm uppercase">Redesigned Prediction & Evidence Engine</span>
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-cyan-950 border border-cyan-700 text-cyan-300">
                  {predictionMode} OBSERVATION MODE
                </span>
              </div>
              <p className="text-slate-400 text-[11px] mt-1">
                Multi-factor prediction: Historical Analogs + News Currency Intelligence + Technical Structure + Conflict Vetoes.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleScanUniverse}
                disabled={scanningUniverse}
                className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition flex items-center gap-1.5 disabled:opacity-50 text-[11px]"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{scanningUniverse ? 'Scanning Universe...' : 'Scan Forex Universe'}</span>
              </button>
              <div className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 text-[11px]">
                Live Safety: <b className="text-emerald-400">ISOLATED</b>
              </div>
            </div>
          </div>

          {/* Universe Trade Matrix & Settings Synchronization Panel */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <span>UNIVERSE TRADE SUGGESTIONS & SETTINGS SYNC</span>
                  {universeScan?.timestamp && (
                    <span className="text-[10px] font-normal text-slate-500">
                      (Scanned {new Date(universeScan.timestamp).toLocaleTimeString()})
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Pairs suggested TO TRADE vs Pairs NOT TO TRADE. System flags high-conviction predictions disabled in settings so opportunities are not wasted.
                </div>
              </div>
            </div>

            {/* Summary Counters */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-[10px]">TOTAL UNIVERSE</div>
                <div className="text-base font-bold text-white mt-0.5">{universeScan?.totalUniversePairs ?? '—'} Pairs</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-[10px]">ENABLED IN SETTINGS</div>
                <div className="text-base font-bold text-cyan-300 mt-0.5">{universeScan?.enabledInSettingsCount ?? '—'} Pairs</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-[10px]">SUGGESTED TO TRADE</div>
                <div className="text-base font-bold text-emerald-400 mt-0.5">{universeScan?.recommendedTradeCount ?? 0} Pairs</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-[10px]">SUGGESTED NOT TO TRADE</div>
                <div className="text-base font-bold text-slate-400 mt-0.5">{universeScan?.avoidNoTradeCount ?? '—'} Pairs</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-[10px]">DISABLED IN SETTINGS</div>
                <div className={`text-base font-bold mt-0.5 ${(universeScan?.missedOpportunitiesCount ?? 0) > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                  {universeScan?.missedOpportunitiesCount ?? 0} Opportunities
                </div>
              </div>
            </div>

            {/* Settings Mismatch Alert Banner */}
            {universeScan?.settingsMismatchAlert && universeScan?.missedOpportunities?.length > 0 && (
              <div className="bg-amber-950/40 border border-amber-600/60 rounded-xl p-4 space-y-2.5 shadow-inner">
                <div className="flex items-center gap-2 text-amber-300 font-bold text-xs">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  <span>PREDICTION OPPORTUNITY DISABLED IN SETTINGS ALERT</span>
                </div>
                <p className="text-[11px] text-amber-200/90 leading-relaxed">
                  The prediction model identified high-conviction setups with positive expected value on the following pairs, but they are <b>DISABLED</b> in your Auto Live settings. Without enabling them, the system cannot execute these setups automatically:
                </p>
                <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                  {universeScan.missedOpportunities.map((m: any) => (
                    <div key={m.pair} className="bg-slate-950 border border-amber-700/60 rounded-lg p-2.5 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-white font-bold">{m.pair}</div>
                        <div className="text-[10px] text-emerald-400">
                          {m.recommendation} | EV: +{m.expectedValuePips} pips ({(m.calibratedConfidence * 100).toFixed(0)}% conf)
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleTogglePairInSettings(m.pair, false)}
                        disabled={togglingPair === m.pair}
                        className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[10px] transition disabled:opacity-50 shrink-0"
                      >
                        {togglingPair === m.pair ? 'Enabling...' : `Enable ${m.pair}`}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Qualified Pairs Suggested TO TRADE */}
            {universeScan?.recommendedTrades?.length > 0 && (
              <div className="space-y-2">
                <div className="text-emerald-400 font-bold text-xs flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>PAIRS SUGGESTED TO TRADE (QUALIFIED & ENABLED)</span>
                </div>
                <div className="overflow-x-auto border border-emerald-900/50 rounded-lg bg-slate-950">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="border-b border-emerald-900/40 text-slate-400 bg-emerald-950/20">
                        <th className="py-2 px-3">Pair</th>
                        <th>Direction</th>
                        <th>Confidence</th>
                        <th>Net Expected Value</th>
                        <th>News Sentiment</th>
                        <th>Historical Sample</th>
                        <th>Settings Status</th>
                        <th className="text-right px-3">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {universeScan.recommendedTrades.map((t: any) => (
                        <tr key={t.pair} className="border-b border-slate-800/60 hover:bg-slate-900/40">
                          <td className="py-2 px-3 font-bold text-white">{t.pair}</td>
                          <td className={t.recommendation === 'TRADE_BUY' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                            {t.recommendation}
                          </td>
                          <td className="text-cyan-300">{(t.calibratedConfidence * 100).toFixed(1)}%</td>
                          <td className="text-emerald-400 font-bold">+{t.expectedValuePips} pips</td>
                          <td className="text-slate-300">{t.newsSentiment}</td>
                          <td className="text-slate-400">{t.historicalSampleSize} analogs ({t.historicalWinRate * 100}% win)</td>
                          <td>
                            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700">
                              ENABLED IN AUTO LIVE
                            </span>
                          </td>
                          <td className="text-right px-3">
                            <button
                              type="button"
                              onClick={() => handleTogglePairInSettings(t.pair, true)}
                              disabled={togglingPair === t.pair}
                              className="px-2 py-0.5 rounded border border-slate-700 bg-slate-900 text-slate-400 hover:text-rose-300 hover:border-rose-800 text-[10px]"
                            >
                              {togglingPair === t.pair ? 'Updating...' : 'Disable'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Pairs Suggested NOT TO TRADE / AVOID Table */}
            <div className="space-y-2">
              <div className="text-slate-400 font-bold text-xs flex items-center justify-between">
                <span>PAIRS SUGGESTED NOT TO TRADE / AVOID (SAFETY FILTERED)</span>
                <span className="text-[10px] text-slate-500">Filtered out to protect capital from low expectancy or conflicts</span>
              </div>
              <div className="overflow-x-auto border border-slate-800 rounded-lg bg-slate-950 max-h-64 overflow-y-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500 sticky top-0 bg-slate-950">
                      <th className="py-2 px-3">Pair</th>
                      <th>Model Output</th>
                      <th>Confidence</th>
                      <th>Expected Value</th>
                      <th>Veto / Exclusion Reason</th>
                      <th>Settings</th>
                      <th className="text-right px-3">Toggle Setting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(universeScan?.avoidPairs || []).map((a: any) => (
                      <tr key={a.pair} className="border-b border-slate-800/40 text-slate-400 hover:bg-slate-900/30">
                        <td className="py-1.5 px-3 font-bold text-slate-300">{a.pair}</td>
                        <td>
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-slate-900 border border-slate-800 text-amber-400">
                            {a.recommendation}
                          </span>
                        </td>
                        <td className="text-slate-400">{(a.calibratedConfidence * 100).toFixed(1)}%</td>
                        <td className={a.expectedValuePips > 0 ? 'text-emerald-400' : 'text-slate-500'}>
                          {a.expectedValuePips > 0 ? `+${a.expectedValuePips}` : a.expectedValuePips} pips
                        </td>
                        <td className="text-[10px] text-slate-400 max-w-xs truncate" title={a.vetoReason || a.primaryReason}>
                          {a.vetoReason || a.primaryReason}
                        </td>
                        <td>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] ${a.isEnabledInSettings ? 'text-cyan-400 bg-cyan-950/40 border border-cyan-800/40' : 'text-slate-500 bg-slate-900'}`}>
                            {a.isEnabledInSettings ? 'Active' : 'Disabled'}
                          </span>
                        </td>
                        <td className="text-right px-3">
                          <button
                            type="button"
                            onClick={() => handleTogglePairInSettings(a.pair, a.isEnabledInSettings)}
                            disabled={togglingPair === a.pair}
                            className="px-2 py-0.5 rounded border border-slate-800 bg-slate-900 text-slate-400 hover:text-white text-[10px]"
                          >
                            {togglingPair === a.pair ? '...' : a.isEnabledInSettings ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Interactive Evaluation Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-slate-400 text-[11px] font-bold uppercase tracking-wider mb-3">On-Demand Prediction & Evidence Evaluator</div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Pair:</span>
                <select
                  value={predictionPair}
                  onChange={e => setPredictionPair(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  {['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'EUR/JPY', 'GBP/JPY'].map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-slate-500">Horizon:</span>
                <select
                  value={predictionHorizon}
                  onChange={e => setPredictionHorizon(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="5M">5M</option>
                  <option value="15M">15M</option>
                  <option value="1H">1H</option>
                  <option value="4H">4H</option>
                  <option value="1D">1D</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => handleEvaluatePrediction(predictionPair)}
                disabled={evaluatingPrediction}
                className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{evaluatingPrediction ? 'Evaluating Multi-Factor Evidence...' : 'Evaluate Prediction'}</span>
              </button>
            </div>

            {/* Prediction Breakdown Result Card */}
            {predictionResult && (
              <div className="mt-4 pt-4 border-t border-slate-800 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <div className="text-slate-500 text-[10px]">PREDICTED DIRECTION</div>
                    <div className={`text-lg font-bold mt-1 ${
                      predictionResult.direction === 'UP' ? 'text-emerald-400' :
                      predictionResult.direction === 'DOWN' ? 'text-rose-400' : 'text-amber-400'
                    }`}>
                      {predictionResult.direction}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Horizon: {predictionResult.horizon}</div>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <div className="text-slate-500 text-[10px]">CALIBRATED CONFIDENCE</div>
                    <div className="text-lg font-bold text-white mt-1">
                      {(predictionResult.calibratedConfidence * 100).toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Sample: {predictionResult.sampleSize} analogs</div>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <div className="text-slate-500 text-[10px]">NET EXPECTED VALUE</div>
                    <div className={`text-lg font-bold mt-1 ${
                      predictionResult.expectedValue > 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {predictionResult.expectedValue > 0 ? '+' : ''}{predictionResult.expectedValue} pips
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">After spread & slippage</div>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <div className="text-slate-500 text-[10px]">TRADE RECOMMENDATION</div>
                    <div className={`text-sm font-bold mt-1 px-2 py-1 rounded inline-block ${
                      predictionResult.recommendation === 'TRADE_BUY' ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' :
                      predictionResult.recommendation === 'TRADE_SELL' ? 'bg-rose-950 text-rose-300 border border-rose-700' :
                      'bg-slate-900 text-amber-300 border border-amber-800'
                    }`}>
                      {predictionResult.recommendation}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Default safe: NO_TRADE</div>
                  </div>
                </div>

                {/* Evidence Pillars Grid */}
                <div className="grid md:grid-cols-3 gap-3">
                  {/* News Intelligence */}
                  <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-2">
                    <div className="text-slate-400 font-bold flex items-center justify-between text-[11px]">
                      <span>NEWS INTELLIGENCE</span>
                      <span className={predictionResult.evidence?.news?.direction === 'BULLISH' ? 'text-emerald-400' : predictionResult.evidence?.news?.direction === 'BEARISH' ? 'text-rose-400' : 'text-slate-400'}>
                        {predictionResult.evidence?.news?.direction || 'NEUTRAL'}
                      </span>
                    </div>
                    <div className="space-y-1 text-[11px] text-slate-400">
                      <div>Base Sentiment: <b className="text-white">{predictionResult.evidence?.news?.baseCurrencySentiment}</b></div>
                      <div>Quote Sentiment: <b className="text-white">{predictionResult.evidence?.news?.quoteCurrencySentiment}</b></div>
                      <div>Relative Score: <b className="text-cyan-300">{predictionResult.evidence?.news?.relativeSentiment}</b></div>
                      <div>Conflict Score: <b className={predictionResult.evidence?.news?.conflictScore > 0.4 ? 'text-rose-400' : 'text-emerald-400'}>{(predictionResult.evidence?.news?.conflictScore * 100).toFixed(0)}%</b></div>
                    </div>
                  </div>

                  {/* Historical Analogs */}
                  <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-2">
                    <div className="text-slate-400 font-bold flex items-center justify-between text-[11px]">
                      <span>HISTORICAL ANALOGS</span>
                      <span className="text-cyan-300">{predictionResult.evidence?.historical?.sampleSize} matches</span>
                    </div>
                    <div className="space-y-1 text-[11px] text-slate-400">
                      <div>Historical Up Prob: <b className="text-emerald-400">{(predictionResult.evidence?.historical?.historicalUpProbability * 100).toFixed(1)}%</b></div>
                      <div>Historical Down Prob: <b className="text-rose-400">{(predictionResult.evidence?.historical?.historicalDownProbability * 100).toFixed(1)}%</b></div>
                      <div>Historical Win Rate: <b className="text-white">{(predictionResult.evidence?.historical?.winRate * 100).toFixed(1)}%</b></div>
                      <div>Sample Satiated: <b className={predictionResult.evidence?.historical?.isSampleSufficient ? 'text-emerald-400' : 'text-amber-400'}>{predictionResult.evidence?.historical?.isSampleSufficient ? 'YES' : 'NO (MIN 25)'}</b></div>
                    </div>
                  </div>

                  {/* Technical & Rolling Penalty */}
                  <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-2">
                    <div className="text-slate-400 font-bold flex items-center justify-between text-[11px]">
                      <span>TECHNICAL & PENALTY</span>
                      <span className="text-slate-300">{predictionResult.evidence?.technical?.trend}</span>
                    </div>
                    <div className="space-y-1 text-[11px] text-slate-400">
                      <div>RSI (14): <b className="text-white">{predictionResult.evidence?.technical?.rsi}</b></div>
                      <div>ATR Pips: <b className="text-white">{predictionResult.evidence?.technical?.atrPips} pips</b></div>
                      <div>Rolling Loss Streak: <b className={predictionResult.evidence?.rollingPerformance?.consecutiveLosses > 0 ? 'text-amber-400' : 'text-slate-300'}>{predictionResult.evidence?.rollingPerformance?.consecutiveLosses}</b></div>
                      <div>Penalty Multiplier: <b className="text-white">{predictionResult.evidence?.rollingPerformance?.penaltyMultiplier}x</b></div>
                    </div>
                  </div>
                </div>

                {/* Reasons and Veto Explanations */}
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-[11px]">
                  {predictionResult.vetoReasons?.length > 0 && (
                    <div className="text-rose-400 font-bold mb-1">
                      Veto Reasons: {predictionResult.vetoReasons.join(' | ')}
                    </div>
                  )}
                  {predictionResult.reasons?.length > 0 && (
                    <div className="text-slate-300">
                      Evidence Synthesis: {predictionResult.reasons.join(' | ')}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Chronological Walk-Forward Backtest Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-slate-400 text-[11px] font-bold uppercase tracking-wider">Chronological Walk-Forward Backtest</div>
                <div className="text-[10px] text-slate-500">Out-of-sample rolling windows with zero lookahead bias and baseline comparisons.</div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={walkForwardPair}
                  onChange={e => setWalkForwardPair(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white"
                >
                  {['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'USD/CHF'].map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleRunWalkForward(walkForwardPair)}
                  disabled={runningWalkForward}
                  className="px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold transition disabled:opacity-50"
                >
                  {runningWalkForward ? 'Running...' : 'Run Walk-Forward Backtest'}
                </button>
              </div>
            </div>

            {walkForwardReport && (
              <div className="space-y-3 pt-3 border-t border-slate-800">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                    <div className="text-slate-500 text-[10px]">WINDOWS EVALUATED</div>
                    <div className="text-base font-bold text-white mt-0.5">{walkForwardReport.validationWindows}</div>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                    <div className="text-slate-500 text-[10px]">TOTAL OBSERVATIONS</div>
                    <div className="text-base font-bold text-white mt-0.5">{walkForwardReport.modelMetrics?.totalObservations}</div>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                    <div className="text-slate-500 text-[10px]">NO_TRADE RATE</div>
                    <div className="text-base font-bold text-cyan-300 mt-0.5">{walkForwardReport.modelMetrics?.noTradePct}%</div>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                    <div className="text-slate-500 text-[10px]">BRIER SCORE</div>
                    <div className="text-base font-bold text-white mt-0.5">{walkForwardReport.modelMetrics?.brierScore}</div>
                  </div>
                </div>

                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 overflow-x-auto">
                  <div className="text-[10px] text-slate-400 font-bold uppercase mb-2">Out-of-Sample Performance vs Baselines</div>
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-800 pb-1">
                        <th className="py-1">Strategy / Baseline</th>
                        <th>Win Rate</th>
                        <th>Profit Factor</th>
                        <th>Expectancy (Pips)</th>
                        <th>Trade Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-slate-800/60 font-bold text-cyan-300">
                        <td className="py-1.5">Redesigned Combined Model</td>
                        <td>{(walkForwardReport.modelMetrics?.winRate * 100).toFixed(1)}%</td>
                        <td>{walkForwardReport.modelMetrics?.profitFactor}</td>
                        <td>{walkForwardReport.modelMetrics?.expectancyPips} pips</td>
                        <td>{walkForwardReport.modelMetrics?.tradeCount} (Safely Filtered)</td>
                      </tr>
                      {walkForwardReport.baselines?.map((b: any) => (
                        <tr key={b.baselineName} className="border-b border-slate-800/40 text-slate-400">
                          <td className="py-1">{b.baselineName}</td>
                          <td>{(b.winRate * 100).toFixed(1)}%</td>
                          <td>{b.profitFactor}</td>
                          <td className={b.expectancyPips < 0 ? 'text-rose-400' : 'text-emerald-400'}>{b.expectancyPips} pips</td>
                          <td>{b.tradeCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Recent Stored Predictions Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-slate-400 text-[11px] font-bold uppercase tracking-wider">Historical Predictions & Resolution Ledger</div>
                <div className="text-[10px] text-slate-500">Persisted in SQLite predictions table for auditing and continuous calibration.</div>
              </div>
              <button
                type="button"
                onClick={fetchPredictionStatus}
                className="px-2.5 py-1 rounded border border-slate-700 bg-slate-950 text-slate-300 text-[10px]"
              >
                Refresh
              </button>
            </div>

            {predictionHistory.length === 0 ? (
              <div className="py-6 text-center text-slate-500 font-mono text-xs">No stored predictions recorded yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800 pb-1">
                      <th className="py-1">Timestamp</th>
                      <th>Pair</th>
                      <th>Horizon</th>
                      <th>Direction</th>
                      <th>Confidence</th>
                      <th>EV</th>
                      <th>Recommendation</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {predictionHistory.map((p: any) => (
                      <tr key={p.prediction_id} className="border-b border-slate-800/50">
                        <td className="py-1.5 text-slate-500">{new Date(p.timestamp).toLocaleTimeString()}</td>
                        <td className="text-white font-bold">{p.pair}</td>
                        <td className="text-slate-400">{p.horizon}</td>
                        <td className={p.direction === 'UP' ? 'text-emerald-400' : p.direction === 'DOWN' ? 'text-rose-400' : 'text-slate-400'}>
                          {p.direction}
                        </td>
                        <td className="text-cyan-300">{(p.confidence * 100).toFixed(1)}%</td>
                        <td className={p.expected_return > 0 ? 'text-emerald-400' : 'text-rose-400'}>{p.expected_return}</td>
                        <td className={p.recommendation.includes('BUY') ? 'text-emerald-300' : p.recommendation.includes('SELL') ? 'text-rose-300' : 'text-slate-400'}>
                          {p.recommendation}
                        </td>
                        <td>
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-slate-950 border border-slate-800 text-slate-400">
                            {p.actual_outcome || 'PENDING'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'controls' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
            <div>
              <div className="text-sm font-bold text-white font-mono">Risk Controls</div>
              <div className="text-[10px] text-slate-500 mt-1">Daily loss protection is operator-configurable and persists across server restarts.</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-2">Daily Loss Limit (%)</label>
              <div className="flex gap-2 items-center">
                <input type="number" min="0.1" max="100" step="0.1" value={dailyLossLimitPct} onChange={(e) => setDailyLossLimitPct(Number(e.target.value))} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono text-white outline-none focus:border-cyan-500" />
                <span className="text-slate-400 font-mono">%</span>
                <button type="button" onClick={saveDailyLossLimit} disabled={dailyLossSaving} className="shrink-0 rounded-lg border border-cyan-700 bg-cyan-950/40 px-3 py-2 text-xs font-mono text-cyan-300 disabled:opacity-50">{dailyLossSaving ? 'Saving...' : 'Save'}</button>
              </div>
              <div className="text-[10px] text-slate-500 mt-2">The live safety gate calculates the actual daily loss threshold from the current account balance using this percentage.</div>
              {dailyLossSaveMessage && <div className="text-[10px] text-emerald-300 mt-2">{dailyLossSaveMessage}</div>}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="text-sm font-bold text-white font-mono mb-3">Auto Live Status</div><div className="space-y-3 text-xs font-mono">
            <div className="flex justify-between"><span className="text-slate-500">Engine State</span><span className="text-white">{autoStatus?.state || 'LOADING'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Autonomous Permission</span><span className={autoStatus?.autonomousPermission ? "text-emerald-400" : "text-rose-400"}>{autoStatus?.autonomousPermission ? 'ALLOWED' : 'BLOCKED'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Minimum Signal Score</span><span className="text-cyan-300">{autoStatus?.minSignalScore ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Max Trades / Pair</span><span className="text-cyan-300">{autoStatus?.maxTradesPerPair ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Max Trades / System</span><span className="text-cyan-300">{autoStatus?.maxOpenPositions ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Emergency Halt</span><span className={isEmergencyHalted ? "text-rose-400" : "text-emerald-400"}>{isEmergencyHalted ? 'ACTIVE' : 'READY'}</span></div>
            {autoStatusError && <div className="text-rose-300 border border-rose-900 bg-rose-950/30 rounded p-2">{autoStatusError}</div>}
          </div></div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="text-sm font-bold text-white font-mono mb-3">Secondary Tools</div><div className="text-xs text-slate-500">Detailed diagnostics, configuration and historical information should be kept in dedicated application pages rather than the default Auto Live cockpit.</div></div>
        </div>
      )}
    </div>
  );

};