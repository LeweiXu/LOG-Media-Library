import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// One QueryClient for the whole app. It lives at module scope so non-component
// code (auth login/logout in app.jsx) can reach it to clear cross-user cache.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Treat data as fresh for 30s. Hover-prefetched pages then render straight
      // from cache on click without kicking off an immediate refetch.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      // The app has its own focus handler (useRevalidateOnFocus) that also probes
      // the backend for offline recovery, so RQ's own focus refetch stays off to
      // avoid double-fetching.
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export function DataProvider({ children }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
