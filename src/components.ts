/**
 * The only supported way to reach hostable's three new structural
 * primitives. `<Gateway>`/`<Host>`/`<Upstream>` (or called directly as
 * functions, no JSX needed) are ordinary functions with an explicit,
 * importable identity -- unlike the lowercase `<gateway>`/`<host>`/
 * `<upstream>` tags, which are reserved and throw if authored directly
 * (see jsx-runtime.ts's RESERVED_TAGS). Mirrors fileable's/servable's
 * components.ts exactly.
 */
import type { Descriptor, DescriptorChild, GatewayProps, HostProps, StructuralTag, UpstreamProps } from "./types.js";

function toChildArray(children: unknown): DescriptorChild[] {
  if (children === undefined) return [];
  return ([] as DescriptorChild[]).concat(children as DescriptorChild);
}

function structural(tag: StructuralTag, props: Record<string, unknown>): Descriptor {
  const { children, ...rest } = props;
  return { tag, props: rest, children: toChildArray(children) };
}

export function Gateway(props: GatewayProps = {}): Descriptor {
  return structural("gateway", props as Record<string, unknown>);
}

export function Host(props: HostProps): Descriptor {
  return structural("host", props as Record<string, unknown>);
}

export function Upstream(props: UpstreamProps): Descriptor {
  return structural("upstream", props as Record<string, unknown>);
}
