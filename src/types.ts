/**
 * hostable is a thin layer on top of @johnhenry/servable: `Gateway`/`Host`
 * are new, `Upstream` is new, everything else (`Group`/`Route`/`Use`/
 * `ErrorBoundary`/`NotFound`/`Redirect`/`Response`) is re-exported from
 * servable directly, unchanged. Mirrors fileable's/servable's own
 * types.ts shape (Descriptor, DescriptorChild, the Tag-widening fix)
 * applied to a third domain: a multi-domain gateway instead of a single
 * app's dispatcher.
 */
import type { FetchLike } from "./forward.js";
import type { Handler, RouteContext } from "@johnhenry/servable";

export const FRAGMENT: unique symbol = Symbol.for("hostable.fragment");

export type StructuralTag = "gateway" | "host" | "upstream";

export interface BaseProps {
  [key: string]: unknown;
  children?: unknown;
}

export interface GatewayProps extends BaseProps {}

export interface HostProps extends BaseProps {
  /** An exact hostname ("a.example.com") or a URLPattern-syntax hostname pattern ("*.example.com"). */
  name?: string;
  pattern?: string;
}

export type UpstreamHandler = (req: Request, ctx: RouteContext) => Response | Promise<Response>;

export interface UpstreamProps extends BaseProps {
  path?: string;
  method?: string;
  /** Reverse-proxy target -- forwarded via fetch(), with the matched Host/Group prefix stripped. */
  url?: string;
  /** Any Fetch-shaped backend -- a compiled servable dispatcher, a dialback Server, or anything with .fetch(). Called in-process, zero network hop. */
  app?: FetchLike;
  /** Full escape hatch, same shape as Route's own handler. */
  handler?: UpstreamHandler;
  timeout?: number;
}

/**
 * Any tag that isn't one of the three structural primitives is plain
 * markup. Widened to the general `symbol` type (not the exact `typeof
 * FRAGMENT`) for the same reason fileable/servable already widened
 * theirs: it lets a sibling package's Descriptor (with its own,
 * differently-keyed Fragment symbol) type-check as a valid hostable JSX
 * element when nested literally inside `<Gateway>`/`<Host>` -- e.g.
 * `@johnhenry/servable`'s own `<Route>`/`<Group>`.
 */
export type Tag = StructuralTag | symbol | string;

export interface Descriptor {
  tag: Tag;
  props: Record<string, unknown>;
  children: DescriptorChild[];
}

export type DescriptorChild = Descriptor | string | number | boolean | object | null | undefined | DescriptorChild[];

export function isDescriptor(value: unknown): value is Descriptor {
  return (
    !!value &&
    typeof value === "object" &&
    "tag" in (value as object) &&
    "props" in (value as object) &&
    "children" in (value as object)
  );
}

/** Anything shaped like `{fetch(request): Promise<Response>}` -- a compiled servable app, a dialback Server, or a caller's own adaptor. See forward.ts. */
export function isFetchLike(value: unknown): value is FetchLike {
  return !!value && typeof value === "object" && typeof (value as FetchLike).fetch === "function";
}

export class HostableError extends Error {
  path: string;
  constructor(message: string, path: string, cause?: unknown) {
    super(`${message} (at ${path})`);
    this.name = "HostableError";
    this.path = path;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export type { Handler, RouteContext };
