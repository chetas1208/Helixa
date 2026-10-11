/**
 * Pure URL <-> selection logic for `?tab=&workspace=`. No DOM access.
 * Only a tab id and an opaque workspace id are ever placed in the URL: no sequences, edits or transcripts.
 */
import { TAB_ORDER } from "../types";
import type { TabId } from "../types";

export const WORKSPACE_ID_PATTERN = /^ws-[a-z0-9]+$/;
const MAX_ID_LENGTH = 64;

export const isTabId = (v: unknown): v is TabId => typeof v === "string" && (TAB_ORDER as readonly string[]).includes(v);
export const isWorkspaceId = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_ID_LENGTH && WORKSPACE_ID_PATTERN.test(v);

export interface UrlSelection {
  tab: TabId | null;
  workspace: string | null;
  /** Human-readable notes about params that were ignored (never throws). */
  issues: string[];
}

/** Parse a `location.search` string. Invalid or missing values become null with an issue; never throws. */
export function parseUrlSelection(search: string): UrlSelection {
  const issues: string[] = [];
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { tab: null, workspace: null, issues: ["unparseable query string"] };
  }
  const rawTab = params.get("tab");
  const rawWs = params.get("workspace");
  let tab: TabId | null = null;
  let workspace: string | null = null;
  if (rawTab !== null) {
    if (isTabId(rawTab)) tab = rawTab;
    else issues.push("unknown tab ignored");
  }
  if (rawWs !== null) {
    if (isWorkspaceId(rawWs)) workspace = rawWs;
    else issues.push("malformed workspace id ignored");
  }
  return { tab, workspace, issues };
}

/**
 * Produce the next `location.search` for a selection, preserving unrelated params.
 * A null workspace removes the param. Returns "" or "?a=b".
 */
export function serialiseUrlSelection(sel: { tab: TabId; workspace: string | null }, currentSearch = ""): string {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(currentSearch);
  } catch {
    params = new URLSearchParams();
  }
  params.set("tab", sel.tab);
  if (sel.workspace && isWorkspaceId(sel.workspace)) params.set("workspace", sel.workspace);
  else params.delete("workspace");
  const s = params.toString();
  return s ? `?${s}` : "";
}

export type BootstrapSource = "url" | "server-active" | "first" | "none";
export interface BootstrapResult {
  workspaceId: string | null;
  source: BootstrapSource;
  /** True when the URL asked for a workspace that does not exist (caller should replace the URL and tell the user). */
  urlWorkspaceMissing: boolean;
}

/** Initial workspace: URL id if it exists, else the server's `active`, else the first workspace, else null. */
export function resolveBootstrapWorkspace(input: {
  urlWorkspaceId: string | null;
  workspaceIds: readonly string[];
  serverActiveId: string | null;
}): BootstrapResult {
  const { urlWorkspaceId, workspaceIds, serverActiveId } = input;
  const urlOk = urlWorkspaceId !== null && workspaceIds.includes(urlWorkspaceId);
  const urlWorkspaceMissing = urlWorkspaceId !== null && !urlOk;
  if (urlOk) return { workspaceId: urlWorkspaceId, source: "url", urlWorkspaceMissing };
  if (serverActiveId && workspaceIds.includes(serverActiveId)) return { workspaceId: serverActiveId, source: "server-active", urlWorkspaceMissing };
  if (workspaceIds.length > 0) return { workspaceId: workspaceIds[0], source: "first", urlWorkspaceMissing };
  return { workspaceId: null, source: "none", urlWorkspaceMissing };
}

export type HistoryMode = "push" | "replace" | "none";

/**
 * Decide how to write the URL after a state change.
 *  - identical -> none
 *  - bootstrap/normalisation/correction -> replace (no junk history entries)
 *  - user-driven tab or workspace change -> push (Back returns to the previous tab/workspace)
 */
export function decideHistoryMode(input: { currentSearch: string; nextSearch: string; reason: "bootstrap" | "user" | "correction" }): HistoryMode {
  if (normaliseSearch(input.currentSearch) === normaliseSearch(input.nextSearch)) return "none";
  return input.reason === "user" ? "push" : "replace";
}

function normaliseSearch(s: string): string {
  const p = new URLSearchParams(s);
  p.sort();
  return p.toString();
}
