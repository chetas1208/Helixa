/**
 * Query keys. Pure. Every key that holds per-workspace data carries the workspace id, so a
 * workspace switch can never serve (or be confused with) another workspace's cache entry.
 */
export const qk = {
  reference: ["reference"] as const,
  window: (s: number, e: number) => ["window", s, e] as const,
  workspaces: ["workspaces"] as const,
  workspace: (id: string) => ["workspace", id] as const,
  intelligence: (id: string, rev?: string) => ["intelligence", id, rev ?? ""] as const,
  parameters: ["parameters"] as const,
  environments: ["environments"] as const,
  /** workspaceId optional for backward compatibility; pass it whenever known so cancellation and display guards can scope it. */
  simulation: (id: string, workspaceId?: string) => ["simulation", id, workspaceId ?? ""] as const,
  fixtures: ["fixtures"] as const,
  harnesses: ["harnesses"] as const,
  harnessLineage: (id: string) => ["harness-lineage", id] as const,
  health: ["health"] as const,
  transcription: ["transcription-availability"] as const,
  capabilities: ["workspace-capabilities"] as const,
  workspaceSimulations: (workspaceId: string) => ["simulation-list", workspaceId] as const,
};

/** Workspace id a query key is scoped to, or null for global keys. */
export function workspaceIdFromKey(key: readonly unknown[]): string | null {
  const head = key[0];
  if (head === "workspace" || head === "intelligence") return typeof key[1] === "string" && key[1] !== "none" ? key[1] : null;
  if (head === "simulation-list") return typeof key[1] === "string" ? key[1] : null;
  if (head === "simulation") return typeof key[2] === "string" && key[2] !== "" ? key[2] : null;
  return null;
}

/** True when the key belongs to a workspace other than `activeId` (candidates for cancelQueries on a switch). */
export function isStaleKeyForWorkspace(key: readonly unknown[], activeId: string | null): boolean {
  const owner = workspaceIdFromKey(key);
  return owner !== null && owner !== activeId;
}
