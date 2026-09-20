/**
 * hostable's own compile stage is a thin pre-transform, not a parallel
 * implementation of servable's Layout/dispatch. It walks the hostable
 * tree, converts `Gateway`/`Host`/`Upstream` into real servable
 * primitives (`Router`/nothing/`Route`), and hands the result to
 * @johnhenry/servable's own `compile()`. servable never sees a
 * hostable-specific tag.
 *
 * `Host` has no servable equivalent -- it's flattened away entirely,
 * contributing only to a `hostname` value threaded through the walk
 * (`TransformCtx.hostname`) that gets baked into a raw `URLPattern`
 * instance for every `Route`/`Upstream` inside it (servable's `Route.path`
 * already accepts a raw `URLPattern` instance for exactly this
 * "cross-origin matching a plain string can't express" case). `Group`'s
 * own pathname-prefix accumulation is independently re-tracked here
 * (`TransformCtx.pathPrefix`, mirroring servable/layout.ts's own
 * `posixJoin(ctx.basePath, prefix)`) because passing a raw `URLPattern`
 * instance bypasses servable's own string-based prefix-joining entirely
 * -- confirmed by reading servable/src/urlpattern.ts's `compilePath()`,
 * which returns an already-constructed `URLPattern` unchanged.
 *
 * Known v1 limitation: `NotFound`/`ErrorBoundary` scope resolution is
 * still keyed purely by servable's own pathname-based scope (`Host`
 * doesn't contribute to it) -- two sibling `Host`s at the same path scope
 * share one `NotFound`/error boundary unless also separated by a real
 * `Group prefix`. Only `Route`/`Upstream` get hostname-qualified matching
 * in v1; `Redirect` does not (documented in the README).
 */
import { join as posixJoin } from "node:path/posix";
import { URLPattern as URLPatternPolyfill } from "urlpattern-polyfill";
import {
  ErrorBoundary as ServableErrorBoundary,
  Group as ServableGroup,
  Route as ServableRoute,
  Router as ServableRouter,
  Use as ServableUse,
  compile as servableCompile,
} from "@johnhenry/servable";
import type { CompileOptions, CompileResult } from "@johnhenry/servable";
import { HostableError, isDescriptor, isFetchLike } from "./types.js";
import type { Descriptor, DescriptorChild } from "./types.js";
import { createAppUpstream, resolveUpstreamHandler } from "./forward.js";

/**
 * servable's own `RouteProps.path` type is pinned to `urlpattern-polyfill`'s
 * class shape (its internal `URLPatternInstance` type isn't exported
 * publicly for us to reference directly) -- construct via the same
 * constructor so the value satisfies that type exactly, not `as any`.
 * Prefer the native global when present (Node 26 has it, same as servable's
 * own urlpattern.ts does internally) -- functionally identical either way,
 * this only affects which constructor produces the instance.
 */
type URLPatternCtor = typeof URLPatternPolyfill;
const NativeURLPattern = (globalThis as { URLPattern?: URLPatternCtor }).URLPattern;
const URLPatternImpl: URLPatternCtor = NativeURLPattern ?? URLPatternPolyfill;

interface TransformCtx {
  /** Set once inside a <Host> -- undefined outside any Host (routes there are untouched, handled entirely by servable's own Layout). */
  hostname?: string;
  /** Accumulated <Group prefix> chain, independent of hostname -- tracked unconditionally so <Upstream> always knows how much prefix to strip when forwarding. */
  pathPrefix: string;
}

function hostQualifiedPattern(hostname: string, pathname: string): InstanceType<URLPatternCtor> {
  return new URLPatternImpl({ hostname, pathname });
}

/**
 * The match path for a Route/Upstream/raw-child at `localPath` under `ctx`.
 * Outside any Host, this is just `localPath` UNCHANGED -- the real `Group`
 * ancestor already sits in the output tree (see the "group" case below),
 * and servable's own Layout independently joins its `prefix` for any
 * string path nested inside it; joining `ctx.pathPrefix` in here too would
 * double-apply it. Inside a Host, a raw URLPattern instance bypasses that
 * joining entirely (confirmed by reading servable/src/urlpattern.ts's
 * `compilePath()`), so the full join has to happen here instead.
 */
function routePathFor(ctx: TransformCtx, localPath: string): string | InstanceType<URLPatternCtor> {
  if (ctx.hostname === undefined) return localPath;
  return hostQualifiedPattern(ctx.hostname, posixJoin(ctx.pathPrefix, localPath));
}

