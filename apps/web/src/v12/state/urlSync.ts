/**
 * Bidirectional `?tab=&workspace=` <-> useSession sync. Mount ONCE in App (Agent A):
 *   const sync = useUrlSync();   // { status, notice, retry }
 *
 * - Bootstrap: URL workspace if it exists, else server `active`, else first workspace, else null.
 * - State -> URL: user-driven changes push history entries; bootstrap/corrections replace.
 * - URL -> State: popstate (Back/Forward) restores the tab and, via the guarded switch, the workspace.
 * - Bad params never throw: they are ignored and the URL is normalised with replaceState.
 * - Cancels queries of non-active workspaces whenever the active workspace changes.
 * Only a tab id and an opaque workspace id are ever written to the URL.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaces } from "../api/hooks";
import { isStaleKeyForWorkspace, qk } from "../api/queryKeys";
import { useGuardedWorkspaceSwitch } from "../library/SwitchGuard";
import type { TabId } from "../types";
import { useSession } from "./session";
import { decideHistoryMode, parseUrlSelection, resolveBootstrapWorkspace, serialiseUrlSelection } from "./urlParams";

export type UrlSyncStatus = "loading" | "ready" | "empty" | "error";
export interface UrlSyncResult {
  status: UrlSyncStatus;
  /** One-line, user-facing note when the URL asked for something that does not exist; null otherwise. */
  notice: string | null;
  retry: () => void;
}

function writeUrl(reason: "bootstrap" | "user" | "correction", tab: TabId, workspace: string | null): void {
  if (typeof window === "undefined") return;
  const next = serialiseUrlSelection({ tab, workspace }, window.location.search);
  const mode = decideHistoryMode({ currentSearch: window.location.search, nextSearch: next, reason });
  if (mode === "none") return;
  const url = `${window.location.pathname}${next}${window.location.hash}`;
  try {
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  } catch {
    /* sandboxed iframe / file:// : URL sync is best-effort */
  }
}

export function useUrlSync(): UrlSyncResult {
  const qc = useQueryClient();
  const workspaces = useWorkspaces();
  const guardedSwitch = useGuardedWorkspaceSwitch();
  const switchRef = useRef(guardedSwitch);
  switchRef.current = guardedSwitch;

  const activeTab = useSession((s) => s.activeTab);
  const activeWorkspaceId = useSession((s) => s.activeWorkspaceId);
  const [notice, setNotice] = useState<string | null>(null);
  const bootstrapped = useRef(false);
  /** True while we apply URL -> state, so the state -> URL effect does not echo it back as a push. */
  const applyingFromUrl = useRef(false);
  const initialUrl = useRef(typeof window === "undefined" ? { tab: null, workspace: null, issues: [] as string[] } : parseUrlSelection(window.location.search));

  // 1) Tab from the URL, immediately (no server needed).
  useEffect(() => {
    const t = initialUrl.current.tab;
    if (t && t !== useSession.getState().activeTab) {
      applyingFromUrl.current = true;
      useSession.getState().setActiveTab(t);
      applyingFromUrl.current = false;
    }
  }, []);

  // 2) Bootstrap workspace once the list is known.
  useEffect(() => {
    if (bootstrapped.current || !workspaces.data) return;
    bootstrapped.current = true;
    const ids = workspaces.data.workspaces.filter((w) => w.status.toUpperCase() !== "ARCHIVED").map((w) => w.workspace_id);
    const current = useSession.getState().activeWorkspaceId;
    const r = resolveBootstrapWorkspace({
      urlWorkspaceId: initialUrl.current.workspace,
      workspaceIds: ids,
      serverActiveId: workspaces.data.active?.workspace_id ?? null,
    });
    if (r.urlWorkspaceMissing) setNotice("The workspace in the link was not found, so the server's active workspace is shown.");
    else if (initialUrl.current.issues.length > 0) setNotice("Part of the link was not understood and was ignored.");
    const chosen = current && ids.includes(current) ? current : r.workspaceId;
    applyingFromUrl.current = true;
    useSession.getState().setActiveWorkspaceId(chosen);
    applyingFromUrl.current = false;
    writeUrl("bootstrap", useSession.getState().activeTab, chosen);
  }, [workspaces.data]);

  // 3) State -> URL for user-driven changes (after bootstrap).
  const lastWritten = useRef<string>("");
  useEffect(() => {
    if (!bootstrapped.current || applyingFromUrl.current) return;
    const key = `${activeTab}|${activeWorkspaceId ?? ""}`;
    if (key === lastWritten.current) return;
    lastWritten.current = key;
    writeUrl("user", activeTab, activeWorkspaceId);
  }, [activeTab, activeWorkspaceId]);

  // 4) Back/Forward: URL -> state. Workspace changes go through the draft guard; a refusal restores the URL.
  useEffect(() => {
    const onPop = () => {
      const sel = parseUrlSelection(window.location.search);
      const s = useSession.getState();
      if (sel.tab && sel.tab !== s.activeTab) {
        applyingFromUrl.current = true;
        s.setActiveTab(sel.tab);
        applyingFromUrl.current = false;
      }
      const ids = qc.getQueryData<{ workspaces: { workspace_id: string }[] }>(qk.workspaces)?.workspaces.map((w) => w.workspace_id) ?? [];
      if (sel.workspace && sel.workspace !== s.activeWorkspaceId && ids.includes(sel.workspace)) {
        void switchRef.current(sel.workspace).then((ok) => {
          if (!ok) writeUrl("correction", useSession.getState().activeTab, useSession.getState().activeWorkspaceId);
        });
      } else if (sel.workspace && !ids.includes(sel.workspace)) {
        writeUrl("correction", useSession.getState().activeTab, useSession.getState().activeWorkspaceId);
      }
      lastWritten.current = `${useSession.getState().activeTab}|${useSession.getState().activeWorkspaceId ?? ""}`;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [qc]);

  // 5) Workspace switch hygiene: cancel in-flight queries that belong to any other workspace.
  useEffect(() => {
    void qc.cancelQueries({ predicate: (q) => isStaleKeyForWorkspace(q.queryKey, activeWorkspaceId) });
  }, [activeWorkspaceId, qc]);

  const retry = useCallback(() => {
    void workspaces.refetch();
  }, [workspaces]);

  let status: UrlSyncStatus = "loading";
  if (workspaces.isError && !bootstrapped.current) status = "error";
  else if (bootstrapped.current && workspaces.data) status = workspaces.data.workspaces.length === 0 ? "empty" : "ready";
  return { status, notice, retry };
}
