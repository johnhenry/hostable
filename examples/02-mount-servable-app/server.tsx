/**
 * Mounting a whole compiled @johnhenry/servable app into a hostable
 * gateway -- in-process, zero network hop, same mounting duality
 * servable itself supports for fileable trees: an explicit
 * `<Upstream app={compiledApp} />` prop, or the compiled app placed
 * directly as a raw JSX child (detected via `typeof value.fetch ===
 * "function"` duck-typing, no brand/symbol needed -- a Descriptor is
 * {tag,props,children}-shaped, a compiled app is {fetch}-shaped,
 * genuinely unambiguous).
 *
 * Run with:
 *   npm run build && node dist/examples/02-mount-servable-app/server.js
 * Then:
 *   curl http://localhost:3011/via-prop/users
 *   curl http://localhost:3011/via-raw-child/users
 */
/** @jsxImportSource @johnhenry/hostable */
import { Router, Route, compile as compileServable } from "@johnhenry/servable";
import { Gateway, Group, Upstream, compile } from "@johnhenry/hostable";
import { serve } from "@johnhenry/hostable/adapters/node";

// A small, ordinary servable app -- knows nothing about the gateway mounting it.
const usersApi = await compileServable(
  <Router>
    <Route path="/users" method="GET">
      {{ users: ["alice", "bob"] }}
    </Route>
  </Router>,
);

const app = (
  <Gateway>
    <Group prefix="/via-prop">
      <Upstream path="/*" app={usersApi} />
    </Group>
    <Group prefix="/via-raw-child">{usersApi}</Group>
  </Gateway>
);

const compiled = await compile(app);
serve(compiled, { port: 3011 });
console.log("listening on http://localhost:3011");
