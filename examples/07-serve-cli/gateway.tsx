/**
 * A gateway for the `hostable` CLI: the module only default-exports the
 * compiled gateway; the CLI owns the port, the lifecycle and (with --json)
 * the event stream, including a `routes` event listing every hostname.
 *
 * The api.localhost backend is a separate process the supervisor runs
 * (hostable doesn't start backends, see README "Backends"). Start one with:
 *   node -e 'require("http").createServer((q,s)=>s.end("api saw "+q.url)).listen(3021)'
 *
 * Run with:
 *   npm run build && node dist/src/cli.js routes dist/examples/07-serve-cli/gateway.js
 *   node dist/src/cli.js serve dist/examples/07-serve-cli/gateway.js --port 3020
 * Machine-driven, under Node's permission model:
 *   node --permission --allow-fs-read="$PWD" --allow-net dist/src/cli.js \
 *     serve dist/examples/07-serve-cli/gateway.js --port 0 --json --watch
 * Then:
 *   curl http://127.0.0.1:3020/   # an index of what this gateway answers
 *   curl http://127.0.0.1:3020/ -H "Host: www.localhost"
 *   curl http://127.0.0.1:3020/v1/users -H "Host: api.localhost"
 */
/** @jsxImportSource @johnhenry/hostable */
import { Gateway, Host, Route, Redirect, Upstream, compile } from "@johnhenry/hostable";

export default await compile(
  <Gateway>
    <Host name="www.localhost">
      <Route path="/" method="GET">
        Hello from www.localhost
      </Route>
      <Redirect from="/home" to="/" />
    </Host>
    <Host name="api.localhost">
      <Upstream path="/v1/*" url="http://127.0.0.1:3021/" />
    </Host>
    {/* Any host, last: a plain http://127.0.0.1:3020/ (no matching Host header) lands on this index instead of a 404. */}
    <Route path="/" method="GET">
      <h1>hostable serve</h1>
      <p>Routes by Host header (through a *.localhost name router, or curl -H):</p>
      <ul>
        <li><code>www.localhost GET / and /home</code></li>
        <li><code>api.localhost GET /v1/* (proxied to 127.0.0.1:3021)</code></li>
      </ul>
    </Route>
  </Gateway>,
);
