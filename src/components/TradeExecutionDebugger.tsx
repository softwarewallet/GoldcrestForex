import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, ShieldAlert } from 'lucide-react';

export const TradeExecutionDebugger: React.FC = () => {
  const [debugData, setDebugData] = useState<any[]>([]);

  const fetchDebugInfo = async () => {
    try {
      const response = await fetch('/api/brokers/execution-debug', { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        setDebugData(data);
      }
    } catch (e) {
      console.error('Failed to fetch execution debug data', e);
    }
  };

  useEffect(() => {
    fetchDebugInfo();
    const interval = setInterval(fetchDebugInfo, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-md font-mono text-xs">
      <h2 className="text-sm font-bold text-slate-200 mb-4 uppercase tracking-wider">Trade Execution Debugger</h2>
      {debugData.length === 0 ? (
        <p className="text-slate-500">No recent execution attempts to debug.</p>
      ) : (
        <div className="space-y-4">
          {debugData.map((attempt, idx) => (
            <div key={idx} className="border-l-2 border-slate-700 pl-4 py-1">
              <div className="flex justify-between items-center mb-1">
                <span className="font-bold text-slate-100">{attempt.symbol}</span>
                <span className={`px-2 py-0.5 rounded text-[10px] ${attempt.passed ? 'bg-emerald-900/30 text-emerald-400' : 'bg-rose-900/30 text-rose-400'}`}>
                  {attempt.passed ? 'PASSED' : 'REJECTED'}
                </span>
              </div>
              {!attempt.passed && (
                <ul className="list-disc list-inside text-rose-400 space-y-0.5">
                  {attempt.failedReasons.map((reason: string, rIdx: number) => (
                    <li key={rIdx}>{reason}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
