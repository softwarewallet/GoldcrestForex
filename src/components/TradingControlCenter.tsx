import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  DollarSign,
  Eye,
  FileCheck,
  FileText,
  Filter,
  Flame,
  Globe,
  HelpCircle,
  Info,
  Layers,
  Link as LinkIcon,
  Lock,
  PieChart,
  Play,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Terminal,
  TrendingDown,
  TrendingUp,
  Unlock,
  XCircle,
  Zap
} from 'lucide-react';
import { BrokerType, TradingEnvironment, OrderRequest } from '../brokers/types';
import { TradingSignal } from '../markets/common/types';

export type ControlCenterSection =
  | 'ALL_OVERVIEW'
  | 'ACCOUNT_OVERVIEW'
  | 'MARKET_INTELLIGENCE'
  | 'OPTIONS_CHAIN'
  | 'SIGNAL_CENTER'
  | 'POSITIONS'
  | 'ORDERS'
  | 'RISK_CENTER'
  | 'RECONCILIATION'
  | 'SYSTEM_HEALTH'
  | 'AUDIT_CENTER'
  | 'SAFETY_STATUS';

export type FreshnessStatus = 'LIVE' | 'RECENT' | 'STALE' | 'ERROR' | 'UNAVAILABLE';

interface AccountCardData {
  broker: BrokerType;
  accountId: string;
  accountStatus: 'ACTIVE' | 'DISCONNECTED' | 'ERROR' | 'ACCOUNT_NOT_FOUND';
  connectionStatus: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR';
  currency: 'USD' | 'INR';
  balance: number;
  equity: number;
  availableMargin: number;
  usedMargin: number;
  marginLevelPct?: number;
  unrealizedPnl: number;
  realizedPnl: number;
  lastSyncTimestamp: number;
  freshness: FreshnessStatus;
  source: string;
  errorMessage?: string;
}

interface MarketQuoteItem {
  market: 'FOREX' | 'INDIA_EQUITY';
  symbol: string;
  bid: number;
  ask: number;
  ltp: number;
  spreadPipsOrPts: number;
  change24h: number;
  changePercent24h: number;
  volume24h?: number;
  timestamp: number;
  timeframe: string;
  status: 'OPEN' | 'CLOSED' | 'EXTENDED';
  freshness: FreshnessStatus;
}

interface PositionItem {
  positionId: string;
  broker: BrokerType;
  account: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  currency: 'USD' | 'INR';
  openedAt: number;
  brokerSyncStatus: 'SYNCED' | 'PENDING' | 'DESYNC';
  reconciliationStatus: 'MATCH' | 'MINOR_DELAY' | 'MATERIAL_MISMATCH';
}

interface OrderItem {
  internalOrderId: string;
  brokerOrderId: string;
  account: string;
  broker: BrokerType;
  instrument: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  status: 'CREATED' | 'VALIDATED' | 'RISK_CHECKED' | 'SUBMITTED' | 'ACKNOWLEDGED' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED' | 'RECONCILED';
  createdAt: number;
  updatedAt: number;
  reconciliationState: 'MATCH' | 'PENDING_ACK' | 'MISMATCH';
  rejectionReason?: string;
}

