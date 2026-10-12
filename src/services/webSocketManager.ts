
type WebSocketHandler = WebSocket;

interface SocketMetadata {
  ws: WebSocketHandler;
  connectionTime: number;
  retryCount: number;
  pingLatency: number;
}

class WebSocketManager {
  private activeSockets: Map<string, SocketMetadata> = new Map();

  register(id: string, ws: WebSocketHandler, retryCount: number = 0) {
    console.log(`[DEBUG] Registering socket ${id}, attempt ${retryCount}`);
    
    // Check if we already have an OPEN socket for this ID.
    const existing = this.activeSockets.get(id);
    if (existing && existing.ws.readyState === WebSocket.OPEN) {
        console.log(`[DEBUG] Socket ${id} already OPEN, reusing.`);
        // Close the new one we just created, we don't need it
        try { ws.close(); } catch {}
        return; 
    }

    this.close(id); // Ensure previous instance is closed
    this.activeSockets.set(id, {
      ws,
      connectionTime: Date.now(),
      retryCount,
      pingLatency: 0
    });
  }

  updateLatency(id: string, latency: number) {
    const meta = this.activeSockets.get(id);
    if (meta) {
      meta.pingLatency = latency;
    }
  }

  getSocketInfo(id: string) {
    return this.activeSockets.get(id);
  }

  getAllSocketInfo() {
    return Array.from(this.activeSockets.entries());
  }

  close(id: string) {
    const meta = this.activeSockets.get(id);
    if (meta) {
      const { ws } = meta;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        try {
          ws.close();
        } catch (e) {
          console.error(`Error closing websocket ${id}`, e);
        }
      }
      this.activeSockets.delete(id);
    }
  }

  closeAll() {
    for (const [id] of this.activeSockets.entries()) {
      this.close(id);
    }
  }
}

export const webSocketManager = new WebSocketManager();
