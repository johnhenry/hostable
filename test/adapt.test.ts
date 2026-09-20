import { test } from "node:test";
import assert from "node:assert/strict";
import { fromFetchFn, fromNullableRouter } from "../src/adapt.js";
import { compile } from "../src/compile.js";
import { Gateway, Upstream } from "../src/components.js";

test("fromFetchFn adapts a fetch(url, init)-shaped function into a FetchLike usable as Upstream app=", async () => {
  const calls: Array<{ url: string; init?: unknown }> = [];
  const fakeFetch = async (url: string, init?: { method?: string; headers?: object; body?: unknown }) => {
    calls.push({ url, init });
    return new Response(`saw ${url}`);
  };
  const tree = Gateway({ children: Upstream({ path: "/*", app: fromFetchFn(fakeFetch) }) });
  const compiled = await compile(tree);
  const res = await compiled.fetch(new Request("http://x/hello"));
  assert.equal(await res.text(), "saw http://x/hello");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://x/hello");
});

test("fromFetchFn reads a non-GET body as text before calling fn (not a raw stream)", async () => {
  let seenBody: unknown;
  const fakeFetch = async (_url: string, init?: { body?: unknown }) => {
    seenBody = init?.body;
    return new Response("ok");
  };
  const tree = Gateway({ children: Upstream({ path: "/*", app: fromFetchFn(fakeFetch) }) });
  const compiled = await compile(tree);
  await compiled.fetch(new Request("http://x/hello", { method: "POST", body: "hello" }));
  assert.equal(seenBody, "hello");
});

test("fromFetchFn omits the body for GET/HEAD requests", async () => {
  let seenBody: unknown = "not-yet-set";
  const fakeFetch = async (_url: string, init?: { body?: unknown }) => {
    seenBody = init?.body;
    return new Response("ok");
  };
  const tree = Gateway({ children: Upstream({ path: "/*", app: fromFetchFn(fakeFetch) }) });
  const compiled = await compile(tree);
  await compiled.fetch(new Request("http://x/hello"));
  assert.equal(seenBody, undefined);
});

test("fromNullableRouter passes through a real Response", async () => {
  const router = async (_req: Request) => new Response("matched");
  const tree = Gateway({ children: Upstream({ path: "/*", app: fromNullableRouter(router) }) });
  const compiled = await compile(tree);
  const res = await compiled.fetch(new Request("http://x/hello"));
  assert.equal(await res.text(), "matched");
});

test("fromNullableRouter falls back to a plain 404 when the router returns null", async () => {
  const router = async (_req: Request) => null;
  const tree = Gateway({ children: Upstream({ path: "/*", app: fromNullableRouter(router) }) });
  const compiled = await compile(tree);
  const res = await compiled.fetch(new Request("http://x/hello"));
  assert.equal(res.status, 404);
});

test("fromNullableRouter's fallback is configurable", async () => {
  const router = async (_req: Request) => null;
  const tree = Gateway({
    children: Upstream({
      path: "/*",
      app: fromNullableRouter(router, () => new Response("custom fallback", { status: 418 })),
    }),
  });
  const compiled = await compile(tree);
  const res = await compiled.fetch(new Request("http://x/hello"));
  assert.equal(res.status, 418);
  assert.equal(await res.text(), "custom fallback");
});
