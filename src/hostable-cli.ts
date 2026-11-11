/**
 * hostable's CLI: `hostable serve` and `hostable routes` run
 * `@johnhenry/servable/cli`, servable's own runtime (same options, NDJSON
 * envelope, `v` schema version, events, error and exit codes, lifecycle;
 * servable#21 brought the `routes` event and command there too), with
 * hostable's hooks: the gateway's `routes` report (servable's plus `url=`
 * backends), `E_UPSTREAM` for unreachable backends, and hostable's product
 * strings. Nothing reachable from `src/index.ts` imports
 * this file.
 */
import {
  EXIT,
  createReporter,
  formatRoutesHuman as servableFormatRoutesHuman,
  routesCommand as servableRoutesCommand,
  routesFields as servableRoutesFields,
  routesUsage,
  serveCommand,
  serveUsage,
  type EventFields,
  type Reporter,
  type RunHooks,
} from "@johnhenry/servable/cli";
import type { CompileResult } from "@johnhenry/servable";

export const LABEL = "hostable";
export const SERVE_USAGE = serveUsage(LABEL, "<Gateway>...</Gateway>");
/** hostable's codes on top of servable's `ERROR_CODES`. */
export const HOSTABLE_ERROR_CODES = {
  /** Never fatal: an `<Upstream url=...>` backend couldn't be reached. The client gets a 502 (504 on its `timeout=`). */
  E_UPSTREAM: EXIT.INTERNAL,
} as const;

/** Human rendering of a `routes` event: one line per host, its paths indented, then backends. servable's `formatRoutesHuman()` (the same text). */
export const formatRoutesHuman: (fields: EventFields) => string = servableFormatRoutesHuman;

const renderers = { routes: (fields: EventFields) => ({ to: "stdout" as const, text: formatRoutesHuman(fields) }) };
const loadOptions = { reloadParam: "hostable-reload", compileHint: "export default await compile(<Gateway>...</Gateway>)" };
const ROUTES_UNKNOWN_MESSAGE = "the default export wasn't made by hostable's compile(), so its routes can't be listed";

/** hostable's reporter: servable's, labelled `hostable`, with the `routes` rendering. */
export function hostableReporter(json: boolean): Reporter {
  return createReporter(json, { label: LABEL, renderers });
}

export const ROUTES_USAGE = routesUsage(LABEL, "the hostnames, paths and url= backends the gateway a module default-exports answers");

/** The `routes` event's fields: the report plus `complete: false` when the app can't describe itself. servable's `routesFields()` with hostable's message. */
export function routesFields(app: CompileResult, reporter?: Reporter): Promise<EventFields> {
  return servableRoutesFields(app, reporter, ROUTES_UNKNOWN_MESSAGE);
}

/** A failed `<Upstream url=>` fetch: 502 (504 on its `timeout=`), with a non-fatal `E_UPSTREAM` event. */
export function upstreamError(error: unknown, reporter: Reporter): Response | undefined {
  const e = error as { name?: string; message?: string; cause?: { code?: string; address?: string; port?: number } };
  const timedOut = e?.name === "AbortError" || e?.name === "TimeoutError";
  const unreachable = e instanceof TypeError && e.message === "fetch failed";
  if (!timedOut && !unreachable) return undefined;
  reporter.event("error", {
    code: "E_UPSTREAM",
    message: timedOut ? "upstream timed out" : `upstream unreachable: ${e.cause?.code ?? e.message}`,
    fatal: false,
    errno: e.cause?.code,
    address: e.cause?.address,
    port: e.cause?.port,
  });
  const status = timedOut ? 504 : 502;
  return new Response(timedOut ? "Gateway Timeout" : "Bad Gateway", { status });
}

/** Everything that makes servable's serve runtime `hostable serve`. */
export const HOSTABLE_HOOKS: RunHooks & { usage: string } = {
  label: LABEL,
  usage: SERVE_USAGE,
  ...loadOptions,
  loadFailedMessage: "the gateway failed to load",
  errorCodes: HOSTABLE_ERROR_CODES,
  renderers,
  afterLoad: async (app, reporter) => reporter.event("routes", await routesFields(app, reporter)),
  requestError: upstreamError,
};

export function hostableServe(argv: string[]): Promise<number> {
  return serveCommand(argv, HOSTABLE_HOOKS);
}

/** `hostable routes`: servable's `routesCommand()` with hostable's label, usage, strings and error codes. */
export function routesCommand(argv: string[]): Promise<number> {
  return servableRoutesCommand(argv, {
    label: LABEL,
    usage: ROUTES_USAGE,
    ...loadOptions,
    errorCodes: HOSTABLE_ERROR_CODES,
    renderers,
    routesUnknownMessage: ROUTES_UNKNOWN_MESSAGE,
  });
}
