/**
 * hostable's CLI: `hostable serve` runs `@johnhenry/servable/cli`, servable's
 * own serve runtime (same options, NDJSON envelope, `v` schema version,
 * events, error and exit codes, lifecycle), with hostable's hooks: the
 * `routes` event and command, `E_UPSTREAM` for unreachable backends, and
 * hostable's product strings. Nothing reachable from `src/index.ts` imports
 * this file.
 */
import { parseArgs } from "node:util";
import { resolve as resolvePath } from "node:path";
import type { CompileResult } from "@johnhenry/servable";
import {
  CliError,
  EXIT,
  createReporter,
  errorFields,
  exitCodeFor,
  loadApp,
  serveCommand,
  serveUsage,
  type EventFields,
  type Reporter,
  type RunHooks,
} from "@johnhenry/servable/cli";
import type { RoutesReport } from "./routes.js";

export const LABEL = "hostable";
export const SERVE_USAGE = serveUsage(LABEL, "<Gateway>...</Gateway>");
/** hostable's codes on top of servable's `ERROR_CODES`. */
export const HOSTABLE_ERROR_CODES = {
  /** Never fatal: an `<Upstream url=...>` backend couldn't be reached. The client gets a 502 (504 on its `timeout=`). */
  E_UPSTREAM: EXIT.INTERNAL,
} as const;

/** Human rendering of a `routes` event: one line per host, its paths indented. */
export function formatRoutesHuman(fields: EventFields): string {
  const hosts = (fields.hosts ?? []) as { hostname: string; routes: { path: string; methods: string[]; redirect?: string }[] }[];
  const lines: string[] = [];
  for (const host of hosts) {
    lines.push(host.hostname === "*" ? "(any host)" : host.hostname);
    for (const r of host.routes) lines.push(`  ${r.methods.join(",").padEnd(8)} ${r.path}${r.redirect ? ` -> ${r.redirect}` : ""}`);
  }
  const backends = (fields.backends ?? []) as { hostname: string; path: string; url: string }[];
  if (backends.length) {
    lines.push("backends:");
    for (const b of backends) lines.push(`  ${b.hostname === "*" ? "" : b.hostname}${b.path} -> ${b.url}`);
  }
  return lines.join("\n") + "\n";
}

const renderers = { routes: (fields: EventFields) => ({ to: "stdout" as const, text: formatRoutesHuman(fields) }) };
const loadOptions = { reloadParam: "hostable-reload", compileHint: "export default await compile(<Gateway>...</Gateway>)" };

/** hostable's reporter: servable's, labelled `hostable`, with the `routes` rendering. */
export function hostableReporter(json: boolean): Reporter {
  return createReporter(json, { label: LABEL, renderers });
}

export const ROUTES_USAGE = `Usage: hostable routes <module> [--json]

Print the hostnames, paths and url= backends the gateway a module
default-exports answers, without serving it.
`;

/** The `routes` event's fields: the report plus `complete: false` when the app can't describe itself. */
export async function routesFields(app: CompileResult, reporter?: Reporter): Promise<EventFields> {
  const describe = (app as { describeRoutes?: () => Promise<RoutesReport> }).describeRoutes;
  if (typeof describe !== "function") {
    reporter?.event("warning", {
      code: "E_ROUTES_UNKNOWN",
      message: "the default export wasn't made by hostable's compile(), so its routes can't be listed",
    });
    return { hosts: [], backends: [], complete: false };
  }
  try {
    return { ...(await describe.call(app)), complete: true };
  } catch (error) {
    reporter?.event("warning", { code: "E_ROUTES_UNKNOWN", message: `couldn't list routes: ${(error as Error).message}` });
    return { hosts: [], backends: [], complete: false };
  }
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

export async function routesCommand(argv: string[]): Promise<number> {
  const json = argv.includes("--json");
  const reporter = hostableReporter(json);
  const end = (name: string, fields: EventFields) => new Promise<void>((done) => reporter.final(name, fields, done));
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } } });
    if (parsed.values.help) {
      process.stdout.write(ROUTES_USAGE);
      return EXIT.OK;
    }
    if (parsed.positionals.length !== 1) throw new CliError("E_USAGE", "expected one <module>");
  } catch (error) {
    const err = error instanceof CliError ? error : new CliError("E_USAGE", (error as Error).message);
    if (!json) process.stderr.write(ROUTES_USAGE);
    await end("error", errorFields(err, true));
    return EXIT.USAGE;
  }
  if (json) console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args);
  try {
    const app = await loadApp(resolvePath(parsed.positionals[0]), 0, loadOptions);
    const fields = await routesFields(app, reporter);
    await end("routes", fields);
    return EXIT.OK;
  } catch (error) {
    const fields = errorFields(error, true);
    await end("error", fields);
    return exitCodeFor(fields.code, HOSTABLE_ERROR_CODES);
  }
}
