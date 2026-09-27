import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, lower } from "../src/compile.js";
import { Gateway, Upstream } from "../src/components.js";
import { Host, Route } from "@johnhenry/servable";
import { isDescriptor } from "../src/types.js";

// issue #7's second ask: expose the Gateway -> servable lowering step so
// tools can inspect compiled routes without reimplementing this file's own
// transform rules (host/group nesting, Upstream -> Route expansion, ...).

test("lower() exposes the real servable tree compile() would build from", async () => {
  const tree = Gateway({
    children: Host({
      name: "a.example.com",
      children: Route({ path: "/x", method: "GET", children: ["a's x"] }),
    }),
  });

  const lowered = lower(tree);
  assert.ok(isDescriptor(lowered));
  // gateway lowers to a bare Router wrapping its children.
  assert.equal(typeof lowered.tag, "string");

  // The same tree, run through compile(), must behave identically to
  // whatever lower() produced -- lower() is not a separate code path.
  const compiled = await compile(tree);
  const res = await compiled.fetch(new Request("http://a.example.com/x"));
  assert.equal(await res.text(), "a's x");
});

test("lower() expands a method-less <Upstream> into one Route per HTTP method, inspectably", async () => {
  const tree = Gateway({
    children: Upstream({ path: "/*", handler: async () => new Response("ok") }),
  });

  const lowered = lower(tree);
  assert.ok(isDescriptor(lowered));
  const routes = lowered.children.filter(isDescriptor);
  const methods = routes.map((r) => r.props.method).sort();
  assert.deepEqual(methods, ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);
});

test("lower() with an explicit Upstream method produces a single Route, not seven", async () => {
  const tree = Gateway({
    children: Upstream({ path: "/x", method: "POST", handler: async () => new Response("ok") }),
  });

  const lowered = lower(tree);
  assert.ok(isDescriptor(lowered));
  const routes = lowered.children.filter(isDescriptor);
  assert.equal(routes.length, 1);
  assert.equal(routes[0]!.props.method, "POST");
});
