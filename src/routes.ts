/**
 * What a gateway answers: hostnames, paths and methods, plus the `url=`
 * backends it forwards to (issue #11). A supervisor registers the
 * hostnames with its name router and starts/health-checks the backends.
 *
 * Routes come from servable's own Layout stage run over the same lowered
 * tree `compile()` uses, so mounted fileable trees and `Group from=` globs
 * are listed too, not only literal `<Route>`s. Backends come from the
 * hostable tree itself (after lowering, an `<Upstream url=>` is just a
 * handler).
 */
import * as servable from "@johnhenry/servable";
import type { CompileOptions } from "@johnhenry/servable";
import { lower } from "./compile.js";
import { join as posixJoin } from "./posix.js";
import { FRAGMENT, isDescriptor } from "./types.js";
import type { DescriptorChild } from "./types.js";

export interface RouteEntry {
  /** URLPattern pathname syntax, as servable matches it (`/users/:id`, `/static/*`). */
  path: string;
  methods: string[];
  /** Present for a `<Redirect>`: where it points. */
  redirect?: string;
}

export interface HostEntry {
  /** A hostname, a URLPattern hostname pattern (`*.example.com`), or `*` for routes outside any `<Host>`. */
  hostname: string;
  /** True when `hostname` is a pattern rather than one literal name. */
  pattern: boolean;
  routes: RouteEntry[];
}

export interface BackendEntry {
  /** The `<Host>` the `<Upstream>` is under, or `*`. */
  hostname: string;
  /** The path it's mounted at, Group prefixes included. */
  path: string;
  /** The `url=` it forwards to. */
  url: string;
  methods: string[];
}

export interface RoutesReport {
  hosts: HostEntry[];
  backends: BackendEntry[];
}

const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const isPattern = (hostname: string): boolean => hostname === "*" || /[*:(){}\\]/.test(hostname);

/** Lists what `tree` (an uncompiled hostable/servable tree) answers. Needs `@johnhenry/servable` >= 0.0.3. */
export async function describeRoutes(tree: unknown, options: CompileOptions = {}): Promise<RoutesReport> {
  const clone = (servable as { cloneDescriptorTree?: (t: unknown) => unknown }).cloneDescriptorTree;
  if (typeof clone !== "function") {
    throw new Error("listing routes needs @johnhenry/servable >= 0.0.3 (for cloneDescriptorTree)");
  }
  // The same Build -> Resolve -> Layout servable's compile() runs, on a
  // private copy (Build mutates its input).
  const lowered = clone(lower(tree, { ipfsGateway: options.ipfsGateway }));
  const built = servable.build(lowered);
  const resolved = await servable.resolve(built, options);
  const laidOut = servable.layout(resolved);

  const hosts = new Map<string, Map<string, RouteEntry>>();
  const entryFor = (hostname: string, key: string, make: () => RouteEntry): RouteEntry => {
    let routes = hosts.get(hostname);
    if (!routes) hosts.set(hostname, (routes = new Map()));
    let entry = routes.get(key);
    if (!entry) routes.set(key, (entry = make()));
    return entry;
  };
  for (const route of laidOut.routes) {
    const hostname = route.pattern.hostname || "*";
    const path = route.pattern.pathname;
    const entry = entryFor(hostname, `route:${path}`, () => ({ path, methods: [] }));
    if (!entry.methods.includes(route.method)) entry.methods.push(route.method);
  }
  for (const redirect of laidOut.redirects) {
    const hostname = redirect.pattern.hostname || "*";
    const path = redirect.pattern.pathname;
    entryFor(hostname, `redirect:${path}`, () => ({ path, methods: ["*"], redirect: redirect.to }));
  }

  return {
    hosts: [...hosts].map(([hostname, routes]) => ({ hostname, pattern: isPattern(hostname), routes: [...routes.values()] })),
    backends: collectBackends(tree),
  };
}

function collectBackends(tree: unknown): BackendEntry[] {
  const out: BackendEntry[] = [];
  const walk = (node: unknown, hostname: string, prefix: string): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, hostname, prefix);
      return;
    }
    if (!isDescriptor(node)) return;
    const props = node.props as Record<string, unknown>;
    const children = node.children as DescriptorChild[];
    switch (node.tag) {
      case "host":
        walk(children, String(props.name ?? props.pattern ?? "*"), prefix);
        return;
      case "group":
        walk(children, hostname, posixJoin(prefix, (props.prefix as string | undefined) ?? ""));
        return;
      case "upstream":
        if (typeof props.url === "string") {
          out.push({
            hostname,
            path: posixJoin(prefix || "/", (props.path as string | undefined) ?? "/*"),
            url: props.url,
            methods: typeof props.method === "string" ? [props.method] : ALL_METHODS,
          });
        }
        return;
      case "gateway":
      case "router":
      case "use":
      case "errorboundary":
      case FRAGMENT:
        walk(children, hostname, prefix);
        return;
      default:
        return;
    }
  };
  walk(tree, "*", "");
  return out;
}
