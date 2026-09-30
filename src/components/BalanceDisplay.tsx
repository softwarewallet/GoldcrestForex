import React, { useEffect, useState } from 'react';
import { Wallet, RefreshCw, Clock } from 'lucide-react';
import { BrokerAccountInfo, BrokerType } from '../brokers/types';

interface BalanceDisplayProps {
  environment?: string;
}

const BROKERS: BrokerType[] = ['CTRADER'];

export const BalanceDisplay: React.FC<BalanceDisplayProps> = () => {
  const [account, setAccount] = useState<BrokerAccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const fetchBalances = async (force: boolean = false) => {
    setLoading(true);

    try {
      const url = force ? '/api/brokers/status?force=true' : '/api/brokers/status';
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || data?.message || `Broker status request failed (HTTP ${response.status})`));
      }

      const row = Array.isArray(data?.brokers)
        ? data.brokers.find((item: any) => item?.broker === 'CTRADER')
        : null;

      if (row?.account && row.account.broker === 'CTRADER') {
        setAccount(row.account as BrokerAccountInfo);
        setError(null);
        setLastUpdated(Date.now());
      } else {
        const message = String(row?.error || row?.lastRefreshError || '');
        setError(message || 'cTrader live account data unavailable');
      }
    } catch (err: any) {
      setError(err?.message || 'Broker status temporarily unavailable');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalances();
    const interval = setInterval(fetchBalances, 10000);
    return () => clearInterval(interval);
  }, []);

  const formatCurrency = (value: number | undefined, currency = 'USD') => {
    if (value === undefined || value === null || !Number.isFinite(value)) return '--';
    const normalized = currency.toUpperCase();
    return new Intl.NumberFormat('en-US', {
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

  const isStale = lastUpdated ? Date.now() - lastUpdated > 30000 : false;

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
    <div id="balance_display_ctrader" className="flex flex-col bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg py-2 px-3 min-w-[330px] shadow-sm font-mono">
      <div className="flex items-start justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-amber-400 animate-pulse' : account?.connectionStatus === 'CONNECTED' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">cTrader</span>
          <span className="text-[8px] px-1 rounded bg-slate-800 text-slate-400 border border-slate-700">FOREX LIVE</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Wallet className="w-3.5 h-3.5 text-emerald-500" />
          <button
            type="button"
            id="btn_refresh_balance_ctrader"
            onClick={() => fetchBalances(true)}
            disabled={loading}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-emerald-400 disabled:opacity-50 transition cursor-pointer"
            title="Refresh Balance"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
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
              <Clock className="inline w-2.5 h-2.5 mr-0.5" />{isStale ? 'STALE' : timeAgo(lastUpdated)}
            </span>
          </div>
        </>
      ) : (
        <div className="py-1.5">
          <div className="text-sm font-bold text-slate-500">{loading ? 'Connecting…' : 'Balance Unavailable'}</div>
          {error && (
            <div className="text-[10px] text-amber-400 mt-1 truncate" title={error}>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
