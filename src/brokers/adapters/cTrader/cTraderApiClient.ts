import WebSocket from 'ws';
import https from 'node:https';
import { BrokerAccountInfo, TradingEnvironment } from '../../types';
import { getCTraderApiMode } from '../../../services/configService';
import { recordTradeRequest, recordTradeResult } from '../../../services/tradeAuditLog';
import { webSocketManager, ConnectionKey } from '../../../services/webSocketManager';

export interface CTraderRawAccount {
  ctidTraderAccountId: number;
  isLive: boolean;
  traderLogin: number;
  lastClosingDealTimestamp?: number;
  lastBalanceUpdateTimestamp?: number;
  brokerTitleShort?: string;
  /** cTrader Open API token scope: 0=view, 1=trade. */
  permissionScope?: number;
}

export interface CTraderRealTraderDetails {
  ctidTraderAccountId: number;
  traderLogin: number;
  balance: number;
  equity: number;
  availableMargin: number;
  usedMargin: number;
  freeMargin: number;
  currency: string;
  brokerName?: string;
  isLive: boolean;
  leverageInCents?: number;
  moneyDigits: number;
  /** cTrader account access rights: 0=FULL_ACCESS, 1=CLOSE_ONLY, 2=NO_TRADING, 3=NO_LOGIN. */
  accessRights?: number;
}

const MSG_APP_AUTH_REQ = 2100;
const MSG_APP_AUTH_RES = 2101;
const MSG_ACC_AUTH_REQ = 2102;
const MSG_ACC_AUTH_RES = 2103;
const MSG_ASSET_LIST_REQ = 2112;
const MSG_ASSET_LIST_RES = 2113;
const MSG_TRADER_REQ = 2121;
const MSG_TRADER_RES = 2122;
const MSG_RECONCILE_REQ = 2124;
const MSG_RECONCILE_RES = 2125;
const MSG_SYMBOLS_LIST_REQ = 2114;
const MSG_SYMBOLS_LIST_RES = 2115;
const MSG_SUBSCRIBE_SPOTS_REQ = 2127;
const MSG_SUBSCRIBE_SPOTS_RES = 2128;
const MSG_SPOT_EVENT = 2131;
const MSG_GET_TRENDBARS_REQ = 2137;
const MSG_GET_TRENDBARS_RES = 2138;
const MSG_SUBSCRIBE_LIVE_TRENDBAR_REQ = 2135;
const MSG_GET_ACCOUNTS_REQ = 2149;
const MSG_GET_ACCOUNTS_RES = 2150;
const MSG_NEW_ORDER_REQ = 2106;
const MSG_CANCEL_ORDER_REQ = 2108;
const MSG_AMEND_ORDER_REQ = 2109;
const MSG_AMEND_POSITION_SLTP_REQ = 2110;
const MSG_CLOSE_POSITION_REQ = 2111;
const MSG_DEAL_LIST_REQ = 2133;
const MSG_DEAL_LIST_RES = 2134;
const MSG_EXECUTION_EVENT = 2126;
const MSG_ORDER_ERROR_EVENT = 2132;
const MSG_ORDER_DETAILS_REQ = 2181;
const MSG_ORDER_DETAILS_RES = 2182;
const MSG_SYMBOLS_FOR_CONVERSION_REQ = 2118;
const MSG_SYMBOLS_FOR_CONVERSION_RES = 2119;
const MSG_ERROR_RES = 2142;
const MSG_GET_POSITION_UNREALIZED_PNL_REQ = 2187;
const MSG_GET_POSITION_UNREALIZED_PNL_RES = 2188;

/**
 * The broker adapter remains the cTrader route for Forex; the Open API
 * endpoint is selected explicitly as LIVE or DEMO so credentials can be
 * tested against the matching cTrader account environment.
 */
function getConfiguredCTraderWsHost(mode: 'LIVE' | 'DEMO'): string | null {
  const primaryKey = mode === 'DEMO' ? 'CTRADER_DEMO_API_HOST' : 'CTRADER_LIVE_API_HOST';
  const configured = String(process.env[primaryKey] || '').trim();
  if (!configured || configured.toLowerCase() === 'auto') return null;
  return configured;
}

function getCTraderWsHost(accountIsLive?: boolean): string {
  const mode = getCTraderApiMode();
  const configured = getConfiguredCTraderWsHost(mode);
  if (configured) return configured;
  return mode === 'DEMO'
    ? 'wss://demo.ctraderapi.com:5036'
    : 'wss://live.ctraderapi.com:5036';
}

function isAuthoritativeLiveHost(host: string): boolean {
  try {
    return new URL(host).hostname.toLowerCase() === 'live.ctraderapi.com';
  } catch {
    return false;
  }
}

/**
 * Resolve the cTrader WebSocket endpoint from the selected cTrader API mode.
 */
export function getCTraderRequestHosts(_accountIsLive: boolean): string[] {
  const mode = getCTraderApiMode();
  const configuredHost = getConfiguredCTraderWsHost(mode);
  return [configuredHost || (
    mode === 'DEMO'
      ? 'wss://demo.ctraderapi.com:5036'
      : 'wss://live.ctraderapi.com:5036'
  )];
}

function safeCloseSocket(ws?: WebSocket | null): void {
  if (!ws) return;
  try {
    ws.removeAllListeners();
  } catch {}
  try {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.terminate();
    }
  } catch {}
}

/**
 * Executes a WebSocket request flow against the cTrader Open API (port 5036 JSON interface)
 */
