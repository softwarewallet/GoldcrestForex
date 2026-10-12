import React, { useState, useEffect } from 'react';
import { webSocketManager } from '../services/webSocketManager';

export const ConnectionHealthWidget: React.FC = () => {
  const [connections, setConnections] = useState<any[]>([]);

  useEffect(() => {
    const update = () => {
      if (typeof webSocketManager?.getAllSocketInfo === 'function') {
        try {
          setConnections(webSocketManager.getAllSocketInfo());
        } catch (e) {
          console.error('Error in ConnectionHealthWidget update:', e);
        }
      } else {
        console.error('webSocketManager.getAllSocketInfo is not a function. Manager:', webSocketManager);
      }
    };
    
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-4 bg-gray-800 text-white rounded shadow-md">
      <h3 className="text-lg font-bold mb-2">Connection Health</h3>
      {connections.length === 0 ? (
        <p className="text-gray-400">No active connections</p>
      ) : (
        connections.map((socket) => (
          <div key={socket.id} className="mb-2 text-sm border-b border-gray-700 pb-1">
            <p className="font-mono text-xs">{socket.id.slice(0, 15)}...</p>
            <p>Duration: {Math.round((Date.now() - socket.connectionTime) / 1000)}s</p>
            <p>Retries: {socket.retryCount}</p>
            <p>Latency: {socket.pingLatency}ms</p>
          </div>
        ))
      )}
    </div>
  );
};
