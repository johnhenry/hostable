/**
 * What a gateway answers: hostnames, paths and methods, plus the `url=`
 * backends it forwards to (issue #11). A supervisor registers the
 * hostnames with its name router and starts/health-checks the backends.
 *
 * Routes come from servable's own route report (servable#21), read off
 * Layout's output for the same lowered tree `compile()` uses, so mounted
 * fileable trees and `Group from=` globs are listed too, not only literal
 * `<Route>`s. Backends come from the
 * hostable tree itself (after lowering, an `<Upstream url=>` is just a
 * handler).
 */
import * as servable from "@johnhenry/servable";
import type { BackendEntry, CompileOptions, RoutesReport } from "@johnhenry/servable";
import { lower } from "./compile.js";
import { join as posixJoin } from "./posix.js";
import { FRAGMENT, isDescriptor } from "./types.js";
import type { DescriptorChild } from "./types.js";

// One structure for a gateway's routes and an app's (servable#21): the
// report is servable's, with `backends` filled in here. Each route has
// `path`, `methods` and (for a redirect) `redirect`, as since #11, plus
// servable's `kind`, `params`, `hasParams`, `prefix` and `status`; each
// host has `notFoundPrefixes`; the report has `notFound`.
export type { RoutesReport, HostEntry, RouteEntry, RouteKind, BackendEntry } from "@johnhenry/servable";

const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Lists what `tree` (an uncompiled hostable/servable tree) answers. Needs `@johnhenry/servable` >= 0.3.0. */
export async function describeRoutes(tree: unknown, options: CompileOptions = {}): Promise<RoutesReport> {
  const describe = (servable as { describeRoutes?: (t: unknown, o?: CompileOptions) => Promise<RoutesReport> }).describeRoutes;
  if (typeof describe !== "function") {
    throw new Error("listing routes needs @johnhenry/servable >= 0.3.0 (for describeRoutes)");
  }
  // servable runs Build -> Resolve -> Layout on its own copy of the lowered tree.
  const report = await describe(lower(tree, { ipfsGateway: options.ipfsGateway }), options);
  return { ...report, backends: collectBackends(tree) };
}

/** The `<Upstream url=>` backends in `tree`, with the Host and Group prefixes they sit under. */
export function collectBackends(tree: unknown): BackendEntry[] {
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
