/**
 * Remembers simulation ids per workspace (ids only; no frames, no genomic data) because the
 * backend cannot list simulations per workspace (V12_REQUIRED_BACKEND_ENDPOINTS #4).
 * Pure given an injected storage; every access is try/catch'd and every parse is validated.
 */
export const SIM_MEMORY_PREFIX = "diamond.v12.sims.";
export const SIM_MEMORY_LIMIT = 20;
const SIM_ID = /^sim-[A-Za-z0-9_-]{1,64}$/;
const WS_ID = /^ws-[A-Za-z0-9]{1,64}$/;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const isSimulationId = (v: unknown): v is string => typeof v === "string" && SIM_ID.test(v);
export const isWorkspaceIdShape = (v: unknown): v is string => typeof v === "string" && WS_ID.test(v);

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Safe parse of a stored value: anything that is not a JSON array of simulation ids yields []. Dedupes, caps, keeps order (newest first). */
export function parseSimulationIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const item of v) if (isSimulationId(item) && !out.includes(item)) out.push(item);
    return out.slice(0, SIM_MEMORY_LIMIT);
  } catch {
    return [];
  }
}

/** Pure list update: newest first, no duplicates, capped. */
export function addSimulationId(existing: readonly string[], id: string): string[] {
  return [id, ...existing.filter((x) => x !== id)].slice(0, SIM_MEMORY_LIMIT);
}

export function recallSimulations(workspaceId: string, storage: KeyValueStorage | null = defaultStorage()): string[] {
  if (!isWorkspaceIdShape(workspaceId) || !storage) return [];
  try {
    return parseSimulationIds(storage.getItem(SIM_MEMORY_PREFIX + workspaceId));
  } catch {
    return [];
  }
}

/** Returns the new list (also when persistence failed, so the session still shows it). */
export function rememberSimulation(workspaceId: string, simulationId: string, storage: KeyValueStorage | null = defaultStorage()): string[] {
  if (!isWorkspaceIdShape(workspaceId) || !isSimulationId(simulationId)) return [];
  const next = addSimulationId(recallSimulations(workspaceId, storage), simulationId);
  try {
    storage?.setItem(SIM_MEMORY_PREFIX + workspaceId, JSON.stringify(next));
  } catch {
    /* quota / private mode: memory is a convenience only */
  }
  notifySimulationMemory(workspaceId);
  return next;
}

// ---- tiny subscription so UI (library cards) re-reads after a run elsewhere in the session ----
const listeners = new Set<() => void>();
let version = 0;
export function subscribeSimulationMemory(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key && e.key.startsWith(SIM_MEMORY_PREFIX)) cb();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
export const simulationMemoryVersion = () => version;
function notifySimulationMemory(_workspaceId: string): void {
  version += 1;
  listeners.forEach((l) => l());
}
