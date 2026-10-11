import { FakeBackend } from "./fakeBackend";

/** Install a global fetch backed by a FakeBackend. Returns the backend and a restore function. */
export function installFakeFetch(be: FakeBackend = new FakeBackend()) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h) {
      if (h instanceof Headers) h.forEach((v, k) => (headers[k.toLowerCase()] = v));
      else if (Array.isArray(h)) for (const [k, v] of h) headers[k!.toLowerCase()] = v!;
      else for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
    }
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const r = be.handle(method, url, body, headers);
    if (r.abort) throw new TypeError("Failed to fetch");
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return new Response(JSON.stringify(r.json), { status: r.status, statusText: String(r.status), headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { be, restore: () => void (globalThis.fetch = original) };
}
