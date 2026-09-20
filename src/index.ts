export { compile } from "./compile.js";
export { Gateway, Host, Upstream } from "./components.js";

// Re-exported directly from @johnhenry/servable, unchanged -- hostable's
// routing IS servable's routing; a consumer needs only one import source.
export { Group, Route, Use, ErrorBoundary, NotFound, Redirect, Response } from "@johnhenry/servable";
export { linkTo, warn, markdownToHtml, setCookie, sse, streamBody, upgradeWebSocket, serveFile } from "@johnhenry/servable";

export type { GatewayProps, HostProps, UpstreamProps, UpstreamHandler, Descriptor, DescriptorChild, BaseProps } from "./types.js";
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
