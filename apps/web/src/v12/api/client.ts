import type { ZodType } from "zod";

/** Detail carried by every response-validation failure (status 502: the upstream answered, but not per contract). */
export const CONTRACT_MISMATCH_DETAIL = "Response did not match the expected contract";
/** Default per-request ceiling. Callers may pass their own AbortSignal as well. */
export const DEFAULT_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public path: string,
    /** Contract failures only: `field.path: message` strings (never values, so no genomic data leaks into logs). */
    public issues: string[] = [],
  ) {
    super(`${status} ${path}: ${detail}`);
    this.name = "ApiError";
  }
  /** Endpoint missing on this backend (405, 501, network) as opposed to a missing record. */
  get unavailable(): boolean {
    return this.status === 0 || this.status === 405 || this.status === 501;
  }
  /** Optimistic-concurrency / budget conflict. `detail` is the server's own explanation: surface it, never retry silently. */
  get conflict(): boolean {
    return this.status === 409;
  }
  get notFound(): boolean {
    return this.status === 404;
  }
  /** The server answered but the payload failed zod validation. */
  get contractMismatch(): boolean {
    return this.status === 502 && this.detail === CONTRACT_MISMATCH_DETAIL;
  }
  get network(): boolean {
    return this.status === 0;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;
export const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

/** Retry policy shared by the QueryClient: only transient failures (network, 5xx other than contract mismatch), at most twice. */
export function shouldRetryRequest(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!isApiError(error)) return false;
  if (error.contractMismatch) return false;
  if (error.status === 0) return true;
  return error.status >= 500;
}

/** Merge a caller signal with a timeout. Returns the combined signal plus a disposer. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const ctrl = new AbortController();
  let didTimeOut = false;
  const timer = setTimeout(() => {
    didTimeOut = true;
    ctrl.abort();
  }, ms);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    timedOut: () => didTimeOut,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

export function summariseIssues(error: { issues: { path: (string | number)[]; message: string }[] }): string[] {
  return error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

function abortError(): Error {
  const e = new Error("The operation was aborted.");
  e.name = "AbortError";
  return e;
}

async function request(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, init?: RequestInit): Promise<unknown> {
  const t = withTimeout(init?.signal ?? undefined, DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? init?.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: t.signal,
    });
  } catch (e) {
    t.dispose();
    if (init?.signal?.aborted) throw abortError();
    if (t.timedOut()) throw new ApiError(0, "The request timed out.", path);
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new ApiError(0, "Network error. The API is unreachable.", path);
  }
  try {
    if (!res.ok) {
      let detail = res.statusText || `HTTP ${res.status}`;
      try {
        const j: unknown = await res.json();
        if (j && typeof j === "object" && "detail" in j) {
          const d = (j as { detail: unknown }).detail;
          detail = typeof d === "string" ? d : JSON.stringify(d);
        } else {
          detail = JSON.stringify(j);
        }
      } catch {
        /* non-JSON error body: keep status text */
      }
      throw new ApiError(res.status, detail, path);
    }
    try {
      return await res.json();
    } catch (e) {
      if (init?.signal?.aborted) throw abortError();
      if (e instanceof Error && e.name === "AbortError") throw e;
      throw new ApiError(502, CONTRACT_MISMATCH_DETAIL, path, ["(root): body is not valid JSON"]);
    }
  } finally {
    t.dispose();
  }
}

function parseOrThrow<T>(schema: ZodType<T>, data: unknown, path: string): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new ApiError(502, CONTRACT_MISMATCH_DETAIL, path, summariseIssues(r.error));
  return r.data;
}

/** Validated GET: the only way data should enter render state. */
export const apiGetParsed = async <T>(path: string, schema: ZodType<T>, signal?: AbortSignal): Promise<T> =>
  parseOrThrow(schema, await request("GET", path, undefined, { signal }), path);

/** Validated POST. `init.signal` is honoured; 4xx are never retried here. */
export const apiPostParsed = async <T>(path: string, body: unknown, schema: ZodType<T>, init?: RequestInit): Promise<T> =>
  parseOrThrow(schema, await request("POST", path, body ?? {}, init), path);

export const apiPatchParsed = async <T>(path: string, body: unknown, schema: ZodType<T>, init?: RequestInit): Promise<T> =>
  parseOrThrow(schema, await request("PATCH", path, body ?? {}, init), path);

/**
 * Unvalidated escape hatches kept for backward compatibility. Do not use for data that reaches
 * render state: prefer apiGetParsed / apiPostParsed (hooks.ts does).
 */
export const apiGet = <T>(path: string, signal?: AbortSignal) => request("GET", path, undefined, { signal }) as Promise<T>;
export const apiPost = <T>(path: string, body: unknown, init?: RequestInit) => request("POST", path, body ?? {}, init) as Promise<T>;
