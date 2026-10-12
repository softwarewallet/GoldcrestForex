import React from 'react';
import { ConnectionHealthWidget } from './ConnectionHealthWidget';

export const ConnectionMonitorPage: React.FC = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Connection Monitor</h1>
      <ConnectionHealthWidget />
    </div>
  );
};
