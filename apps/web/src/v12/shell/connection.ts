import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/client";
import { useWorkspaces } from "../api/hooks";
import { useSession } from "../state/session";
import type { ConnectionState } from "../types";

export interface ConnectionInfo {
  state: ConnectionState;
  label: string;
  detail: string;
  retry: () => void;
}

const LABEL: Record<ConnectionState, string> = {
  online: "API online",
  degraded: "API degraded",
  offline: "API offline",
  unknown: "Checking API",
};

/**
 * Real connection status. `session.connection` (driven by the data layer's health poll) wins when it
 * has a verdict; until then it is derived from the workspaces query, never from a UI toggle.
 */
export function useConnectionInfo(): ConnectionInfo {
  const fromSession = useSession((s) => s.connection);
  const ws = useWorkspaces();
  const qc = useQueryClient();

  let derived: ConnectionState = "unknown";
  if (ws.isError) derived = ws.error instanceof ApiError && ws.error.status !== 0 ? "degraded" : "offline";
  else if (ws.isSuccess) derived = ws.isRefetchError ? "degraded" : "online";

  const state = fromSession !== "unknown" ? fromSession : derived;
  const detail =
    state === "offline"
      ? "The API at /api is unreachable. Data on screen may be stale; saving, proposals and simulation are unavailable."
      : state === "degraded"
        ? "The API answered with an error. Some data may be missing or stale."
        : state === "online"
          ? "Connected to the HELIXA API."
          : "Waiting for the first response from the API.";

  return { state, label: LABEL[state], detail, retry: () => void qc.refetchQueries({ type: "active" }) };
}
