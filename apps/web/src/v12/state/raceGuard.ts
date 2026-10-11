/**
 * Pure helpers for out-of-order protection (rapid A -> B -> A workspace switching).
 */

/** Latest-wins gate: only the most recently begun operation may apply its result. */
export interface LatestGate {
  begin(): number;
  isCurrent(token: number): boolean;
  /** Invalidate everything in flight without starting a new operation. */
  invalidate(): void;
}
export function createLatestGate(): LatestGate {
  let current = 0;
  return {
    begin: () => ++current,
    isCurrent: (t) => t === current,
    invalidate: () => {
      current += 1;
    },
  };
}

/** Data may be shown only when it belongs to the active workspace. */
export function belongsToActiveWorkspace(activeId: string | null, dataWorkspaceId: string | null | undefined): boolean {
  return !!activeId && !!dataWorkspaceId && activeId === dataWorkspaceId;
}

/** Returns the data only when it belongs to the active workspace; otherwise undefined (render a skeleton, not another workspace's data). */
export function onlyIfActive<T extends { workspace_id: string }>(activeId: string | null, data: T | undefined | null): T | undefined {
  return data && belongsToActiveWorkspace(activeId, data.workspace_id) ? data : undefined;
}

/**
 * Serialises async tasks and lets a newer request skip older ones that have not started.
 * Used for `select` calls so the server's final `active` equals the latest user intent.
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const next = tail.then(task, task);
      tail = next.catch(() => undefined);
      return next;
    },
  };
}
