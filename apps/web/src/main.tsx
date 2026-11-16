import { PowerSyncContext } from '@powersync/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createClock } from './clock.ts';
import { db, startSync } from './powersync/db.ts';
import './styles.css';

const clock = createClock();

// Test hook: lets Playwright read rows without reaching into IndexedDB.
if (import.meta.env.MODE === 'test') {
  (window as unknown as { __app: unknown }).__app = { db, clock };
}

startSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PowerSyncContext.Provider value={db}>
      <App clock={clock} db={db} />
    </PowerSyncContext.Provider>
  </StrictMode>,
);
