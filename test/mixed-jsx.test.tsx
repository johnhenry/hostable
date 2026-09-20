/** @jsxImportSource @johnhenry/hostable */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Gateway, Host, Group, Route, Upstream, compile } from "../src/index.js";

test("literal <Route>/<Group> (re-exported from @johnhenry/servable) nested inside <Gateway>/<Host>, one file, one pragma", async () => {
  const app = (
    <Gateway>
      <Host name="a.example.com">
        <Group prefix="/api">
          <Route path="/users" method="GET">
            {{ users: [] }}
          </Route>
        </Group>
      </Host>
    </Gateway>
  );
  const compiled = await compile(app);
  const res = await compiled.fetch(new Request("http://a.example.com/api/users"));
  assert.deepEqual(await res.json(), { users: [] });
});

test("literal <Upstream> alongside literal <Route> under <Host>, ordering respected", async () => {
  const app = (
    <Gateway>
      <Host name="b.example.com">
        <Route path="/health" method="GET">
          {{ ok: true }}
        </Route>
        <Upstream path="/*" handler={async () => new Response("fallback")} />
      </Host>
    </Gateway>
  );
  const compiled = await compile(app);
  const health = await compiled.fetch(new Request("http://b.example.com/health"));
  assert.deepEqual(await health.json(), { ok: true });
  const rest = await compiled.fetch(new Request("http://b.example.com/anything"));
  assert.equal(await rest.text(), "fallback");
});
