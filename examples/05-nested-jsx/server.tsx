/**
 * All three layers of the lineage nested literally in ONE JSX expression,
 * under ONE pragma (hostable's): fileable's <Dir>/<File>, servable's
 * <Group>/<Route> (re-exported from hostable), and hostable's own
 * <Gateway>/<Host>/<Upstream> -- no separate compile() step for an inner
 * layer, no `from=`/`app=` indirection, just direct containment.
 *
 * This works for the same reason the fileable-in-servable and
 * servable-in-hostable cases each work on their own: every layer's
 * `jsx()` calls any function-typed tag directly with its props
 * (`type(allProps)`), and every layer's `Descriptor.tag` type is the
 * general `symbol` (not its own exact `typeof FRAGMENT`), so a
 * grandchild package's Fragment marker still type-checks two hops away.
 *
 * Run with:
 *   npm run build && node dist/examples/05-nested-jsx/server.js
 * Then (the mounted Dir's own name, "dist", IS part of the URL -- see
 * servable's README, "Mounting a fileable tree"):
 *   curl http://localhost:3014/   # an index of what this gateway answers
 *   curl http://localhost:3014/static/dist -H "Host: nested.example.com"   # no trailing slash -- posixDirname never adds one except for the true root
 *   curl http://localhost:3014/static/dist/about/index.html -H "Host: nested.example.com"
 *   curl http://localhost:3014/api/hello -H "Host: nested.example.com"
 *   curl http://localhost:3014/anything -H "Host: proxy.example.com"
 */
/** @jsxImportSource @johnhenry/hostable */
import http from "node:http";
import { Dir, File } from "@johnhenry/fileable";
import { Gateway, Host, Group, Route, Upstream, compile } from "@johnhenry/hostable";
import { serve } from "@johnhenry/hostable/adapters/node";

// A separate backend, reverse-proxied to under a different domain --
// demonstrates Upstream alongside the nested fileable/servable content.
const legacyBackend = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`legacy backend saw ${req.url}`);
});
await new Promise<void>((resolve) => legacyBackend.listen(0, resolve));
const legacyPort = (legacyBackend.address() as { port: number }).port;

const app = (
  <Gateway>
    <Host name="nested.example.com">
      <Group prefix="/static">
        {/* fileable JSX, nested directly inside servable's Group, nested inside hostable's Host -- three packages, one tree */}
        <Dir name="dist">
          <File name="index.html">{"<h1>Home</h1><a href=\"/static/dist/about/index.html\">About</a>"}</File>
          <Dir name="about">
            <File name="index.html">{"<h1>About</h1>"}</File>
          </Dir>
        </Dir>
      </Group>
      <Route path="/api/hello" method="GET">
        {{ hello: "world" }}
      </Route>
    </Host>
    <Host name="proxy.example.com">
      <Upstream path="/*" url={`http://localhost:${legacyPort}/`} />
    </Host>
    {/* Any host, last: a plain http://localhost:3014/ (no matching Host header) lands on this index instead of a 404. */}
    <Route path="/" method="GET">
      <h1>Nested JSX gateway</h1>
      <p>Routes by Host header; try these with curl -H:</p>
      <ul>
        <li><code>Host: nested.example.com GET /static/dist</code></li>
        <li><code>Host: nested.example.com GET /api/hello</code></li>
        <li><code>Host: proxy.example.com GET /* (proxied)</code></li>
      </ul>
    </Route>
  </Gateway>
);

const compiled = await compile(app);
serve(compiled, { port: 3014 });
console.log('listening on http://localhost:3014 -- try curl -H "Host: nested.example.com" or "Host: proxy.example.com"');
