import React, { useState, useEffect } from 'react';
import { Activity, ShieldCheck, Wifi, RefreshCw } from 'lucide-react';

export const ConnectionHealthWidget: React.FC = () => {
  const [connections, setConnections] = useState<any[]>([]);
  const [brokerStatus, setBrokerStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchConnectionData = async () => {
    try {
      const [connRes, statusRes] = await Promise.all([
        fetch('/api/connections', { cache: 'no-store' }).catch(() => null),
        fetch('/api/brokers/status', { cache: 'no-store' }).catch(() => null)
      ]);
      if (connRes?.ok) {
        const data = await connRes.json();
        if (Array.isArray(data)) setConnections(data);
      }
      if (statusRes?.ok) {
        const data = await statusRes.json();
        setBrokerStatus(data);
      }
    } catch (e) {
      console.warn('Failed to fetch connection health:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchConnectionData();
    const interval = setInterval(fetchConnectionData, 3000);
    return () => clearInterval(interval);
  }, []);

  const brokersList = Array.isArray(brokerStatus?.brokers) ? brokerStatus.brokers : [];
  const credentialsList = Array.isArray(brokerStatus?.credentials) ? brokerStatus.credentials : [];

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Active Broker Gateways</div>
            <div className="text-xl font-bold text-emerald-400 mt-1">
              {brokersList.filter((b: any) => b.connected).length} / {brokersList.length} Connected
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">Live Broker Routing Active</div>
          </div>
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
            <Wifi className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">WebSocket Sockets</div>
            <div className="text-xl font-bold text-sky-400 mt-1">
              {connections.length} Active
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">Open API Multiplex Stream</div>
          </div>
          <div className="p-3 bg-sky-500/10 border border-sky-500/20 rounded-lg text-sky-400">
            <Activity className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Environment & Status</div>
            <div className="text-xl font-bold text-purple-400 mt-1">
              {brokerStatus?.environment || 'LIVE'}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">Emergency Stop: {brokerStatus?.emergencyStop?.isHalted ? 'HALTED' : 'NORMAL'}</div>
          </div>
          <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg text-purple-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Broker Details Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-md font-mono">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Wifi className="w-4 h-4 text-emerald-400" />
            <span>Configured Broker Gateways & Credentials</span>
          </h3>
          <button
            onClick={() => void fetchConnectionData()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded-lg transition border border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh Status</span>
          </button>
        </div>

        <div className="p-6 overflow-x-auto">
          {isLoading && brokersList.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">Loading broker connection details...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {brokersList.map((brokerItem: any, idx: number) => {
                const cred = credentialsList.find((c: any) => c.broker === brokerItem.broker);
                const isConnected = brokerItem.connected;
                const acc = brokerItem.account;
                return (
                  <div key={idx} className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                        <span className="font-bold text-slate-100">{brokerItem.broker}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">{brokerItem.environment}</span>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${isConnected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                        {isConnected ? 'CONNECTED' : (brokerItem.code || 'DISCONNECTED')}
                      </span>
                    </div>

                    <div className="text-xs space-y-1.5 text-slate-400 border-t border-slate-900 pt-3">
                      <div className="flex justify-between">
                        <span>Account ID:</span>
                        <span className="text-slate-200 font-semibold">{acc?.accountId || cred?.maskedAccountId || '****'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Account Type:</span>
                        <span className="text-slate-200">{acc?.accountType || 'LIVE'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Balance / Equity:</span>
                        <span className="text-slate-200">
                          {acc?.balance !== undefined ? `${acc.balance.toLocaleString()} ${acc?.currency || 'USD'}` : 'N/A'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>API Credentials:</span>
                        <span className={cred?.configured || cred?.hasAccessToken ? 'text-emerald-400' : 'text-amber-400'}>
                          {cred?.configured || cred?.hasAccessToken ? 'Configured & Active' : 'Unconfigured'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Active WebSocket Sockets List */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-md font-mono">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-4 h-4 text-sky-400" />
            <span>Active WebSocket Stream Multiplexer Sockets</span>
          </h3>
          <span className="text-xs text-slate-400">{connections.length} Active Sockets</span>
        </div>

        <div className="p-6">
          {connections.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">
              No active persistent WebSocket sockets currently open. Sockets connect on-demand when placing orders, subscribing to live forex quotes, or streaming order book depth.
            </div>
          ) : (
            <div className="space-y-3">
              {connections.map((socket) => (
                <div key={socket.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="font-bold text-slate-200">{socket.broker || 'cTrader'} ({socket.isLive ? 'LIVE' : 'DEMO'})</span>
                      <span className="text-[10px] font-mono text-slate-500">Account: {socket.accountId}</span>
                    </div>
                    <div className="text-slate-400 font-mono text-[11px] truncate max-w-md">
                      Endpoint: {socket.endpoint}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-slate-300">
                    <div>
                      <span className="text-slate-500 block text-[10px]">STATE</span>
                      <span className="font-semibold text-emerald-400">{socket.state}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">DURATION</span>
                      <span>{Math.round((Date.now() - socket.connectionTime) / 1000)}s</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">RETRIES</span>
                      <span>{socket.retryCount}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">PING LATENCY</span>
                      <span>{socket.pingLatency}ms</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
