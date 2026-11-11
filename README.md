# hostable

[![npm version](https://img.shields.io/npm/v/%40johnhenry%2Fhostable.svg)](https://www.npmjs.com/package/@johnhenry/hostable)
[![CI](https://github.com/johnhenry/hostable/actions/workflows/ci.yml/badge.svg)](https://github.com/johnhenry/hostable/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/%40johnhenry%2Fhostable.svg)](LICENSE)

Full documentation: [opensource.johnhenry.me/hostable](https://opensource.johnhenry.me/hostable/)

Declaratively describe an API gateway using JSX -- routes across multiple
domains and backend services by `Host` header, on top of
[`@johnhenry/servable`](https://github.com/johnhenry/servable)'s single-app
`(Request) => Response` dispatcher.

Third package in the `fileable -> servable -> hostable` lineage:
[`fileable`](https://github.com/johnhenry/fileable) compiles JSX into
filesystem artifacts, `servable` compiles JSX into *one* app's dispatcher,
`hostable` is the layer above that -- routing across a *fleet* of apps and
backends, addressed by domain as well as path.

## Contents

- [Installation](#installation)
- [The governing rule](#the-governing-rule)
- [Primitives](#primitives)
- [Literal cross-package JSX](#literal-cross-package-jsx)
- [Adapters](#adapters)
- [Command line](#command-line)
  - [The `routes` event](#the-routes-event)
  - [Backends](#backends)
  - [Node's permission model](#nodes-permission-model)
- [Non-goals](#non-goals)
- [Adding a new primitive](#adding-a-new-primitive)
- [Examples](#examples)
- [Family](#family)
- [License](#license)

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
dependency, and `Group`/`Host`/`Route`/`Use`/`ErrorBoundary`/`NotFound`/
`Redirect`/`Response` are all re-exported from it directly, unchanged. A
gateway-level auth check, rate limit, or health-check endpoint is just
`Use`/`Route`, identical to servable.

`Host` -- the domain-axis scope this package is named after -- used to be
implemented here as a hostable-only pre-transform. It's a genuine
`@johnhenry/servable` primitive now (a real Layout-stage scope, the same
stage `Group`'s own prefix-joining, `NotFound`/`ErrorBoundary` scoping,
and `linkTo()` already live in) -- see servable's own README, "The
primitives", for the full writeup. That move fixed a real bug this
package's earlier implementation had: content mounted inside one `Host`
(a fileable tree, `Group from="glob"` file-based routing, ...) could leak
into a sibling `Host` that should never have seen it, since hostable's own
one-pass pre-transform ran *before* those later pipeline stages created
the routes it needed to qualify. See servable's CHANGELOG for the full
writeup (six independent leak points, all from the same root cause).

```tsx
<Host name="a.example.com"> ... </Host>
<Host pattern="*.example.com"> ... </Host>
```

One genuinely new primitive:

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
  on the client's behalf. `url="ipfs://<cid>/<path>"` (EXAMPLE) is also
  recognized -- see "`ipfs://` upstreams" below.
- **`app`** -- any object shaped `{fetch(request): Promise<Response>}`,
  called in-process, zero network hop. Covers a compiled
  `@johnhenry/servable` dispatcher, a `@johnhenry/dialback` `Server`
  instance, or anything else with a `.fetch` method -- genuinely uniform,
  no per-integration code needed for either.
- **`handler`** -- full escape hatch, same shape as `Route`'s `handler`.

### `ipfs://` upstreams

`url="ipfs://<cid>/<path>"` (EXAMPLE) reverse-proxies an entire
domain/prefix straight at an IPFS gateway -- the same idea as
`@johnhenry/fileable`'s `<File src="ipfs://...">` and
`@johnhenry/servable`'s `<Route src="ipfs://...">`, one layer up: instead
of resolving one file, a whole `<Upstream>` forwards everything under its
matched path.

```tsx
<Upstream path="/*" url="ipfs://bafybeigdyrzt.../" />
```

Unlike the other two layers, this can't just be "one more branch in the
same `fetch()` call" -- `fetch()` has no native `ipfs:` protocol handler
at all, so the outgoing request's URL is rewritten to a real `https://`
gateway URL (`${ipfsGateway}${cid}/${path}`) before `fetch()` ever sees
it, done fresh per request inside the same forwarding handler `url=`
already uses. Configure the gateway via `compile(tree, { ipfsGateway })`
(default: `"https://ipfs.io/ipfs/"`) -- the same option name/default/
semantics as `@johnhenry/fileable`'s `RenderOptions.ipfsGateway` and
`@johnhenry/servable`'s `CompileOptions.ipfsGateway` (re-exported/passed
straight through, since hostable's own `CompileOptions` type comes from
`@johnhenry/servable`).

Public gateways (`ipfs.io`, `dweb.link`, `w3s.link`, `nftstorage.link`)
currently return `429` for direct server-side (non-browser) fetches --
verified directly, they're migrating to service-worker-only access. Point
`ipfsGateway` at your own gateway/pinning service in production, or a
local mock in tests (see `test/upstream-url.test.ts`'s `ipfs://` cases).
There's no caching layer here either, same as `url=` in general: every
matching request re-fetches through the gateway; compose a caching `Use`
around it if that cost matters.

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
        {/* "dist" IS part of the URL -- this file serves at
            https://a.example.com/static/dist/index.html. See servable's
            README, "Mounting a fileable tree", for the full naming rule
            (including the Fragment-based way to mount without a folder
            name at all, and mounting a bare <File> -- named or not --
            with no <Dir> wrapper). */}
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

Fileable descriptors are recognized the same way here as in plain servable
-- as a child of `<Group>`/`<Router>` (or that `Group`'s own `from=`), never
as a child of `<Route>`/`<Upstream>`. Putting one under `<Route>` throws the
same clear compile-time error servable's own compile stage throws (hostable
delegates to servable's `compile()` for everything below `<Host>`, so this
isn't reimplemented here) -- use `<Route>`'s own body/`src=` handling for a
single file's content at one route instead.

### Fragments work at every layer

`<>...</>` works directly under `<Host>`/`<Gateway>` here, the same as it
does under servable's own `<Router>`/`<Group>`, and the same as fileable's
own `<>...</>` works as a mount root (see servable's README, "Mounting a
fileable tree"). All three compose in one nested tree without conflicting:

```tsx
/** @jsxImportSource @johnhenry/hostable */
import { Dir, File } from "@johnhenry/fileable";
import { Gateway, Host, Group, Route, compile } from "@johnhenry/hostable";

// A fileable Fragment is genuinely necessary here: Group's `from=` only
// ever accepts ONE value, so mounting multiple named files with no
// enclosing folder name in the URL requires bundling them into that one
// slot -- see servable's README, "Mounting a fileable tree".
const site = (
  <>
    <File name="index.html">{"home"}</File>
    <File name="about.html">{"about"}</File>
  </>
);

// A component function returning a Fragment is the OTHER place Fragment
// earns its keep: a function can only return one value, and Fragment is
// what lets that one value stand for several sibling Routes -- reusable
// across as many Hosts as you embed it in, not copy-pasted per domain.
// (`<Host>`'s own children already accept any number of direct siblings
// with no wrapping needed at all -- wrapping a FIXED list of children in
// `<>...</>` for no other reason doesn't do anything, so that's not what
// this is demonstrating.)
function CommonRoutes() {
  return (
    <>
      <Route path="/health" method="GET">{{ ok: true }}</Route>
      <Route path="/version" method="GET">{{ version: "1.0.0" }}</Route>
    </>
  );
}

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
```

`<CommonRoutes />`, capitalized -- not `<commonRoutes />`. This isn't
specific to this package: every JSX transform decides how to compile a tag
name from its capitalization alone, before any custom `jsx()` factory ever
runs -- a lowercase-starting tag always compiles to a bare string
(`jsx("commonRoutes", {})`), which this family's `jsx()` then treats as an
unrecognized markup tag and rejects (`<commonRoutes> is not a servable
primitive here`, confirmed by actually trying it); an uppercase-starting
tag compiles to a lookup of the `CommonRoutes` binding
(`jsx(CommonRoutes, {})`), which `jsx()` already has a branch for --
`typeof type === "function"` -- and calls directly. Same convention this
whole ecosystem already uses for `Dir`/`File`/`Route`/`Group`/`Host`
themselves.

hostable's own exported `Fragment` (from `@johnhenry/hostable/jsx-runtime`,
what `<>...</>` compiles to under this package's `@jsxImportSource`) is
deliberately *servable's* Fragment symbol, re-exported rather than
redefined -- hostable has no build/resolve/layout pipeline of its own (it
hands everything to servable's real `compile()`, see "Literal cross-package
JSX" above), so a genuinely distinct hostable Fragment symbol would need
servable's own `build()` to recognize it too, which it never would (each
layer's Fragment/`FILEABLE_DESCRIPTOR` detection is scoped to its own,
`Symbol.for()`-registry-keyed marker -- see servable's README's own
`Symbol.for("fileable.descriptor")` note). An earlier version of this
package *did* mint its own distinct `Symbol.for("hostable.fragment")` --
real bug, caught by actually compiling and fetching a `<>...</>` under this
pragma rather than just reasoning about the symbol keys statically: it
threw `<Symbol(hostable.fragment)> is not a servable primitive here` the
moment it was used for anything beyond being re-exported. Fixed; see
`test/fragment.test.tsx` for the regression coverage (both the standalone
case and the fileable/hostable-Fragments-composed-together case above).

## Inspecting the compiled tree

`compile(tree, options)` is `lower(tree, options)` followed by
`@johnhenry/servable`'s own `compile()` -- `lower()` runs just the first
half: hostable's `Gateway`/`Upstream`/raw-Fetch pre-transform, without
handing the result off for dispatching. It returns the same real servable
descriptor tree (`Router`/`Route`/`Host`/`Group`/...) `compile()` would
compile from, so a tool can inspect what a gateway actually resolves to --
which routes exist, how `Host`/`Group` nest, how many `Route`s a
method-less `<Upstream>` expanded into -- without reimplementing this
file's own transform rules:

```ts
import { Gateway, Host, Upstream, lower } from "@johnhenry/hostable";
import { isDescriptor } from "@johnhenry/hostable";

const tree = Gateway({
  children: Host({ name: "a.example.com", children: Upstream({ path: "/*", url: "https://backend/" }) }),
});

const lowered = lower(tree);
// lowered is a real servable Descriptor tree: {tag, props, children}.
```

`lower()` takes the same `ipfsGateway` option `compile()` does (via
`LowerOptions`, a strict subset of `CompileOptions`) since `Upstream`'s
`url="ipfs://..."` handler is built during this pre-transform, before
servable's own `compile()` -- and its own use of `ipfsGateway` -- ever runs.

## Adapters

Thin re-exports of servable's own -- hostable's compiled output IS a
servable-compiled dispatcher:

```ts
import { serve } from "@johnhenry/hostable/adapters/node";
const handle = serve(compiled, { port: 3000 });
```

## Command line

`hostable serve <module>` runs a gateway, and `hostable routes <module>`
lists what it answers. Together they're the interface a supervisor (such as
Sitefile Desktop's `*.localhost` name router) drives hostable through.
Node only.

The module default-exports the compiled gateway and doesn't call `serve()`
itself:

```tsx
/** @jsxImportSource @johnhenry/hostable */
import { Gateway, Host, Route, compile } from "@johnhenry/hostable";
export default await compile(
  <Gateway>
    <Host name="www.localhost"><Route path="/">Hello</Route></Host>
  </Gateway>,
);
```

```sh
npx hostable routes dist/gateway.js --json
npx hostable serve dist/gateway.js --port 0 --json --watch
```

`hostable serve` is `servable serve`'s own runtime
([`@johnhenry/servable/cli`](https://github.com/johnhenry/servable#embedding-the-cli-johnhenryservablecli))
with hostable's hooks, so it follows the same contract as
[`servable serve`](https://github.com/johnhenry/servable#command-line):
the same options (`--port`/`--port 0`, `--host`, `--json`, `--watch`,
`--watch-path`, `--public-url`, `--trust-proxy`, `--drain-timeout`), the
same NDJSON envelope (`{"v":1,"event":…,"time":…}`) and events (`ready`,
`request`, `reloading`, `warning`, `error`, `stopping`, `stopped`), the
same SIGTERM/SIGINT drain, and the same exit codes. Point it at JavaScript,
not `.tsx`. See [`examples/07-serve-cli`](./examples/07-serve-cli/gateway.tsx).

| Exit | Error codes | Meaning |
| --- | --- | --- |
| 0 | | Stopped by SIGTERM/SIGINT (or `routes` succeeded). |
| 1 | `E_INTERNAL` | Unexpected error, or an uncaught exception after start. |
| 2 | `E_USAGE` | Bad command line. |
| 3 | `E_MODULE_NOT_FOUND`, `E_MODULE_LOAD`, `E_NOT_AN_APP` | The module is missing, threw while loading, or its default export isn't a compiled app. Under `--watch` these aren't fatal: the server starts anyway and serves a 500. |
| 4 | `E_LISTEN` | Couldn't listen (`errno`, e.g. `EADDRINUSE`). |
| 5 | `E_ACCESS_DENIED` | Node's permission model refused something. |
| | `E_REQUEST`, `E_UPSTREAM` | Never fatal: a handler threw (500), or a `url=` backend was unreachable (502) or hit its `timeout=` (504). |

### The `routes` event

hostable adds one event. `serve --json` emits it after every successful
load, before `ready`. `routes --json` prints it as its only line and exits
without listening.

```json
{"v":1,"event":"routes","time":"…",
 "hosts":[
   {"hostname":"www.localhost","pattern":false,"routes":[
     {"path":"/","methods":["GET"],"kind":"static","params":[],"hasParams":false,"prefix":""},
     {"path":"/home","methods":["*"],"kind":"redirect","params":[],"hasParams":false,"prefix":"","redirect":"/","status":301}],
    "notFoundPrefixes":[]},
   {"hostname":"api.localhost","pattern":false,"routes":[
     {"path":"/v1/*","methods":["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"],"kind":"handler","params":[],"hasParams":true,"prefix":""}],
    "notFoundPrefixes":[]},
   {"hostname":"*","pattern":true,"routes":[
     {"path":"/","methods":["GET"],"kind":"static","params":[],"hasParams":false,"prefix":""}],
    "notFoundPrefixes":[]}],
 "backends":[{"hostname":"api.localhost","path":"/v1/*","url":"http://127.0.0.1:3021/","methods":["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"]}],
 "notFound":false,"complete":true}
```

It's the same structure as `servable serve --json`'s `routes` event
(servable#21; servable's README "Listing routes" has the full field
table), with `backends` filled in. An app's routes and a gateway's read
the same way.

- `hosts[].hostname` is a `<Host name>`, a `<Host pattern>` (`pattern:
  true`, URLPattern hostname syntax such as `*.example.com`), or `*` for
  routes outside any `<Host>`. Register the literal names with your name
  router. A pattern or `*` needs a wildcard rule or a fixed name of your
  choosing.
- `routes[].path` uses URLPattern pathname syntax, Group prefixes
  included. The list comes from servable's own Layout stage, so mounted
  fileable trees and `Group from=` routes are included. A Group's own
  `path="/"` route is listed at the prefix (`/api`).
- `routes[].kind` is `handler` (an `<Upstream>` of any kind is one),
  `static`, `src`, `redirect` or `mount`; `params`/`hasParams` say whether
  the path is a pattern; `prefix` is the Group prefix applied. Redirects
  have `redirect` and `status`.
- `hosts[].notFoundPrefixes` and `notFound` say where a `<NotFound>`
  answers unmatched requests.
- `complete: false` (with an `E_ROUTES_UNKNOWN` warning from `routes`)
  means the default export can't describe itself: it wasn't made by
  hostable's `compile()` or servable >= 0.3's. An app compiled by servable
  directly is listed, with `backends: []`.

The same report is available in code: `await compiled.describeRoutes()` (a
non-enumerable method on what `compile()` returns; it reads the table
`compile()` already built), or `describeRoutes(tree)`. Both need
`@johnhenry/servable` 0.3.0 or later.

### Backends

hostable doesn't start, stop or health-check the processes behind
`<Upstream url=…>`. It lists them as `backends` in the `routes` event. The
supervisor owns them:

1. Read `backends` from `routes`, then start each local backend and wait
   until it's healthy (your own check: hostable has no health endpoint
   convention).
2. Start or keep `hostable serve` running. Order doesn't matter: a request
   to a backend that isn't up gets a **502** and a non-fatal `error` event
   with `code: "E_UPSTREAM"`, `errno` (e.g. `ECONNREFUSED`), `address` and
   `port`, so you can see which backend to restart. A `timeout=` that runs
   out gets a **504** with the same code.
3. Restart backends independently. The gateway holds no connection state
   for them; the next request just works.

`app=` and `handler=` upstreams run in the gateway's own process and aren't
listed as backends.

### Node's permission model

Like `servable serve`: `--allow-fs-read` covering the project (the module,
its imports, and `node_modules`), plus `--allow-net` to listen. The same
`--allow-net` also covers forwarding to `url=` backends; Node 26 has no
per-host network permission. `hostable routes` needs only the read access.
Neither command needs `--allow-fs-write` or `--allow-child-process`.

```sh
node --permission --allow-fs-read="$PWD" --allow-net \
  node_modules/@johnhenry/hostable/dist/src/cli.js serve dist/gateway.js --port 0 --json
```

## Non-goals

- Not a service mesh, not pod discovery, not sidecar injection --
  `browsermesh`'s domain, not duplicated here.
- No built-in TLS/cert management -- delegate to the adapter/runtime.
- No backend process management: `hostable serve` doesn't start, stop or
  health-check `url=` backends. It reports them and returns 502/504 when
  they're down (see "Backends").
- No hot module replacement: `--watch` re-imports the gateway on change,
  like `servable serve --watch`.
- No built-in load balancing/health checks/circuit breaking in v1 --
  `Upstream` stays single-target; `handler=` covers custom multi-target
  logic without a new primitive.
- No built-in caching layer (same Fetch `Cache` API portability reasoning
  servable already used to reject one).
- No built-in DNS/Consul-style service discovery -- `url=`/`app=` are
  static per compile; `handler=` is the dynamic-resolution escape hatch.

## Adding a new primitive

This package only has one new leaf (`Upstream`) plus the reused
`Gateway` root -- most capability growth here isn't a new *primitive* at
all, it's a new *forwarding mechanism* on `Upstream` itself (a new
`url=` scheme, a new backend shape for `app=`). The real worked example
in this package's own history is `url="ipfs://<cid>/<path>"` support
(see CHANGELOG's "Unreleased" entry), which is the right template
because it's the harder of the two cases: unlike `https://` (already
just `fetch()`), `ipfs:` has no native `fetch()` protocol handler at
all, so it can't be "one more branch inside the same call" the way
`@johnhenry/fileable`'s `loadSrc()` and `@johnhenry/servable`'s
`resolveAsset()` handle their own `ipfs://` support. It touches:

1. **`src/forward.ts`** -- `rewriteIpfsUrl(target, gateway)` translates
   `ipfs://<cid>/<path>` into a real `${gateway}<cid>/<path>` URL
   *before* `fetch()` ever sees it. `createUrlUpstream()` checks
   `targetUrl.protocol === "ipfs:"` and rewrites up front, done fresh
   per request inside the same forwarding handler `url=` already builds
   -- not a compile-time rewrite, since the target is only known once a
   request actually arrives. `DEFAULT_IPFS_GATEWAY` mirrors
   `@johnhenry/fileable`/`@johnhenry/servable`'s own default
   (`"https://ipfs.io/ipfs/"`).
2. **`src/compile.ts`'s `TransformCtx`** -- gained an `ipfsGateway?:
   string` field, threaded through `transformChildren()`/
   `transformUpstream()` down to `resolveUpstreamHandler()` the same way
   `pathPrefix` already is. This is the one part that isn't boilerplate:
   `Upstream` handlers (including any `url="ipfs://..."` forwarding
   target) are built during hostable's own pre-transform, which runs
   *before* servable's own `compile()` -- and therefore before
   servable's own `ipfsGateway` option would normally apply -- so the
   option has to be threaded down through this package's private
   `TransformCtx` explicitly rather than picked up for free. No new type
   was needed for the public option itself: `CompileOptions` is imported
   directly from `@johnhenry/servable` (`compile(tree, options:
   CompileOptions)`), so `options.ipfsGateway` was already there: only
   `compile()`'s own `rootCtx` construction needed the one extra field
   (`{ pathPrefix: "", ipfsGateway: options.ipfsGateway }`).
3. **Real tests against a local mock gateway, not a live one**
   (`test/upstream-url.test.ts`) -- a real `node:http` server stands in
   for the gateway (`http.createServer(handler)`), because every major
   public IPFS gateway (`ipfs.io`, `dweb.link`, `w3s.link`,
   `nftstorage.link`) currently rejects direct server-side fetches with
   `429`, confirmed by direct `curl` testing, not assumed. Three cases:
   the happy path (`Group prefix` stripped first, then forwarded through
   `${baseUrl}/ipfs/<cid>/...`), a fixed base path joined with the
   forwarded request path, and a real gateway error (missing CID)
   surfacing as-is rather than being swallowed.

No `types.ts`/`jsx-runtime.ts`/`components.ts` changes at all for this
one, since it's a new *behavior* inside an existing leaf's existing
`url=` prop, not a new tag -- contrast with `@johnhenry/servable`'s own
"Adding a new primitive" section (a genuinely new tag, `Host`, which
*does* touch `RESERVED_TAGS`/`StructuralTag`/a new factory) for when a
new primitive is warranted instead.

## Examples

See [`examples/`](./examples) (and its own
[`examples/README.md`](./examples/README.md) index):

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

## Family

hostable is the third package in the `fileable -> servable -> hostable`
lineage, and also the gateway other family packages plug backend traffic
into.

- **[`@johnhenry/servable`](https://github.com/johnhenry/servable)** --
  a real, direct dependency: `Group`/`Host`/`Route`/`Use`/`ErrorBoundary`/
  `NotFound`/`Redirect`/`Response` are all re-exported from servable
  unchanged, and this package's own `compile()` delegates to servable's
  `compile()` for everything below `<Host>`. `Host` itself -- the
  domain-axis scope this package is named after -- lives in servable's own
  Layout stage, not here (see servable's README, "Adding a new primitive",
  for the bug that move fixed).
- **[`@johnhenry/fileable`](https://github.com/johnhenry/fileable)** --
  no direct dependency; fileable content reaches a hostable gateway
  transitively, through servable's own mount support (a `<Dir>`/`<File>`
  tree nested inside `<Group>`, itself nested inside `<Host>`/`<Gateway>`
  -- see "Literal cross-package JSX" above, and `examples/05-nested-jsx`
  for all three layers in one expression).

Neither of the two integrations below gets hostable-specific code -- both
plug in through `Upstream`'s existing `app=`/`handler=` mechanism, though
not identically: `dialback`'s export already satisfies `FetchLike`
directly; `browsermesh`'s two exports don't, so they go through two small,
generic adapters instead (not browsermesh-specific themselves -- see
below).

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

## License

MIT
