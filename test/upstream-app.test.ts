import { test } from "node:test";
import assert from "node:assert/strict";
import { compile as compileHostable } from "../src/compile.js";
import { Gateway, Upstream } from "../src/components.js";
import { Group, Host, Route, Router, compile as compileServable } from "@johnhenry/servable";

async function realServableApp() {
  return compileServable(
    Router({
      children: Route({ path: "/*", method: "GET", handler: async (req: Request) => new Response(`mounted app saw ${new URL(req.url).pathname}`) }),
    }),
  );
}

test("<Upstream app={...}> mounts a compiled servable app, in-process, with the Group prefix stripped", async () => {
  const app = await realServableApp();
  const tree = Gateway({ children: Group({ prefix: "/mounted", children: Upstream({ path: "/*", app }) }) });
  const compiled = await compileHostable(tree);
  const res = await compiled.fetch(new Request("http://x/mounted/a/b"));
  assert.equal(await res.text(), "mounted app saw /a/b");
});

test("a compiled servable app as a raw JSX child (no Upstream wrapper) mounts the same way", async () => {
  const app = await realServableApp();
  const tree = Gateway({ children: Group({ prefix: "/mounted", children: app }) });
  const compiled = await compileHostable(tree);
  const res = await compiled.fetch(new Request("http://x/mounted/a/b"));
  assert.equal(await res.text(), "mounted app saw /a/b");
});

test("a raw fetch-shaped child composes with an explicit sibling Route in the same Group", async () => {
  const app = { fetch: async () => new Response("app") };
  const tree = Gateway({
    children: Group({
      prefix: "/mixed",
      children: [Route({ path: "/api", method: "GET", children: [{ ok: true }] }), app],
    }),
  });
  const compiled = await compileHostable(tree);
  const api = await compiled.fetch(new Request("http://x/mixed/api"));
  assert.deepEqual(await api.json(), { ok: true });
  const rest = await compiled.fetch(new Request("http://x/mixed/anything"));
  assert.equal(await rest.text(), "app");
});

test("<Upstream app={...}> under a Host is hostname-qualified", async () => {
  const app = await realServableApp();
  const tree = Gateway({ children: Host({ name: "a.example.com", children: Upstream({ path: "/*", app }) }) });
  const compiled = await compileHostable(tree);
  const matching = await compiled.fetch(new Request("http://a.example.com/x"));
  assert.equal(await matching.text(), "mounted app saw /x");
  const other = await compiled.fetch(new Request("http://b.example.com/x"));
  assert.equal(other.status, 404);
});

test("compile() called twice on the same tree with a mounted app doesn't leak mutations", async () => {
  const app = await realServableApp();
  const tree = Gateway({ children: Upstream({ path: "/*", app }) });
  const first = await compileHostable(tree);
  const second = await compileHostable(tree);
  assert.equal(await (await first.fetch(new Request("http://x/a"))).text(), "mounted app saw /a");
  assert.equal(await (await second.fetch(new Request("http://x/a"))).text(), "mounted app saw /a");
});
