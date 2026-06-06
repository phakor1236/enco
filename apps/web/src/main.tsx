import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';

import { App } from './App.js';
import { restoreSession } from './lib/apiClient.js';
import { queryClient } from './lib/queryClient.js';

import './styles/tokens.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element not found');

// Boot-time silent refresh: if the HttpOnly refresh cookie is still valid,
// re-hydrate user + accessToken before the app mounts so F5 / fresh tab
// don't appear to log the user out. Fire-and-forget — UI shows a loading
// state via authStore.initialized while this resolves.
void restoreSession();

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
