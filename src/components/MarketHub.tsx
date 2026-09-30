import React from 'react';
import { ForexDashboard } from './ForexDashboard';
import { TradingSignal, Candle } from '../markets/common/types';

interface MarketHubProps {
  forexPairs: any[];
  candlesMap: Record<string, Candle[]>;
  onSelectSignal: (signal: TradingSignal) => void;
  onEnsureCandles: (symbol: string) => Promise<void>;
  environment?: string;
}

export const MarketHub: React.FC<MarketHubProps> = ({
  forexPairs,
  candlesMap,
  onSelectSignal,
  onEnsureCandles,
  environment = 'LIVE'
}) => {
  return (
    <div id="unified_market_hub" className="space-y-4">
      <ForexDashboard
        pairs={forexPairs}
        onSelectSignal={onSelectSignal}
        candlesMap={candlesMap}
        onEnsureCandles={onEnsureCandles}
        environment={environment}
      />
    </div>
  );
};
