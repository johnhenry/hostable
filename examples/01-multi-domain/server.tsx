/**
 * Two domains, one gateway. Each <Host> is matched against the incoming
 * request's Host header (embedded in the Request's own URL -- confirmed
 * by reading @johnhenry/leserve's node-request.mjs, which is what
 * servable's Node adapter uses to build the Request from a real
 * IncomingMessage: `new URL(req.url, \`http://${req.headers.host}\`)`).
 *
 * Domain A serves nested fileable/servable content directly -- a static
 * page via literal `<Dir>`/`<File>`, plus a dynamic `<Route>`, all three
 * layers of the lineage in one JSX expression, no `from=`/`app=`
 * indirection (see examples/05-nested-jsx for the deeper tour: multiple
 * directories, an index.html-at-directory-path, a second proxied domain,
 * all together). Domain B reverse-proxies to a separate backend via
 * `url=`, for contrast -- one gateway routing both kinds of content,
 * addressed by domain.
 *
 * Run with:
 *   npm run build && node dist/examples/01-multi-domain/server.js
 * Then (-H sets the Host header directly, avoiding any real or fake DNS):
 *   curl http://localhost:3010/site/assets/index.html -H "Host: a.example.com"
 *   curl http://localhost:3010/hello -H "Host: a.example.com"
 *   curl http://localhost:3010/hello -H "Host: b.example.com"
 */
/** @jsxImportSource @johnhenry/hostable */
import http from "node:http";
import { Dir, File } from "@johnhenry/fileable";
import { Gateway, Host, Group, Route, Upstream, compile } from "@johnhenry/hostable";
import { serve } from "@johnhenry/hostable/adapters/node";

const backendB = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`backend-b saw ${req.url}`);
});
await new Promise<void>((resolve) => backendB.listen(0, resolve));
const portB = (backendB.address() as { port: number }).port;

const app = (
  <Gateway>
    <Host name="a.example.com">
      <Group prefix="/site">
        <Dir name="assets">
          <File name="index.html">{"<h1>Hello from a.example.com</h1>"}</File>
        </Dir>
      </Group>
      <Route path="/hello" method="GET">
        Hello, world!
      </Route>
    </Host>
    <Host name="b.example.com">
      <Upstream path="/*" url={`http://localhost:${portB}/`} />
    </Host>
  </Gateway>
);

const compiled = await compile(app);
serve(compiled, { port: 3010 });
console.log('listening on http://localhost:3010 -- try curl -H "Host: a.example.com" or "Host: b.example.com"');
