// `hostable serve` / `hostable routes` (issue #11): spawns the real bin and
// reads its NDJSON event stream, the way a desktop supervisor would.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile, describeRoutes, Gateway, Group, Host, NotFound, Redirect, Route, Upstream } from "../src/index.js";
import { SCHEMA_VERSION } from "@johnhenry/servable/cli";

const distRoot = fileURLToPath(new URL("../", import.meta.url));
const cli = join(distRoot, "src", "cli.js");
const hostableIndex = pathToFileURL(join(distRoot, "src", "index.js")).href;
const isWindows = process.platform === "win32";
const fixturesRoot = join(distRoot, ".cli-fixtures");
mkdirSync(fixturesRoot, { recursive: true });

const fixtureDir = (): string => mkdtempSync(join(fixturesRoot, "case-"));

/** A module default-exporting a compiled gateway (plain function calls, no JSX). */
function gatewaySource(children: string, prelude = ""): string {
  return `import { Gateway, Host, Group, Route, Redirect, Upstream, compile } from ${JSON.stringify(hostableIndex)};
${prelude}
export default await compile(Gateway({ children: [${children}] }));
`;
}

interface Event {
  v: number;
  event: string;
  time: string;
  [key: string]: unknown;
}

interface Running {
  child: ChildProcess;
  events: Event[];
  stdoutLines: string[];
  stderr: () => string;
  waitFor(pred: (e: Event) => boolean, timeoutMs?: number): Promise<Event>;
  exit: Promise<number | null>;
}

