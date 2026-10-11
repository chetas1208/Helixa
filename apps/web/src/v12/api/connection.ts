import type { ConnectionState } from "../types";
import { isApiError } from "./client";
import type { HealthResponse } from "./schemas";

/** Pure: map a health probe outcome to the shell's connection indicator. Never fabricates "online". */
export function connectionFromHealth(outcome: { data?: HealthResponse; error?: unknown }): ConnectionState {
  if (outcome.data) return outcome.data.status.toUpperCase() === "HEALTHY" ? "online" : "degraded";
  const e = outcome.error;
  if (isApiError(e)) {
    if (e.status === 0) return "offline"; // network / timeout
    return "degraded"; // reachable but erroring or answering off-contract
  }
  return "unknown";
}

/** Poll faster while unhealthy so recovery shows quickly; otherwise relaxed. */
export const healthRefetchInterval = (state: ConnectionState): number => (state === "online" ? 20_000 : 5_000);