export async function fetchLiveCTraderAccounts(
  clientId: string,
  clientSecret: string,
  accessToken: string,
  _preferredHost: 'live' = 'live'
): Promise<CTraderRawAccount[]> {
  const hosts = getCTraderRequestHosts(true);
  const MAX_RETRIES = 3;
  const TIMEOUT_MS = 10000;

  let lastError: Error | null = null;

  for (const host of hosts) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      let ws: WebSocket | null = null;
      let timer: NodeJS.Timeout | null = null;
      let isDone = false;
      const cleanup = () => {
        if (isDone) return;
        isDone = true;
        if (timer) clearTimeout(timer);
        safeCloseSocket(ws);
      };

      try {
        const accounts = await new Promise<CTraderRawAccount[]>((resolve, reject) => {
          ws = new WebSocket(host, {
            headers: {
              'User-Agent': 'Goldcrest-Trading-Bot/1.3.0'
            },
            agent: new https.Agent({ rejectUnauthorized: false })
          });
          ws.setMaxListeners(100);

          timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Timeout connecting to cTrader host: ${host}`));
          }, TIMEOUT_MS);

          ws.on('open', () => {
            if (isDone) return;
            ws?.send(JSON.stringify({
              clientMsgId: 'app_auth',
              payloadType: MSG_APP_AUTH_REQ,
              payload: { clientId, clientSecret }
            }));
          });

          ws.on('message', (data: any) => {
            if (isDone) return;
            try {
              const raw = typeof data === 'string' ? data : (data?.data ?? data).toString();
              const msg = JSON.parse(raw);
              if (msg.payloadType === MSG_APP_AUTH_RES) {
                ws?.send(JSON.stringify({
                  clientMsgId: 'acc_list',
                  payloadType: MSG_GET_ACCOUNTS_REQ,
                  payload: { accessToken }
                }));
              } else if (msg.payloadType === MSG_GET_ACCOUNTS_RES) {
                const permissionScope = msg.payload?.permissionScope !== undefined
                  ? Number(msg.payload.permissionScope)
                  : undefined;
                const accList: CTraderRawAccount[] = (msg.payload?.ctidTraderAccount || []).map((account: CTraderRawAccount) => ({
                  ...account,
                  permissionScope
                }));
                const endpointIsLive = isAuthoritativeLiveHost(host);
                const eligibleAccounts = accList.filter(account => endpointIsLive ? account.isLive === true : account.isLive === false);
                const accountsToReturn = eligibleAccounts.length > 0 ? eligibleAccounts : accList;
                if (accountsToReturn.length === 0) {
                  cleanup();
                  reject(new Error('cTrader returned accounts, but none match the connected Open API account environment.'));
                  return;
                }
                cleanup();
                resolve(accountsToReturn);
              } else if (msg.payloadType === MSG_ERROR_RES) {
                cleanup();
                reject(new Error(`cTrader API Error: ${JSON.stringify(msg.payload)}`));
              }
            } catch (e: any) {
              cleanup();
              reject(e);
            }
          });

          ws.on('error', (err: any) => {
            cleanup();
            reject(err);
          });
        });

        if (accounts.length > 0) {
          return accounts;
        }
      } catch (err: any) {
        cleanup();
        lastError = err;
        const msg = String(err?.message || '');
        const isTransient =
          msg.includes('Timeout') ||
          msg.includes('ECONNRESET') ||
          msg.includes('ETIMEDOUT') ||
          msg.includes('socket');

        if (isTransient && attempt < MAX_RETRIES) {
          const backoff = Math.min(1000 * Math.pow(1.8, attempt - 1), 10000);
          console.warn(`[cTrader] Connection to ${host} failed (${msg}). Retrying attempt ${attempt + 1}/${MAX_RETRIES} in ${Math.round(backoff)}ms...`);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        break;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
  return [];
}

/**
 * Fetches genuine real-time balance and account details from cTrader Open API
 */
export async function fetchLiveCTraderAccountDetails(
  rawAccount: CTraderRawAccount,
  clientId: string,
  clientSecret: string,
  accessToken: string
): Promise<CTraderRealTraderDetails> {
  const host = getCTraderWsHost(rawAccount.isLive);

  if (isAuthoritativeLiveHost(host) && !rawAccount.isLive) {
    return Promise.reject(new Error(`cTrader account ${rawAccount.ctidTraderAccountId} is not marked LIVE by Open API. The configured LIVE broker endpoint requires a LIVE cTrader account.`));
  }

  return new Promise<CTraderRealTraderDetails>((resolve, reject) => {
    const ws = new WebSocket(host, {
      headers: {
        'User-Agent': 'Goldcrest-Trading-Bot/1.3.0'
      },
      agent: new https.Agent({ rejectUnauthorized: false })
    });
    ws.setMaxListeners(200);
    const wsId = `ct_det_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    // webSocketManager.register(wsId, ws);

    const timer = setTimeout(() => {
      webSocketManager.close(wsId);
      reject(new Error(`Timeout fetching account details from ${host}`));
    }, 15000);

    const assetMap: Record<number, string> = {
      1: 'EUR',
      2: 'GBP',
      16: 'USD',
      17: 'JPY',
      18: 'CHF',
      19: 'AUD',
      20: 'CAD'
    };

    let traderData: any = null;
    let reconcilePositions: any[] = [];

    ws.on('open', () => {
      ws.send(JSON.stringify({
        clientMsgId: 'app_auth',
        payloadType: MSG_APP_AUTH_REQ,
        payload: { clientId, clientSecret }
      }));
    });

    ws.on('message', (data: any) => {
      try {
        const raw = typeof data === 'string' ? data : (data?.data ?? data).toString();
        const msg = JSON.parse(raw);

        if (msg.payloadType === MSG_APP_AUTH_RES) {
          // Authenticate account session
          ws.send(JSON.stringify({
            clientMsgId: 'acc_auth',
            payloadType: MSG_ACC_AUTH_REQ,
            payload: {
              ctidTraderAccountId: rawAccount.ctidTraderAccountId,
              accessToken
            }
          }));
        } else if (msg.payloadType === MSG_ACC_AUTH_RES) {
          // Request asset list for accurate currency mapping
          ws.send(JSON.stringify({
            clientMsgId: 'asset_req',
            payloadType: MSG_ASSET_LIST_REQ,
            payload: {
              ctidTraderAccountId: rawAccount.ctidTraderAccountId
            }
          }));
        } else if (msg.payloadType === MSG_ASSET_LIST_RES) {
          if (Array.isArray(msg.payload?.asset)) {
            for (const a of msg.payload.asset) {
              if (a.assetId && (a.name || a.displayName)) {
                assetMap[a.assetId] = a.name || a.displayName;
              }
            }
          }
          // Request Trader Details (balance, leverage, brokerName)
          ws.send(JSON.stringify({
            clientMsgId: 'trader_req',
            payloadType: MSG_TRADER_REQ,
            payload: {
              ctidTraderAccountId: rawAccount.ctidTraderAccountId
            }
          }));
        } else if (msg.payloadType === MSG_TRADER_RES) {
          traderData = msg.payload?.trader;
          // Reconcile open positions and orders to verify equity
          ws.send(JSON.stringify({
            clientMsgId: 'reconcile_req',
            payloadType: MSG_RECONCILE_REQ,
            payload: {
              ctidTraderAccountId: rawAccount.ctidTraderAccountId
            }
          }));
        } else if (msg.payloadType === MSG_RECONCILE_RES) {
          if (!traderData) {
            clearTimeout(timer);
            webSocketManager.close(wsId);
            return reject(new Error('Trader data missing from cTrader Open API response'));
          }

          const moneyDigits = traderData.moneyDigits !== undefined ? Number(traderData.moneyDigits) : 2;
          const rawBalance = Number(traderData.balance);
          if (!Number.isFinite(rawBalance)) {
            clearTimeout(timer);
            webSocketManager.close(wsId);
            return reject(new Error('cTrader trader details did not include a valid account balance.'));
          }
          const realBalance = rawBalance / Math.pow(10, moneyDigits);

          // ProtoOATrader exposes the authoritative balance, but not live equity or
          // account margin fields. ProtoOAPosition exposes authoritative usedMargin
          // per open position, while ProtoOAGetPositionUnrealizedPnLReq returns the
          // broker-calculated unrealized P&L in deposit currency. Use those broker
          // values instead of looking for non-existent margin/equity fields on
          // ProtoOATrader or trying to infer P&L from reconcile position objects.
          reconcilePositions = Array.isArray(msg.payload?.position) ? msg.payload.position : [];
          const usedMargin = reconcilePositions.reduce((sum: number, position: any) => {
            const raw = Number(position?.usedMargin ?? 0);
            if (!Number.isFinite(raw) || raw < 0) return sum;
            const positionDigits = position?.moneyDigits !== undefined
              ? Number(position.moneyDigits)
              : moneyDigits;
            const divisor = Math.pow(10, Number.isFinite(positionDigits) ? positionDigits : moneyDigits);
            return sum + raw / divisor;
          }, 0);

          // Ask cTrader to calculate P&L in the account deposit currency. This is
          // essential for FX positions because quote-to-deposit currency conversion
          // cannot safely be reconstructed from the reconcile payload alone.
          ws.send(JSON.stringify({
            clientMsgId: 'position_pnl_req',
            payloadType: MSG_GET_POSITION_UNREALIZED_PNL_REQ,
            payload: {
              ctidTraderAccountId: rawAccount.ctidTraderAccountId
            }
          }));
        } else if (msg.payloadType === MSG_GET_POSITION_UNREALIZED_PNL_RES) {
          clearTimeout(timer);
          webSocketManager.close(wsId);

          if (!traderData) {
            return reject(new Error('cTrader trader details missing while calculating account equity.'));
          }

          const moneyDigits = traderData.moneyDigits !== undefined ? Number(traderData.moneyDigits) : 2;
          const rawBalance = Number(traderData.balance);
          if (!Number.isFinite(rawBalance)) {
            return reject(new Error('cTrader trader details did not include a valid account balance.'));
          }
          const realBalance = rawBalance / Math.pow(10, moneyDigits);
          const pnlMoneyDigits = msg.payload?.moneyDigits !== undefined
            ? Number(msg.payload.moneyDigits)
            : moneyDigits;
          const pnlDivisor = Math.pow(10, Number.isFinite(pnlMoneyDigits) ? pnlMoneyDigits : moneyDigits);
          const pnlRows = Array.isArray(msg.payload?.positionUnrealizedPnL)
            ? msg.payload.positionUnrealizedPnL
            : [];
          const netUnrealizedPnl = pnlRows.reduce((sum: number, row: any) => {
            const raw = Number(row?.netUnrealizedPnL ?? 0);
            return Number.isFinite(raw) ? sum + raw / pnlDivisor : sum;
          }, 0);
          const equity = realBalance + netUnrealizedPnl;

          // Used margin was calculated from the authoritative ProtoOAPosition
          // objects received immediately before this P&L response.
          const usedMargin = reconcilePositions.reduce((sum: number, position: any) => {
            const raw = Number(position?.usedMargin ?? 0);
            if (!Number.isFinite(raw) || raw < 0) return sum;
            const positionDigits = position?.moneyDigits !== undefined
              ? Number(position.moneyDigits)
              : moneyDigits;
            const divisor = Math.pow(10, Number.isFinite(positionDigits) ? positionDigits : moneyDigits);
            return sum + raw / divisor;
          }, 0);
          const freeMargin = equity - usedMargin;
          const currency = assetMap[traderData.depositAssetId] || 'USD';

          resolve({
            ctidTraderAccountId: rawAccount.ctidTraderAccountId,
            traderLogin: rawAccount.traderLogin,
            balance: realBalance,
            equity,
            availableMargin: freeMargin,
            usedMargin,
            freeMargin,
            currency,
            brokerName: traderData.brokerName || rawAccount.brokerTitleShort || 'cTrader',
            isLive: rawAccount.isLive,
            leverageInCents: traderData.leverageInCents,
            moneyDigits,
            accessRights: traderData.accessRights !== undefined ? Number(traderData.accessRights) : undefined
          });
        } else if (msg.payloadType === MSG_ERROR_RES) {
          clearTimeout(timer);
          webSocketManager.close(wsId);
          const code = String(msg.payload?.errorCode || '').toUpperCase();
          const description = String(msg.payload?.description || '').trim();
          if (code === 'CANT_ROUTE_REQUEST' || description.toLowerCase().includes('cannot route request') || description.toLowerCase().includes('no environment connection')) {
            reject(new Error(`cTrader Open API cannot route account ${rawAccount.ctidTraderAccountId} through the configured broker endpoint. Verify that the account, access token, and configured cTrader endpoint belong to the same broker environment. (CANT_ROUTE_REQUEST)`));
          } else {
            reject(new Error(`cTrader Account Error: ${JSON.stringify(msg.payload)}`));
          }
        }
      } catch (err: any) {
        clearTimeout(timer);
        webSocketManager.close(wsId);
        reject(err);
      }
    });

    ws.on('error', (err: any) => {
      clearTimeout(timer);
      webSocketManager.close(wsId);
      reject(err);
    });
  });
}


export interface CTraderAssetInfo {
  assetId: number;
  name: string;
  displayName?: string;
  digits?: number;
}

export interface CTraderConversionSymbol {
  symbolId: number;
  symbolName: string;
  baseAssetId?: number;
  quoteAssetId?: number;
}

export async function fetchCTraderAssets(
  ctidTraderAccountId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean
): Promise<CTraderAssetInfo[]> {
  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const payload = await sendAndAwait(ws, MSG_ASSET_LIST_REQ, { ctidTraderAccountId }, MSG_ASSET_LIST_RES, 15000);
    const assets = Array.isArray(payload.asset) ? payload.asset : [];
    return assets
      .filter((a: any) => a.assetId !== undefined && (a.name || a.displayName))
      .map((a: any) => ({
        assetId: Number(a.assetId),
        name: String(a.name || a.displayName).toUpperCase(),
        displayName: a.displayName ? String(a.displayName) : undefined,
        digits: a.digits !== undefined ? Number(a.digits) : undefined
      }));
  });
}

