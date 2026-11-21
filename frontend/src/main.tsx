import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes } from './app/Routes';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000 } },
});
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppRoutes />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
