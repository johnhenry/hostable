# hostable examples

Runnable TSX gateways, each a real, compiled multi-domain/reverse-proxy
dispatcher started via the Node adapter. They compile alongside `src/`/
`adapters/` (see `tsconfig.json`'s `include`). Every file's own header
comment states its exact run command, port, and a few `curl -H "Host:
..."` calls to try against it once running.

| Example | Demonstrates |
| --- | --- |
| [`01-multi-domain/server.tsx`](./01-multi-domain/server.tsx) | Two `Host`s, each forwarding to a different `url=` backend -- domain A serves nested fileable/servable content directly, domain B reverse-proxies, one gateway addressed by `Host` header. |
| [`02-mount-servable-app/server.tsx`](./02-mount-servable-app/server.tsx) | `Upstream app={}` and the raw-child form for mounting a whole compiled `@johnhenry/servable` app in-process, zero network hop -- mirrors servable's own `07-mount-fileable`. |
| [`03-dialback-tunnel/server.tsx`](./03-dialback-tunnel/server.tsx) | `Upstream app={dialback.Server}` forwarding a real request through a real tunnel to a connected `dialback` `Agent` -- both sides run in one process for a self-contained demo. |
| [`04-full-stack/server.tsx`](./04-full-stack/server.tsx) | `fileable` (static assets, via servable's `Group from=`) + `servable` (a separately-compiled API app, mounted as a raw child) + `hostable` (multi-domain routing + reverse proxy), one running app. |
| [`05-nested-jsx/server.tsx`](./05-nested-jsx/server.tsx) | The flagship: all three layers of the lineage written as literal, nested JSX in one expression -- `<Dir>`/`<File>` (fileable) inside `<Group>` (servable) inside `<Host>`/`<Gateway>` (hostable), one file, one pragma. |
| [`06-browsermesh/server.tsx`](./06-browsermesh/server.tsx) | Forwards gateway traffic into a real browsermesh peer two ways: `createBrowserMeshFetch()` via `fromFetchFn()`, and `MeshFetchRouter` via `fromNullableRouter()` paired with `<Host pattern="*.mesh.local">`. Two real Ed25519-identified peers, a real `mesh-rpc` round trip. |

## Running

```sh
npm run build
node dist/examples/01-multi-domain/server.js
# then, per that example's own header comment (-H sets the Host header
# directly, avoiding any real or fake DNS):
curl http://localhost:3010/hello -H "Host: a.example.com"
```

Each example listens on its own fixed port (3010-3015, in file order) so
several can run side by side; see each file's header comment for its exact
port and `curl` calls.

## Runtime requirements (honest edition)

All six run under plain Node >= 26 via the Node adapter (a thin re-export
of servable's own, which delegates to `@johnhenry/leserve`'s `serve()`).
`06-browsermesh` additionally needs the `browsermesh` packages listed in
this repo's `devDependencies` -- they're dev-time integration examples,
not runtime dependencies of the library itself.
