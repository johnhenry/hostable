/**
 * hostable is a thin layer on top of @johnhenry/servable: `Gateway` and
 * `Upstream` are the only genuinely new primitives; everything else
 * (`Group`/`Host`/`Route`/`Use`/`ErrorBoundary`/`NotFound`/`Redirect`/
 * `Response`) is re-exported from servable directly, unchanged. `Host`
 * moved into that list -- it's a real servable primitive (a Layout-stage
 * hostname scope) now, not a hostable-only pre-transform; see compile.ts's
 * module doc comment for why. Mirrors fileable's/servable's own types.ts
 * shape (Descriptor, DescriptorChild, the Tag-widening fix) applied to a
 * third domain: a multi-domain gateway instead of a single app's
 * dispatcher.
 */
import type { FetchLike } from "./forward.js";
import type { Handler, RouteContext } from "@johnhenry/servable";
import { Fragment as SERVABLE_FRAGMENT } from "@johnhenry/servable/jsx-runtime";

/**
 * NOT a distinct `Symbol.for("hostable.fragment")` -- deliberately the
 * SAME symbol servable's own `Fragment` is (`Symbol.for("servable.fragment")`,
 * see `@johnhenry/servable/jsx-runtime`). hostable has no build/resolve/
 * layout pipeline of its own (compile.ts is a thin pre-transform that hands
 * everything to servable's real `compile()`, see that file's own doc
 * comment) -- unlike fileable and servable, which each really do flatten
 * their own distinctly-keyed Fragment. A hostable-specific Fragment symbol
 * would need servable's `build()` to recognize it too, which it never
 * would (servable only checks its own symbol) -- so `<>...</>` written
 * under hostable's `@jsxImportSource` pragma would compile-throw the
 * moment it was actually used (confirmed by reproducing it: `<Symbol
 * (hostable.fragment)> is not a servable primitive here`, before this
 * fix). Reusing servable's own symbol here means the exact same Fragment
 * node servable's `build()` already flattens is what hostable's JSX
 * produces, with no new flattening logic needed anywhere.
 *
 * Not typed `unique symbol` (unlike fileable's/servable's own FRAGMENT,
 * each the sole, literal source of their own symbol): TypeScript only
 * lets a `unique symbol`-typed binding be initialized from a fresh
 * `Symbol()`/`Symbol.for()` call or a direct reference to another
 * `unique symbol` *declaration* in the same compilation, not a value
 * merely inferred to have that nominal type across a package boundary --
 * `@johnhenry/servable/jsx-runtime`'s own `Fragment` export widens to
 * plain `symbol` once re-exported. Not a problem here: nothing in this
 * package narrows on `FRAGMENT`'s exact literal type (see `Tag`, below,
 * already widened to general `symbol` for the same cross-package reason).
 */
export const FRAGMENT: symbol = SERVABLE_FRAGMENT;

export type StructuralTag = "gateway" | "upstream";

export interface BaseProps {
  [key: string]: unknown;
  children?: unknown;
}

export interface GatewayProps extends BaseProps {}

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
 * Any tag that isn't one of the two structural primitives hostable itself
 * owns (`gateway`/`upstream`) is plain markup. Widened to the general
 * `symbol` type (not the exact `typeof FRAGMENT`) for the same reason
 * fileable/servable already widened theirs: it lets a sibling package's
 * Descriptor (with its own, differently-keyed Fragment symbol) type-check
 * as a valid hostable JSX element when nested literally inside
 * `<Gateway>` -- e.g. `@johnhenry/servable`'s own `<Host>`/`<Route>`/`<Group>`.
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
