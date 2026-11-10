/**
 * hostable's additions to the shared serve contract (serve-cli.ts): the
 * `routes` event and command, and `E_UPSTREAM` for unreachable backends.
 */
import { parseArgs } from "node:util";
import { resolve as resolvePath } from "node:path";
import type { CompileResult } from "@johnhenry/servable";
import {
  CliError,
  ERROR_CODES,
  EXIT,
  createReporter,
  errorFields,
  loadApp,
  serveCommand,
  type ErrorCode,
  type EventFields,
  type Reporter,
} from "./serve-cli.js";
import type { RoutesReport } from "./routes.js";

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

export function hostableServe(argv: string[]): Promise<number> {
  return serveCommand(argv, {
    label: "hostable",
    afterLoad: async (app, reporter) => reporter.event("routes", await routesFields(app, reporter)),
    requestError: upstreamError,
  });
}

export async function routesCommand(argv: string[]): Promise<number> {
  const json = argv.includes("--json");
  const reporter = createReporter(json, "hostable");
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
    const app = await loadApp(resolvePath(parsed.positionals[0]));
    const fields = await routesFields(app, reporter);
    await end("routes", fields);
    return EXIT.OK;
  } catch (error) {
    const fields = errorFields(error, true);
    await end("error", fields);
    return ERROR_CODES[fields.code as ErrorCode] ?? EXIT.INTERNAL;
  }
}
