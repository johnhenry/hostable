/**
 * hostable's own compile stage is a thin pre-transform, not a parallel
 * implementation of servable's Layout/dispatch. It walks the hostable
 * tree, converts `Gateway`/`Upstream`/a raw Fetch-shaped child into real
 * servable primitives (`Router`/`Route`), and hands the result to
 * @johnhenry/servable's own `compile()`. servable never sees a
 * hostable-specific tag.
 *
 * `Host` is now a REAL servable primitive (`@johnhenry/servable`'s own
 * `Host`, re-exported here unchanged -- see components.ts) instead of a
 * hostable-only pre-transform. That's a deliberate correction: hostname
 * scoping is a Layout-stage concern (the stage that runs AFTER every other
 * pipeline stage has finished expanding the tree -- mounted fileable
 * trees, glob-based file routing, promise-valued `path`s, ...), and this
 * file's own pre-transform runs BEFORE all of that. A `<Route>`/`<Group
 * from=...>`/raw fileable child inside a `<Host>` that hostable's earlier,
 * pre-Build-only transform could never see (because those routes didn't
 * exist yet at transform time) used to leak across every `<Host>` in the
 * gateway -- confirmed empirically, not just reasoned about: a `<Host>`
 * that should only reverse-proxy elsewhere was ALSO serving a sibling
 * `<Host>`'s mounted static files. See servable's own CHANGELOG entry for
 * the full writeup (six independent leak points, all from the same root
 * cause) and layout.ts's module doc comment for how `Host` works now.
 *
 * This file's own remaining job is strictly leaf-local: `Upstream` needs
 * per-request path-prefix stripping when forwarding (`forward.ts`'s
 * `stripPrefix`), which is a RUNTIME concern independent of how the MATCH
 * pattern is compiled -- `TransformCtx.pathPrefix` exists only for that,
 * tracked the same way it always was. The match path itself no longer
 * needs any manual joining or hostname-baking here at all: `Upstream`
 * compiles to a real, relative `<Route path=localPath>`, nested inside
 * whatever real `<Group>`/`<Host>` structure the tree already has (this
 * file preserves that nesting when transforming, see the "group"/"host"
 * cases below) -- servable's own Layout joins the Group prefix and applies
 * the Host hostname automatically, exactly like it already does for any
 * hand-written `<Route>`, hostable or not.
 */
import { join as posixJoin } from "node:path/posix";
import {
  ErrorBoundary as ServableErrorBoundary,
  Group as ServableGroup,
  Host as ServableHost,
  Route as ServableRoute,
  Router as ServableRouter,
  Use as ServableUse,
  compile as servableCompile,
} from "@johnhenry/servable";
import type { CompileOptions, CompileResult } from "@johnhenry/servable";
import { FRAGMENT, isDescriptor, isFetchLike } from "./types.js";
import type { Descriptor, DescriptorChild } from "./types.js";
import { createAppUpstream, resolveUpstreamHandler } from "./forward.js";

interface TransformCtx {
  /** Accumulated <Group prefix> chain -- used only for Upstream's own runtime prefix-stripping (forward.ts), never for compiling the match pattern (servable's own Layout does that now). */
  pathPrefix: string;
  /** See `CompileOptions.ipfsGateway` (servable). Threaded down from the top-level `compile()` options since `Upstream` handlers -- including any `url="ipfs://..."` forwarding target -- are built during this pre-transform, before servable's own `compile()` (and its own use of `ipfsGateway`) ever runs. */
  ipfsGateway?: string;
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
    return ALL_METHODS.map((method) => ServableRoute({ path: "/*", method, handler: createAppUpstream(child, ctx.pathPrefix) }));
  }
  if (!isDescriptor(child)) return child; // opaque: string/number/plain object/etc.

  switch (child.tag) {
    case "gateway": {
      return ServableRouter({
        children: transformChildren(child.children, { pathPrefix: "", ipfsGateway: ctx.ipfsGateway }, `${path} > gateway`),
      });
    }
    case "router": {
      // A literal nested <Router> (servable's own, re-exported) -- not
      // itself hostable-specific, but still needs recursing into so any
      // <Upstream> nested inside it gets transformed. Without this case it
      // fell to `default` below and was passed through untouched, silently
      // skipping that transformation entirely.
      return ServableRouter({
        ...child.props,
        children: transformChildren(child.children, ctx, `${path} > router`),
      });
    }
    case "host": {
      // servable's own Host now validates name/pattern itself (a real
      // ServableError, not a HostableError) -- not re-validated here, so
      // there's exactly one place that check lives, not two.
      return ServableHost({
        ...child.props,
        children: transformChildren(child.children, ctx, `${path} > host`),
      });
    }
    case "group": {
      const prefix = (child.props.prefix as string | undefined) ?? "";
      const nextCtx: TransformCtx = { pathPrefix: posixJoin(ctx.pathPrefix, prefix), ipfsGateway: ctx.ipfsGateway };
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
    case FRAGMENT: {
      // A Fragment (from any layer -- see servable's own FRAGMENT doc
      // comment, re-exported from there, for why every layer shares one
      // symbol) is a container whose children need the current pathPrefix
      // context applied, exactly like "group" itself -- unlike the
      // genuinely opaque cases in `default` below.
      return transformChildren(child.children, ctx, `${path} > fragment`);
    }
    default:
      // route/notfound/redirect/response, a foreign (e.g. fileable)
      // descriptor, or generic markup -- pass through untouched, by
      // reference. A <Route>'s own `path` needs no transformation at all
      // now: it's already relative, and servable's Layout joins/qualifies
      // it via whatever real Group/Host structure it ends up nested in.
      return child;
  }
}

function transformChildren(children: DescriptorChild[], ctx: TransformCtx, path: string): DescriptorChild[] {
  return children.map((c) => transformChild(c, ctx, path)).flat();
}

function transformUpstream(node: Descriptor, ctx: TransformCtx, path: string): Descriptor | Descriptor[] {
  const upstreamPath = (node.props.path as string | undefined) ?? "/*";
  const handler = resolveUpstreamHandler(node.props, ctx.pathPrefix, path, ctx.ipfsGateway);
  const method = node.props.method as string | undefined;
  if (method !== undefined) return ServableRoute({ path: upstreamPath, method, handler });
  return ALL_METHODS.map((m) => ServableRoute({ path: upstreamPath, method: m, handler }));
}

export async function compile(tree: unknown, options: CompileOptions = {}): Promise<CompileResult> {
  const roots = Array.isArray(tree) ? tree : [tree];
  const rootCtx: TransformCtx = { pathPrefix: "", ipfsGateway: options.ipfsGateway };
  const transformed = roots.map((root) => transformChild(root as DescriptorChild, rootCtx, "root"));
  return servableCompile(transformed.length === 1 ? transformed[0] : transformed, options);
}
