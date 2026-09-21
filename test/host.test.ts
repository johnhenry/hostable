import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Dir, File } from "@johnhenry/fileable";
import { compile } from "../src/compile.js";
import { Gateway, Upstream } from "../src/components.js";
import { Group, Host, Route } from "@johnhenry/servable";

function req(host: string, path: string): Request {
  return new Request(`http://${host}${path}`);
}

async function withBackend(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await run(`http://localhost:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// --- The original bug, end to end: fileable-mounted static content in one
// Host must not leak into a sibling Host that only reverse-proxies
// elsewhere. Verified against a real http.createServer backend and a real
// compiled gateway, not a stand-in Route -- this is the exact shape
// examples/05-nested-jsx and examples/01-multi-domain actually run. ---
test("fileable-mounted content in one Host does not leak into a sibling Host's real Upstream reverse-proxy", async () => {
  await withBackend(
    (req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`legacy backend saw ${req.url}`);
    },
    async (baseUrl) => {
      const site = Dir({ name: "dist", children: [File({ name: "index.html", children: ["<h1>Home</h1>"] })] });
      const tree = Gateway({
        children: [
          Host({ name: "nested.example.com", children: Group({ prefix: "/static", children: site }) }),
          Host({ name: "proxy.example.com", children: Upstream({ path: "/*", url: `${baseUrl}/` }) }),
        ],
      });
      const compiled = await compile(tree);

      const correct = await compiled.fetch(req("nested.example.com", "/static/dist/index.html"));
      assert.equal(await correct.text(), "<h1>Home</h1>");

      // The actual regression: this used to also return the static
      // content (200, "<h1>Home</h1>") instead of reaching the proxy.
      const shouldProxy = await compiled.fetch(req("proxy.example.com", "/static/dist/index.html"));
      assert.equal(await shouldProxy.text(), "legacy backend saw /static/dist/index.html");
    },
  );
});

test("a Route inside a Host only matches that Host's requests", async () => {
  const tree = Gateway({
    children: Host({
      name: "a.example.com",
      children: Route({ path: "/x", method: "GET", children: ["a's x"] }),
    }),
  });
  const compiled = await compile(tree);
  const matching = await compiled.fetch(req("a.example.com", "/x"));
  assert.equal(await matching.text(), "a's x");
  const other = await compiled.fetch(req("b.example.com", "/x"));
  assert.equal(other.status, 404);
});

test("two sibling Hosts route independently, same path, different domains", async () => {
  const tree = Gateway({
    children: [
      Host({ name: "a.example.com", children: Route({ path: "/x", method: "GET", children: ["a"] }) }),
      Host({ name: "b.example.com", children: Route({ path: "/x", method: "GET", children: ["b"] }) }),
    ],
  });
  const compiled = await compile(tree);
  assert.equal(await (await compiled.fetch(req("a.example.com", "/x"))).text(), "a");
  assert.equal(await (await compiled.fetch(req("b.example.com", "/x"))).text(), "b");
});

test("a Route outside any Host matches every domain (no hostname constraint)", async () => {
  const tree = Gateway({ children: Route({ path: "/x", method: "GET", children: ["anywhere"] }) });
  const compiled = await compile(tree);
  assert.equal(await (await compiled.fetch(req("a.example.com", "/x"))).text(), "anywhere");
  assert.equal(await (await compiled.fetch(req("totally-different.com", "/x"))).text(), "anywhere");
});

test("wildcard subdomain Host pattern matches", async () => {
  const tree = Gateway({
    children: Host({ pattern: "*.example.com", children: Route({ path: "/x", method: "GET", children: ["wild"] }) }),
  });
  const compiled = await compile(tree);
  assert.equal(await (await compiled.fetch(req("anything.example.com", "/x"))).text(), "wild");
  const notMatching = await compiled.fetch(req("example.com", "/x"));
  assert.equal(notMatching.status, 404);
});

test("Host nested inside a Group prefix combines both correctly", async () => {
  const tree = Gateway({
    children: Group({
      prefix: "/v1",
      children: Host({ name: "a.example.com", children: Route({ path: "/x", method: "GET", children: ["combined"] }) }),
    }),
  });
  const compiled = await compile(tree);
  const res = await compiled.fetch(req("a.example.com", "/v1/x"));
  assert.equal(await res.text(), "combined");
  // The bare path (no /v1 prefix) must NOT match.
  const bare = await compiled.fetch(req("a.example.com", "/x"));
  assert.equal(bare.status, 404);
});

test("a Group prefix nested inside a Host combines both correctly", async () => {
  const tree = Gateway({
    children: Host({
      name: "a.example.com",
      children: Group({ prefix: "/api", children: Route({ path: "/x", method: "GET", children: ["nested"] }) }),
    }),
  });
  const compiled = await compile(tree);
  const res = await compiled.fetch(req("a.example.com", "/api/x"));
  assert.equal(await res.text(), "nested");
  const wrongHost = await compiled.fetch(req("b.example.com", "/api/x"));
  assert.equal(wrongHost.status, 404);
});

test("an explicit Route ordered before a catch-all Upstream in the same Host wins (first-match-wins, document order)", async () => {
  const tree = Gateway({
    children: Host({
      name: "a.example.com",
      children: [
        Route({ path: "/health", method: "GET", children: [{ ok: true }] }),
        Upstream({ path: "/*", handler: async () => new Response("fallback") }),
      ],
    }),
  });
  const compiled = await compile(tree);
  const res = await compiled.fetch(req("a.example.com", "/health"));
  assert.deepEqual(await res.json(), { ok: true });
  const other = await compiled.fetch(req("a.example.com", "/anything"));
  assert.equal(await other.text(), "fallback");
});

test("<Host> requires a name or pattern prop", async () => {
  const tree = Gateway({ children: Host({ children: Route({ path: "/x", method: "GET", children: ["x"] }) }) });
  await assert.rejects(() => compile(tree));
});
