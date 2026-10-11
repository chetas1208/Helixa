/**
 * POST /api/genome-edit/interpret-command when Agent 4 has landed it.
 * 404 / 405 / 501 → the local router, which must stay correct on its own.
 */
import { ApiError, apiPost, isApiError } from "../../v12/api/client";
import type { InterpretCommandRequest, InterpretCommandResponse } from "../../v14/contracts";
import { routePrompt } from "../../v12/editor/promptRouter";
import type { RouterContext } from "../../v12/editor/promptRouter";

const PATH = "/api/genome-edit/interpret-command";

const INTENTS = new Set(["EXPLORE", "PRECISE_EDIT", "TRAIT_GOAL", "NEEDS_CLARIFICATION", "UNSUPPORTED"]);

function asResponse(raw: unknown): InterpretCommandResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const intent = (raw as { intent?: unknown }).intent;
  const reason = (raw as { reason?: unknown }).reason;
  if (typeof intent !== "string" || !INTENTS.has(intent) || typeof reason !== "string") return null;
  return raw as InterpretCommandResponse;
}

function useLocal(e: unknown): boolean {
  if (!isApiError(e)) return e instanceof ApiError;
  return e.notFound || e.status === 405 || e.status === 501 || e.status === 0;
}

export async function interpretCommandOrLocal(
  req: InterpretCommandRequest,
  ctx: RouterContext,
  signal?: AbortSignal,
): Promise<InterpretCommandResponse> {
  const local = routePrompt(req.text, ctx, req.source);
  try {
    const raw = await apiPost<unknown>(PATH, req, { signal });
    return asResponse(raw) ?? local;
  } catch (e) {
    if (useLocal(e)) return local;
    throw e;
  }
}
