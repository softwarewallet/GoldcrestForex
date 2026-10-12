
type WebSocketHandler = WebSocket;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: NodeJS.Timeout;
}

interface SocketMetadata {
  ws: WebSocketHandler;
  connectionTime: number;
  retryCount: number;
  pingLatency: number;
  pendingRequests: Map<string, PendingRequest>;
  status: 'CONNECTING' | 'READY' | 'CLOSED';
}

class WebSocketManager {
  private activeSockets: Map<string, SocketMetadata> = new Map();

  // Get or create connection (basic pooling placeholder for now)
  async getConnection(accountId: number, isLive: boolean): Promise<WebSocket> {
      // Logic for actual pooling will be integrated here
      throw new Error('Not implemented');
  }

  register(id: string, ws: WebSocketHandler, retryCount: number = 0) {
    this.close(id);
    this.activeSockets.set(id, {
      ws,
      connectionTime: Date.now(),
      retryCount,
      pingLatency: 0,
      pendingRequests: new Map(),
      status: 'READY'
    });
  }
  
  // New request correlation methods
  registerRequest(socketId: string, requestId: string, resolve: (v: any) => void, reject: (r: any) => void, timeoutMs: number) {
      const meta = this.activeSockets.get(socketId);
      if(!meta) throw new Error('Socket not found');
      
      const timeout = setTimeout(() => {
          meta.pendingRequests.delete(requestId);
          reject(new Error('Request timeout'));
      }, timeoutMs);
      
      meta.pendingRequests.set(requestId, { resolve, reject, timeout });
  }
  
  resolveRequest(socketId: string, requestId: string, response: any) {
      const meta = this.activeSockets.get(socketId);
      if(!meta) return;
      
      const req = meta.pendingRequests.get(requestId);
      if(req) {
          clearTimeout(req.timeout);
          meta.pendingRequests.delete(requestId);
          req.resolve(response);
      }
  }

  close(id: string) {
    const meta = this.activeSockets.get(id);
    if (meta) {
      meta.pendingRequests.forEach(req => {
          clearTimeout(req.timeout);
          req.reject(new Error('Socket closed'));
      });
      try { meta.ws.close(); } catch {}
      this.activeSockets.delete(id);
    }
  }

  getAllSocketInfo() {
    return Array.from(this.activeSockets.entries()).map(([id, meta]) => ({
      id,
      connectionTime: meta.connectionTime,
      retryCount: meta.retryCount,
      pingLatency: meta.pingLatency,
      status: meta.status
    }));
  }
}

export const webSocketManager = new WebSocketManager();
