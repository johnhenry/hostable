import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compile.js";
import { Gateway, Host, Upstream } from "../src/components.js";
import { Group, Route } from "@johnhenry/servable";

function req(host: string, path: string): Request {
  return new Request(`http://${host}${path}`);
}

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
