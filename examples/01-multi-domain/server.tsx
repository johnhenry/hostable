/**
 * Two domains, one gateway. Each <Host> is matched against the incoming
 * request's Host header (embedded in the Request's own URL -- confirmed
 * by reading @johnhenry/leserve's node-request.mjs, which is what
 * servable's Node adapter uses to build the Request from a real
 * IncomingMessage: `new URL(req.url, \`http://${req.headers.host}\`)`),
 * and routes to a completely different backend via `url=`.
 *
 * Run with:
 *   npm run build && node dist/examples/01-multi-domain/server.js
 * Then (-H sets the Host header directly, avoiding any real or fake DNS):
 *   curl http://localhost:3010/hello -H "Host: a.example.com"
 *   curl http://localhost:3010/hello -H "Host: b.example.com"
 */
/** @jsxImportSource @johnhenry/hostable */
import http from "node:http";
import { Gateway, Host, Upstream, compile } from "@johnhenry/hostable";
import { serve } from "@johnhenry/hostable/adapters/node";

function backend(name: string) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`${name} saw ${req.url}`);
  });
  return server;
}

const backendA = backend("backend-a");
const backendB = backend("backend-b");
await new Promise<void>((resolve) => backendA.listen(0, resolve));
await new Promise<void>((resolve) => backendB.listen(0, resolve));
const portA = (backendA.address() as { port: number }).port;
const portB = (backendB.address() as { port: number }).port;

const app = (
  <Gateway>
    <Host name="a.example.com">
      <Upstream path="/*" url={`http://localhost:${portA}/`} />
    </Host>
    <Host name="b.example.com">
      <Upstream path="/*" url={`http://localhost:${portB}/`} />
    </Host>
  </Gateway>
);

const compiled = await compile(app);
serve(compiled, { port: 3010 });
console.log('listening on http://localhost:3010 -- try curl -H "Host: a.example.com" or "Host: b.example.com"');