function run(args: string[], nodeArgs: string[] = []): Running {
  const child = spawn(process.execPath, [...nodeArgs, cli, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  const events: Event[] = [];
  const stdoutLines: string[] = [];
  let stderr = "";
  let buffer = "";
  const waiters: { pred: (e: Event) => boolean; resolve: (e: Event) => void }[] = [];
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      stdoutLines.push(line);
      let parsed: Event;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      events.push(parsed);
      for (const w of [...waiters]) {
        if (w.pred(parsed)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(parsed);
        }
      }
    }
  });
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => (stderr += chunk));
  const exit = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return {
    child,
    events,
    stdoutLines,
    stderr: () => stderr,
    exit,
    waitFor(pred, timeoutMs = 10_000) {
      const seen = events.find(pred);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out; events ${JSON.stringify(events)}; stderr: ${stderr}`)), timeoutMs);
        waiters.push({ pred, resolve: (e) => (clearTimeout(timer), resolve(e)) });
        exit.then(() =>
          setTimeout(() => {
            clearTimeout(timer);
            reject(new Error(`exited before the event; events ${JSON.stringify(events)}; stderr: ${stderr}`));
          }, 50),
        );
      });
    },
  };
}

const ready = (e: Event) => e.event === "ready";

/** Sends a request with an explicit Host header (fetch() won't let us set one). */
async function get(base: string, path: string, host: string): Promise<{ status: number; body: string }> {
  const { request } = await import("node:http");
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = request({ host: url.hostname, port: url.port, path: url.pathname, headers: { host } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode!, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

test("serve --json: a routes event with every hostname, then ready, requests, and a clean SIGTERM", async () => {
  const dir = fixtureDir();
  const mod = join(dir, "gw.mjs");
  writeFileSync(
    mod,
    gatewaySource(
      `Host({ name: "www.localhost", children: [Route({ path: "/", method: "GET", children: ["www"] })] }),
       Host({ name: "api.localhost", children: [Route({ path: "/v1/ping", method: "GET", children: ["pong"] })] })`,
      `console.log("loaded");`,
    ),
  );
  const r = run(["serve", mod, "--port", "0", "--json"]);
  try {
    const ev = await r.waitFor(ready);
    const routesIdx = r.events.findIndex((e) => e.event === "routes");
    assert.ok(routesIdx >= 0 && routesIdx < r.events.indexOf(ev), "routes comes before ready");
    const routes = r.events[routesIdx];
    assert.equal(routes.v, SCHEMA_VERSION);
    assert.equal(routes.complete, true);
    assert.deepEqual(
      (routes.hosts as { hostname: string }[]).map((h) => h.hostname),
      ["www.localhost", "api.localhost"],
    );
    assert.ok((ev.port as number) > 0);
    assert.deepEqual(await get(ev.url as string, "/v1/ping", "api.localhost"), { status: 200, body: "pong" });
    assert.equal((await get(ev.url as string, "/v1/ping", "www.localhost")).status, 404);
    const req = await r.waitFor((e) => e.event === "request");
    assert.equal(req.host, "api.localhost");
    r.child.kill("SIGTERM");
    const code = await r.exit;
    if (!isWindows) {
      assert.equal(code, 0);
      assert.equal(r.events.at(-1)!.event, "stopped");
    }
    for (const line of r.stdoutLines) assert.doesNotThrow(() => JSON.parse(line), line);
    assert.match(r.stderr(), /loaded/);
  } finally {
    r.child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("routes command: JSON and human output, without listening", async () => {
  const dir = fixtureDir();
  const mod = join(dir, "gw.mjs");
  writeFileSync(
    mod,
    gatewaySource(
      `Host({ name: "a.localhost", children: [Group({ prefix: "/api", children: [Upstream({ path: "/*", url: "http://127.0.0.1:9/" })] }), Redirect({ from: "/old", to: "/new" })] }),
       Route({ path: "/health", method: "GET", children: ["ok"] })`,
    ),
  );
  try {
    const j = run(["routes", mod, "--json"]);
    assert.equal(await j.exit, 0);
    assert.equal(j.events.length, 1);
    const ev = j.events[0];
    assert.equal(ev.event, "routes");
    const hosts = ev.hosts as { hostname: string; pattern: boolean; routes: { path: string; methods: string[]; redirect?: string }[] }[];
    const a = hosts.find((h) => h.hostname === "a.localhost")!;
    assert.equal(a.pattern, false);
    assert.ok(a.routes.some((rt) => rt.path === "/api/*" && rt.methods.includes("POST")));
    assert.ok(a.routes.some((rt) => rt.path === "/old" && rt.redirect === "/new"));
    const any = hosts.find((h) => h.hostname === "*")!;
    assert.equal(any.pattern, true);
    // #19: servable#21's fields are added; #11's path/methods are unchanged.
    assert.deepEqual(any.routes, [{ path: "/health", methods: ["GET"], kind: "static", params: [], hasParams: false, prefix: "" }]);
    assert.deepEqual(
      a.routes.map((rt) => [rt.path, (rt as { kind?: string }).kind, (rt as { prefix?: string }).prefix]),
      [["/api/*", "handler", "/api"], ["/old", "redirect", ""]],
    );
    assert.equal(ev.notFound, false);
    assert.deepEqual(ev.backends, [
      { hostname: "a.localhost", path: "/api/*", url: "http://127.0.0.1:9/", methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] },
    ]);

    const h = run(["routes", mod]);
    assert.equal(await h.exit, 0);
    assert.match(h.stdoutLines.join("\n"), /a\.localhost\n {2}.*\/api\/\*/);
    assert.match(h.stdoutLines.join("\n"), /backends:\n {2}a\.localhost\/api\/\* -> http:\/\/127\.0\.0\.1:9\//);

    // An app compiled by servable directly can't describe itself.
    const plain = join(dir, "plain.mjs");
    writeFileSync(plain, `export default { fetch: async () => new Response("x"), warnings: [] };\n`);
    const p = run(["routes", plain, "--json"]);
    assert.equal(await p.exit, 0);
    assert.ok(p.events.some((e) => e.event === "warning" && e.code === "E_ROUTES_UNKNOWN"));
    assert.equal(p.events.find((e) => e.event === "routes")!.complete, false);

    const missing = run(["routes", join(dir, "nope.mjs"), "--json"]);
    assert.equal(await missing.exit, 3);
    assert.equal(missing.events[0].code, "E_MODULE_NOT_FOUND");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unreachable url= backend is a 502 with a non-fatal E_UPSTREAM event", async () => {
  const dir = fixtureDir();
  const mod = join(dir, "gw.mjs");
  const port = await freePort();
  writeFileSync(mod, gatewaySource(`Upstream({ path: "/*", url: "http://127.0.0.1:${port}/" })`));
  const r = run(["serve", mod, "--port", "0", "--json"]);
  try {
    const ev = await r.waitFor(ready);
    const res = await fetch(`${ev.url}x`);
    assert.equal(res.status, 502);
    const err = await r.waitFor((e) => e.event === "error");
    assert.equal(err.code, "E_UPSTREAM");
    assert.equal(err.fatal, false);
    assert.equal(err.errno, "ECONNREFUSED");
    assert.equal((await r.waitFor((e) => e.event === "request")).status, 502);
  } finally {
    r.child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#13 human serve output: the routes block, then listening; E_UPSTREAM and the 504 on timeout=", async () => {
  const dir = fixtureDir();
  const mod = join(dir, "gw.mjs");
  const port = await freePort();
  const { createServer: httpServer } = await import("node:http");
  const slow = httpServer(() => {});
  await new Promise<void>((r) => slow.listen(0, "127.0.0.1", r));
  const slowPort = (slow.address() as AddressInfo).port;
  writeFileSync(
    mod,
    gatewaySource(
      `Host({ name: "a.localhost", children: [Route({ path: "/", method: "GET", children: ["a"] })] }), Upstream({ path: "/down/*", url: "http://127.0.0.1:${port}/" }), Upstream({ path: "/slow/*", url: "http://127.0.0.1:${slowPort}/", timeout: 200 })`,
    ),
  );
  const r = run(["serve", mod, "--port", "0"]);
  try {
    for (let i = 0; i < 400 && !r.stdoutLines.some((l) => l.startsWith("hostable: listening on ")); i++) await new Promise((res) => setTimeout(res, 25));
    const listening = r.stdoutLines.findIndex((l) => l.startsWith("hostable: listening on "));
    assert.ok(listening > 0, r.stdoutLines.join("\n"));
    assert.deepEqual(r.stdoutLines.slice(0, 3), ["a.localhost", "  GET      /", "(any host)"]);
    assert.ok(r.stdoutLines.slice(0, listening).includes("backends:"));
    const base = r.stdoutLines[listening].slice("hostable: listening on ".length);
    assert.equal((await fetch(`${base}down/x`)).status, 502);
    assert.equal((await fetch(`${base}slow/x`)).status, 504);
    for (let i = 0; i < 200 && (r.stderr().match(/E_UPSTREAM/g) ?? []).length < 2; i++) await new Promise((res) => setTimeout(res, 25));
    assert.match(r.stderr(), /^hostable: error E_UPSTREAM: upstream unreachable: ECONNREFUSED$/m);
    assert.match(r.stderr(), /^hostable: error E_UPSTREAM: upstream timed out$/m);
  } finally {
    r.child.kill("SIGKILL");
    slow.closeAllConnections();
    slow.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--trust-proxy: X-Forwarded-Host picks the <Host>", async () => {
  const dir = fixtureDir();
  const mod = join(dir, "gw.mjs");
  writeFileSync(mod, gatewaySource(`Host({ name: "b.localhost", children: [Route({ path: "/", method: "GET", children: ["b"] })] })`));
  const r = run(["serve", mod, "--port", "0", "--json", "--trust-proxy"]);
  try {
    const ev = await r.waitFor(ready);
    assert.equal((await fetch(ev.url as string)).status, 404);
    assert.equal(await (await fetch(ev.url as string, { headers: { "x-forwarded-host": "b.localhost" } })).text(), "b");
  } finally {
    r.child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("usage, module and listen failures use servable's exit codes", async () => {
  const usage = run(["serve", "x.mjs", "--port", "nope", "--json"]);
  assert.equal(await usage.exit, 2);
  assert.equal(usage.events[0].code, "E_USAGE");

  const help = run(["serve", "--help"]);
  assert.equal(await help.exit, 0);
  assert.match(help.stdoutLines.join("\n"), /^Usage: hostable serve <module> \[options\]\n\nServe the compiled app a module default-exports \(export default await compile\(<Gateway>\.\.\.<\/Gateway>\)\)\.\n/);

  const dir = fixtureDir();
  const notApp = join(dir, "not.mjs");
  writeFileSync(notApp, `export default 42;\n`);
  const blocker = createServer();
  await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", r));
  try {
    const n = run(["serve", notApp, "--json", "--port", "0"]);
    assert.equal(await n.exit, 3);
    const notAppError = n.events.find((e) => e.event === "error")!;
    assert.equal(notAppError.code, "E_NOT_AN_APP");
    assert.match(String(notAppError.message), /expected a compiled app -- export default await compile\(<Gateway>\.\.\.<\/Gateway>\)$/);

    const mod = join(dir, "gw.mjs");
    writeFileSync(mod, gatewaySource(`Route({ path: "/", method: "GET", children: ["x"] })`));
    const l = run(["serve", mod, "--json", "--port", String((blocker.address() as AddressInfo).port)]);
    assert.equal(await l.exit, 4);
    assert.equal(l.events.find((e) => e.event === "error")!.code, "E_LISTEN");
  } finally {
    blocker.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--watch: a reload re-emits routes, a broken gateway serves a 500, the port stays", async () => {
  const dir = fixtureDir();
  const mod = join(dir, "gw.mjs");
  const hosts = join(dir, "hosts.mjs");
  writeFileSync(hosts, `export const name = "one.localhost";\n`);
  writeFileSync(mod, gatewaySource(`Host({ name, children: [Route({ path: "/", method: "GET", children: [name] })] })`, `import { name } from "./hosts.mjs";`));
  const r = run(["serve", mod, "--port", "0", "--json", "--watch"]);
  try {
    const first = await r.waitFor(ready);
    assert.equal((await get(first.url as string, "/", "one.localhost")).body, "one.localhost");

    writeFileSync(hosts, `export const name = "two.localhost";\n`);
    const second = await r.waitFor((e) => e.event === "ready" && (e.reload as number) > 0);
    assert.equal(second.port, first.port);
    const routes = r.events.filter((e) => e.event === "routes");
    assert.equal(routes.length, 2);
    assert.equal((routes[1].hosts as { hostname: string }[])[0].hostname, "two.localhost");
    assert.equal((await get(first.url as string, "/", "two.localhost")).body, "two.localhost");

    // Broken (it throws its own URL, so the reload's query parameter shows).
    writeFileSync(hosts, `export const name = "three.localhost";\nthrow new Error("broken at " + import.meta.url);\n`);
    await r.waitFor((e) => e.event === "ready" && e.ok === false);
    const broken = await get(first.url as string, "/", "two.localhost");
    assert.equal(broken.status, 500);
    // hostable's wording (#13: these strings are hooks on servable's runtime now).
    assert.match(broken.body, /^hostable: the gateway failed to load\n\nE_MODULE_LOAD: /);
    // Reloads re-import the project's files under hostable's query parameter, not servable's.
    const loadError = r.events.filter((e) => e.event === "error").at(-1)!;
    assert.equal(loadError.code, "E_MODULE_LOAD");
    assert.match(String(loadError.message), /broken at file:\S*hosts\.mjs\?hostable-reload=\d+$/);
    assert.doesNotMatch(String(loadError.message), /servable-reload/);
  } finally {
    r.child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Node permission model: project read + --allow-net is enough; no --allow-net is E_ACCESS_DENIED (exit 5)", async () => {
  const dir = fixtureDir();
  const mod = join(dir, "gw.mjs");
  writeFileSync(mod, gatewaySource(`Route({ path: "/", method: "GET", children: ["sandboxed"] })`));
  const project = fileURLToPath(new URL("../../", import.meta.url));
  try {
    const ok = run(["serve", mod, "--port", "0", "--json", "--watch"], ["--permission", `--allow-fs-read=${project}`, "--allow-net"]);
    const ev = await ok.waitFor(ready);
    assert.equal(await (await fetch(ev.url as string)).text(), "sandboxed");
    assert.ok(ok.events.some((e) => e.event === "routes" && e.complete === true));
    ok.child.kill("SIGKILL");

    const routesOnly = run(["routes", mod, "--json"], ["--permission", `--allow-fs-read=${project}`]);
    assert.equal(await routesOnly.exit, 0, "listing routes needs no network");

    const noNet = run(["serve", mod, "--port", "0", "--json"], ["--permission", `--allow-fs-read=${project}`]);
    assert.equal(await noNet.exit, 5);
    assert.match(String(noNet.events.find((e) => e.event === "error")!.message), /--allow-net/);

    const outside = mkdtempSync(join(tmpdir(), "hostable-cli-outside-"));
    try {
      const deniedMod = join(outside, "gw.mjs");
      writeFileSync(deniedMod, gatewaySource(`Route({ path: "/", method: "GET", children: ["x"] })`));
      const denied = run(["serve", deniedMod, "--port", "0", "--json"], ["--permission", `--allow-fs-read=${project}`, "--allow-net"]);
      assert.equal(await denied.exit, 5);
      assert.equal(denied.events.find((e) => e.event === "error")!.code, "E_ACCESS_DENIED");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("describeRoutes: Host patterns, Group prefixes, and compile()'s non-enumerable describeRoutes()", async () => {
  const tree = Gateway({
    children: [
      Host({ pattern: "*.example.test", children: [Group({ prefix: "/g", children: [Route({ path: "/r", method: "PUT", children: ["x"] })] })] }),
    ],
  });
  const report = await describeRoutes(tree);
  assert.deepEqual(report.hosts, [
    {
      hostname: "*.example.test",
      pattern: true,
      routes: [{ path: "/g/r", methods: ["PUT"], kind: "static", params: [], hasParams: false, prefix: "/g" }],
      notFoundPrefixes: [],
    },
  ]);
  assert.equal(report.notFound, false);
  assert.deepEqual(report.backends, []);
  const compiled = await compile(tree);
  assert.ok(!Object.keys(compiled).includes("describeRoutes"));
  assert.deepEqual(await compiled.describeRoutes(), report);
  // Describing doesn't disturb the compiled app or the tree.
  assert.equal(await (await compiled.fetch(new Request("http://x.example.test/g/r", { method: "PUT" }))).text(), "x");
  assert.deepEqual(await describeRoutes(tree), report);
  void Redirect;
  void Upstream;
});

test("#19 the routes report is servable's (servable#21) plus backends: kinds, prefixes, NotFound, Group roots", async () => {
  const backend = { fetch: async () => new Response("app") };
  const tree = Gateway({
    children: [
      Host({
        name: "a.localhost",
        children: [
          Group({ prefix: "/api", children: [Route({ path: "/", method: "GET", children: ["root"] }), Upstream({ path: "/v1/*", url: "http://127.0.0.1:9/" })] }),
          Upstream({ path: "/app/*", method: "GET", app: backend }),
          NotFound({ children: ["no"] }),
        ],
      }),
    ],
  });
  const report = await describeRoutes(tree);
  assert.deepEqual(Object.keys(report), ["hosts", "backends", "notFound"]);
  assert.equal(report.notFound, true);
  const [host] = report.hosts;
  assert.equal(host.hostname, "a.localhost");
  assert.deepEqual(host.notFoundPrefixes, ["/"]);
  assert.deepEqual(
    host.routes.map((r) => ({ path: r.path, methods: r.methods.length, kind: r.kind, hasParams: r.hasParams, prefix: r.prefix })),
    [
      // A Group's own path="/" is listed at the prefix (it used to read "/api{/}?", the match pattern).
      { path: "/api", methods: 1, kind: "static", hasParams: false, prefix: "/api" },
      { path: "/api/v1/*", methods: 7, kind: "handler", hasParams: true, prefix: "/api" },
      { path: "/app/*", methods: 1, kind: "handler", hasParams: true, prefix: "" },
    ],
  );
  assert.deepEqual(report.backends, [
    { hostname: "a.localhost", path: "/api/v1/*", url: "http://127.0.0.1:9/", methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] },
  ]);
  assert.deepEqual(await (await compile(tree)).describeRoutes(), report);
});

test("#19 hostable routes lists an app compiled by servable directly (backends empty)", async () => {
  const dir = fixtureDir();
  const mod = join(dir, "servable-app.mjs");
  writeFileSync(
    mod,
    `import { Router, Route, compile } from "@johnhenry/servable";\nexport default await compile(Router({ children: [Route({ path: "/", method: "GET", children: ["hi"] })] }));\n`,
  );
  try {
    const r = run(["routes", mod, "--json"]);
    assert.equal(await r.exit, 0);
    assert.deepEqual(r.events.map((e) => e.event), ["routes"]);
    assert.equal(r.events[0].complete, true);
    assert.deepEqual(r.events[0].backends, []);
    assert.deepEqual((r.events[0].hosts as { routes: { path: string }[] }[])[0].routes.map((x) => x.path), ["/"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