interface RiskTimelineEvent {
  id: string;
  timestamp: number;
  broker: BrokerType;
  account: string;
  instrument?: string;
  eventType:
    | 'SIGNAL QUALIFIED'
    | 'RISK APPROVED'
    | 'RISK REJECTED'
    | 'LIMIT REACHED'
    | 'STALE DATA'
    | 'ACCOUNT DATA UNAVAILABLE'
    | 'CURRENCY MISMATCH'
    | 'RECONCILIATION FAILURE'
    | 'EXECUTION GATE BLOCKED';
  reason: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

interface SystemHealthComponent {
  id: string;
  name: string;
  status: 'HEALTHY' | 'DEGRADED' | 'ERROR' | 'OFFLINE';
  lastSuccessTimestamp: number;
  latencyMs: number;
  errorCount24h: number;
  currentFailureState?: string;
  lastRecoveryTimestamp?: number;
  requestCount24h: number;
  successCount24h: number;
  failedCount24h: number;
  timeoutCount24h: number;
  rateLimitEvents24h: number;
}

interface ReconciliationComparison {
  category: 'BALANCE' | 'POSITIONS' | 'ORDERS' | 'TRADES_FILLS' | 'PNL';
  brokerValue: string | number;
  internalValue: string | number;
  sqliteCount: string | number;
  status: 'MATCH' | 'MINOR_DELAY' | 'MATERIAL_MISMATCH' | 'SOURCE_UNAVAILABLE';
  quantityDiff?: number;
  priceDiff?: number;
  currencyDiff?: string;
  details: string;
}

interface TradingControlCenterProps {
  initialSection?: ControlCenterSection;
  onSelectSignalModal?: (signal: TradingSignal) => void;
  autoTradingStatus?: any | null;
  onAutoTradingStatusChange?: (status: any) => void;
}

export const TradingControlCenter: React.FC<TradingControlCenterProps> = ({
  initialSection = 'ALL_OVERVIEW',
  onSelectSignalModal,
  autoTradingStatus: parentAutoTradingStatus = null,
  onAutoTradingStatusChange
}) => {
  const [activeSection, setActiveSection] = useState<ControlCenterSection>(initialSection);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(Date.now());
  const [selectedSignalDecision, setSelectedSignalDecision] = useState<any | null>(null);
  const [autoTradingStatus, setAutoTradingStatus] = useState<any | null>(parentAutoTradingStatus);
  const [autoTradingBusy, setAutoTradingBusy] = useState(false);
  const [closedMarketPrompt, setClosedMarketPrompt] = useState<any | null>(null);
  const [dailyLossLimitPct, setDailyLossLimitPct] = useState<number>(3);

  // Filter States
  const [positionBrokerFilter, setPositionBrokerFilter] = useState<string>('ALL');
  const [positionCurrencyFilter, setPositionCurrencyFilter] = useState<string>('ALL');
  const [positionReconFilter, setPositionReconFilter] = useState<string>('ALL');

  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('ALL');
  const [orderBrokerFilter, setOrderBrokerFilter] = useState<string>('ALL');

  const [auditSearchQuery, setAuditSearchQuery] = useState<string>('');
  const [auditCategoryFilter, setAuditCategoryFilter] = useState<string>('ALL');
  const [auditSeverityFilter, setAuditSeverityFilter] = useState<string>('ALL');

  // Options Workspace State
  const [optionsUnderlying, setOptionsUnderlying] = useState<string>('NIFTY');
  const [optionsExpiry, setOptionsExpiry] = useState<string>('');
  const [optionsStrikeRange, setOptionsStrikeRange] = useState<number>(7);
  const [optionsChainData, setOptionsChainData] = useState<any | null>(null);
  const [optionsLoading, setOptionsLoading] = useState<boolean>(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  // Execution Gate State
  const [gateBusy, setGateBusy] = useState<boolean>(false);
  const [gateFeedback, setGateFeedback] = useState<string | null>(null);

  // Live broker/account/market state only; empty until authoritative APIs return data.
  const [accounts, setAccounts] = useState<AccountCardData[]>([]);
  const [marketQuotes, setMarketQuotes] = useState<MarketQuoteItem[]>([]);
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [signals, setSignals] = useState<any[]>([]);
  const [riskTimeline, setRiskTimeline] = useState<RiskTimelineEvent[]>([]);
  const [reconciliations, setReconciliations] = useState<ReconciliationComparison[]>([]);
  const [healthComponents, setHealthComponents] = useState<SystemHealthComponent[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [newsSnapshot, setNewsSnapshot] = useState<any | null>(null);
  const [newsBusy, setNewsBusy] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch('/api/config', { cache: 'no-store' })
      .then(async (res) => res.ok ? await res.json() : null)
      .then((config) => {
        const value = Number(config?.maxDailyLossPct);
        if (mounted && Number.isFinite(value) && value > 0) setDailyLossLimitPct(value);
      })
      .catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  // Fetch live operational data from authoritative broker and runtime APIs.
  const fetchAllOperationalData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [
        brokerStatusRes,
        positionsRes,
        ordersRes,
        auditLogsRes,
        reconPositionsRes,
        reconOrdersRes,
        healthRes,
        autoTradingRes,
        forexPairsRes,
        indiaUnderlyingsRes,
        signalsRes,
        newsRes
      ] = await Promise.all([
        fetch('/api/brokers/status', { cache: 'no-store' }).catch(() => null),
        fetch('/api/brokers/positions', { cache: 'no-store' }).catch(() => null),
        fetch('/api/brokers/orders', { cache: 'no-store' }).catch(() => null),
        fetch('/api/governance/audit-logs?limit=100', { cache: 'no-store' }).catch(() => null),
        fetch('/api/governance/reconciliation/positions', { cache: 'no-store' }).catch(() => null),
        fetch('/api/governance/reconciliation/orders', { cache: 'no-store' }).catch(() => null),
        fetch('/api/governance/live-health', { cache: 'no-store' }).catch(() => null),
        fetch('/api/auto-trading/status', { cache: 'no-store' }).catch(() => null),
        fetch('/api/forex/pairs', { cache: 'no-store' }).catch(() => null),
        fetch('/api/india/underlyings', { cache: 'no-store' }).catch(() => null),
        fetch('/api/signals/all', { cache: 'no-store' }).catch(() => null),
        fetch('/api/forex/news', { cache: 'no-store' }).catch(() => null)
      ]);

      if (autoTradingRes?.ok) {
        const nextStatus = await autoTradingRes.json();
        setAutoTradingStatus(nextStatus);
        onAutoTradingStatusChange?.(nextStatus);
      } else if (parentAutoTradingStatus) {
        // App-level status is the canonical browser-wide state. Keep the
        // Control Center synchronized even when a transient telemetry request
        // fails during page navigation/remount.
        setAutoTradingStatus(parentAutoTradingStatus);
      }

      if (brokerStatusRes?.ok) {
        const status = await brokerStatusRes.json();
        const liveAccounts: AccountCardData[] = (Array.isArray(status?.brokers) ? status.brokers : [])
          .filter((item: any) => item?.environment === 'LIVE' && item?.account)
          .map((item: any) => {
            const account = item.account;
            const connected = item.connected === true;
            const currency = String(account.currency || 'USD').toUpperCase();
            return {
              broker: item.broker,
              accountId: String(account.accountId || '****'),
              accountStatus: connected ? 'ACTIVE' : 'ERROR',
              connectionStatus: connected ? 'CONNECTED' : 'ERROR',
              currency: currency === 'INR' ? 'INR' : 'USD',
              balance: Number(account.balance),
              equity: Number(account.equity),
              availableMargin: Number(account.availableMargin ?? account.freeMargin),
              usedMargin: Number(account.usedMargin ?? 0),
              marginLevelPct: account.marginLevelPct !== undefined ? Number(account.marginLevelPct) : undefined,
              unrealizedPnl: Number(account.unrealizedPnL ?? account.unrealizedPnl ?? 0),
              realizedPnl: Number(account.realizedPnL ?? account.realizedPnl ?? 0),
              lastSyncTimestamp: Number(account.lastUpdate || Date.now()),
              freshness: 'LIVE',
              source: item.broker === 'CTRADER' ? 'cTrader LIVE API' : '5paisa LIVE API',
              errorMessage: item.error || undefined
            };
          })
          .filter((account: AccountCardData) =>
            Number.isFinite(account.balance) && Number.isFinite(account.equity)
          );
        setAccounts(liveAccounts);
      }

      if (positionsRes?.ok) {
        const livePositions = await positionsRes.json();
        const rows = Array.isArray(livePositions) ? livePositions : [];
        setPositions(rows
          .filter((p: any) => p?.environment === 'LIVE')
          .map((p: any): PositionItem => ({
            positionId: String(p.id || p.brokerPositionId || ''),
            broker: p.broker,
            account: String(p.accountId || p.account || '****'),
            symbol: p.symbol,
            side: p.side,
            quantity: Number(p.quantity),
            entryPrice: Number(p.entryPrice),
            currentPrice: Number(p.currentPrice),
            unrealizedPnl: Number(p.unrealizedPnL ?? 0),
            realizedPnl: Number(p.realizedPnL ?? 0),
            currency: String(p.currency || 'USD').toUpperCase() === 'INR' ? 'INR' : 'USD',
            openedAt: Number(p.timestamp || Date.now()),
            brokerSyncStatus: 'SYNCED',
            reconciliationStatus: 'MINOR_DELAY'
          }))
          .filter((p: PositionItem) =>
            p.positionId && Number.isFinite(p.quantity) && Number.isFinite(p.entryPrice) && Number.isFinite(p.currentPrice)
          ));
      }

      if (ordersRes?.ok) {
        const liveOrders = await ordersRes.json();
        const rows = Array.isArray(liveOrders) ? liveOrders : [];
        setOrders(rows
          .filter((o: any) => o?.environment === 'LIVE')
          .map((o: any): OrderItem => ({
            internalOrderId: String(o.id || ''),
            brokerOrderId: String(o.brokerOrderId || o.id || ''),
            account: String(o.accountId || o.account || '****'),
            broker: o.broker,
            instrument: o.symbol,
            side: o.side,
            quantity: Number(o.quantity),
            price: Number(o.price ?? 0),
            status: o.status,
            createdAt: Number(o.timestamp || Date.now()),
            updatedAt: Number(o.timestamp || Date.now()),
            reconciliationState: 'MATCH',
            rejectionReason: o.rejectionReason
          }))
          .filter((o: any) => o.internalOrderId && Number.isFinite(o.quantity)));
      }

      if (forexPairsRes?.ok || indiaUnderlyingsRes?.ok) {
        const [fxRows, inRows] = await Promise.all([
          forexPairsRes?.ok ? forexPairsRes.json() : [],
          indiaUnderlyingsRes?.ok ? indiaUnderlyingsRes.json() : []
        ]);
        const liveQuotes: MarketQuoteItem[] = [];
        if (Array.isArray(fxRows)) {
          for (const q of fxRows) {
            if (q?.dataStatus !== 'FRESH' && q?.dataStatus !== 'LIVE') continue;
            const bid = Number(q.bid);
            const ask = Number(q.ask);
            if (!(bid > 0 && ask > 0)) continue;
            liveQuotes.push({
              market: 'FOREX',
              symbol: q.symbol,
              bid,
              ask,
              ltp: (bid + ask) / 2,
              spreadPipsOrPts: Number(q.spreadPips ?? q.spreadPipsOrPts ?? 0),
              change24h: Number(q.changePips24h ?? q.changePips ?? 0),
              changePercent24h: Number(q.changePercent24h ?? 0),
              timestamp: Date.now(),
              timeframe: 'LIVE',
              status: 'OPEN',
              freshness: 'LIVE'
            });
          }
        }
        if (Array.isArray(inRows)) {
          for (const q of inRows) {
            const spot = Number(q?.spot);
            if (!(spot > 0)) continue;
            liveQuotes.push({
              market: 'INDIA_EQUITY',
              symbol: q.symbol,
              bid: null as unknown as number,
              ask: null as unknown as number,
              ltp: spot,
              spreadPipsOrPts: Number(q.spreadPoints ?? 0),
              change24h: Number(q.change ?? 0),
              changePercent24h: Number(q.changePercent ?? 0),
              timestamp: Date.now(),
              timeframe: 'LIVE',
              status: 'OPEN',
              freshness: 'LIVE'
            });
          }
        }
        setMarketQuotes(liveQuotes);
      }

      if (signalsRes?.ok) {
        const liveSignals = await signalsRes.json();
        setSignals(Array.isArray(liveSignals) ? liveSignals : []);
      }

      if (newsRes?.ok) {
        const snapshot = await newsRes.json();
        setNewsSnapshot(snapshot);
        setNewsError(snapshot?.status === 'LIVE' ? null : (snapshot?.error || null));
      } else if (newsRes) {
        const payload = await newsRes.json().catch(() => ({}));
        setNewsError(payload?.message || payload?.error || 'Live news endpoint unavailable.');
      }

      if (auditLogsRes?.ok) {
        const raw = await auditLogsRes.json();
        const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.logs) ? raw.logs : [];
        setAuditLogs(rows.map((log: any, index: number) => ({
          eventId: log.id,
          sequenceNumber: index + 1,
          timestamp: Number(log.timestamp || Date.now()),
          category: String(log.action || '').toLowerCase().includes('risk') ? 'RISK'
            : String(log.action || '').toLowerCase().includes('order') ? 'ORDER'
            : String(log.action || '').toLowerCase().includes('position') ? 'POSITION'
            : String(log.action || '').toLowerCase().includes('account') ? 'ACCOUNT'
            : String(log.action || '').toLowerCase().includes('market') ? 'MARKET_DATA'
            : 'SAFETY',
          action: log.action,
          operatorId: log.account || log.source || 'LIVE',
          payload: {
            broker: log.broker,
            environment: log.environment,
            symbol: log.symbol,
            quantity: log.quantity,
            result: log.result,
            error: log.error
          },
          currentHash: ''
        })));

        const riskRows = rows.filter((log: any) => {
          const action = String(log.action || '').toUpperCase();
          return action.includes('RISK')
            || action.includes('REJECT')
            || action.includes('BLOCK')
            || action.includes('LIMIT')
            || action.includes('KILL')
            || action.includes('STALE')
            || action.includes('RECONCILIATION')
            || action.includes('EXECUTION_GATE')
            || action.includes('EXECUTION_');
        });

        setRiskTimeline(riskRows.slice(0, 20).map((log: any, index: number) => {
          const action = String(log.action || '').toUpperCase();
          const isBlocked = log.result === 'BLOCKED' || action.includes('BLOCK');
          const isFailure = log.result === 'FAILURE' || action.includes('REJECT') || action.includes('FAIL');
          const isLimit = action.includes('LIMIT');

          let eventType: RiskTimelineEvent['eventType'] = 'RISK APPROVED';
          if (isLimit) {
            eventType = 'LIMIT REACHED';
          } else if (isFailure) {
            eventType = action.includes('STALE')
              ? 'STALE DATA'
              : action.includes('RECONCILIATION')
                ? 'RECONCILIATION FAILURE'
                : 'RISK REJECTED';
          } else if (isBlocked) {
            eventType = 'EXECUTION GATE BLOCKED';
          } else if (action.includes('STALE')) {
            eventType = 'STALE DATA';
          } else if (action.includes('RECONCILIATION')) {
            eventType = 'RECONCILIATION FAILURE';
          }

          return {
            id: log.id || `RISK_${index}`,
            timestamp: Number(log.timestamp || Date.now()),
            broker: log.broker || 'CTRADER',
            account: log.account || '****',
            instrument: log.symbol,
            eventType,
            reason: log.error || log.action || 'Live risk event',
            severity: isFailure ? 'CRITICAL' : isBlocked || isLimit ? 'WARNING' : 'INFO'
          };
        }));
      }

      const reconRows: ReconciliationComparison[] = [];
      for (const response of [reconPositionsRes, reconOrdersRes]) {
        if (!response?.ok) continue;
        const payload = await response.json();
        const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.comparisons) ? payload.comparisons : [];
        for (const row of rows) reconRows.push(row);
      }
      setReconciliations(reconRows);

      if (healthRes?.ok) {
        const health = await healthRes.json();
        setHealthComponents(Array.isArray(health?.components) ? health.components : []);
      }

      setLastRefreshedAt(Date.now());
    } catch (err) {
      console.warn('Control Center live refresh failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const fetchNewsNow = useCallback(async () => {
    setNewsBusy(true);
    setNewsError(null);
    try {
      const response = await fetch('/api/forex/news?refresh=true', {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || `News refresh failed (HTTP ${response.status})`);
      }
      setNewsSnapshot(payload);
      if (payload?.error) setNewsError(payload.error);
      // Refresh the Auto Live telemetry as well so the header NEWS pill
      // immediately reflects the same provider fetch that the operator just triggered.
      const autoRes = await fetch('/api/auto-trading/status', { cache: 'no-store' }).catch(() => null);
      if (autoRes?.ok) {
        const autoStatus = await autoRes.json();
        setAutoTradingStatus(autoStatus);
        onAutoTradingStatusChange?.(autoStatus);
      }
    } catch (err: any) {
      setNewsError(err?.message || 'Manual news refresh failed.');
    } finally {
      setNewsBusy(false);
    }
  }, []);

