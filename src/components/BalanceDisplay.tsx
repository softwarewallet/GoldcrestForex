import React, { useEffect, useState } from 'react';
import { Wallet, RefreshCw, AlertCircle, Clock } from 'lucide-react';
import { BrokerAccountInfo, BrokerType } from '../brokers/types';

interface BalanceDisplayProps {
  environment?: string;
}

const BROKERS: BrokerType[] = ['CTRADER'];

export const BalanceDisplay: React.FC<BalanceDisplayProps> = () => {
  const [accounts, setAccounts] = useState<Record<BrokerType, BrokerAccountInfo | null>>({
    CTRADER: null,
    FIVE_PAISA: null
  });
  const [errors, setErrors] = useState<Record<BrokerType, string | null>>({
    CTRADER: null,
    FIVE_PAISA: null
  });
  const [loading, setLoading] = useState<Record<BrokerType, boolean>>({
    CTRADER: false,
    FIVE_PAISA: false
  });
  const [lastUpdated, setLastUpdated] = useState<Record<BrokerType, number | null>>({
    CTRADER: null,
    FIVE_PAISA: null
  });

  const fetchBalances = async (force: boolean = false) => {
    setLoading(prev => ({ ...prev, CTRADER: true }));

    try {
      // Use the shared broker-status snapshot rather than making additional
      // broker account calls from the header. The server coalesces/caches this
      // endpoint, preventing UI refresh loops from triggering broker throttling.
      const url = force ? '/api/brokers/status?force=true' : '/api/brokers/status';
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || data?.message || `Broker status request failed (HTTP ${response.status})`));
      }

      const nextAccounts: Record<BrokerType, BrokerAccountInfo | null> = {
        CTRADER: null,
        FIVE_PAISA: null
      };
      const nextErrors: Record<BrokerType, string | null> = {
        CTRADER: null,
        FIVE_PAISA: null
      };
      const now = Date.now();

      for (const broker of BROKERS) {
        const row = Array.isArray(data?.brokers)
          ? data.brokers.find((item: any) => item?.broker === broker)
          : null;

        if (row?.account && row.account.broker === broker) {
          nextAccounts[broker] = row.account as BrokerAccountInfo;
          continue;
        }

        const message = String(row?.error || row?.lastRefreshError || '');
        nextErrors[broker] = message || `${broker} live account data unavailable`;

        // Keep the last known account visible during a transient provider throttle.
        if (row?.code === 'RATE_LIMITED' || row?.lastRefreshError) {
          const previousAccount = accounts[broker];
          if (previousAccount) {
            nextAccounts[broker] = previousAccount;
            continue;
          }
        }
      }

      setAccounts(nextAccounts);
      setErrors(nextErrors);
      setLastUpdated(prev => ({
        ...prev,
        CTRADER: nextAccounts.CTRADER ? now : prev.CTRADER
      }));
    } catch (err: any) {
      setErrors(prev => ({
        ...prev,
        CTRADER: prev.CTRADER || err?.message || 'Broker status temporarily unavailable'
      }));
    } finally {
      setLoading(prev => ({ ...prev, CTRADER: false }));
    }
  };

  useEffect(() => {
    fetchBalances();
    // 30 seconds refresh interval for cTrader balance
    const interval = setInterval(fetchBalances, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatCurrency = (value: number | undefined, currency = 'USD') => {
    if (value === undefined || value === null || !Number.isFinite(value)) return '--';
    const normalized = currency.toUpperCase();
    return new Intl.NumberFormat(normalized === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency: normalized,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const timeAgo = (timestamp: number | null) => {
    if (!timestamp) return '—';
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
  };

  const renderCard = (broker: BrokerType) => {
    const account = accounts[broker];
    const error = errors[broker];
    const isLoading = loading[broker];
    const updated = lastUpdated[broker];
    const isStale = updated ? Date.now() - updated > 60000 : false;
    const label = broker === 'CTRADER' ? 'cTrader' : '5paisa';
    const market = broker === 'CTRADER' ? 'FOREX' : 'INDIAN MARKETS';

    const metric = (
      title: string,
      value: number | undefined,
      tone: string = 'text-white'
    ) => (
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[9px] text-slate-500">
          <span>{title}</span>
        </div>
        <div className={`mt-0.5 text-[12px] font-semibold font-mono ${tone}`}>
          {formatCurrency(value, account?.currency)}
        </div>
      </div>
    );

    return (
      <div key={broker} id={`balance_display_${broker.toLowerCase()}`} className="flex flex-col bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg py-2 px-3 min-w-[340px] shadow-sm font-mono">
        <div className="flex items-start justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-amber-400 animate-pulse' : account?.connectionStatus === 'CONNECTED' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">{label}</span>
            <span className="text-[8px] px-1 rounded bg-slate-800 text-slate-500 border border-slate-700">{market}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5 text-emerald-500" />
            <button
              type="button"
              id={`btn_refresh_balance_${broker.toLowerCase()}`}
              onClick={() => fetchBalances(true)}
              disabled={isLoading}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-emerald-400 disabled:opacity-50 transition cursor-pointer"
              title="Refresh Balance (30s auto-refresh)"
            >
              <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {account ? (
          <>
            <div className="grid grid-cols-4 gap-2 border-t border-slate-800/60 pt-2">
              {metric('Balance', account.balance)}
              {metric('Equity', account.equity)}
              {metric('Used margin', account.usedMargin, 'text-amber-300')}
              {metric('Free margin', account.freeMargin ?? account.availableMargin, 'text-emerald-300')}
            </div>
            <div className="mt-1.5 pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-[9px] text-slate-500">
              <span className="truncate max-w-[145px]" title={account.accountId}>A/C {account.accountId}</span>
              <span>{account.currency}</span>
              <span className={isStale ? 'text-amber-400 font-bold' : 'text-slate-500'}>
                <Clock className="inline w-2.5 h-2.5 mr-0.5" />{isStale ? 'STALE' : timeAgo(updated)}
              </span>
            </div>
          </>
        ) : (
          <div className="py-1.5">
            <div className="text-sm font-bold text-slate-500">{isLoading ? 'Connecting…' : 'Balance Unavailable'}</div>
            {error && (
              <div className="text-[9px] text-rose-400 truncate mt-0.5" title={error}>
                <AlertCircle className="inline w-2.5 h-2.5 mr-1" />
                {error.length > 50 ? `${error.substring(0, 47)}...` : error}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div id="dual_live_balance_display" className="flex items-center gap-2">
      {renderCard('CTRADER')}
    </div>
  );
};
