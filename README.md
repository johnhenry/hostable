# hostable

Declaratively describe an API gateway using JSX -- routes across multiple
domains and backend services by `Host` header, on top of
[`@johnhenry/servable`](https://github.com/johnhenry/servable)'s single-app
`(Request) => Response` dispatcher.

Third package in the `fileable -> servable -> hostable` lineage:
[`fileable`](https://github.com/johnhenry/fileable) compiles JSX into
filesystem artifacts, `servable` compiles JSX into *one* app's dispatcher,
`hostable` is the layer above that -- routing across a *fleet* of apps and
backends, addressed by domain as well as path.

## Installation

```bash
npm install @johnhenry/hostable
```

## The governing rule

> A gateway matches by domain (`Host`) before path (`Group`/`Route`) --
> `Host` compiles into the same `URLPattern` `hostname` component that
> `Group`'s prefix already uses for `pathname`, so `Host`/`Group`/`Route`
> together are one flat, first-match-wins dispatch table, not a two-phase
> lookup. A leaf either handles the request itself (`Route`, reused
> verbatim from servable) or forwards it elsewhere (`Upstream`, hostable's
> one new leaf) -- forwarding is always a leaf, never a wrapper, exactly
> like `Route` is always a leaf.

## Primitives

Mostly **reused, not reimplemented** -- `@johnhenry/servable` is a real
dependency, and `Group`/`Route`/`Use`/`ErrorBoundary`/`NotFound`/
`Redirect`/`Response` are re-exported from it directly, unchanged. A
gateway-level auth check, rate limit, or health-check endpoint is just
`Use`/`Route`, identical to servable.

Two new primitives:

### `Host`

```tsx
<Host name="a.example.com"> ... </Host>
<Host pattern="*.example.com"> ... </Host>
```

Domain-axis scope -- matched against the incoming request's `Host` header
(embedded in the request's own URL by the Node adapter, same as any other
real HTTP server). Accumulates into every nested `Route`/`Upstream`'s
compiled `URLPattern` `hostname` component, exactly parallel to how
`Group prefix` accumulates the `pathname` component. Wildcard subdomains
work via `URLPattern`'s own native hostname pattern syntax. Multiple
sibling `Host`s route independent domains within one `Gateway`.

**Known v1 limitation**: `NotFound`/`ErrorBoundary` scope resolution is
still keyed purely by servable's own pathname-based scope -- two sibling
`Host`s at the same path scope (e.g. both directly under `Gateway`, no
`Group` nesting) share one `NotFound`/error boundary unless also
separated by a real `Group prefix`. Only `Route`/`Upstream` get
hostname-qualified matching; `Redirect` does not.

### `Upstream`

```tsx
<Upstream path="/*" url="https://backend:3000" />
<Upstream path="/*" app={compiledServableApp} />
<Upstream path="/*" handler={async (req, ctx) => new Response("...")} />
```

"Forward it there" -- the one new leaf. `url`/`app`/`handler` are mutually
exclusive (throws if more than one is set). Unlike `Route` (which defaults
to `GET`), an `Upstream` with no `method` set forwards **every standard
HTTP method** (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD`/`OPTIONS`) --
servable's own dispatch has no "any method" concept, and a reverse proxy
silently 404ing every non-GET request would be wrong for the common case.

- **`url`** -- reverse-proxy via `fetch()`. Strips the matched
  `Host`/`Group` prefix from the incoming request's path before
  forwarding (same "serve what's inside this scope" rule fileable-mount
  uses), strips hop-by-hop headers (RFC 9110 §7.6.1: `Connection`,
  `Keep-Alive`, `Transfer-Encoding`, `TE`, `Trailer`, `Upgrade`,
  `Proxy-Authenticate`, `Proxy-Authorization`) from both the outgoing
  request and the returned response, and passes redirects through
  unfollowed (`redirect: "manual"`) rather than silently following them
  on the client's behalf.
- **`app`** -- any object shaped `{fetch(request): Promise<Response>}`,
  called in-process, zero network hop. Covers a compiled
  `@johnhenry/servable` dispatcher, a `@johnhenry/dialback` `Server`
  instance, or anything else with a `.fetch` method -- genuinely uniform,
  no per-integration code needed for either.
- **`handler`** -- full escape hatch, same shape as `Route`'s `handler`.

### Mounting an app without `Upstream` at all

A Fetch-shaped object (a compiled servable app, a `dialback` `Server`,
anything with `.fetch()`) can sit directly as a raw JSX child of
`Gateway`/`Host`/`Group` -- detected via `typeof value.fetch ===
"function"` duck-typing, no brand/symbol needed (a hostable `Descriptor`
is `{tag,props,children}`-shaped; a Fetch-shaped backend is `{fetch}`-shaped
-- genuinely unambiguous):

```tsx
const app = await compileServable(<Router>...</Router>);

const gateway = (
  <Gateway>
    <Host name="app.example.com">{app}</Host>
  </Gateway>
);
```

## Literal cross-package JSX

`@johnhenry/servable`'s own `<Route>`/`<Group>` can be written literally,
nested directly inside `<Gateway>`/`<Host>`, in the same file, under one
`@jsxImportSource @johnhenry/hostable` pragma:

```tsx
/** @jsxImportSource @johnhenry/hostable */
import { Gateway, Host, Group, Route, Upstream, compile } from "@johnhenry/hostable";

const app = (
  <Gateway>
    <Host name="a.example.com">
      <Group prefix="/api">
        <Route path="/users" method="GET">{{ users: [] }}</Route>
      </Group>
      <Upstream path="/*" handler={async () => new Response("fallback")} />
    </Host>
  </Gateway>
);
```

This works because hostable's `jsx()` calls any function-typed tag
directly with its props (`type(allProps)`) rather than treating it as
markup, and `Descriptor.tag`'s type is the general `symbol` (not
hostable's own exact `typeof FRAGMENT`) specifically so a sibling
package's differently-keyed Fragment marker still type-checks.

The same mechanism goes a layer deeper: `fileable`'s `<Dir>`/`<File>` can
be nested directly inside servable's `<Group>`, which is itself nested
inside hostable's `<Host>` -- three packages' JSX, one pragma, one
expression:

```tsx
/** @jsxImportSource @johnhenry/hostable */
import { Dir, File } from "@johnhenry/fileable";
import { Gateway, Host, Group, Route, compile } from "@johnhenry/hostable";

const app = (
  <Gateway>
    <Host name="a.example.com">
      <Group prefix="/static">
        <Dir name="dist">
          <File name="index.html">{"<h1>Home</h1>"}</File>
        </Dir>
      </Group>
      <Route path="/api/hello" method="GET">{{ hello: "world" }}</Route>
    </Host>
  </Gateway>
);
```

See `examples/05-nested-jsx` for the full, verified version (static
assets, a JSON API, and a reverse-proxied second domain, all in one tree).

## Ecosystem integration

Neither of these gets hostable-specific integration code -- both plug in
through `Upstream`'s existing `app=`/`handler=` mechanism, though not
identically: `dialback`'s export already satisfies `FetchLike` directly;
`browsermesh`'s two exports don't, so they go through two small, generic
adapters instead (not browsermesh-specific themselves -- see below).

- **[`@johnhenry/dialback`](https://github.com/johnhenry/dialback)**
  (reverse-proxy-over-websockets: an agent dials out, the server dials
  back through that connection to reach it) -- a `Server` instance is
  already Fetch-shaped (`server.fetch(request)`), so forwarding gateway
  traffic to an agent behind NAT/a firewall is just `<Upstream
  app={dialbackServer} />`, no adapter needed. See
  `examples/03-dialback-tunnel`.

  **Known constraint**: `dialback`'s `Server#fetch()` picks a connection
  via its own load-balancing strategy across *all* connected agents --
  there's no way to target one specific agent by ID. Use one dedicated
  `Server` instance per `Upstream` that needs a specific agent.

- **[`@johnhenry/browsermesh`](https://github.com/johnhenry/browsermesh)**
  (peer-to-peer mesh networking for browser Pods) has its own HTTP-shaped
  bridges independent of `dialback`, but **neither satisfies `FetchLike`
  as-is** (confirmed by reading their source, not assumed):
  `createBrowserMeshFetch()` is a bare `fetch(url, init)`-shaped
  *function*, not an object with `.fetch`; `MeshFetchRouter#route()`
  returns `Response | null` (the Service-Worker-interceptor convention),
  not always a `Response`. `fromFetchFn()`/`fromNullableRouter()` (below)
  adapt each into `FetchLike`. See `examples/06-browsermesh` for a real,
  running mesh round-trip both ways.

### `fromFetchFn` / `fromNullableRouter`

Two small, generic adapters -- not specific to browsermesh, just the two
shapes it happens to need:

```ts
import { fromFetchFn, fromNullableRouter } from "@johnhenry/hostable";
// Subpath imports (added in @johnhenry/browsermesh-apps@0.5.0) -- not the
// top-level `.` entrypoint, which pulls in the package's entire 70+-module
// application layer, including an eager @johnhenry/browsermesh-transport
// import this integration doesn't need.
import { createBrowserMeshFetch } from "@johnhenry/browsermesh-apps/mesh-fetch";
import { MeshFetchRouter } from "@johnhenry/browsermesh-discovery";

// Adapts any fetch(url, init)-shaped function into app=.
const meshFetch = createBrowserMeshFetch(meshRpcApi);
<Upstream path="/*" app={fromFetchFn((_url, init) => meshFetch(`mesh://${podId}/greet`, init))} />

// Adapts a (req) => Promise<Response|null> router into app=, with a
// configurable fallback for null (default: a plain 404).
const router = new MeshFetchRouter({ onRpc });
<Host pattern="*.mesh.local">
  <Upstream path="/*" app={fromNullableRouter(router.route.bind(router))} />
</Host>
```

`fromFetchFn` reads a non-GET/HEAD request's body as text before calling
`fn` (not a raw stream) -- matching how both `createBrowserMeshFetch()`
and `MeshFetchRouter#route()` already extract a body from `init.body`/a
real `Request` (read as text, then try `JSON.parse`), since neither
accepts a stream.

## Adapters

Thin re-exports of servable's own -- hostable's compiled output IS a
servable-compiled dispatcher:

```ts
import { serve } from "@johnhenry/hostable/adapters/node";
const handle = serve(compiled, { port: 3000 });
```

## Non-goals

- Not a service mesh, not pod discovery, not sidecar injection --
  `browsermesh`'s domain, not duplicated here.
- No built-in TLS/cert management -- delegate to the adapter/runtime.
- No built-in load balancing/health checks/circuit breaking in v1 --
  `Upstream` stays single-target; `handler=` covers custom multi-target
  logic without a new primitive.
- No built-in caching layer (same Fetch `Cache` API portability reasoning
  servable already used to reject one).
- No built-in DNS/Consul-style service discovery -- `url=`/`app=` are
  static per compile; `handler=` is the dynamic-resolution escape hatch.

## Examples

See [`examples/`](./examples):

- `01-multi-domain` -- two `Host`s, each forwarding to a different `url=`
  backend.
- `02-mount-servable-app` -- `Upstream app={}` and the raw-child form,
  mirrors servable's own `07-mount-fileable` example.
- `03-dialback-tunnel` -- `Upstream app={dialback.Server}`, forwards a
  real request through a real tunnel to a connected `Agent`.
- `04-full-stack` -- `fileable` (static assets, via servable's
  `Group from=`) + `servable` (a separately-compiled API app, mounted as
  a raw child) + `hostable` (multi-domain routing + reverse proxy), one
  running app.
- `05-nested-jsx` -- the flagship: all three layers written as **literal,
  nested JSX in one expression** -- `<Dir>`/`<File>` (fileable) directly
  inside `<Group>` (servable) directly inside `<Host>`/`<Gateway>`
  (hostable), one file, one `@jsxImportSource @johnhenry/hostable`
  pragma, no separate `compile()` step or `from=`/`app=` indirection for
  the inner layers. The direct payoff of the whole `fileable -> servable
  -> hostable` lineage.
- `06-browsermesh` -- forwards gateway traffic into a real browsermesh
  peer two ways: `createBrowserMeshFetch()` via `fromFetchFn()`, and
  `MeshFetchRouter` via `fromNullableRouter()` paired with `<Host
  pattern="*.mesh.local">`. Two real Ed25519-identified peers, a real
  `mesh-rpc` round trip, verified over real HTTP.

## License

MIT
