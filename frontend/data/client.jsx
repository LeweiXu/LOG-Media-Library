import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// One QueryClient for the whole app. It lives at module scope so non-component
// code (auth login/logout in app.jsx) can reach it to clear cross-user cache.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Preload once per app session: a prefetched/loaded query is never refetched
      // just because time passed — only when something invalidates it. Library
      // mutations invalidate entries/counts/lists/stats (clearing the table
      // preloads), and useRevalidateOnFocus invalidates on tab refocus. This is
      // what makes "hover once, cached for the session" hold.
      staleTime: Infinity,
      gcTime: 30 * 60_000,
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
