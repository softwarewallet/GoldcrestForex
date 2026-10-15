
import WebSocket from 'ws';

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

  constructor() {
    console.log('WebSocketManager initialized');
  }

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
        ws.setMaxListeners(1000);
        ws.on('close', () => {
          this.stopHeartbeat(key);
          this.handleReconnection(key, connectFn);
        });
        
        ws.on('message', (data: any) => {
          const meta = this.activeSockets.get(keyStr);
          if (meta) meta.lastHeartbeat = Date.now();
          try {
            const message = JSON.parse(data.toString());
            if (message.clientMsgId) {
              this.resolveRequest(key, message.clientMsgId, message);
            }
          } catch (e) {
            console.error('Failed to parse message', e);
          }
        });
        
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
        this.startHeartbeat(key);
        return ws;
      } finally {
        this.pendingConnections.delete(keyStr);
      }
    })();

    this.pendingConnections.set(keyStr, connectionPromise);
    return connectionPromise;
  }

  async sendRequest(key: ConnectionKey, payload: any, messageType: number): Promise<any> {
    const keyStr = serializeKey(key);
    const meta = this.activeSockets.get(keyStr);
    if (!meta || meta.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Socket not ready');
    }

    const requestId = Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      this.registerRequest(key, requestId, resolve, reject, 20000);
      
      meta.ws.send(JSON.stringify({
        payload,
        clientMsgId: requestId,
        payloadType: messageType
      }));
    });
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

  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();

  private startHeartbeat(key: ConnectionKey) {
    const keyStr = serializeKey(key);
    this.stopHeartbeat(key);
    
    this.heartbeatIntervals.set(keyStr, setInterval(() => {
      const meta = this.activeSockets.get(keyStr);
      if (!meta || meta.ws.readyState !== WebSocket.OPEN) return;

      // cTrader Heartbeat is usually a simple ping/pong or a heartbeat message
      // Assuming it needs to be sent explicitly based on requirements.
      // For now, update state check.
      if (Date.now() - meta.lastHeartbeat > 30000) {
        meta.state = 'DEGRADED';
        this.close(key);
      }
    }, 10000));
  }

  private stopHeartbeat(key: ConnectionKey) {
    const keyStr = serializeKey(key);
    if (this.heartbeatIntervals.has(keyStr)) {
      clearInterval(this.heartbeatIntervals.get(keyStr)!);
      this.heartbeatIntervals.delete(keyStr);
    }
  }

  private async handleReconnection(key: ConnectionKey, connectFn: () => Promise<WebSocket>) {
    const keyStr = serializeKey(key);
    const meta = this.activeSockets.get(keyStr);
    
    // Increment retry count, apply exponential backoff
    if (meta && meta.retryCount < 20) {
        meta.retryCount++;
        meta.state = 'RECONNECTING';
        
        // Apply exponential backoff with jitter
        const delay = Math.min(1000 * Math.pow(2, meta.retryCount) + Math.random() * 1000, 30000);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Retry
        this.activeSockets.delete(keyStr); 
        this.getConnection(key, connectFn);
    } else {
        this.activeSockets.delete(keyStr);
        console.error('Max reconnection retries reached for', keyStr);
    }
  }

  close(keyOrId: ConnectionKey | string) {
    const keyStr = typeof keyOrId === 'string' ? keyOrId : serializeKey(keyOrId);
    if (typeof keyOrId !== 'string') {
      this.stopHeartbeat(keyOrId);
    } else {
      for (const [k, meta] of this.activeSockets.entries()) {
        if (k === keyOrId) {
          this.stopHeartbeat(meta.key);
        }
      }
    }
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

  getAllSocketInfo(): {
    id: string;
    state: ConnectionState;
    connectionTime: number;
    retryCount: number;
    pingLatency: number;
    broker: string;
    endpoint: string;
    accountId: number;
    isLive: boolean;
    lastHeartbeat: number;
    readyState: number;
  }[] {
    return Array.from(this.activeSockets.entries()).map(([id, meta]) => ({
      id,
      state: meta.state,
      connectionTime: meta.connectionTime,
      retryCount: meta.retryCount,
      pingLatency: meta.pingLatency,
      broker: meta.key.broker,
      endpoint: meta.key.endpoint,
      accountId: meta.key.accountId,
      isLive: meta.key.isLive,
      lastHeartbeat: meta.lastHeartbeat,
      readyState: meta.ws ? meta.ws.readyState : 0
    }));
  }
}

export const webSocketManager = new WebSocketManager();
