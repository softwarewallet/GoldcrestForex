
type WebSocketHandler = WebSocket;

export type ConnectionState = 
  | 'DISCONNECTED' 
  | 'CONNECTING' 
  | 'APP_AUTHENTICATING' 
  | 'ACCOUNT_AUTHENTICATING' 
  | 'READY' 
  | 'DEGRADED' 
  | 'RECONNECTING' 
  | 'CLOSING' 
  | 'CLOSED';

export interface ConnectionKey {
  broker: 'cTrader';
  isLive: boolean;
  endpoint: string;
  accountId: number;
}

export function serializeKey(key: ConnectionKey): string {
  return `${key.broker}:${key.isLive}:${key.endpoint}:${key.accountId}`;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: NodeJS.Timeout;
}

interface SocketMetadata {
  key: ConnectionKey;
  ws: WebSocketHandler;
  state: ConnectionState;
  connectionTime: number;
  retryCount: number;
  pingLatency: number;
  pendingRequests: Map<string, PendingRequest>;
  lastHeartbeat: number;
}

class WebSocketManager {
  private activeSockets: Map<string, SocketMetadata> = new Map();
  private pendingConnections: Map<string, Promise<WebSocket>> = new Map();

  async getConnection(key: ConnectionKey, connectFn: () => Promise<WebSocket>): Promise<WebSocket> {
    const keyStr = serializeKey(key);
    
    // Check existing
    const existing = this.activeSockets.get(keyStr);
    if (existing && existing.ws.readyState === WebSocket.OPEN && existing.state === 'READY') {
      return existing.ws;
    }

    // Single-flight initiation
    if (this.pendingConnections.has(keyStr)) {
      return this.pendingConnections.get(keyStr)!;
    }

    const connectionPromise = (async () => {
      try {
        const ws = await connectFn();
        this.activeSockets.set(keyStr, {
          key,
          ws,
          state: 'READY',
          connectionTime: Date.now(),
          retryCount: 0,
          pingLatency: 0,
          pendingRequests: new Map(),
          lastHeartbeat: Date.now(),
        });
        return ws;
      } finally {
        this.pendingConnections.delete(keyStr);
      }
    })();

    this.pendingConnections.set(keyStr, connectionPromise);
    return connectionPromise;
  }

  registerRequest(key: ConnectionKey, requestId: string, resolve: (v: any) => void, reject: (r: any) => void, timeoutMs: number) {
    const keyStr = serializeKey(key);
    const meta = this.activeSockets.get(keyStr);
    if (!meta) throw new Error('Socket not found');
    
    const timeout = setTimeout(() => {
      meta.pendingRequests.delete(requestId);
      reject(new Error('Request timeout'));
    }, timeoutMs);
    
    meta.pendingRequests.set(requestId, { resolve, reject, timeout });
  }

  resolveRequest(key: ConnectionKey, requestId: string, response: any) {
    const keyStr = serializeKey(key);
    const meta = this.activeSockets.get(keyStr);
    if (!meta) return;
    
    const req = meta.pendingRequests.get(requestId);
    if (req) {
      clearTimeout(req.timeout);
      meta.pendingRequests.delete(requestId);
      req.resolve(response);
    }
  }

  close(key: ConnectionKey) {
    const keyStr = serializeKey(key);
    const meta = this.activeSockets.get(keyStr);
    if (meta) {
      meta.pendingRequests.forEach(req => {
        clearTimeout(req.timeout);
        req.reject(new Error('Socket closed'));
      });
      try { meta.ws.close(); } catch {}
      this.activeSockets.delete(keyStr);
    }
  }

  getAllSocketInfo() {
    return Array.from(this.activeSockets.entries()).map(([id, meta]) => ({
      id,
      state: meta.state,
      connectionTime: meta.connectionTime,
      retryCount: meta.retryCount,
      pingLatency: meta.pingLatency,
    }));
  }
}

export const webSocketManager = new WebSocketManager();
