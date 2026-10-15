import React, { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
const Dashboard = lazy(() => import('./components/Dashboard').then(module => ({ default: module.Dashboard })));
const SignalsView = lazy(() => import('./components/SignalsView').then(module => ({ default: module.SignalsView })));
const TradingHub = lazy(() => import('./components/TradingHub').then(module => ({ default: module.TradingHub })));
const ShadowModeDashboard = lazy(() => import('./components/ShadowModeDashboard').then(module => ({ default: module.ShadowModeDashboard })));
const PredictionForensicsPage = lazy(() => import('./components/PredictionForensicsPage').then(module => ({ default: module.PredictionForensicsPage })));
const DirectionAnalysisPage = lazy(() => import('./components/DirectionAnalysisPage').then(module => ({ default: module.DirectionAnalysisPage })));
const NativeIndicatorsReportPage = lazy(() => import('./components/NativeIndicatorsReportPage').then(module => ({ default: module.NativeIndicatorsReportPage })));
const DynamicExitAnalysisPage = lazy(() => import('./components/DynamicExitAnalysisPage').then(module => ({ default: module.DynamicExitAnalysisPage })));
const ShortTPOptimizationPage = lazy(() => import('./components/ShortTPOptimizationPage').then(module => ({ default: module.ShortTPOptimizationPage })));
import { TradingOperationsDashboard } from './components/TradingOperationsDashboard';
const TradingControlCenter = lazy(() => import('./components/TradingControlCenter').then(module => ({ default: module.TradingControlCenter })));
const HistoryPage = lazy(() => import('./components/HistoryPage').then(module => ({ default: module.HistoryPage })));
const DatabaseExplorerPage = lazy(() => import('./components/DatabaseExplorerPage').then(module => ({ default: module.DatabaseExplorerPage })));
const ConnectionMonitorPage = lazy(() => import('./components/ConnectionMonitorPage').then(module => ({ default: module.ConnectionMonitorPage })));
const AlertsPage = lazy(() => import('./components/AlertsPage').then(module => ({ default: module.AlertsPage })));
const PnLAccountingPage = lazy(() => import('./components/PnLAccountingPage').then(module => ({ default: module.PnLAccountingPage })));
const SettingsHub = lazy(() => import('./components/SettingsHub').then(module => ({ default: module.SettingsHub })));
const MarketSessionsWidget = lazy(() => import('./components/MarketSessionsWidget').then(module => ({ default: module.MarketSessionsWidget })));
import { GlobalAppShell } from './components/GlobalAppShell';
const SignalModal = lazy(() => import('./components/SignalModal').then(module => ({ default: module.SignalModal })));
const DiagnosticsModal = lazy(() => import('./components/DiagnosticsModal').then(module => ({ default: module.DiagnosticsModal })));
const OrderConfirmationModal = lazy(() => import('./components/OrderConfirmationModal').then(module => ({ default: module.OrderConfirmationModal })));
import { TradingSignal, Candle, ForexSessionState, IndianSessionState } from './markets/common/types';
import { getForexSessionState, getIndianSessionState } from './markets/common/session';
import { BrokerType, TradingEnvironment, OrderRequest } from './brokers/types';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('market_watch');
  const [forexPairs, setForexPairs] = useState<any[]>([]);
  const [forexSessions, setForexSessions] = useState<ForexSessionState>(() => getForexSessionState(new Date()));
  const [indianUnderlyings] = useState<any[]>([]);
  const [indianSession] = useState<IndianSessionState>(() => getIndianSessionState(new Date()));
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [candlesMap, setCandlesMap] = useState<Record<string, Candle[]>>({});
  const [selectedSignal, setSelectedSignal] = useState<TradingSignal | null>(null);
  const [selectedOptionUnderlying] = useState<string>('');
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const terminalRefreshInFlightRef = useRef<Promise<void> | null>(null);

  // Broker Environment & Safety State
  const [environment, setEnvironment] = useState<TradingEnvironment>('LIVE');
  const [selectedBroker, setSelectedBroker] = useState<BrokerType>('CTRADER');
  const [maskedAccount, setMaskedAccount] = useState<string>('****');
  const [currency, setCurrency] = useState<string>('USD');
  const [balance, setBalance] = useState<number>(0);
  const [isEmergencyHalted, setIsEmergencyHalted] = useState<boolean>(false);
  const [autoTradingStatus, setAutoTradingStatus] = useState<any | null>(null);
  const [activeForexUniverse, setActiveForexUniverse] = useState<string[]>([
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD'
  ]);
  const [activeIndianUniverse] = useState<string[]>([]);

  // Order confirmation modal; Goldcrest operates in LIVE_ONLY mode.
  const [pendingOrder, setPendingOrder] = useState<OrderRequest | null>(null);

  // Fetch Broker Status
  const refreshBrokerStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/brokers/status');
      if (res.ok) {
        const data = await res.json();
        setEnvironment('LIVE');
        setSelectedBroker(data.selectedBroker || 'CTRADER');
        setIsEmergencyHalted(data.emergencyStop?.isHalted || false);

        if (data.activeAccount) {
          setMaskedAccount(data.activeAccount.accountId || '****');
          setCurrency(data.activeAccount.currency || 'USD');
          setBalance(data.activeAccount.balance || 0);
        } else {
          const cred = data.credentials?.find((c: any) => c.broker === data.selectedBroker && c.environment === data.environment);
          if (cred) {
            setMaskedAccount(cred.maskedAccountId || cred.maskedClientId || '****');
          }
        }
      }
    } catch (err) {
      console.warn('Broker status endpoint temporarily unavailable, using LIVE-only state:', err);
    }
  }, []);

  // Fetch all primary terminal data
  // Fetch all primary terminal data. Background refreshes are serialized
  // and never replace valid state with an empty/error fallback.
  const refreshTerminalData = useCallback(async (showSpinner = true) => {
    if (terminalRefreshInFlightRef.current) {
      return terminalRefreshInFlightRef.current;
    }

    const run = (async () => {
      if (showSpinner) setIsRefreshing(true);

      try {
        const safeFetchJson = async (url: string, fallback: any = [], timeoutMs = 25000) => {
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
          try {
            const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
            if (res.ok) return await res.json();
            console.warn(`Safe fetch returned HTTP ${res.status} for ${url}`);
          } catch (e: any) {
            if (e?.name !== 'AbortError') {
              console.warn(`Safe fetch failed for ${url}:`, e);
            }
          } finally {
            window.clearTimeout(timeout);
          }
          return fallback;
        };

        // Load primary Forex market data and configuration.
        // Indian trading is completely retired; only genuine Forex pairs are requested.
        const [fxPairs, autoStatus, config] = await Promise.all([
          safeFetchJson('/api/forex/pairs', [], 25000),
          safeFetchJson('/api/auto-trading/status', null, 15000),
          safeFetchJson('/api/config', null, 15000)
        ]);

        if (config && typeof config === 'object') {
          if (Array.isArray(config.autoLiveForexPairs)) setActiveForexUniverse(config.autoLiveForexPairs);
        }

        const selectedForex = Array.isArray(config?.autoLiveForexPairs)
          ? new Set(config.autoLiveForexPairs.map((symbol: any) => String(symbol).toUpperCase()))
          : null;

        if (Array.isArray(fxPairs) && fxPairs.length > 0) {
          const filtered = selectedForex
            ? fxPairs.filter((row: any) => selectedForex.has(String(row?.symbol || '').toUpperCase()))
            : fxPairs;
          setForexPairs(filtered);

          // Populate signals directly from current forex pair evaluation
          const derivedSignals = filtered.map((row: any) => row?.signal).filter(Boolean);
          if (derivedSignals.length > 0) {
            setSignals(derivedSignals);
          }
        }
        if (autoStatus && typeof autoStatus === 'object') setAutoTradingStatus(autoStatus);

        // Fetch EUR/USD candles for primary market chart
        void safeFetchJson('/api/candles/EUR%2FUSD', [], 25000).then(eurCandles => {
          if (Array.isArray(eurCandles) && eurCandles.length > 0) {
            setCandlesMap(prev => ({ ...prev, 'EUR/USD': eurCandles }));
          }
        });

        // Background sync for all signals
        void safeFetchJson('/api/signals/all', [], 25000).then(sigs => {
          if (Array.isArray(sigs) && sigs.length > 0) setSignals(sigs);
        });
      } catch (err) {
        console.error('Failed to load terminal data:', err);
      } finally {
        if (showSpinner) setIsRefreshing(false);
        setLoadingInitial(false);
      }
    })();

    terminalRefreshInFlightRef.current = run;
    try {
      await run;
    } finally {
      terminalRefreshInFlightRef.current = null;
    }
  }, [terminalRefreshInFlightRef]);

  // One application-level market refresh loop. Child dashboards do not need
  // independent high-frequency polling for the same broker resources.
  useEffect(() => {
    void refreshTerminalData(true);

    const safetyTimer = setTimeout(() => {
      setLoadingInitial(false);
    }, 4000);

    const dataTimer = setInterval(() => {
      void refreshTerminalData(false);
    }, 30000);

    return () => {
      clearTimeout(safetyTimer);
      clearInterval(dataTimer);
    };
  }, [refreshTerminalData]);

  // LIVE_ONLY runtime: no environment switching is exposed.
  const handleRequestEnvironmentChange = (_targetEnv: TradingEnvironment) => {
    // Intentionally ignored; server enforces LIVE_ONLY.
  };

  // Broker selection handler
  const handleSelectBroker = async (broker: BrokerType) => {
    try {
      const res = await fetch('/api/brokers/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker })
      });
      if (res.ok) {
        setSelectedBroker(broker);
        await refreshBrokerStatus();
      }
    } catch (err) {
      console.error('Failed to select broker:', err);
    }
  };

  // Toggle Emergency Kill Switch
  const handleToggleKillSwitch = async () => {
    const action = isEmergencyHalted ? 'RESUME' : 'HALT';
    if (action === 'HALT') {
      const confirmed = confirm('CRITICAL: Are you sure you want to trigger the EMERGENCY STOP? This will cancel all pending orders and immediately block any new trade orders.');
      if (!confirmed) return;
    }

    try {
      const res = await fetch('/api/brokers/emergency-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason: 'Operator manual UI button' })
      });
      if (res.ok) {
        const data = await res.json();
        setIsEmergencyHalted(data.emergencyStop.isHalted);
      }
    } catch (err) {
      console.error('Failed to trigger emergency stop:', err);
    }
  };

  // Track last fetched timestamps to prevent redundant polling loops
  const candleFetchTimesRef = useRef<Record<string, number>>({});

  // Ensure candles loaded for an instrument
  const ensureCandlesLoaded = useCallback(async (symbol: string) => {
    if (!symbol) return;
    const now = Date.now();
    const lastFetch = candleFetchTimesRef.current[symbol] || 0;
    // Throttle to at most once every 10 seconds per symbol
    if (now - lastFetch < 10000) return;
    candleFetchTimesRef.current[symbol] = now;

    try {
      const encoded = encodeURIComponent(symbol);
      const res = await fetch(`/api/candles/${encoded}`);
      if (res.ok) {
        const data = await res.json();
        setCandlesMap(prev => ({ ...prev, [symbol]: Array.isArray(data) ? data : [] }));
      }
    } catch {
      // Safe fallback when disconnected or server is restarting
      setCandlesMap(prev => ({ ...prev, [symbol]: prev[symbol] || [] }));
    }
  }, []);

  // Execute confirmed order
  const handleExecuteConfirmedOrder = async (confirmedOrder: OrderRequest) => {
    setPendingOrder(null);
    try {
      const idempotencyKey = confirmedOrder.signalId || `manual-${confirmedOrder.market}-${confirmedOrder.symbol}-${confirmedOrder.side}-${Date.now()}`;
      const res = await fetch('/api/brokers/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          ...confirmedOrder,
          broker: selectedBroker,
          environment,
          operatorConfirmed: true
        })
      });
      const data = await res.json();
      if (res.ok && (data.success || ['EXECUTED', 'ACCEPTED', 'PARTIALLY_FILLED', 'DUPLICATE_REPLAY'].includes(data.status))) {
        alert(`Order Placed Successfully!\nBroker: ${selectedBroker}\nID: ${data.order?.orderId}\nStatus: ${data.order?.status}`);
        await refreshBrokerStatus();
      } else {
        alert(`Order Rejected / Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Order Execution Error: ${err.message}`);
    }
  };

  return (
    <GlobalAppShell
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      forexPairs={forexPairs}
      forexSessions={forexSessions}
      indianSession={indianSession}
      indianUnderlyings={indianUnderlyings}
      header={
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          forexSessions={forexSessions}
          indianSession={indianSession}
          onRefresh={refreshTerminalData}
          isRefreshing={isRefreshing}
          onOpenDiagnostics={() => setShowDiagnostics(true)}
          environment={environment}
          onRequestEnvironmentChange={handleRequestEnvironmentChange}
          selectedBroker={selectedBroker}
          maskedAccount={maskedAccount}
          autoTradingStatus={autoTradingStatus}
          isEmergencyHalted={isEmergencyHalted}
          onToggleKillSwitch={handleToggleKillSwitch}
        />
      }
    >
      {/* Fixed global shell content outlet: view components render here. */}
      <main id="global_app_content" className="min-h-[calc(100vh-162px)] w-full space-y-4 bg-[#03070d] text-slate-100" style={{ paddingLeft: '10px', paddingRight: '10px', paddingTop: '10px', paddingBottom: '10px' }}>
        <Suspense fallback={<div className="min-h-40 p-6 text-sm text-slate-400">Loading view…</div>}>
        {/* Market Watch / scanners */}
        {loadingInitial && activeTab === 'market_watch' ? (
          <div className="space-y-6 p-6 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-6 w-48 bg-slate-800 rounded" />
                <div className="h-4 w-72 bg-slate-900 rounded" />
              </div>
              <div className="h-10 w-32 bg-slate-800 rounded-lg" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="h-24 bg-slate-900 border border-slate-800 rounded-xl" />
              <div className="h-24 bg-slate-900 border border-slate-800 rounded-xl" />
              <div className="h-24 bg-slate-900 border border-slate-800 rounded-xl" />
              <div className="h-24 bg-slate-900 border border-slate-800 rounded-xl" />
            </div>
            <div className="h-96 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <div className="h-8 w-64 bg-slate-800 rounded" />
              <div className="space-y-3">
                <div className="h-12 w-full bg-slate-800/60 rounded" />
                <div className="h-12 w-full bg-slate-800/40 rounded" />
                <div className="h-12 w-full bg-slate-800/30 rounded" />
                <div className="h-12 w-full bg-slate-800/20 rounded" />
              </div>
            </div>
          </div>
        ) : (
          activeTab === 'market_watch' && (
            <Dashboard
              forexPairs={forexPairs}
              indianUnderlyings={indianUnderlyings}
              candlesMap={candlesMap}
              onSelectSignal={(sig) => setSelectedSignal(sig)}
              onEnsureCandles={ensureCandlesLoaded}
              initialOptionSymbol={selectedOptionUnderlying}
              environment={environment}
            />
          )
        )}

        {activeTab === 'market_sessions' && (
          <MarketSessionsWidget />
        )}

        {activeTab === 'signals' && (
          <SignalsView
            signals={signals}
            onSelectSignal={(sig) => setSelectedSignal(sig)}
          />
        )}

        {activeTab === 'trading' && (
          <TradingHub
            environment={environment}
            selectedBroker={selectedBroker}
            maskedAccount={maskedAccount}
            balance={balance}
            currency={currency}
            isEmergencyHalted={isEmergencyHalted}
            onRequestEnvironmentChange={handleRequestEnvironmentChange}
          />
        )}

        {activeTab === 'shadow_mode' && (
          <ShadowModeDashboard />
        )}

        {activeTab === 'forensics' && (
          <PredictionForensicsPage />
        )}

        {activeTab === 'direction_analysis' && (
          <DirectionAnalysisPage />
        )}

        {activeTab === 'native_indicators' && (
          <NativeIndicatorsReportPage />
        )}

        {activeTab === 'dynamic_exits' && (
          <DynamicExitAnalysisPage />
        )}

        {activeTab === 'short_tp' && (
          <ShortTPOptimizationPage />
        )}

        {(activeTab === 'pnl' || activeTab === 'accounting') && (
          <PnLAccountingPage />
        )}

        {(activeTab === 'research' || activeTab === 'ml') && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
            Research and ML training interfaces are retired from the LIVE production runtime.
          </div>
        )}

        {(activeTab === 'control_center' || activeTab === 'operations' || activeTab === 'reconciliation' || activeTab === 'reconcile') && (
          <TradingControlCenter
          onSelectSignalModal={(sig) => setSelectedSignal(sig)}
          autoTradingStatus={autoTradingStatus}
          onAutoTradingStatusChange={setAutoTradingStatus}
        />
        )}

        {activeTab === 'alerts' && (
          <AlertsPage />
        )}

        {activeTab === 'history' && (
          <HistoryPage />
        )}

        {activeTab === 'database' && (
          <DatabaseExplorerPage />
        )}

        {activeTab === 'connection_monitor' && (
          <ConnectionMonitorPage />
        )}

        {(activeTab === 'settings' || activeTab === 'governance') && (
          <SettingsHub
            currentEnvironment={environment}
            selectedBroker={selectedBroker}
            onEnvironmentChange={handleRequestEnvironmentChange}
            onBrokerSelect={handleSelectBroker}
            onRefreshGlobal={refreshBrokerStatus}
          />
        )}
        </Suspense>
      </main>
 
      <Suspense fallback={null}>
      {/* Signal Quantitative Inspection Modal */}
      {selectedSignal && (
        <SignalModal
          signal={selectedSignal}
          onClose={() => setSelectedSignal(null)}
        />
      )}

      {/* Database & Diagnostics Modal */}
      {showDiagnostics && (
        <DiagnosticsModal
          onClose={() => setShowDiagnostics(false)}
        />
      )}

      {/* Order Confirmation Modal */}
      {pendingOrder && (
        <OrderConfirmationModal
          isOpen={!!pendingOrder}
          onClose={() => setPendingOrder(null)}
          onConfirm={handleExecuteConfirmedOrder}
          order={pendingOrder}
          broker={selectedBroker}
          environment={environment}
          maskedAccount={maskedAccount}
          currentPrice={pendingOrder.price || 0}
        />
      )}
      </Suspense>
    </GlobalAppShell>
  );
}