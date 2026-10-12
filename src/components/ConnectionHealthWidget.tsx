import React, { useState, useEffect } from 'react';
import { webSocketManager } from '../services/webSocketManager';

export const ConnectionHealthWidget: React.FC = () => {
  const [connections, setConnections] = useState<any[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setConnections(webSocketManager.getAllSocketInfo());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-4 bg-gray-800 text-white rounded shadow-md">
      <h3 className="text-lg font-bold mb-2">Connection Health</h3>
      {connections.length === 0 ? (
        <p className="text-gray-400">No active connections</p>
      ) : (
        connections.map(([id, meta]) => (
          <div key={id} className="mb-2 text-sm border-b border-gray-700 pb-1">
            <p className="font-mono text-xs">{id.slice(0, 15)}...</p>
            <p>Duration: {Math.round((Date.now() - meta.connectionTime) / 1000)}s</p>
            <p>Retries: {meta.retryCount}</p>
            <p>Latency: {meta.pingLatency}ms</p>
          </div>
        ))
      )}
    </div>
  );
};
