/**
 * Pure classification of capability probes. Probes target a workspace id that cannot exist
 * (`ws-capability-probe`), so a route that exists answers 404 (unknown workspace) or 4xx validation,
 * while a route that does not exist answers FastAPI's generic 404 "Not Found" or 405. No side effects.
 */
import type { WorkspaceCapabilities } from "./schemas";

export const PROBE_WORKSPACE_ID = "ws-capability-probe";
export type ProbeKind = keyof WorkspaceCapabilities;
export interface ProbeOutcome {
  /** HTTP status, or 0 for network/timeout, or 200 when the call succeeded. */
  status: number;
  detail: string;
}

export function routeExists(_kind: ProbeKind, o: ProbeOutcome): boolean {
  if (o.status === 0 || o.status === 405 || o.status === 501) return false;
  if (o.status === 404) return o.detail !== "Not Found"; // generic router 404 => no such route; anything else is the handler's "unknown workspace"
  return o.status === 200 || (o.status >= 400 && o.status < 500);
}

export const NO_CAPABILITIES: WorkspaceCapabilities = { rename: false, archive: false, listSimulations: false };