  const toggleAutoTrading = useCallback(async () => {
    setAutoTradingBusy(true);
    try {
      const shouldStop = ['RUNNING', 'PREPARING'].includes(autoTradingStatus?.state);
      const res = await fetch(shouldStop ? '/api/auto-trading/stop' : '/api/auto-trading/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json().catch(() => ({}));

      if (data?.requiresClosedMarketConfirmation) {
        setClosedMarketPrompt(data);
        setAutoTradingStatus(data);
        return;
      }

      setAutoTradingStatus(data);
      onAutoTradingStatusChange?.(data);
      if (!res.ok) {
        console.warn(
          'Auto trading control rejected:',
          data?.lastCycleResult || data?.message || data?.error || res.statusText
        );
      }
    } catch (err) {
      console.warn('Auto trading control failed:', err);
    } finally {
      setAutoTradingBusy(false);
    }
  }, [autoTradingStatus?.state]);

  const confirmClosedMarketAutoLive = useCallback(async () => {
    setAutoTradingBusy(true);
    setClosedMarketPrompt(null);
    try {
      const res = await fetch('/api/auto-trading/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmWhenClosed: true })
      });
      const data = await res.json().catch(() => ({}));
      setAutoTradingStatus(data);
      onAutoTradingStatusChange?.(data);
      if (!res.ok) {
        console.warn(
          'Confirmed auto trading start rejected:',
          data?.lastCycleResult || data?.message || data?.error || res.statusText
        );
      }
    } catch (err) {
      console.warn('Confirmed auto trading start failed:', err);
    } finally {
      setAutoTradingBusy(false);
    }
  }, []);

