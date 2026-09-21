# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project will adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches 1.0.0.

## [Unreleased]

### Added

- Initial release: `Gateway`, `Upstream` primitives (this package's own);
  `Group`/`Host`/`Route`/`Use`/`ErrorBoundary`/`NotFound`/`Redirect`/
  `Response` re-exported directly from `@johnhenry/servable` -- `Host`
  itself now lives in servable's own Layout stage rather than being
  implemented here (see the "Fixed" entry below for why), so this
  package's own compile step only ever rewrites `Gateway`/`Upstream`/a
  raw Fetch-shaped child.
- `Upstream`'s `url=`/`app=`/`handler=` forwarding, with hop-by-hop header
  stripping (RFC 9110 §7.6.1), Group/Host prefix stripping, and
  redirect passthrough for the `url=` case.
- Mounting a Fetch-shaped backend (a compiled servable app, a `dialback`
  `Server`) as a raw JSX child, no `Upstream` wrapper needed -- detected
  via `typeof value.fetch === "function"` duck-typing.
- Literal cross-package JSX support from day one (`Tag = StructuralTag |
  symbol | string`) -- servable's own `<Route>`/`<Group>` can be written
  literally inside `<Gateway>`/`<Host>`, and this goes a layer deeper:
  fileable's `<Dir>`/`<File>` nested inside servable's `<Group>` nested
  inside hostable's `<Host>`, three packages in one JSX expression under
  one pragma -- verified for real (`examples/05-nested-jsx`), not just
  reasoned about from the pairwise cases.
- `fromFetchFn()`/`fromNullableRouter()` (`src/adapt.ts`): two small,
  generic adapters from "almost FetchLike" shapes into the real thing --
  a bare `fetch(url, init)`-shaped function, and a `(req) =>
  Promise<Response|null>` nullable router (the Service-Worker-interceptor
  convention). Not browsermesh-specific, but that's exactly what
  `@johnhenry/browsermesh-apps`' `createBrowserMeshFetch()` and
  `@johnhenry/browsermesh-discovery`'s `MeshFetchRouter#route()` need --
  neither satisfies `FetchLike` as-is (confirmed by reading their source).
  Verified against real browsermesh packages: two real Ed25519-identified
  peers, a real `mesh-rpc` round trip, both adapters exercised end-to-end
  through a compiled `Gateway` (`test/browsermesh-adapt.test.ts`,
  `examples/06-browsermesh`).

- `url="ipfs://<cid>/<path>"` (EXAMPLE) on `Upstream`: reverse-proxies an
  entire domain/prefix straight at an IPFS gateway, the same idea as
  `@johnhenry/fileable`'s `<File src="ipfs://...">` and
  `@johnhenry/servable`'s `<Route src="ipfs://...">` one layer up. Unlike
  those two, `fetch()` has no native `ipfs:` protocol handler at all, so
  this can't be "one more branch in the same fetch call" -- the outgoing
  request's URL is rewritten to a real `https://` gateway URL
  (`${ipfsGateway}${cid}/${path}`) before `fetch()` ever sees it, done
  fresh per request in `forward.ts`'s `createUrlUpstream` (mirroring
  servable's own per-request `resolveAsset()`, not fileable's
  resolve-once-at-compile-time model). Configured via `compile(tree, {
  ipfsGateway })`, same option name/default (`"https://ipfs.io/ipfs/"`)
  as the other two layers -- `CompileOptions` is imported directly from
  `@johnhenry/servable`, so the type was already available here, just not
  yet threaded through this package's own pre-transform. Verified against
  a real local `node:http` mock gateway, not a live public one: direct
  `curl` testing confirmed `ipfs.io`/`dweb.link`/`w3s.link`/
  `nftstorage.link` currently 429 direct server-side fetches (see
  `test/upstream-url.test.ts`'s `ipfs://` cases).

### Fixed (in this package itself)

- **`Group`'s own transform silently dropped `ipfsGateway` from the
  context it passes to its children.** `transformChild`'s `"group"` case
  builds a fresh `TransformCtx` for everything nested inside it (to
  accumulate the prefix), but constructed it as `{ pathPrefix }` only --
  any `Upstream url="ipfs://..."` nested inside a `Group` silently fell
  back to the default public gateway instead of the one passed to
  `compile(tree, { ipfsGateway })`, regardless of `Group` nesting depth.
  Caught by a real failing test (a local mock gateway server that should
  never have been reachable getting bypassed in favor of a real `429`
  from the live default), not by reasoning about the transform in the
  abstract. Fixed by carrying `ctx.ipfsGateway` through both places that
  construct a new `TransformCtx` (`"group"` and `"gateway"`, the tree
  root) instead of just the one (`"gateway"`) added first.

- **`Host` moved into `@johnhenry/servable` itself, fixing a real cross-
  domain content leak.** `Host` was originally implemented entirely in
  this package, as a one-pass pre-transform run *before* handing the tree
  to servable's own `compile()`. That meant any route created by a LATER
  servable pipeline stage -- a mounted fileable tree, `Group from="glob"`
  file-based routing, a promise-valued `path`, a literal `<Router>` nested
  inside a `<Host>` -- simply didn't exist yet when hostable's transform
  ran, so it was never hostname-qualified at all. Confirmed empirically,
  not just reasoned about: a `<Host>` that should only reverse-proxy
  elsewhere via `Upstream` was ALSO serving a sibling `<Host>`'s mounted
  static files at the same path. Two more real breakages shared the same
  root cause: a bare `path="/"` under a `Group` inside a `Host` incorrectly
  404'd (hostable's own path-joining never replicated servable Layout's
  trailing-slash handling), and `linkTo()` threw for any route inside a
  `Host` (hostable's rewrite produced a new descriptor object, breaking
  the descriptor-identity lookup `linkTo()` relies on). Fixed by moving
  `Host` into servable's own Layout stage -- the stage that runs *after*
  every other stage has finished expanding the tree, and already owns
  `Group`'s prefix-joining, `NotFound`/`ErrorBoundary` scoping, and
  `linkTo()`. This package's own `Host` is gone; `@johnhenry/servable`'s
  `Host` is re-exported directly instead (same as `Group`/`Route`/etc.),
  and `compile.ts` shrank to strictly leaf-local rewrites (`Gateway`,
  `Upstream`, a raw Fetch-shaped child) plus `Upstream`'s own runtime
  prefix-stripping, which is a genuinely different, request-time concern
  from how the match pattern gets compiled. See servable's own CHANGELOG
  for the full six-leak enumeration, and `test/host.test.ts` here for the
  end-to-end regression (a real mounted fileable tree, a real sibling
  `Host` with a real `http.createServer` reverse-proxy target, proving the
  leak is gone against a real compiled gateway and real `fetch()` calls).