export async function fetchCTraderConversionSymbols(
  ctidTraderAccountId: number,
  firstAssetId: number,
  lastAssetId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean
): Promise<CTraderConversionSymbol[]> {
  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const payload = await sendAndAwait(ws, MSG_SYMBOLS_FOR_CONVERSION_REQ, {
      ctidTraderAccountId,
      firstAssetId,
      lastAssetId
    }, MSG_SYMBOLS_FOR_CONVERSION_RES, 15000);
    const symbols = Array.isArray(payload.symbol) ? payload.symbol : [];
    return symbols
      .filter((s: any) => s.symbolId !== undefined && s.symbolName)
      .map((s: any) => ({
        symbolId: Number(s.symbolId),
        symbolName: String(s.symbolName),
        baseAssetId: s.baseAssetId !== undefined ? Number(s.baseAssetId) : undefined,
        quoteAssetId: s.quoteAssetId !== undefined ? Number(s.quoteAssetId) : undefined
      }));
  });
}

export interface CTraderMarketQuote {
  symbol: string;
  symbolId: number;
  bid?: number;
  ask?: number;
  timestamp: number;
  status: 'FRESH' | 'STALE';
}

export interface CTraderSpotSubscriptionSymbol {
  symbolId: number;
  symbol: string;
  digits: number;
}

/** Deduplicate and validate symbol IDs before issuing a batched Open API request. */
export function normalizeCTraderSpotSymbolIds(symbolIds: number[]): number[] {
  const unique: number[] = [];
  for (const raw of Array.isArray(symbolIds) ? symbolIds : []) {
    const id = Number(raw);
    if (Number.isSafeInteger(id) && id > 0 && !unique.includes(id)) unique.push(id);
  }
  return unique;
}

/** Keep the wire payload shape testable and consistent for single- and multi-symbol subscriptions. */
export function buildCTraderSpotSubscriptionPayload(
  ctidTraderAccountId: number,
  symbolIds: number[]
): { ctidTraderAccountId: number; symbolId: number[]; subscribeToSpotTimestamp: boolean } {
  if (!Number.isSafeInteger(ctidTraderAccountId) || ctidTraderAccountId <= 0) {
    throw new Error('A valid cTrader account ID is required for spot subscriptions.');
  }
  const normalizedIds = normalizeCTraderSpotSymbolIds(symbolIds);
  if (normalizedIds.length === 0) {
    throw new Error('A spot subscription batch must contain at least one valid symbol ID.');
  }
  return { ctidTraderAccountId, symbolId: normalizedIds, subscribeToSpotTimestamp: true };
}

export interface CTraderCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface CTraderSymbolInfo {
  symbolId: number;
  symbolName: string;
  digits: number;
  pipPosition: number;
  /** cTrader protocol volume constraints are expressed in 1/100 of a base unit. */
  minVolume?: number;
  maxVolume?: number;
  stepVolume?: number;
  lotSize?: number;
  baseAssetId?: number;
  quoteAssetId?: number;
}

const TREND_BAR_PERIODS: Record<string, number> = {
  '1M': 1, '2M': 2, '3M': 3, '4M': 4, '5M': 5, '10M': 6,
  '15M': 7, '30M': 8, '1H': 9, '4H': 10, '12H': 11, 'DAILY': 12, '1D': 12, 'D': 12,
  '1W': 13, '1MN': 14
};

function priceFromRelative(value: number, digits = 5): number {
  return value / Math.pow(10, digits);
}

function getPayloadTypeName(payloadType: number): string {
  const names: Record<number, string> = {
    [MSG_APP_AUTH_REQ]: 'AppAuthReq (2100)',
    [MSG_APP_AUTH_RES]: 'AppAuthRes (2101 - Application Authentication)',
    [MSG_ACC_AUTH_REQ]: 'AccountAuthReq (2102)',
    [MSG_ACC_AUTH_RES]: 'AccountAuthRes (2103 - Account Authorization)',
    [MSG_ASSET_LIST_REQ]: 'AssetListReq (2112)',
    [MSG_ASSET_LIST_RES]: 'AssetListRes (2113)',
    [MSG_TRADER_REQ]: 'TraderReq (2121)',
    [MSG_TRADER_RES]: 'TraderRes (2122 - Trader Profile)',
    [MSG_RECONCILE_REQ]: 'ReconcileReq (2124)',
    [MSG_RECONCILE_RES]: 'ReconcileRes (2125 - Positions & Orders)',
    [MSG_SYMBOLS_LIST_REQ]: 'SymbolsListReq (2114)',
    [MSG_SYMBOLS_LIST_RES]: 'SymbolsListRes (2115)',
    [MSG_SUBSCRIBE_SPOTS_REQ]: 'SubscribeSpotsReq (2127)',
    [MSG_SUBSCRIBE_SPOTS_RES]: 'SubscribeSpotsRes (2128)',
    [MSG_GET_TRENDBARS_REQ]: 'GetTrendbarsReq (2137)',
    [MSG_GET_TRENDBARS_RES]: 'GetTrendbarsRes (2138)',
    [MSG_NEW_ORDER_REQ]: 'NewOrderReq (2106)',
    [MSG_CANCEL_ORDER_REQ]: 'CancelOrderReq (2108)',
    [MSG_AMEND_ORDER_REQ]: 'AmendOrderReq (2109)',
    [MSG_AMEND_POSITION_SLTP_REQ]: 'AmendPositionSLTPReq (2110)',
    [MSG_CLOSE_POSITION_REQ]: 'ClosePositionReq (2111)',
    [MSG_DEAL_LIST_REQ]: 'DealListReq (2133)',
    [MSG_DEAL_LIST_RES]: 'DealListRes (2134)',
  };
  return names[payloadType] || `Type ${payloadType}`;
}