/**
 * servable's own dispatch has no "match any method" concept (`compile.ts`
 * does a plain `route.method !== req.method` check) -- `Route` defaulting
 * to `"GET"` makes sense for a single API endpoint, but the same default
 * would be wrong for `Upstream`: a reverse proxy blindly forwarding only
 * `GET` by default would silently 404 every `POST`/`PUT`/`DELETE`/etc.
 * request, which is not what "forward everything under this path" means
 * in practice. When `method` isn't set, register one servable `Route` per
 * standard method instead, all sharing the same compiled path+handler.
 */
const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function transformChild(child: DescriptorChild, ctx: TransformCtx, path: string): DescriptorChild | DescriptorChild[] {
  if (Array.isArray(child)) return child.map((c) => transformChild(c, ctx, path)).flat();
  // A raw Fetch-shaped object (a compiled servable app, a dialback Server,
  // anything with .fetch()) placed directly as a child -- mirrors
  // <Upstream app={value} path="/*" />. Checked before isDescriptor since
  // servable's own Layout would otherwise silently drop it (walkChild only
  // recurses into Descriptors/Arrays, ignoring anything else).
  if (isFetchLike(child)) {
    const matchPath = routePathFor(ctx, "/*");
    return ALL_METHODS.map((method) => ServableRoute({ path: matchPath, method, handler: createAppUpstream(child, ctx.pathPrefix) }));
  }
  if (!isDescriptor(child)) return child; // opaque: string/number/plain object/etc.

  switch (child.tag) {
    case "gateway": {
      return ServableRouter({
        children: transformChildren(child.children, { hostname: undefined, pathPrefix: "" }, `${path} > gateway`),
      });
    }
    case "host": {
      const name = child.props.name as string | undefined;
      const pattern = child.props.pattern as string | undefined;
      const hostname = pattern ?? name;
      if (!hostname) throw new HostableError("<Host> requires a `name` or `pattern` prop", path);
      const nextCtx: TransformCtx = { hostname, pathPrefix: ctx.pathPrefix };
      // <Host> has no servable equivalent -- flatten its (transformed) children directly into the parent.
      return transformChildren(child.children, nextCtx, `${path} > host[${hostname}]`);
    }
    case "group": {
      const prefix = (child.props.prefix as string | undefined) ?? "";
      const nextCtx: TransformCtx = { hostname: ctx.hostname, pathPrefix: posixJoin(ctx.pathPrefix, prefix) };
      return ServableGroup({
        ...child.props,
        children: transformChildren(child.children, nextCtx, `${path} > group[${prefix}]`),
      });
    }
    case "use": {
      return ServableUse({ ...child.props, children: transformChildren(child.children, ctx, `${path} > use`) });
    }
    case "errorboundary": {
      return ServableErrorBoundary({ ...child.props, children: transformChildren(child.children, ctx, `${path} > errorboundary`) });
    }
    case "upstream": {
      return transformUpstream(child, ctx, path);
    }
    case "route": {
      if (ctx.hostname === undefined) return child; // no Host ancestor -- servable handles this entirely on its own
      return transformRoutePath(child, ctx, path);
    }
    default:
      // notfound/redirect/response, a foreign (e.g. fileable) descriptor, or
      // generic markup -- pass through untouched, by reference. None of
      // these are containers a nested Upstream/Host could appear inside.
      return child;
  }
}

function transformChildren(children: DescriptorChild[], ctx: TransformCtx, path: string): DescriptorChild[] {
  return children.map((c) => transformChild(c, ctx, path)).flat();
}

function transformRoutePath(node: Descriptor, ctx: TransformCtx, path: string): Descriptor {
  const rawPath = node.props.path;
  if (typeof rawPath !== "string") return node; // already a raw URLPattern (or unset -- servable will throw its own clear error)
  return {
    ...node,
    props: { ...node.props, path: routePathFor(ctx, rawPath) },
  };
}

function transformUpstream(node: Descriptor, ctx: TransformCtx, path: string): Descriptor | Descriptor[] {
  const upstreamPath = (node.props.path as string | undefined) ?? "/*";
  const handler = resolveUpstreamHandler(node.props, ctx.pathPrefix, path);
  const matchPath = routePathFor(ctx, upstreamPath);
  const method = node.props.method as string | undefined;
  if (method !== undefined) return ServableRoute({ path: matchPath, method, handler });
  return ALL_METHODS.map((m) => ServableRoute({ path: matchPath, method: m, handler }));
}

export async function compile(tree: unknown, options: CompileOptions = {}): Promise<CompileResult> {
  const roots = Array.isArray(tree) ? tree : [tree];
  const transformed = roots.map((root) => transformChild(root as DescriptorChild, { hostname: undefined, pathPrefix: "" }, "root"));
  return servableCompile(transformed.length === 1 ? transformed[0] : transformed, options);
}