- `<>...</>` (Fragment) written under this package's own
  `@jsxImportSource @johnhenry/hostable` pragma threw
  `<Symbol(hostable.fragment)> is not a servable primitive here` the
  moment it was actually used for anything beyond being re-exported --
  this package minted its own, distinct `Symbol.for("hostable.fragment")`,
  but has no build/resolve/layout pipeline of its own (everything below
  `<Host>` is handed to servable's real `compile()`), and servable's own
  `build()` only ever flattens its *own* Fragment symbol. Found by actually
  compiling and fetching a `<>...</>`-containing tree, not by reasoning
  about the `Symbol.for()` keys statically. Fixed by making hostable's
  `FRAGMENT` deliberately the *same* symbol as servable's own (re-exported,
  not redefined) -- see `types.ts`'s `FRAGMENT` doc comment, and the
  README's "Fragments work at every layer" section.

### Fixed (while building this package, in its dependencies)

- `@johnhenry/dialback@0.0.1`: `package.json`'s `exports["."]` had no
  `types` condition, breaking type resolution under `moduleResolution:
  "NodeNext"`.
- `@johnhenry/dialback@0.0.1`: the Node.js README example passed a raw
  `IncomingMessage` directly to `Server#fetch()`, which throws --
  `unBoundFetch()` requires a real `Request` instance or a URL string.
- `@johnhenry/dialback@0.0.2`: `Server`/`Agent` were declared as plain
  `interface`s (no construct signature) despite being real, constructable
  classes at runtime -- `new Server(...)` failed to type-check. Also
  removed `createServer`/`createAgent`, phantom factory-function
  declarations with no corresponding real export.
- `@johnhenry/dialback@0.0.3`: `Server`'s `defaultHandler` and
  `AgentOptions.abort` were typed as synchronous-only, but the runtime
  already accepts async handlers.
- `@johnhenry/browsermesh-apps@0.5.0`: added subpath exports (`./mesh-rpc`,
  `./mesh-fetch`, `./mesh-service`, `./peer-registry`) so a consumer
  needing only the mesh-rpc layer isn't forced to import the top-level
  `.` entrypoint, which `export *`s from 70+ modules including an eager,
  unconditional `@johnhenry/browsermesh-transport` import -- despite that
  peer dependency being declared `optional: true`. This repo's own
  `test/browsermesh-adapt.test.ts`/`examples/06-browsermesh` now import
  via these subpaths and no longer need the six extra devDependencies
  (`browsermesh-primitives`/`-transport`/`-sync`/`-kernel`/`-netway`,
  `andbox`) that were only ever needed to satisfy the old eager import.
  (Also: `PeerRegistry` was already public, in `browsermesh-apps` --
  not `browsermesh-core` as this file previously, incorrectly, said.)

### Known v1 limitations

- `dialback`'s `Server#fetch()` has no way to target one specific
  connected agent by ID -- use one dedicated `Server` instance per
  `Upstream` that needs a specific agent.
