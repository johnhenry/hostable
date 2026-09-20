/**
 * Small, generic adapters from two common "almost FetchLike" shapes into
 * the real thing (`{fetch(request): Promise<Response>}`, see forward.ts).
 * Not specific to any one integration -- e.g. dialback's `Server` already
 * satisfies `FetchLike` directly and needs neither of these, but
 * `@johnhenry/browsermesh-apps`' `createBrowserMeshFetch()` (a bare
 * `fetch(url, init)`-shaped function) and
 * `@johnhenry/browsermesh-discovery`'s `MeshFetchRouter#route()` (a
 * `(req) => Promise<Response|null>` Service-Worker-interceptor shape) each
 * need one of these, and neither adapter has anything mesh-specific in it
 * -- standardized here so every caller doesn't hand-roll slightly
 * different (and possibly subtly wrong) wrapper code.
 */
import type { FetchLike } from "./forward.js";

export interface FetchFnInit {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
}

/**
 * Adapts any `fetch()`-shaped function -- `(url, init) => Promise<Response>`
 * -- into a `FetchLike` object usable as `<Upstream app={...} />`.
 *
 * The request body is read as text before calling `fn` (not passed as a
 * raw `ReadableStream`) -- matching how both
 * `createBrowserMeshFetch()`/`MeshFetchRouter#route()` already extract a
 * body from `init.body`/a real `Request` (read as text, then try
 * `JSON.parse`), since neither accepts a stream. GET/HEAD requests never
 * carry a body, matching real `fetch()`.
 */
export function fromFetchFn(fn: (url: string, init?: FetchFnInit) => Response | Promise<Response>): FetchLike {
  return {
    async fetch(req: Request): Promise<Response> {
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const body = hasBody ? await req.text() : undefined;
      return fn(req.url, { method: req.method, headers: req.headers, body });
    },
  };
}

/**
 * Adapts a nullable router -- `(req) => Promise<Response | null>`, the
 * Service-Worker-`fetch`-event-interceptor shape ("return `null` for `not
 * mine`") -- into a `FetchLike` object, with a configurable fallback for
 * `null` (default: a plain 404).
 */
export function fromNullableRouter(
  fn: (req: Request) => Response | null | Promise<Response | null>,
  notFound: () => Response = () => new Response("Not Found", { status: 404 }),
): FetchLike {
  return {
    async fetch(req: Request): Promise<Response> {
      const res = await fn(req);
      return res ?? notFound();
    },
  };
}