interface WsQueuedRequest {
  priority: number;
  sequence: number;
  enqueuedAt: number;
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface WsConnectionRequestQueueState {
  pending: WsQueuedRequest[];
  draining: boolean;
  sequence: number;
  lastRequestTimestamp: number;
  cooldownUntil: number;
}

const wsConnectionState = new WeakMap<WebSocket, WsConnectionRequestQueueState>();
// Preserve cTrader's request-rate limit while preventing long historical-candle
// backlogs from delaying quotes and orders. FIFO ordering is retained within a priority.
const MIN_REQUEST_INTERVAL_MS = Math.max(
  750,
  Number(process.env.CTRADER_MIN_REQUEST_INTERVAL_MS || 1000)
);

function getCTraderRequestPriority(payloadType: number): number {
  if ([MSG_NEW_ORDER_REQ, MSG_CANCEL_ORDER_REQ, MSG_AMEND_ORDER_REQ, MSG_AMEND_POSITION_SLTP_REQ, MSG_CLOSE_POSITION_REQ].includes(payloadType)) return 100;
  if (payloadType === MSG_SUBSCRIBE_SPOTS_REQ) return 90;
  if ([MSG_RECONCILE_REQ, MSG_ORDER_DETAILS_REQ, MSG_DEAL_LIST_REQ].includes(payloadType)) return 75;
  if ([MSG_GET_ACCOUNTS_REQ, MSG_TRADER_REQ, MSG_SYMBOLS_LIST_REQ].includes(payloadType)) return 50;
  if (payloadType === MSG_GET_TRENDBARS_REQ) return 10;
  return 40;
}

async function drainWsQueue(state: WsConnectionRequestQueueState): Promise<void> {
  if (state.draining) return;
  state.draining = true;
  try {
    while (state.pending.length > 0) {
      state.pending.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
      const entry = state.pending.shift()!;
      const requiredAt = Math.max(state.lastRequestTimestamp + MIN_REQUEST_INTERVAL_MS, state.cooldownUntil);
      const waitMs = Math.max(0, requiredAt - Date.now());
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
      state.lastRequestTimestamp = Date.now();

      const queueWaitMs = state.lastRequestTimestamp - entry.enqueuedAt;
      if (queueWaitMs >= 5000) {
        console.warn(`[cTrader] Request waited ${queueWaitMs}ms in queue (priority=${entry.priority}, pending=${state.pending.length}).`);
      }
      try {
        entry.resolve(await entry.task());
      } catch (error: any) {
        const message = String(error?.message || error);
        if (/BLOCKED_PAYLOAD_TYPE|RATE_LIMIT_EXCEEDED|TOO_MANY_REQUESTS|rate limit|too many requests/i.test(message)) {
          state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + 5000);
        }
        entry.reject(error);
      }
    }
  } finally {
    state.draining = false;
    if (state.pending.length > 0) void drainWsQueue(state);
  }
}

function queueWsRequest<T>(ws: WebSocket, task: () => Promise<T>, priority = 40): Promise<T> {
  let state = wsConnectionState.get(ws);
  if (!state) {
    state = { pending: [], draining: false, sequence: 0, lastRequestTimestamp: 0, cooldownUntil: 0 };
    wsConnectionState.set(ws, state);
  }
  return new Promise<T>((resolve, reject) => {
    state!.pending.push({
      priority,
      sequence: state!.sequence++,
      enqueuedAt: Date.now(),
      task: task as () => Promise<unknown>,
      resolve: value => resolve(value as T),
      reject
    });
    void drainWsQueue(state!);
  });
}

function sendAndAwait(
  ws: WebSocket,
  payloadType: number,
  payload: Record<string, unknown>,
  expectedPayloadType: number,
  timeoutMs = 60000
): Promise<any> {
  return queueWsRequest(
    ws,
    () => sendAndAwaitUnqueued(ws, payloadType, payload, expectedPayloadType, timeoutMs, 1),
    getCTraderRequestPriority(payloadType)
  );
}

