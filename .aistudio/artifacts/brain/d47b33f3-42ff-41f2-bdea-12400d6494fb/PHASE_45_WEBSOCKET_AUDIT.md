# PHASE_45_WEBSOCKET_AUDIT

## 1. Connection Lifecycle Audit

The current WebSocket architecture is high-churn.
- **Root Cause**: `src/brokers/adapters/cTrader/cTraderApiClient.ts` (`withAuthenticatedAccount`) instantiates a `new WebSocket` for every retry of every account-scoped API operation.
- **Lifecycle**: `Request -> Instantiate WebSocket -> Authenticate App -> Authenticate Account -> Perform Request -> Close WebSocket`.
- **Result**: Even for simple read operations (like fetching a quote), the client creates and tears down a full, authenticated WebSocket connection. During application startup, this triggers a storm of socket connections, often hitting connection limits, causing `socket hang up` or `ECONNRESET` errors due to server-side rate limiting or TLS handshake exhaustion.

## 2. Affected Call Sites

- **Primary Driver**: `withAuthenticatedAccount` in `cTraderApiClient.ts`.
- **Callers**:
    - `fetchLiveCTraderAccounts`
    - `fetchLiveCTraderAccountDetails`
    - `fetchCTraderSymbols`
    - `fetchLiveCTraderQuote` (Attempted fix for persistence added, needs generalization)
    - `fetchCTraderTrendbars`
    - `fetchCTraderOrderDetails`
    - `fetchCTraderDeals`
    - `submitLiveCTraderOrder`
    - `amendLiveCTraderOrder`
    - `cancelLiveCTraderOrder`
    - `closeLiveCTraderPosition`

## 3. Failure Modes

- **Socket Exhaustion**: Rapid creation of sockets leads to OS/Broker limits.
- **TLS Handshake Latency**: Constant re-authentication and TLS negotiation adds significant overhead.
- **Race Conditions**: `webSocketManager` registration/deregistration is not atomic with respect to the `withAuthenticatedAccount` retry loop, leading to overlapping socket attempts.
- **Rate Limiting**: High frequency of authentication requests triggers broker-side throttling.

## 4. Remediation Plan

1.  **Centralize Connection Management**: Refactor `WebSocketManager` to act as a proper connection pool/registry.
2.  **Implement Connection Persistence**: Modify `withAuthenticatedAccount` to request a *shared* authenticated connection from the `WebSocketManager` instead of opening a new one.
3.  **Request Correlation**: Implement unique client message IDs and a pending-request registry in the manager to allow safe multiplexing of requests over a single shared connection.
4.  **Controlled Reconnection**: Implement a state-machine-based reconnection logic (single-flight) to prevent reconnect storms.
5.  **Telemetry**: Add structured logging to monitor connection reuse rates, latency, and failure reasons.
