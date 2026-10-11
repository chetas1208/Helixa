import { QueryClient } from "@tanstack/react-query";
import { shouldRetryRequest } from "./client";

/**
 * App-wide QueryClient. Mount once:
 *   const queryClient = useMemo(createQueryClient, []);  // or a module-level const
 *   <QueryClientProvider client={queryClient}>...</QueryClientProvider>
 *
 * Policy: server state is authoritative and short-lived (staleTime 5 s, refetch on focus/reconnect);
 * immutable resources (reference, parameters, simulations) override with staleTime Infinity in hooks.
 * Queries retry at most twice and only on network/5xx; 4xx (incl. 409) and contract mismatches never
 * retry. Mutations never retry (a commit must not be replayed silently).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryRequest,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: { retry: false },
    },
  });
}
