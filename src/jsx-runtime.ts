/**
 * hostable's own JSX runtime -- selected via a per-file
 * `@jsxImportSource @johnhenry/hostable` pragma or
 * `compilerOptions.jsxImportSource`. No React/Solid/Astro runtime involved:
 * structural tags become descriptor nodes; everything else (plain markup
 * tags, function components) is evaluated immediately, mirroring the JSX
 * call tree 1:1. Mirrors fileable's/servable's jsx-runtime.ts exactly.
 *
 * `gateway`/`host`/`upstream` are reserved and NOT treated as structural
 * when written as bare lowercase tags -- authoring them directly throws.
 * `Gateway`/`Host`/`Upstream`, imported from "@johnhenry/hostable" (see
 * components.ts), are the only supported way to reach the three new
 * primitives. `Group`/`Route`/`Use`/`ErrorBoundary`/`NotFound`/`Redirect`/
 * `Response` (re-exported from @johnhenry/servable) are NOT re-declared as
 * reserved here -- writing `<Route>` under this pragma already works via
 * the generic function-typed-tag passthrough below, since `Route` is a
 * real function reference, not a bare string. A bare lowercase `<route>`
 * typo would not get a friendly reserved-tag error this way (falls
 * through to the generic-markup branch instead) -- the same mistake made
 * through servable's own pragma directly still throws correctly.
 */
import type { Descriptor, DescriptorChild, Tag } from "./types.js";
import { FRAGMENT, HostableError } from "./types.js";

export const Fragment = FRAGMENT;

type ComponentFn = (props: Record<string, unknown>) => unknown;

const RESERVED_TAGS: Record<string, string> = {
  gateway: "Gateway",
  host: "Host",
  upstream: "Upstream",
};

function toChildArray(children: unknown): DescriptorChild[] {
  if (children === undefined) return [];
  return ([] as DescriptorChild[]).concat(children as DescriptorChild);
}

export function jsx(
  type: Tag | ComponentFn,
  props: (Record<string, unknown> & { children?: unknown }) | null,
): Descriptor {
  const allProps = props ?? {};
  if (typeof type === "function") {
    return type(allProps) as Descriptor;
  }
  if (typeof type === "string" && type in RESERVED_TAGS) {
    const component = RESERVED_TAGS[type];
    throw new HostableError(
      `<${type}> is reserved and not a hostable primitive on its own -- ` +
        `import { ${component} } from "@johnhenry/hostable" and write <${component}> instead of the bare lowercase tag`,
      `<${type}>`,
    );
  }
  const { children, ...rest } = allProps;
  const descriptor: Descriptor = {
    tag: type,
    props: rest,
    children: toChildArray(children),
  };
  return descriptor;
}

// The "automatic" JSX transform calls jsxs() instead of jsx() when there is
// more than one statically-known child; behavior is otherwise identical.
export const jsxs = jsx;

export namespace JSX {
  interface CommonProps {
    [key: string]: unknown;
    children?: unknown;
  }
  export interface IntrinsicElements {
    [elemName: string]: CommonProps;
  }
  export type Element = Descriptor;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
}
