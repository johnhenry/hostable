/**
 * The url=/app=/handler= dispatch logic behind <Upstream>. Each Upstream
 * compiles down to a servable <Route> whose handler is one of the three
 * functions this module builds -- see compile.ts.
 */
import type { RouteContext } from "@johnhenry/servable";
import { HostableError } from "./types.js";
import type { UpstreamHandler } from "./types.js";

/** Anything shaped like `{fetch(request): Promise<Response>}` -- a compiled servable app, a dialback Server, or a caller's own adaptor. */
export interface FetchLike {
  fetch(request: Request): Response | Promise<Response>;
}

/**
 * Hop-by-hop headers per RFC 9110 SS7.6.1 -- meaningful only for a single
 * transport hop, never meant to be forwarded by a proxy. Stripped from both
 * the outgoing (proxied) request and the returned response.
 */
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function stripHopByHop(headers: Headers): Headers {
  const cleaned = new Headers(headers);
  for (const name of HOP_BY_HOP_HEADERS) cleaned.delete(name);
  return cleaned;
}

/**
 * Strips `prefix` from `pathname` -- the same "serve what's *inside* this
 * scope" rule fileable-mount already uses. `prefix` is the Host/Group
 * scope's own accumulated basePath; an empty prefix (root-mounted Upstream)
 * leaves the path untouched.
 */
function stripPrefix(pathname: string, prefix: string): string {
  if (!prefix || prefix === "/") return pathname;
  if (pathname === prefix) return "/";
  if (pathname.startsWith(prefix + "/")) return pathname.slice(prefix.length) || "/";
  return pathname;
}

/** Builds the forwarding handler for `url=` -- a real reverse proxy via fetch(). */
export function createUrlUpstream(target: string, prefix: string, timeout?: number): UpstreamHandler {
  return async (req: Request): Promise<Response> => {
    const incoming = new URL(req.url);
    const targetUrl = new URL(target);
    const strippedPath = stripPrefix(incoming.pathname, prefix); // always starts with "/"
    const targetBasePath = targetUrl.pathname === "/" ? "" : targetUrl.pathname.replace(/\/$/, "");
    targetUrl.pathname = targetBasePath + strippedPath;
    targetUrl.search = incoming.search;

    const headers = stripHopByHop(req.headers);
    const controller = timeout !== undefined ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : undefined;
    try {
      const upstreamRes = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: req.body,
        redirect: "manual",
        signal: controller?.signal,
        // @ts-expect-error -- duplex is required by Node's fetch when a body is a stream, not yet in lib.dom.d.ts.
        duplex: req.body ? "half" : undefined,
      });
      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: stripHopByHop(upstreamRes.headers),
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

/** Builds the forwarding handler for `app=` -- an in-process Fetch-shaped backend, zero network hop. */
export function createAppUpstream(app: FetchLike, prefix: string): UpstreamHandler {
  return async (req: Request): Promise<Response> => {
    const incoming = new URL(req.url);
    const rewritten = new URL(incoming);
    rewritten.pathname = stripPrefix(incoming.pathname, prefix);
    const forwarded = new Request(rewritten, req);
    return app.fetch(forwarded);
  };
}

/** `handler=` needs no wrapping -- it's already the exact shape compile.ts feeds to servable's Route. */
export function createHandlerUpstream(handler: UpstreamHandler): UpstreamHandler {
  return handler;
}

export function resolveUpstreamHandler(
  props: { url?: unknown; app?: unknown; handler?: unknown; timeout?: unknown },
  prefix: string,
  path: string,
): UpstreamHandler {
  const hasUrl = props.url !== undefined;
  const hasApp = props.app !== undefined;
  const hasHandler = props.handler !== undefined;
  if ([hasUrl, hasApp, hasHandler].filter(Boolean).length !== 1) {
    throw new HostableError("<Upstream> requires exactly one of `url`, `app`, or `handler`", path);
  }
  if (hasUrl) return createUrlUpstream(props.url as string, prefix, props.timeout as number | undefined);
  if (hasApp) return createAppUpstream(props.app as FetchLike, prefix);
  return createHandlerUpstream(props.handler as UpstreamHandler);
}