// Retries run inside the already-acquired connection queue slot. Enqueuing a
// nested sendAndAwait here would deadlock: the first queued request cannot
// finish until the retry finishes, while the retry waits behind the first.
function sendAndAwaitUnqueued(
  ws: WebSocket,
  payloadType: number,
  payload: Record<string, unknown>,
  expectedPayloadType: number,
  timeoutMs: number,
  attempt: number
): Promise<any> {
  return new Promise((resolve, reject) => {
    const clientMsgId = `gc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(
      () => {
        ws.removeEventListener('message', handler);
        ws.removeEventListener('error', errorHandler);
        reject(new Error(`cTrader request timeout: ${expectedPayloadType} (${getPayloadTypeName(expectedPayloadType)})`));
      },
      timeoutMs
    );
    const handler = (event: any) => {
      try {
        const raw = typeof event?.data === 'string' ? event.data : (event?.data || event).toString();
        const msg = JSON.parse(raw);
        if (msg.clientMsgId === clientMsgId && msg.payloadType === expectedPayloadType) {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          ws.removeEventListener('error', errorHandler);
          resolve(msg.payload || {});
        } else if (
          (msg.payloadType === MSG_ERROR_RES || msg.payloadType === MSG_ORDER_ERROR_EVENT)
          && (msg.clientMsgId === clientMsgId || !msg.clientMsgId)
        ) {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          ws.removeEventListener('error', errorHandler);
          
          // Request-scoped API errors are handled only by their matching
          // request listener. Uncorrelated broker error events are not fanned
          // out as if every in-flight request failed.
          const errorCode = String(msg.payload?.errorCode || '');
          const isRateLimit = errorCode === 'BLOCKED_PAYLOAD_TYPE'
            || errorCode === 'RATE_LIMIT_EXCEEDED'
            || errorCode === 'TOO_MANY_REQUESTS'
            || msg.payloadType === MSG_ERROR_RES
              && /rate limit|too many requests|blocked/i.test(JSON.stringify(msg.payload));

          if (isRateLimit && attempt < 4) {
            const serverRetryAfter = Number(msg.payload?.retryAfter);
            const baseRetry = Number.isFinite(serverRetryAfter) && serverRetryAfter > 0
              ? serverRetryAfter
              : 2000;
            const retryAfter = Math.max(1500, baseRetry) * Math.pow(2, attempt - 1) + Math.random() * 500;
            console.warn(`[cTrader] Rate limited (${msg.payloadType} / ${errorCode || '2142'}). Cooling down ${Math.round(retryAfter)}ms before retry ${attempt + 1}/4.`);
            setTimeout(() => {
              sendAndAwaitUnqueued(ws, payloadType, payload, expectedPayloadType, timeoutMs, attempt + 1).then(resolve).catch(reject);
            }, retryAfter);
          } else {
            reject(new Error(`cTrader API error (${msg.payloadType}): ${JSON.stringify(msg.payload)}`));
          }
        }
      } catch {}
    };
    const errorHandler = (err: any) => {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        ws.removeEventListener('error', errorHandler);
        reject(err);
    };
    ws.addEventListener('message', handler);
    ws.addEventListener('error', errorHandler);
    ws.send(JSON.stringify({ clientMsgId, payloadType, payload }));
  });
}


async function withAuthenticatedAccount<T>(
  accountId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean,
  fn: (ws: WebSocket) => Promise<T>
): Promise<T> {
  const hosts = getCTraderRequestHosts(isLive);
  const key: ConnectionKey = { broker: 'cTrader', isLive, endpoint: hosts[0], accountId };

  const ws = await webSocketManager.getConnection(key, async () => {
    const ws = new WebSocket(key.endpoint, { headers: { 'User-Agent': 'Goldcrest-Trading-Bot/1.3.0' } });
    ws.setMaxListeners(200);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
      setTimeout(() => reject(new Error('Timeout')), 30000);
    });
    
    // Auth
    await sendAndAwait(ws, MSG_APP_AUTH_REQ, { clientId, clientSecret }, MSG_APP_AUTH_RES);
    await sendAndAwait(ws, MSG_ACC_AUTH_REQ, { ctidTraderAccountId: accountId, accessToken }, MSG_ACC_AUTH_RES);
    return ws;
  });

  return await fn(ws);
}

export interface CTraderExecutionActionResult {
  executionType: number;
  orderId?: number;
  positionId?: number;
  raw: any;
}

async function submitLiveCTraderExecutionAction(
  ctidTraderAccountId: number, payloadType: number, payload: Record<string, unknown>,
  clientMsgId: string, clientId: string, clientSecret: string, accessToken: string, isLive: boolean,
  expectedOrderId?: number, expectedPositionId?: number
): Promise<CTraderExecutionActionResult> {
  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    return new Promise<CTraderExecutionActionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.removeEventListener('message', handler);
        reject(new Error('cTrader live execution action timed out without broker acknowledgement.'));
      }, 60000);
      const finish = (value: CTraderExecutionActionResult) => {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        resolve(value);
      };
      const fail = (message: string) => {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        reject(new Error(message));
      };
      const handler = (event: any) => {
        try {
          const raw = typeof event?.data === 'string' ? event.data : (event?.data || event).toString();
          const msg = JSON.parse(raw);
          if (msg.payloadType === MSG_ORDER_ERROR_EVENT || msg.payloadType === MSG_ERROR_RES) {
            const p = msg.payload || {};
            fail(p.description || p.errorCode || 'cTrader rejected the execution action.');
            return;
          }
          if (msg.payloadType !== MSG_EXECUTION_EVENT) return;
          const p = msg.payload || {};
          const order = p.order || {};
          const position = p.position || {};
          const orderId = Number(order.orderId ?? p.orderId ?? 0) || undefined;
          const positionId = Number(position.positionId ?? p.positionId ?? 0) || undefined;
          if (expectedOrderId !== undefined && orderId !== expectedOrderId) return;
          if (expectedPositionId !== undefined && positionId !== expectedPositionId) return;
          finish({ executionType: Number(p.executionType ?? 0), orderId, positionId, raw: msg });
        } catch {}
      };
      ws.addEventListener('message', handler);
      // Serialize the outbound order action with all other cTrader requests.
      // There is deliberately no automatic retry here because an order
      // submission with a missing acknowledgement is ambiguous.
      void queueWsRequest(ws, async () => {
        ws.send(JSON.stringify({ clientMsgId, payloadType, payload }));
      }, 100).catch((error: any) => {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        reject(error);
      });
    });
  });
}

export async function cancelLiveCTraderOrder(
  ctidTraderAccountId: number, orderId: number, clientId: string, clientSecret: string,
  accessToken: string, isLive: boolean
): Promise<CTraderExecutionActionResult> {
  return submitLiveCTraderExecutionAction(ctidTraderAccountId, MSG_CANCEL_ORDER_REQ,
    { ctidTraderAccountId, orderId }, 'gc-cancel-' + orderId + '-' + Date.now(),
    clientId, clientSecret, accessToken, isLive, orderId);
}

export async function amendLiveCTraderOrder(
  ctidTraderAccountId: number, orderId: number,
  modifications: { volume?: number; limitPrice?: number; stopPrice?: number; stopLoss?: number; takeProfit?: number },
  clientId: string, clientSecret: string, accessToken: string, isLive: boolean
): Promise<CTraderExecutionActionResult> {
  const payload: Record<string, unknown> = { ctidTraderAccountId, orderId };
  if (modifications.volume !== undefined) payload.volume = Math.round(modifications.volume * 100);
  if (modifications.limitPrice !== undefined) payload.limitPrice = modifications.limitPrice;
  if (modifications.stopPrice !== undefined) payload.stopPrice = modifications.stopPrice;
  if (modifications.stopLoss !== undefined) payload.stopLoss = modifications.stopLoss;
  if (modifications.takeProfit !== undefined) payload.takeProfit = modifications.takeProfit;
  return submitLiveCTraderExecutionAction(ctidTraderAccountId, MSG_AMEND_ORDER_REQ, payload,
    'gc-amend-' + orderId + '-' + Date.now(), clientId, clientSecret, accessToken, isLive, orderId);
}

export async function amendLiveCTraderPositionSLTP(
  ctidTraderAccountId: number, positionId: number, stopLoss: number | undefined, takeProfit: number | undefined,
  clientId: string, clientSecret: string, accessToken: string, isLive: boolean
): Promise<CTraderExecutionActionResult> {
  const payload: Record<string, unknown> = { ctidTraderAccountId, positionId };
  if (stopLoss !== undefined) payload.stopLoss = stopLoss;
  if (takeProfit !== undefined) payload.takeProfit = takeProfit;
  return submitLiveCTraderExecutionAction(ctidTraderAccountId, MSG_AMEND_POSITION_SLTP_REQ, payload,
    'gc-amend-position-' + positionId + '-' + Date.now(), clientId, clientSecret, accessToken, isLive, undefined, positionId);
}

export async function closeLiveCTraderPosition(
  ctidTraderAccountId: number, positionId: number, volume: number,
  clientId: string, clientSecret: string, accessToken: string, isLive: boolean
): Promise<CTraderExecutionActionResult> {
  const protocolVolume = Math.round(volume * 100);
  if (!Number.isSafeInteger(protocolVolume) || protocolVolume <= 0) throw new Error('cTrader close volume must be positive.');
  return submitLiveCTraderExecutionAction(ctidTraderAccountId, MSG_CLOSE_POSITION_REQ,
    { ctidTraderAccountId, positionId, volume: protocolVolume },
    'gc-close-position-' + positionId + '-' + Date.now(), clientId, clientSecret, accessToken, isLive, undefined, positionId);
}

export interface CTraderOrderSubmission {
  orderId: number;
  positionId?: number;
  status: 'ACCEPTED' | 'FILLED' | 'REJECTED';
  executionPrice?: number;
  executedVolume?: number;
  raw: any;
}

export async function submitLiveCTraderOrder(
  ctidTraderAccountId: number,
  symbolId: number,
  symbol: string,
  orderType: 'MARKET' | 'LIMIT' | 'STOP',
  side: 'BUY' | 'SELL',
  quantity: number,
  price: number | undefined,
  stopLoss: number | undefined,
  takeProfit: number | undefined,
  clientOrderId: string,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean,
  positionId?: string | number
): Promise<CTraderOrderSubmission> {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('cTrader order volume must be positive.');
  }

  const orderTypeMap: Record<string, number> = { MARKET: 1, LIMIT: 2, STOP: 3 };
  const tradeSideMap: Record<string, number> = { BUY: 1, SELL: 2 };
  const mappedType = orderTypeMap[orderType];
  const mappedSide = tradeSideMap[side];
  if (!mappedType || !mappedSide) throw new Error(`Unsupported cTrader order parameters: ${orderType}/${side}`);

  // Goldcrest order quantity is an integer execution quantity. cTrader's
  // protocol volume is represented in 0.01 of a unit, so convert the integer
  // quantity to an integer protocol volume without introducing decimal values.
  const normalizedQuantity = Math.floor(quantity);
  if (!Number.isSafeInteger(normalizedQuantity) || normalizedQuantity <= 0) {
    throw new Error('cTrader order quantity must resolve to a positive integer.');
  }
  const volume = normalizedQuantity * 100;
  if (!Number.isSafeInteger(volume) || volume <= 0) {
    throw new Error('cTrader order volume is outside the supported integer range.');
  }

  return withAuthenticatedAccount(
    ctidTraderAccountId,
    clientId,
    clientSecret,
    accessToken,
    isLive,
    async ws => {
      const requestClientId = clientOrderId.slice(0, 50);
      const tradeAuditId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const payload: Record<string, unknown> = {
        ctidTraderAccountId,
        symbolId,
        orderType: mappedType,
        tradeSide: mappedSide,
        volume,
        clientOrderId: requestClientId
      };
      
      if (positionId !== undefined) {
        payload.positionId = Number(positionId);
      } else {
        // Hardcoded: every normal cTrader order must have a trailing stop loss.
        payload.trailingStopLoss = true;
      }

      if (orderType === 'LIMIT' && price !== undefined) payload.limitPrice = price;
      if (orderType === 'STOP' && price !== undefined) payload.stopPrice = price;
      if (stopLoss !== undefined && stopLoss > 0) payload.stopLoss = stopLoss;
      if (takeProfit !== undefined && takeProfit > 0) payload.takeProfit = takeProfit;

      return new Promise<CTraderOrderSubmission>((resolve, reject) => {
        let accepted: CTraderOrderSubmission | null = null;
        let resultLogged = false;

        const logResult = (result: {
          status: 'ACCEPTED' | 'FILLED' | 'REJECTED' | 'FAILED' | 'TIMEOUT';
          orderId?: number;
          executionPrice?: number;
          executedVolume?: number;
          error?: string;
          response?: unknown;
        }) => {
          if (resultLogged) return;
          resultLogged = true;
          try {
            recordTradeResult({
              tradeAuditId,
              broker: 'CTRADER',
              environment: 'LIVE',
              ...result
            });
          } catch (logError) {
            console.error('[TRADE-LOG] Failed to record trade result:', logError);
          }
        };
        let timer: NodeJS.Timeout | undefined;
        const startAcknowledgementTimeout = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            ws.removeEventListener('message', handler);
            if (accepted) {
              logResult({
                status: 'ACCEPTED',
                orderId: accepted.orderId,
                executionPrice: accepted.executionPrice,
                executedVolume: accepted.executedVolume,
                response: accepted.raw
              });
              resolve(accepted);
            } else {
              const error = 'cTrader order submission timed out without broker acknowledgement.';
              logResult({ status: 'TIMEOUT', error });
              reject(new Error(error));
            }
          }, 15000);
        };

        const finish = (value: CTraderOrderSubmission) => {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          logResult({
            status: value.status === 'FILLED' ? 'FILLED' : 'ACCEPTED',
            orderId: value.orderId,
            executionPrice: value.executionPrice,
            executedVolume: value.executedVolume,
            response: value.raw
          });
          resolve(value);
        };

        const fail = (message: string, response?: unknown) => {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          logResult({ status: 'REJECTED', error: message, response });
          reject(new Error(message));
        };

        const handler = (event: any) => {
          try {
            const raw = typeof event?.data === 'string' ? event.data : (event?.data || event).toString();
            const msg = JSON.parse(raw);

            if (msg.payloadType === MSG_ORDER_ERROR_EVENT || msg.payloadType === MSG_ERROR_RES) {
              const p = msg.payload || {};
              const related = !p.orderId || !accepted || Number(p.orderId) === accepted.orderId;
              if (related) {
                const rawDescription = String(p.description || p.errorCode || 'cTrader rejected the live order.');
                // cTrader sometimes formats integer protocol volumes as
                // decimals in its human-readable rejection text (e.g. 20000.00).
                // Keep the broker's wording but normalize whole-number volumes
                // in Goldcrest audit/operator logs to the exact integer packet value.
                const description = rawDescription.replace(/(volume\s*=\s*)(\d+)\.00\b/gi, '$1$2').replace(/(maximum allowed volume\s*=\s*)(\d+)\.00\b/gi, '$1$2');
                if (/TRADE permission required/i.test(description)) {
                  fail('BROKER_REJECTED [cTrader LIVE]: TRADE permission is not granted to the current access token/account. Re-authorize Goldcrest with the cTrader "trading" scope and ensure the account has FULL_ACCESS trading rights.');
                } else {
                  // Preserve the broker's exact rejection and explicitly identify
                  // cTrader as the source so UI/operator logs never imply that
                  // Goldcrest invented the broker constraint.
                  fail(`BROKER_REJECTED [cTrader LIVE]: ${description}`);
                }
              }
              return;
            }

            if (msg.payloadType !== MSG_EXECUTION_EVENT) return;

            const p = msg.payload || {};
            const order = p.order || {};
            const deal = p.deal || {};
            const orderId = Number(order.orderId ?? p.orderId ?? 0);
            const clientIdMatches = !order.clientOrderId || order.clientOrderId === requestClientId;
            if (!clientIdMatches) return;

            const executionType = Number(p.executionType ?? 0);
            const orderStatus = Number(order.orderStatus ?? 0);
            const executionPrice = Number(
              deal.executionPrice ?? order.executionPrice ?? p.executionPrice
            );
            const executedVolumeRaw = Number(
              deal.filledVolume ?? order.executedVolume ?? p.executedVolume ?? 0
            );

            const normalized: CTraderOrderSubmission = {
              orderId,
              positionId: order.positionId !== undefined ? Number(order.positionId) : undefined,
              status: executionType === 7 || orderStatus === 3
                ? 'REJECTED'
                : (executionType === 3 || orderStatus === 2 || Number(deal.dealStatus) === 2)
                  ? 'FILLED'
                  : 'ACCEPTED',
              executionPrice: Number.isFinite(executionPrice) && executionPrice > 0 ? executionPrice : undefined,
              executedVolume: executedVolumeRaw > 0 ? executedVolumeRaw / 100 : undefined,
              raw: msg
            };

            if (!normalized.orderId) return;

            if (normalized.status === 'REJECTED') {
              fail('cTrader broker rejected the live order.');
            } else if (normalized.status === 'FILLED') {
              finish(normalized);
            } else {
              accepted = normalized;
              // Keep the connection open briefly for the subsequent fill event.
            }
          } catch {
            // Ignore unrelated/non-JSON WebSocket frames.
          }
        };

        ws.addEventListener('message', handler);

        try {
          recordTradeRequest({
            tradeAuditId,
            broker: 'CTRADER',
            environment: 'LIVE',
            accountId: ctidTraderAccountId,
            symbolId,
            symbol,
            orderType,
            side,
            volume,
            price,
            stopLoss,
            takeProfit,
            trailingStopLoss: true,
            clientOrderId: requestClientId,
            packet: {
              clientMsgId: requestClientId,
              payloadType: MSG_NEW_ORDER_REQ,
              payload
            }
          });
        } catch (logError) {
          console.error('[TRADE-LOG] Failed to record trade request:', logError);
        }

        // ProtoOANewOrderReq accepts broker volume, not Goldcrest's normalized
        // quantity field. The exact broker payload must contain only cTrader API
        // fields; Goldcrest's normalized quantity is intentionally never
        // copied into the broker payload.
        const forbiddenPayloadFields = ['quantity', 'quantityUnits', 'protocolVolume'];
        for (const field of forbiddenPayloadFields) {
          if (Object.prototype.hasOwnProperty.call(payload, field)) {
            throw new Error(`INVALID_CTRADER_ORDER_PACKET: ${field} is not a ProtoOANewOrderReq field.`);
          }
        }
        if (payload.volume !== volume) {
          throw new Error('INVALID_CTRADER_ORDER_PACKET: payload.volume does not match the final protocol volume.');
        }

        const packet = JSON.stringify({
          clientMsgId: requestClientId,
          payloadType: MSG_NEW_ORDER_REQ,
          payload
        });

        void queueWsRequest(ws, async () => {
          if (resultLogged) return;
          startAcknowledgementTimeout();
          ws.send(packet);
        }, 100).catch((sendError: any) => {
          const message = `cTrader request transmission failed: ${sendError?.message || String(sendError)}`;
          logResult({ status: 'FAILED', error: message });
          reject(new Error(message));
        });
      });
    }
  );
}

export async function fetchCTraderSymbols(
  ctidTraderAccountId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean
): Promise<CTraderSymbolInfo[]> {
  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const payload = await sendAndAwait(ws, MSG_SYMBOLS_LIST_REQ, {
      ctidTraderAccountId,
      includeArchivedSymbols: false
    }, MSG_SYMBOLS_LIST_RES, 15000);
    const symbols = Array.isArray(payload.symbol) ? payload.symbol : [];
    return symbols
      .filter((s: any) => s.enabled !== false && s.symbolId !== undefined && s.symbolName)
      .map((s: any) => ({
        symbolId: Number(s.symbolId),
        symbolName: String(s.symbolName),
        digits: Number(s.digits || 5),
        pipPosition: Number(s.pipPosition || 4),
        minVolume: Number(s.minVolume || 0) || undefined,
        maxVolume: Number(s.maxVolume || 0) || undefined,
        stepVolume: Number(s.stepVolume || 0) || undefined,
        lotSize: Number(s.lotSize || 0) || undefined,
        baseAssetId: Number(s.baseAssetId || 0) || undefined,
        quoteAssetId: Number(s.quoteAssetId || 0) || undefined
      }));
  });
}

export async function fetchCTraderOrderDetails(
  ctidTraderAccountId: number,
  orderId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean
): Promise<{ order: any | null; deals: any[] }> {
  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const payload = await sendAndAwait(ws, MSG_ORDER_DETAILS_REQ, {
      ctidTraderAccountId,
      orderId
    }, MSG_ORDER_DETAILS_RES, 15000);
    return {
      order: payload?.order || null,
      deals: Array.isArray(payload?.deal) ? payload.deal : []
    };
  });
}

export async function fetchCTraderDeals(
  ctidTraderAccountId: number, fromTimestamp: number, toTimestamp: number,
  clientId: string, clientSecret: string, accessToken: string, isLive: boolean
): Promise<any[]> {
  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const payload = await sendAndAwait(ws, MSG_DEAL_LIST_REQ, {
      ctidTraderAccountId, fromTimestamp, toTimestamp, maxRows: 10000
    }, MSG_DEAL_LIST_RES, 60000);
    return Array.isArray(payload.deal) ? payload.deal : [];
  });
}

export interface CTraderPositionUnrealizedPnL {
  positionId: number;
  grossUnrealizedPnL: number;
  netUnrealizedPnL: number;
  moneyDigits: number;
}

export async function fetchCTraderPositionUnrealizedPnL(
  ctidTraderAccountId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean
): Promise<CTraderPositionUnrealizedPnL[]> {
  return withAuthenticatedAccount(
    ctidTraderAccountId,
    clientId,
    clientSecret,
    accessToken,
    isLive,
    async ws => {
      const payload = await sendAndAwait(
        ws,
        MSG_GET_POSITION_UNREALIZED_PNL_REQ,
        { ctidTraderAccountId },
        MSG_GET_POSITION_UNREALIZED_PNL_RES,
        10000
      );
      const moneyDigits = Number(payload.moneyDigits ?? 0);
      const divisor = Math.pow(10, Number.isFinite(moneyDigits) ? moneyDigits : 0);
      const rows = Array.isArray(payload.positionUnrealizedPnL)
        ? payload.positionUnrealizedPnL
        : [];
      return rows
        .filter((row: any) => row?.positionId !== undefined)
        .map((row: any) => ({
          positionId: Number(row.positionId),
          grossUnrealizedPnL: Number(row.grossUnrealizedPnL || 0) / divisor,
          netUnrealizedPnL: Number(row.netUnrealizedPnL || 0) / divisor,
          moneyDigits
        }));
    }
  );
}

export async function fetchCTraderReconcileState(
  ctidTraderAccountId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean
): Promise<{ positions: any[]; orders: any[] }> {
  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const payload = await sendAndAwait(ws, MSG_RECONCILE_REQ, { ctidTraderAccountId }, MSG_RECONCILE_RES, 60000);
    return {
      positions: Array.isArray(payload.position) ? payload.position : [],
      orders: Array.isArray(payload.order) ? payload.order : []
    };
  });
}


const inFlightSpotQuotes = new Map<string, Promise<CTraderMarketQuote>>();

interface CTraderSpotSnapshot { bid?: number; ask?: number; timestamp: number; receivedAt: number; }
interface CTraderSpotWaiter {
  resolve: (quote: CTraderMarketQuote) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}
interface CTraderSpotSubscriptionRequest {
  symbolIds: number[];
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
  promise: Promise<void>;
}
interface CTraderSpotStreamState {
  accountId: number;
  symbols: Map<number, CTraderSpotSubscriptionSymbol>;
  snapshots: Map<number, CTraderSpotSnapshot>;
  requestedSymbolIds: Set<number>;
  confirmedSymbolIds: Set<number>;
  pendingSymbolIds: Set<number>;
  waiters: Map<number, Set<CTraderSpotWaiter>>;
  requests: Map<string, CTraderSpotSubscriptionRequest>;
  subscriptionPromises: Map<number, Promise<void>>;
  flushTimer?: NodeJS.Timeout;
  messageHandler: (data: any) => void;
  closeHandler: () => void;
  errorHandler: (error: any) => void;
}
const cTraderSpotStreams = new WeakMap<WebSocket, CTraderSpotStreamState>();
const CTRADER_SPOT_SUBSCRIPTION_BATCH_SIZE = 50;
const CTRADER_SPOT_BATCH_DELAY_MS = 20;
const CTRADER_SPOT_QUOTE_TIMEOUT_MS = 5500;
const CTRADER_SPOT_CACHE_FRESH_MS = 2500;
const CTRADER_SPOT_SUBSCRIPTION_ACK_TIMEOUT_MS = 7000;

function rejectCTraderSpotWaiters(state: CTraderSpotStreamState, symbolId: number, error: Error): void {
  const waiters = state.waiters.get(symbolId);
  if (!waiters) return;
  state.waiters.delete(symbolId);
  for (const waiter of waiters) {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
}
function settleCTraderSpotSubscription(state: CTraderSpotStreamState, clientMsgId: string, error?: Error): void {
  const request = state.requests.get(clientMsgId);
  if (!request) return;
  state.requests.delete(clientMsgId);
  if (request.timer) clearTimeout(request.timer);
  for (const symbolId of request.symbolIds) {
    if (error) {
      state.requestedSymbolIds.delete(symbolId);
      state.confirmedSymbolIds.delete(symbolId);
      rejectCTraderSpotWaiters(state, symbolId, error);
    } else {
      state.confirmedSymbolIds.add(symbolId);
    }
    if (state.subscriptionPromises.get(symbolId) === request.promise) state.subscriptionPromises.delete(symbolId);
  }
  if (error) request.reject(error);
  else request.resolve();
}
function failCTraderSpotStream(state: CTraderSpotStreamState, error: Error): void {
  for (const clientMsgId of [...state.requests.keys()]) settleCTraderSpotSubscription(state, clientMsgId, error);
  for (const symbolId of [...state.waiters.keys()]) rejectCTraderSpotWaiters(state, symbolId, error);
  state.requestedSymbolIds.clear();
  state.confirmedSymbolIds.clear();
  state.pendingSymbolIds.clear();
  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = undefined;
  }
}
function getOrCreateCTraderSpotStream(ws: WebSocket, accountId: number): CTraderSpotStreamState {
  const existing = cTraderSpotStreams.get(ws);
  if (existing) {
    if (existing.accountId !== accountId) throw new Error('cTrader spot stream account mismatch on an authenticated socket.');
    return existing;
  }
  let state!: CTraderSpotStreamState;
  const messageHandler = (data: any) => {
    try {
      const raw = typeof data === 'string' ? data : (data?.data ?? data).toString();
      const msg = JSON.parse(raw);
      const clientMsgId = String(msg.clientMsgId || '');
      if (msg.payloadType === MSG_SUBSCRIBE_SPOTS_RES && clientMsgId) {
        settleCTraderSpotSubscription(state, clientMsgId);
        return;
      }
      if (msg.payloadType === MSG_ERROR_RES && clientMsgId && state.requests.has(clientMsgId)) {
        settleCTraderSpotSubscription(state, clientMsgId,
          new Error('cTrader batch spot subscription rejected: ' + JSON.stringify(msg.payload || {})));
        return;
      }
      if (msg.payloadType !== MSG_SPOT_EVENT) return;
      const payload = msg.payload || {};
      const symbolId = Number(payload.symbolId);
      const symbolInfo = state.symbols.get(symbolId);
      if (!symbolInfo || !Number.isSafeInteger(symbolId) || symbolId <= 0) return;
      const previous = state.snapshots.get(symbolId);
      let bid = previous?.bid;
      let ask = previous?.ask;
      let receivedPrice = false;
      // cTrader spot events are incremental and can include only one side.
      if (payload.bid !== undefined) {
        const parsedBid = priceFromRelative(Number(payload.bid), symbolInfo.digits);
        if (Number.isFinite(parsedBid) && parsedBid > 0) { bid = parsedBid; receivedPrice = true; }
      }
      if (payload.ask !== undefined) {
        const parsedAsk = priceFromRelative(Number(payload.ask), symbolInfo.digits);
        if (Number.isFinite(parsedAsk) && parsedAsk > 0) { ask = parsedAsk; receivedPrice = true; }
      }
      if (!receivedPrice) return;
      const receivedAt = Date.now();
      const rawTimestamp = Number(payload.timestamp);
      const timestamp = Number.isFinite(rawTimestamp) && rawTimestamp > 0 ? rawTimestamp : receivedAt;
      state.snapshots.set(symbolId, { bid, ask, timestamp, receivedAt });
      if (bid === undefined || ask === undefined || bid <= 0 || ask < bid) return;
      const quote: CTraderMarketQuote = { symbol: symbolInfo.symbol, symbolId, bid, ask, timestamp, status: 'FRESH' };
      const waiters = state.waiters.get(symbolId);
      if (waiters) {
        state.waiters.delete(symbolId);
        for (const waiter of waiters) {
          clearTimeout(waiter.timer);
          waiter.resolve(quote);
        }
      }
    } catch {
      // Ignore malformed or unrelated WebSocket messages.
    }
  };
  const errorHandler = (error: any) => {
    failCTraderSpotStream(state,
      new Error('cTrader spot stream socket error: ' + String(error?.message || error || 'unknown error')));
  };
  const closeHandler = () => {
    failCTraderSpotStream(state, new Error('cTrader WebSocket closed while waiting for spot quotes.'));
    ws.off('message', messageHandler);
    ws.off('error', errorHandler);
    cTraderSpotStreams.delete(ws);
  };
  state = {
    accountId,
    symbols: new Map<number, CTraderSpotSubscriptionSymbol>(),
    snapshots: new Map<number, CTraderSpotSnapshot>(),
    requestedSymbolIds: new Set<number>(),
    confirmedSymbolIds: new Set<number>(),
    pendingSymbolIds: new Set<number>(),
    waiters: new Map<number, Set<CTraderSpotWaiter>>(),
    requests: new Map<string, CTraderSpotSubscriptionRequest>(),
    subscriptionPromises: new Map<number, Promise<void>>(),
    messageHandler,
    closeHandler,
    errorHandler
  };
  cTraderSpotStreams.set(ws, state);
  ws.on('message', messageHandler);
  ws.once('close', closeHandler);
  ws.on('error', errorHandler);
  return state;
}
async function sendCTraderSpotSubscriptionBatch(
  ws: WebSocket, state: CTraderSpotStreamState, requestedIds: number[]
): Promise<void> {
  const symbolIds = normalizeCTraderSpotSymbolIds(requestedIds)
    .filter(id => !state.confirmedSymbolIds.has(id) && !state.requestedSymbolIds.has(id));
  if (!symbolIds.length) return;
  const clientMsgId = 'spot_batch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  let resolveRequest!: () => void;
  let rejectRequest!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; });
  const request: CTraderSpotSubscriptionRequest = {
    symbolIds, resolve: resolveRequest, reject: rejectRequest, timer: null, promise
  };
  request.timer = setTimeout(() => settleCTraderSpotSubscription(state, clientMsgId,
    new Error('Timed out waiting for cTrader spot-subscription acknowledgement for ' + symbolIds.length + ' symbols.')),
  CTRADER_SPOT_SUBSCRIPTION_ACK_TIMEOUT_MS);
  state.requests.set(clientMsgId, request);
  for (const symbolId of symbolIds) {
    state.requestedSymbolIds.add(symbolId);
    state.subscriptionPromises.set(symbolId, promise);
  }
  try {
    const payload = buildCTraderSpotSubscriptionPayload(state.accountId, symbolIds);
    await queueWsRequest(ws, async () => {
      if (ws.readyState !== WebSocket.OPEN) throw new Error('cTrader WebSocket is not open for spot subscription.');
      ws.send(JSON.stringify({ clientMsgId, payloadType: MSG_SUBSCRIBE_SPOTS_REQ, payload }));
    }, 90);
  } catch (error: any) {
    settleCTraderSpotSubscription(state, clientMsgId,
      new Error(String(error?.message || error || 'Failed to send cTrader spot subscription.')));
  }
  return promise;
}
async function sendCTraderSpotSubscriptionBatches(
  ws: WebSocket, state: CTraderSpotStreamState, symbolIds: number[]
): Promise<void> {
  const ids = normalizeCTraderSpotSymbolIds(symbolIds);
  const batches: number[][] = [];
  for (let index = 0; index < ids.length; index += CTRADER_SPOT_SUBSCRIPTION_BATCH_SIZE) {
    batches.push(ids.slice(index, index + CTRADER_SPOT_SUBSCRIPTION_BATCH_SIZE));
  }
  await Promise.all(batches.map(batch => sendCTraderSpotSubscriptionBatch(ws, state, batch)));
}
async function flushPendingCTraderSpotSubscriptions(ws: WebSocket, state: CTraderSpotStreamState): Promise<void> {
  const ids = [...state.pendingSymbolIds];
  state.pendingSymbolIds.clear();
  const toSend = ids.filter(id => !state.confirmedSymbolIds.has(id) && !state.requestedSymbolIds.has(id));
  if (!toSend.length) return;
  try {
    await sendCTraderSpotSubscriptionBatches(ws, state, toSend);
  } catch (error: any) {
    console.warn('[cTrader] Batched spot subscription failed: ' + String(error?.message || error));
  }
}
function scheduleCTraderSpotSubscriptionFlush(ws: WebSocket, state: CTraderSpotStreamState): void {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(() => {
    state.flushTimer = undefined;
    void flushPendingCTraderSpotSubscriptions(ws, state);
  }, CTRADER_SPOT_BATCH_DELAY_MS);
}
function waitForCTraderSpotQuote(
  ws: WebSocket, accountId: number, requested: CTraderSpotSubscriptionSymbol
): Promise<CTraderMarketQuote> {
  const state = getOrCreateCTraderSpotStream(ws, accountId);
  const symbolId = Number(requested.symbolId);
  if (!Number.isSafeInteger(symbolId) || symbolId <= 0) {
    return Promise.reject(new Error('A valid cTrader symbol ID is required for a spot quote.'));
  }
  state.symbols.set(symbolId, requested);
  const cached = state.snapshots.get(symbolId);
  if (cached && cached.bid !== undefined && cached.ask !== undefined &&
      cached.bid > 0 && cached.ask >= cached.bid &&
      Date.now() - cached.receivedAt <= CTRADER_SPOT_CACHE_FRESH_MS) {
    return Promise.resolve({
      symbol: requested.symbol, symbolId, bid: cached.bid, ask: cached.ask,
      timestamp: cached.timestamp, status: 'FRESH'
    });
  }
  return new Promise<CTraderMarketQuote>((resolve, reject) => {
    let waiters = state.waiters.get(symbolId);
    if (!waiters) { waiters = new Set<CTraderSpotWaiter>(); state.waiters.set(symbolId, waiters); }
    const waiter: CTraderSpotWaiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        const current = state.waiters.get(symbolId);
        if (current) {
          current.delete(waiter);
          if (current.size === 0) state.waiters.delete(symbolId);
        }
        reject(new Error('Timeout waiting for cTrader spot event for ' + requested.symbol));
      }, CTRADER_SPOT_QUOTE_TIMEOUT_MS)
    };
    waiters.add(waiter);
    if (!state.confirmedSymbolIds.has(symbolId) && !state.requestedSymbolIds.has(symbolId)) {
      state.pendingSymbolIds.add(symbolId);
      scheduleCTraderSpotSubscriptionFlush(ws, state);
    }
  });
}

/** Prime one authenticated socket with a multi-symbol request and retain its spot stream. */
export async function subscribeLiveCTraderSpots(
  ctidTraderAccountId: number, symbols: CTraderSpotSubscriptionSymbol[],
  clientId: string, clientSecret: string, accessToken: string, isLive: boolean
): Promise<void> {
  const unique = new Map<number, CTraderSpotSubscriptionSymbol>();
  for (const symbol of Array.isArray(symbols) ? symbols : []) {
    const id = Number(symbol?.symbolId);
    if (Number.isSafeInteger(id) && id > 0 && !unique.has(id)) {
      unique.set(id, { symbolId: id, symbol: String(symbol.symbol || id), digits: Number(symbol.digits || 5) });
    }
  }
  if (!unique.size) return;
  await withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const state = getOrCreateCTraderSpotStream(ws, ctidTraderAccountId);
    for (const symbol of unique.values()) state.symbols.set(symbol.symbolId, symbol);
    if (state.flushTimer) { clearTimeout(state.flushTimer); state.flushTimer = undefined; }
    const allIds = normalizeCTraderSpotSymbolIds([...unique.keys(), ...state.pendingSymbolIds]);
    state.pendingSymbolIds.clear();
    const toSend = allIds.filter(id => !state.confirmedSymbolIds.has(id) && !state.requestedSymbolIds.has(id));
    const sendPromise = toSend.length
      ? sendCTraderSpotSubscriptionBatches(ws, state, toSend)
      : Promise.resolve();
    const inFlight = allIds
      .map(id => state.subscriptionPromises.get(id))
      .filter((promise): promise is Promise<void> => Boolean(promise));
    await Promise.all([sendPromise, ...inFlight]);
  });
}

export async function fetchLiveCTraderQuote(
  ctidTraderAccountId: number, symbolId: number, symbol: string,
  clientId: string, clientSecret: string, accessToken: string, isLive: boolean, digits: number
): Promise<CTraderMarketQuote> {
  const quoteKey = (isLive ? 'LIVE' : 'DEMO') + ':' + ctidTraderAccountId + ':' + symbolId;
  const existing = inFlightSpotQuotes.get(quoteKey);
  if (existing) return existing;
  const work = withAuthenticatedAccount(
    ctidTraderAccountId, clientId, clientSecret, accessToken, isLive,
    async ws => waitForCTraderSpotQuote(ws, ctidTraderAccountId, { symbolId, symbol, digits })
  ).finally(() => {
    if (inFlightSpotQuotes.get(quoteKey) === work) inFlightSpotQuotes.delete(quoteKey);
  });
  inFlightSpotQuotes.set(quoteKey, work);
  return work;
}

export async function fetchCTraderTrendbars(
  ctidTraderAccountId: number,
  symbolId: number,
  periodName: string,
  count: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean,
  digits: number
): Promise<CTraderCandle[]> {
  const normalizedKey = String(periodName || '15M').trim().toUpperCase();
  const period = TREND_BAR_PERIODS[normalizedKey] || TREND_BAR_PERIODS['15M'];
  if (!period) throw new Error(`Unsupported cTrader trendbar period: ${periodName}`);
  const safeCount = Math.min(Math.max(Math.floor(count), 1), 1000);
  const toTimestamp = Date.now();
  const fromTimestamp = toTimestamp - safeCount * ({1: 60, 2: 120, 3: 180, 4: 240, 5: 300, 6: 600, 7: 900, 8: 1800, 9: 3600, 10: 14400, 11: 43200, 12: 86400, 13: 604800, 14: 2592000} as Record<number, number>)[period] * 1000;

  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const payload = await sendAndAwait(ws, MSG_GET_TRENDBARS_REQ, {
      ctidTraderAccountId,
      symbolId,
      period,
      count: safeCount,
      fromTimestamp,
      toTimestamp
    }, MSG_GET_TRENDBARS_RES, 15000);

    const trendbars = Array.isArray(payload.trendbar) ? payload.trendbar : [];
    return trendbars.map((bar: any) => {
      const low = priceFromRelative(Number(bar.low || 0), digits);
      const open = priceFromRelative(Number(bar.low || 0) + Number(bar.deltaOpen || 0), digits);
      const close = priceFromRelative(Number(bar.low || 0) + Number(bar.deltaClose || 0), digits);
      const high = priceFromRelative(Number(bar.low || 0) + Number(bar.deltaHigh || 0), digits);
      return {
        open: Number(open.toFixed(digits)),
        high: Number(high.toFixed(digits)),
        low: Number(low.toFixed(digits)),
        close: Number(close.toFixed(digits)),
        volume: Number(bar.volume || 0),
        timestamp: Number(bar.utcTimestampInMinutes || 0) * 60 * 1000
      };
    }).filter((bar: CTraderCandle) => bar.low > 0 && bar.high >= bar.low && bar.close > 0);
  });
}
