export { compile } from "./compile.js";
export { Gateway, Upstream } from "./components.js";

// Re-exported directly from @johnhenry/servable, unchanged -- hostable's
// routing IS servable's routing; a consumer needs only one import source.
// Host lives here too now, not in components.js -- it's a real servable
// primitive (hostname-axis Layout scope), not a hostable-only pre-transform
// (see compile.ts's own module doc comment for the full story).
export { Group, Host, Route, Use, ErrorBoundary, NotFound, Redirect, Response } from "@johnhenry/servable";
export { linkTo, warn, markdownToHtml, setCookie, sse, streamBody, upgradeWebSocket, serveFile } from "@johnhenry/servable";

export type { GatewayProps, UpstreamProps, UpstreamHandler, Descriptor, DescriptorChild, BaseProps } from "./types.js";
export { HostableError, isDescriptor, isFetchLike } from "./types.js";
export type { FetchLike } from "./forward.js";
export { fromFetchFn, fromNullableRouter } from "./adapt.js";
export type { FetchFnInit } from "./adapt.js";

export type {
  CompileOptions,
  CompileResult,
  ErrorBoundaryProps,
  ErrorHandler,
  GroupProps,
  Handler,
  HeadersInput,
  HeadersInputOrFn,
  HostProps,
  Middleware,
  NextFn,
  NotFoundProps,
  RedirectProps,
  ResponseTagProps,
  RouteContext,
  RouteParams,
  RouteProps,
  RouterProps,
  SrcProp,
  SrcValue,
  TrailersInputOrFn,
  UseProps,
} from "@johnhenry/servable";
