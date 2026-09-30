import {
  BrokerAdapter,
  BrokerType,
  TradingEnvironment,
  ConnectionTestResult,
  BrokerCredentialStatus
} from './types';
import { CTraderLiveAdapter } from './adapters/cTrader/CTraderLiveAdapter';
import { BrokerError } from './errors';

export class BrokerRegistry {
  private activeEnvironment: TradingEnvironment = 'LIVE';
  private selectedBroker: BrokerType = 'CTRADER';

  private adapters: Map<string, BrokerAdapter> = new Map();
  private isInitialized: boolean = false;

  constructor() {}

  private ensureInitialized(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.initializeAdapters();
  }

  private initializeAdapters(): void {
    // Pure Forex: cTrader Live Adapter
    const ctraderLive = new CTraderLiveAdapter();
    this.adapters.set('CTRADER_LIVE', ctraderLive);
  }

  getEnvironment(): TradingEnvironment {
    return this.activeEnvironment;
  }

  setEnvironment(env: TradingEnvironment): void {
    if (env !== 'LIVE') {
      throw new Error('Goldcrest operates in LIVE_ONLY mode.');
    }
    this.activeEnvironment = 'LIVE';
  }

  getSelectedBroker(): BrokerType {
    return 'CTRADER';
  }

  setSelectedBroker(broker: BrokerType): void {
    if (broker !== 'CTRADER') {
      throw new Error('Invalid broker. Goldcrest Forex exclusively connects to CTRADER.');
    }
    this.selectedBroker = 'CTRADER';
  }

  getAdapter(broker?: BrokerType, environment?: TradingEnvironment): BrokerAdapter {
    this.ensureInitialized();
    const targetBroker: BrokerType = 'CTRADER';
    const targetEnv: TradingEnvironment = 'LIVE';

    if (environment !== undefined && environment !== 'LIVE') {
      throw new Error('Goldcrest operates in LIVE_ONLY mode.');
    }

    const key = `${targetBroker}_${targetEnv}`;
    const adapter = this.adapters.get(key);
    if (!adapter) {
      throw new BrokerError(
        'UNKNOWN_ERROR',
        `No live adapter registered for ${targetBroker}`,
        targetBroker,
        'LIVE'
      );
    }
    return adapter;
  }

  /**
   * Resolve the authoritative live broker from the requested market.
   * FOREX -> cTrader
   */
  getAdapterForMarket(market: string): BrokerAdapter {
    this.ensureInitialized();

    if (market === 'FOREX') {
      return this.getAdapter('CTRADER', 'LIVE');
    }

    throw new BrokerError(
      'INVALID_SYMBOL',
      `No live broker route is configured for market ${market}`,
      'CTRADER',
      'LIVE'
    );
  }

  /**
   * Authoritative live broker adapter for dashboard/account aggregation.
   */
  getActiveLiveAdapters(): BrokerAdapter[] {
    this.ensureInitialized();
    return [
      this.getAdapter('CTRADER', 'LIVE')
    ];
  }

  registerAdapter(broker: BrokerType, environment: TradingEnvironment, adapter: BrokerAdapter): void {
    this.ensureInitialized();
    const key = `${broker}_${environment}`;
    this.adapters.set(key, adapter);
  }

  validateMarketCompatibility(market: string, broker: BrokerType): { compatible: boolean; reason?: string } {
    if (broker === 'CTRADER') {
      if (market === 'FOREX') return { compatible: true };
      return {
        compatible: false,
        reason: `cTrader broker only supports FOREX market. Cannot route ${market} to cTrader.`
      };
    }

    return { compatible: false, reason: `Unknown broker ${broker}` };
  }

  async testBrokerConnection(broker: BrokerType, environment: TradingEnvironment): Promise<ConnectionTestResult> {
    const adapter = this.getAdapter('CTRADER', environment);
    return adapter.testConnection();
  }

  getCredentialStatuses(): BrokerCredentialStatus[] {
    this.ensureInitialized();
    const ctraderLive = this.adapters.get('CTRADER_LIVE') as CTraderLiveAdapter;
    const cLiveStatus = ctraderLive.getConfigStatus();

    return [
      {
        broker: 'CTRADER',
        environment: 'LIVE',
        configured: cLiveStatus.configured,
        maskedAccountId: cLiveStatus.maskedAccountId,
        maskedClientId: cLiveStatus.maskedClientId,
        status: cLiveStatus.configured ? 'CONNECTED' : 'DISCONNECTED'
      }
    ];
  }

  updateLiveCredentials(broker: BrokerType, creds: Record<string, any>): void {
    this.ensureInitialized();
    if (broker === 'CTRADER') {
      (this.adapters.get('CTRADER_LIVE') as CTraderLiveAdapter).updateCredentials(creds);
    }
  }

  deleteCredentials(broker: BrokerType, environment: TradingEnvironment): void {
    this.ensureInitialized();
    const key = `${broker}_${environment}`;
    const adapter = this.adapters.get(key) as any;
    if (adapter && typeof adapter.clearCredentials === 'function') {
      adapter.clearCredentials();
    }
  }
}

export const brokerRegistry = new BrokerRegistry();
