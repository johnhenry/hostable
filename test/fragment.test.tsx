/** @jsxImportSource @johnhenry/hostable */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Dir, File } from "@johnhenry/fileable";
import { Gateway, Host, Group, Route, compile } from "../src/index.js";

test("a literal <>...</> Fragment under <Host> works -- regression guard for a real bug", async () => {
  // hostable used to define its own, distinct Fragment symbol
  // (Symbol.for("hostable.fragment")). hostable has no build/resolve/
  // layout pipeline of its own -- it hands everything to servable's real
  // compile() -- and servable's build() only ever flattens ITS OWN
  // Fragment symbol. hostable's own Fragment was never recognized by
  // anything downstream, so writing <>...</> under hostable's pragma threw
  // `<Symbol(hostable.fragment)> is not a servable primitive here` the
  // moment it was actually used. Fixed by making hostable's Fragment BE
  // servable's Fragment symbol (re-exported, not redefined) -- see
  // types.ts's own FRAGMENT doc comment for the full reasoning.
  //
  // NOTE on the shape of this specific test: wrapping two fixed <Route>s
  // in a Fragment here has no purpose of its own -- <Host>'s children
  // already accept any number of direct siblings unwrapped. This is
  // deliberately the narrowest possible case that exercises the symbol,
  // not a recommended pattern -- see the next test for where a Fragment
  // actually earns its keep (a component function's return value).
  const app = (
    <Gateway>
      <Host name="a.example.com">
        <>
          <Route path="/extra-a" method="GET">
            {"extra A"}
          </Route>
          <Route path="/extra-b" method="GET">
            {"extra B"}
          </Route>
        </>
      </Host>
    </Gateway>
  );
  const compiled = await compile(app);
  const a = await compiled.fetch(new Request("http://a.example.com/extra-a"));
  assert.equal(await a.text(), "extra A");
  const b = await compiled.fetch(new Request("http://a.example.com/extra-b"));
  assert.equal(await b.text(), "extra B");
});

// A component function returning a Fragment -- genuinely useful, unlike
// the fixed-list case above: a function can only return ONE value, and
// Fragment is what lets that one value stand for several sibling Routes,
// reused across as many Hosts as it's embedded in. `<CommonRoutes />`,
// capitalized -- not `<commonRoutes />`: JSX itself (not this package's
// jsx()) decides how to compile a tag name purely from its capitalization,
// before any custom jsx() factory runs. A lowercase-starting tag always
// compiles to a bare string ("commonRoutes"), which jsx() then treats as
// an unrecognized markup tag and rejects; only an uppercase-starting tag
// compiles to a lookup of the real `CommonRoutes` binding and gets called
// as a function. Confirmed both ways by actually trying it, not just
// reasoning about JSX's rules -- see the two tests below.
function CommonRoutes() {
  return (
    <>
      <Route path="/health" method="GET">
        {{ ok: true }}
      </Route>
      <Route path="/version" method="GET">
        {{ version: "1.0.0" }}
      </Route>
    </>
  );
}

test("lowercase <commonRoutes /> does NOT call the function -- JSX treats it as a plain markup tag and this package rejects it", async () => {
  // No type error here -- IntrinsicElements accepts any lowercase string
  // tag untyped (same as `<div>`/`<span>` would be), so this only fails at
  // *runtime*, not compile time. That's exactly the trap: nothing stops
  // you from writing this by accident.
  const app = (
    <Gateway>
      <Host name="a.example.com"><commonRoutes /></Host>
    </Gateway>
  );
  await assert.rejects(() => compile(app), /<commonRoutes> is not a servable primitive here/);
});

test("uppercase <CommonRoutes /> calls the function -- a Fragment-returning component reused across two Hosts", async () => {
  const site = (
    <>
      <File name="index.html">{"home"}</File>
      <File name="about.html">{"about"}</File>
    </>
  );
  const app = (
    <Gateway>
      <Host name="a.example.com">
        <Group prefix="/static">{site}</Group>
        <CommonRoutes />
      </Host>
      <Host name="b.example.com">
        <CommonRoutes />
      </Host>
    </Gateway>
  );
  const compiled = await compile(app);

  assert.equal(await (await compiled.fetch(new Request("http://a.example.com/static/index.html"))).text(), "home");
  assert.equal(await (await compiled.fetch(new Request("http://a.example.com/static/about.html"))).text(), "about");

  const aHealth = await compiled.fetch(new Request("http://a.example.com/health"));
  assert.deepEqual(await aHealth.json(), { ok: true });
  const bHealth = await compiled.fetch(new Request("http://b.example.com/health"));
  assert.deepEqual(await bHealth.json(), { ok: true });
  const bVersion = await compiled.fetch(new Request("http://b.example.com/version"));
  assert.deepEqual(await bVersion.json(), { version: "1.0.0" });

  // b.example.com never got <Group prefix="/static">{site}</Group> -- only
  // a.example.com did -- proving CommonRoutes composes independently of
  // whatever else is nested alongside it in a given Host, not by accident
  // of shared state.
  assert.equal((await compiled.fetch(new Request("http://b.example.com/static/index.html"))).status, 404);
});