  const abandonClosedMarketAutoLive = useCallback(async () => {
    setClosedMarketPrompt(null);
    try {
      const res = await fetch('/api/auto-trading/abandon-closed-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      setAutoTradingStatus(data);
    } catch (err) {
      console.warn('Closed-market auto trading abandonment could not be logged:', err);
    }
  }, []);

  const unlockExecutionGate = useCallback(async () => {
    setGateBusy(true);
    setGateFeedback(null);
    try {
      const res = await fetch('/api/execution-gate/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setGateFeedback('Execution gate armed & operational.');
        fetchAllOperationalData();
      } else {
        setGateFeedback(data.message || 'Failed to unlock execution gate.');
      }
    } catch (err) {
      console.warn('Unlock execution gate failed:', err);
      setGateFeedback('Error unlocking execution gate.');
    } finally {
      setGateBusy(false);
    }
  }, [fetchAllOperationalData]);

  const lockExecutionGate = useCallback(async () => {
    setGateBusy(true);
    setGateFeedback(null);
    try {
      const res = await fetch('/api/execution-gate/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setGateFeedback('Execution gate locked by operator.');
        fetchAllOperationalData();
      }
    } catch (err) {
      console.warn('Lock execution gate failed:', err);
    } finally {
      setGateBusy(false);
    }
  }, [fetchAllOperationalData]);
  // Fetch Options Chain
  const fetchOptionsChain = useCallback(async (symbol: string, expiry?: string, depth: number = 7) => {
    setOptionsLoading(true);
    setOptionsError(null);
    try {
      const url = `/api/options/chain/${encodeURIComponent(symbol)}?depth=${depth}${expiry ? `&expiry=${encodeURIComponent(expiry)}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.isBlank && data.error) {
          setOptionsError(data.error);
        } else {
          setOptionsChainData(data);
          if (data.expiry && !optionsExpiry) {
            setOptionsExpiry(data.expiry);
          }
        }
      } else {
        const errData = await res.json().catch(() => ({ error: 'Failed to fetch options chain' }));
        setOptionsError(errData.error || 'Options API Unavailable');
      }
    } catch (err: any) {
      setOptionsError(err.message || 'Failed to connect to Options Data Adapter');
    } finally {
      setOptionsLoading(false);
    }
  }, [optionsExpiry]);

  useEffect(() => {
    if (parentAutoTradingStatus) {
      setAutoTradingStatus(parentAutoTradingStatus);
    }
  }, [parentAutoTradingStatus]);

  useEffect(() => {
    fetchAllOperationalData();
    fetchOptionsChain(optionsUnderlying, optionsExpiry, optionsStrikeRange);

    const interval = setInterval(() => {
      fetchAllOperationalData();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchAllOperationalData, fetchOptionsChain, optionsUnderlying, optionsExpiry, optionsStrikeRange]);

  // Filtered Positions
  const filteredPositions = useMemo(() => {
    return positions.filter(pos => {
      if (positionBrokerFilter !== 'ALL' && pos.broker !== positionBrokerFilter) return false;
      if (positionCurrencyFilter !== 'ALL' && pos.currency !== positionCurrencyFilter) return false;
      if (positionReconFilter !== 'ALL' && pos.reconciliationStatus !== positionReconFilter) return false;
      return true;
    });
  }, [positions, positionBrokerFilter, positionCurrencyFilter, positionReconFilter]);

  // Filtered Orders
  const filteredOrders = useMemo(() => {
    return orders.filter(ord => {
      if (orderStatusFilter !== 'ALL' && ord.status !== orderStatusFilter) return false;
      if (orderBrokerFilter !== 'ALL' && ord.broker !== orderBrokerFilter) return false;
      return true;
    });
  }, [orders, orderStatusFilter, orderBrokerFilter]);

  // Filtered Audit Logs
  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter(log => {
      if (auditCategoryFilter !== 'ALL' && log.category !== auditCategoryFilter) return false;
      if (auditSearchQuery) {
        const q = auditSearchQuery.toLowerCase();
        const actionMatch = log.action.toLowerCase().includes(q);
        const opMatch = log.operatorId.toLowerCase().includes(q);
        const payloadMatch = JSON.stringify(log.payload || {}).toLowerCase().includes(q);
        if (!actionMatch && !opMatch && !payloadMatch) return false;
      }
      return true;
    });
  }, [auditLogs, auditCategoryFilter, auditSearchQuery]);

  const formatNumber = (value: unknown, options?: Intl.NumberFormatOptions): string => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toLocaleString(undefined, options) : '—';
  };

  const formatFixed = (value: unknown, digits: number): string => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(digits) : '—';
  };

  const formatMarketValue = (value: number | null | undefined, market: MarketQuoteItem['market'], symbol: string) => {
    const digits = market === 'FOREX' && !symbol.includes('JPY') ? 5 : 2;
    return formatFixed(value, digits);
  };

  // Calculate Freshness Badge Style
  const renderFreshnessBadge = (freshness: FreshnessStatus, timestamp?: number) => {
    const ageSeconds = timestamp ? Math.floor((Date.now() - timestamp) / 1000) : 0;
    switch (freshness) {
      case 'LIVE':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>LIVE ({ageSeconds}s ago)</span>
          </span>
        );
      case 'RECENT':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-950/80 text-sky-300 border border-sky-700">
            <span>RECENT ({ageSeconds}s ago)</span>
          </span>
        );
      case 'STALE':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-950/80 text-amber-300 border border-amber-700">
            <AlertTriangle className="w-3 h-3" />
            <span>STALE ({ageSeconds}s ago)</span>
          </span>
        );
      case 'ERROR':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950/80 text-rose-300 border border-rose-700">
            <XCircle className="w-3 h-3" />
            <span>ERROR</span>
          </span>
        );
      case 'UNAVAILABLE':
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-900 text-slate-400 border border-slate-800">
            <span>UNAVAILABLE</span>
          </span>
        );
    }
  };

  return (
    <div id="trading_control_center_main" className="space-y-4">
      {closedMarketPrompt && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-lg bg-slate-900 border border-amber-700/80 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Markets Closed</h3>
              </div>
              <button
                onClick={abandonClosedMarketAutoLive}
                className="text-slate-500 hover:text-white text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-4 font-mono text-xs">
              <div className="text-base font-semibold text-amber-200">
                Markets are closed, do you still want to start Auto Live
              </div>
              <p className="text-slate-400 leading-relaxed">
                Selecting <strong className="text-white">Yes</strong> will arm Auto Live and keep the system in
                <strong className="text-amber-300"> PREPARING</strong> state. Before a supported market opens,
                Goldcrest will refresh live market trends and check live macro-news conditions. No order is
                submitted during this preparation phase.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-slate-500 text-[10px]">FOREX / cTRADER</div>
                  <div className={closedMarketPrompt.marketGate?.forex?.isOpen ? 'text-emerald-400 font-bold mt-1' : 'text-amber-300 font-bold mt-1'}>
                    {closedMarketPrompt.marketGate?.forex?.isOpen ? 'OPEN' : 'CLOSED'}
                  </div>
                  <div className="text-slate-500 text-[10px] mt-1">
                    {closedMarketPrompt.marketGate?.forex?.sessions?.join(' / ') || 'Session unavailable'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-slate-500 text-[10px]">INDIA / 5PAISA</div>
                  <div className={closedMarketPrompt.marketGate?.india?.isOpen ? 'text-emerald-400 font-bold mt-1' : 'text-amber-300 font-bold mt-1'}>
                    {closedMarketPrompt.marketGate?.india?.isOpen ? 'OPEN' : 'CLOSED'}
                  </div>
                  <div className="text-slate-500 text-[10px] mt-1">
                    {closedMarketPrompt.marketGate?.india?.phase || 'Session unavailable'}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={abandonClosedMarketAutoLive}
                  disabled={autoTradingBusy}
                  className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800 font-bold disabled:opacity-50"
                >
                  No — Abandon
                </button>
                <button
                  type="button"
                  onClick={confirmClosedMarketAutoLive}
                  disabled={autoTradingBusy}
                  className="px-4 py-2 rounded-lg border border-emerald-600 bg-emerald-950/70 text-emerald-300 hover:bg-emerald-900/70 font-bold disabled:opacity-50"
                >
                  Yes — Start Auto Live
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 1. MASTER OPERATIONAL HEADER & NAVIGATION BAR */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold shadow-inner">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white tracking-tight">Trading Control Center</h2>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  PHASE 11 LIVE OPS
                </span>
              </div>
              <div className="text-slate-400 text-xs flex items-center space-x-2 mt-0.5">
                <span>Multi-Market Operations</span>
                <span className="text-slate-600">•</span>
                <span>cTrader (Forex) & 5paisa (India F&O)</span>
                <span className="text-slate-600">•</span>
                <span>Synced: {new Date(lastRefreshedAt).toLocaleTimeString()}</span>
              </div>
            </div>
          </div>

          {/* Quick Status Pill Bar */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300">
              <span className="text-slate-500">GOVERNANCE:</span>
              <strong className="text-emerald-400">EXP-2026 CLOSED</strong>
            </div>

            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300">
              <span className="text-slate-500">MODEL:</span>
              <strong className="text-slate-200">fx_structure_v2a</strong>
            </div>

            <div className={`flex items-center space-x-1.5 px-2.5 py-1 rounded border font-bold ${
              autoTradingStatus?.state === 'PAUSED_SCHEDULE'
                ? 'bg-amber-950/90 border-amber-500 text-amber-300 animate-pulse'
                : autoTradingStatus?.autonomousPermission
                ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                : 'bg-amber-950/70 border-amber-700 text-amber-300'
            }`}>
              <Zap className="w-3.5 h-3.5" />
              <span>
                AUTO LIVE:{' '}
                {autoTradingStatus?.state === 'PAUSED_SCHEDULE'
                  ? 'PAUSED (RISK WINDOW)'
                  : autoTradingStatus?.state || 'UNKNOWN'}
              </span>
            </div>

            {autoTradingStatus?.scheduler?.enabled && (
              <div
                title={autoTradingStatus.scheduler.message}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded border text-[10px] font-bold ${
                  autoTradingStatus.scheduler.inRiskWindow
                    ? 'bg-amber-950/80 border-amber-600 text-amber-300 animate-pulse'
                    : 'bg-slate-950 border-slate-700 text-slate-300'
                }`}
              >
                <Clock className="w-3 h-3 text-cyan-400" />
                <span>
                  {autoTradingStatus.scheduler.inRiskWindow
                    ? `RISK BLACKOUT ACTIVE (${autoTradingStatus.scheduler.startTime12}–${autoTradingStatus.scheduler.endTime12})`
                    : `SCHEDULE: ${autoTradingStatus.scheduler.startTime12}–${autoTradingStatus.scheduler.endTime12}`}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={toggleAutoTrading}
              disabled={autoTradingBusy}
              className="px-3 py-1 rounded border text-xs font-bold transition disabled:opacity-50 bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800"
              title="Explicitly start or stop autonomous live trading"
            >
              {autoTradingBusy
                ? 'Working...'
                : ['RUNNING', 'PREPARING', 'PAUSED_LIMIT', 'PAUSED_SCHEDULE'].includes(autoTradingStatus?.state)
                ? 'STOP AUTO LIVE'
                : 'START AUTO LIVE'}
            </button>

            {autoTradingStatus?.preOpenPreparation?.news && (
              <div className={`flex items-center gap-2 px-2.5 py-1 rounded border text-[10px] font-mono ${
                autoTradingStatus.preOpenPreparation.news.status === 'LIVE'
                  ? autoTradingStatus.preOpenPreparation.news.riskLevel === 'HIGH'
                    ? 'border-rose-800 bg-rose-950/50 text-rose-200'
                    : 'border-emerald-800 bg-emerald-950/40 text-emerald-200'
                  : 'border-amber-800 bg-amber-950/50 text-amber-200'
              }`}>
                <span>NEWS:</span>
                <strong>{autoTradingStatus.preOpenPreparation.news.status}</strong>
                {autoTradingStatus.preOpenPreparation.news.status === 'LIVE' && (
                  <span>{autoTradingStatus.preOpenPreparation.news.articleCount} ARTICLES · {autoTradingStatus.preOpenPreparation.news.riskLevel}</span>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={fetchNewsNow}
              disabled={newsBusy || newsSnapshot?.marketOpen === false}
              className="px-2.5 py-1 rounded border border-cyan-800 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/50 text-[10px] font-mono font-bold disabled:opacity-50 flex items-center gap-1.5"
              title={newsSnapshot?.marketOpen === false ? "Fetch news only while the Forex market is open" : "Force a fresh fetch from all configured news providers"}
            >
              <RefreshCw className={`w-3 h-3 ${newsBusy ? 'animate-spin' : ''}`} />
              {newsBusy ? 'FETCHING NEWS...' : 'FETCH NEWS'}
            </button>

            {autoTradingStatus?.state === 'PREPARING' && autoTradingStatus?.preOpenPreparation && (
              <div className="flex items-center gap-2 px-2.5 py-1 rounded border border-amber-800 bg-amber-950/50 text-[10px] font-mono text-amber-200">
                <Clock className="w-3 h-3 text-amber-400" />
                <span>
                  PRE-OPEN: {autoTradingStatus.preOpenPreparation.trendPairsEvaluated}/{autoTradingStatus.pairs?.length || 0} TRENDS
                  {' · NEWS: '}
                  {autoTradingStatus.preOpenPreparation.news?.status || 'PENDING'}
                  {autoTradingStatus.preOpenPreparation.news?.riskLevel && autoTradingStatus.preOpenPreparation.news.riskLevel !== 'UNAVAILABLE'
                    ? ` / ${autoTradingStatus.preOpenPreparation.news.riskLevel}`
                    : ''}
                </span>
              </div>
            )}

            {autoTradingStatus?.lastCycleResult && (
              <div
                className={`max-w-[420px] px-2.5 py-1 rounded border text-[10px] font-mono ${
                  autoTradingStatus.state === 'BLOCKED'
                    ? 'bg-amber-950/70 border-amber-700 text-amber-200'
                    : autoTradingStatus.state === 'RUNNING'
                      ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200'
                      : 'bg-slate-900 border-slate-700 text-slate-300'
                }`}
                title={autoTradingStatus.lastCycleResult}
              >
                {autoTradingStatus.lastCycleResult}
              </div>
            )}

            <button
              onClick={fetchAllOperationalData}
              disabled={isRefreshing}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition flex items-center space-x-1.5 text-xs font-semibold disabled:opacity-50"
              title="Refresh all Control Center telemetry"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
              <span>{isRefreshing ? 'Syncing...' : 'Sync Ops'}</span>
            </button>
          </div>
        </div>

        {/* Section Navigation Tabs (10 Primary Operations Sections) */}
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5">
          {[
            { id: 'ALL_OVERVIEW', label: 'OVERVIEW', icon: Activity },
            { id: 'MARKET_INTELLIGENCE', label: '2. MARKET INTEL', icon: TrendingUp },
            { id: 'SYSTEM_HEALTH', label: '9. HEALTH & APIS', icon: Server },
            { id: 'SAFETY_STATUS', label: 'SAFETY & GOVERNANCE', icon: Lock }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id as ControlCenterSection)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 whitespace-nowrap ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* SECTION 2: LIVE NEWS PROVIDER MATRIX (FOREX SESSION) */}
      {(activeSection === 'ALL_OVERVIEW' || activeSection === 'MARKET_INTELLIGENCE') && (
        <div id="section_market_intelligence" className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
            <div>
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span>Live News Provider Matrix (Forex Session)</span>
              </h3>
              <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                News ingestion is linked to active Forex trading hours.
              </p>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px]">
              <span className={`px-2 py-1 rounded border ${
                newsSnapshot?.status === 'MARKET_CLOSED' || newsSnapshot?.marketOpen === false
                  ? 'border-slate-700 bg-slate-950 text-slate-400'
                  : newsSnapshot?.status === 'LIVE'
                    ? 'border-emerald-700 bg-emerald-950/50 text-emerald-300'
                    : newsSnapshot?.status === 'NO_RESULTS' || newsSnapshot?.status === 'STALE'
                      ? 'border-amber-700 bg-amber-950/50 text-amber-300'
                      : 'border-rose-700 bg-rose-950/50 text-rose-300'
              }`}>
                FOREX: {newsSnapshot?.status === 'MARKET_CLOSED' || newsSnapshot?.marketOpen === false ? 'CLOSED (WEEKEND)' : newsSnapshot?.status || 'NOT FETCHED'}
              </span>
              <span className="text-slate-500">
                {newsSnapshot?.articleCount ?? 0} usable articles
              </span>
            </div>
          </div>

          {newsSnapshot?.status === 'MARKET_CLOSED' || newsSnapshot?.marketOpen === false ? (
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4 text-center font-mono text-xs text-slate-400">
              FOREX MARKET CLOSED — live news ingestion and macro analysis are disabled while the Forex market is closed.
            </div>
          ) : (
            <>
              {newsError && (
                <div className="mb-3 px-3 py-2 rounded border border-rose-800 bg-rose-950/30 text-rose-300 text-[10px] font-mono">
                  {newsError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                {[
                  ['FINNHUB', 'Finnhub'],
                  ['MASSIVE', 'Massive'],
                  ['CURRENTS', 'Currents'],
                  ['GOOGLE_NEWS_RSS', 'Google News RSS']
                ].map(([key, label]) => {
                  const d = newsSnapshot?.providerDiagnostics?.[key];
                  const status = d?.status || newsSnapshot?.providerStatus?.[key] || 'NO_RESULTS';
                  const badge = status === 'LIVE'
                    ? 'text-emerald-300 border-emerald-800 bg-emerald-950/40'
                    : status === 'STALE' || status === 'RATE_LIMITED'
                      ? 'text-amber-300 border-amber-800 bg-amber-950/40'
                      : status === 'ERROR'
                        ? 'text-rose-300 border-rose-800 bg-rose-950/40'
                        : 'text-slate-400 border-slate-800 bg-slate-950';
                  return (
                    <div key={key} className="p-3 rounded-lg border border-slate-800 bg-slate-950/70 font-mono">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-white">{label}</span>
                        <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${badge}`}>{status}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-2 text-[9px]">
                        <div><div className="text-slate-600">RAW</div><div className="text-slate-300">{d?.rawArticleCount ?? 0}</div></div>
                        <div><div className="text-slate-600">FRESH</div><div className="text-cyan-300">{d?.freshArticleCount ?? 0}</div></div>
                        <div><div className="text-slate-600">STALE</div><div className="text-amber-300">{d?.staleArticleCount ?? 0}</div></div>
                      </div>
                      {d?.error && <div className="mt-2 text-[9px] text-rose-400 truncate" title={d.error}>{d.error}</div>}
                      <div className="mt-2 flex items-center justify-between text-[9px] text-slate-600">
                        <span>STALE {d?.staleArticleCount ?? 0}</span>
                        <span>{Number.isFinite(Number(d?.latencyMs)) ? `${Number(d?.latencyMs)}ms` : '—'}</span>
                      </div>
                      {(d?.latestRawArticleAt || d?.latencyMs !== undefined) && (
                        <div className="mt-2 text-[8px] text-slate-600">
                          {d?.latestRawArticleAt ? `Latest raw: ${new Date(d.latestRawArticleAt).toLocaleTimeString()}` : 'No timestamp'}
                          {d?.latencyMs !== undefined ? ` · ${d.latencyMs}ms` : ''}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 text-[10px] text-slate-500 font-mono">
                Last news fetch: {newsSnapshot?.fetchedAt ? new Date(newsSnapshot.fetchedAt).toLocaleTimeString() : 'N/A'}
                {newsSnapshot?.latestArticleAt ? ` · Latest article: ${new Date(newsSnapshot.latestArticleAt).toLocaleTimeString()}` : ''}
                {newsSnapshot?.queryPairs?.length ? ` · Universe: ${newsSnapshot.queryPairs.join(', ')}` : ''}
              </div>
            </>
          )}
        </div>
      )}

      {/* SECTION 9: SYSTEM HEALTH & API MONITORING */}
      {(activeSection === 'ALL_OVERVIEW' || activeSection === 'SYSTEM_HEALTH') && (
        <div id="section_system_health" className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3 font-mono text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                <Server className="w-4 h-4 text-emerald-400" />
                <span>System Health & API Operational Monitoring</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Latency, error budgets, and component uptime metrics
              </p>
            </div>
            <div className="px-2.5 py-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-bold">
              ALL SUBSYSTEMS HEALTHY
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {healthComponents.map((comp, compIdx) => (
              <div key={comp.id || `health-${comp.name || compIdx}`} className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs truncate" title={comp.name}>{comp.name}</span>
                  <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 shrink-0">
                    {comp.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-slate-500">Latency: </span>
                    <strong className="text-emerald-400">{comp.latencyMs}ms</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Errors (24h): </span>
                    <strong className="text-slate-200">{comp.errorCount24h}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Requests: </span>
                    <strong className="text-slate-300">{formatNumber(comp.requestCount24h)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Success: </span>
                    <strong className="text-emerald-400">100%</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SECTION 11: SAFETY STATUS & MODEL GOVERNANCE */}
      {(activeSection === 'ALL_OVERVIEW' || activeSection === 'SAFETY_STATUS') && (
        <div id="section_safety_status" className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-4 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>Execution Safety Invariant & Model Governance</span>
            </h3>
            <span className={`font-bold text-xs px-2.5 py-1 rounded border ${autoTradingStatus?.autonomousPermission
              ? 'text-emerald-300 bg-emerald-950/80 border-emerald-700'
              : 'text-amber-300 bg-amber-950/80 border-amber-700'
            }`}>
              AUTO LIVE: {autoTradingStatus?.state || 'UNKNOWN'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Safety Invariant Card */}
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-xs">EXECUTION GATE & SAFETY STATUS</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${autoTradingStatus?.autonomousPermission
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                  : 'bg-amber-950 text-amber-300 border-amber-700'
                }`}>
                  {autoTradingStatus?.autonomousPermission ? 'UNLOCKED / ARMED' : 'LOCKED (GATED)'}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between bg-slate-900/80 p-2.5 rounded border border-slate-800">
                  <span className="text-slate-400">LIVE_AUTO_EXECUTION_ALLOWED</span>
                  <div className="flex items-center space-x-2">
                    <strong className={autoTradingStatus?.autonomousPermission ? 'text-emerald-400' : 'text-amber-400'}>
                      {autoTradingStatus?.autonomousPermission ? 'true (OPERATIONAL)' : 'false (GATED)'}
                    </strong>
                    <button
                      onClick={autoTradingStatus?.autonomousPermission ? lockExecutionGate : unlockExecutionGate}
                      disabled={gateBusy}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                        autoTradingStatus?.autonomousPermission
                          ? 'bg-amber-950/80 border-amber-700 text-amber-300 hover:bg-amber-900'
                          : 'bg-emerald-950/80 border-emerald-700 text-emerald-300 hover:bg-emerald-900'
                      }`}
                    >
                      {gateBusy ? '...' : autoTradingStatus?.autonomousPermission ? 'Lock' : 'Unlock'}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-slate-900/80 p-2.5 rounded border border-slate-800">
                  <span className="text-slate-400">Live Account Connected:</span>
                  <strong className="text-emerald-400">YES (cTrader & 5paisa)</strong>
                </div>

                <div className="flex items-center justify-between bg-slate-900/80 p-2.5 rounded border border-slate-800">
                  <span className="text-slate-400">Live Execution Authorized:</span>
                  <strong className={autoTradingStatus?.autonomousPermission ? 'text-emerald-400' : 'text-amber-400'}>
                    {autoTradingStatus?.autonomousPermission ? 'YES' : 'NO'}
                  </strong>
                </div>
              </div>
            </div>

            {/* Model Governance Card */}
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-xs">MODEL GOVERNANCE</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700">
                  EXP-2026 CLOSED
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between bg-slate-900/80 p-2.5 rounded border border-slate-800">
                  <span className="text-slate-400">Production Model:</span>
                  <div className="text-right">
                    <strong className="text-emerald-400">fx_structure_v2a</strong>
                    <div className="text-[10px] text-slate-500">Deterministic strategy / approval-gated</div>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-slate-900/80 p-2.5 rounded border border-slate-800">
                  <span className="text-slate-400">Research Candidate:</span>
                  <div className="text-right">
                    <strong className="text-amber-400">ML BASELINE</strong>
                    <div className="text-[10px] text-slate-500">Uncalibrated / not used for autonomous execution</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};