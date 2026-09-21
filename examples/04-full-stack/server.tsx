/**
 * The full fileable -> servable -> hostable lineage in one running app --
 * but unlike examples/05-nested-jsx (all three layers under ONE pragma, in
 * ONE expression), this one keeps servable's own compile() as a real,
 * separate step: fileable's `<Dir>`/`<File>` are written literally nested
 * inside servable's `<Router>`/`<Group>` JSX (same nested-JSX mechanism
 * 05 uses, one layer down), that whole tree is compiled into a real
 * `(Request) => Response` app on its own, and only THEN is the already-
 * compiled app mounted into hostable, alongside a completely separate
 * reverse-proxied backend on a second domain. This is the OTHER valid
 * composition shape (compile-then-mount, vs. nest-everything-in-one-tree)
 * -- demonstrating why hostable exists at all: servable compiles one app;
 * hostable is what puts several of them (plus proxied backends) behind
 * one gateway, addressed by domain.
 *
 * Run with:
 *   npm run build && node dist/examples/04-full-stack/server.js
 * Then (-H sets the Host header directly, avoiding any real or fake DNS):
 *   curl http://localhost:3013/static/dist/index.html -H "Host: app.example.com"
 *   curl http://localhost:3013/api/hello -H "Host: app.example.com"
 *   curl http://localhost:3013/anything -H "Host: proxy.example.com"
 */
/** @jsxImportSource @johnhenry/servable */
import http from "node:http";
import { Dir, File } from "@johnhenry/fileable";
import { Router, Group, Route, compile as compileServable } from "@johnhenry/servable";

const app = await compileServable(
  <Router>
    <Group prefix="/static">
      <Dir name="dist">
        <File name="index.html">{"<h1>Hello from the mounted servable app</h1>"}</File>
      </Dir>
    </Group>
    <Route path="/api/hello" method="GET">
      {{ hello: "world" }}
    </Route>
  </Router>,
);

// A separate backend, entirely unaware of hostable, reverse-proxied to under a different domain.
const legacyBackend = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`legacy backend saw ${req.url}`);
});
await new Promise<void>((resolve) => legacyBackend.listen(0, resolve));
const legacyPort = (legacyBackend.address() as { port: number }).port;

// Switch to hostable's own JSX pragma for the gateway layer -- see below.
const { Gateway, Host, Upstream, compile } = await import("@johnhenry/hostable");
const { serve } = await import("@johnhenry/hostable/adapters/node");

const gateway = Gateway({
  children: [
    Host({ name: "app.example.com", children: app }), // the compiled servable app, mounted as a raw child
    Host({ name: "proxy.example.com", children: Upstream({ path: "/*", url: `http://localhost:${legacyPort}/` }) }),
  ],
});

const compiled = await compile(gateway);
serve(compiled, { port: 3013 });
console.log('listening on http://localhost:3013 -- try curl -H "Host: app.example.com" or "Host: proxy.example.com"');
