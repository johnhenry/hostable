# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project will adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches 1.0.0.

## [Unreleased]

### Added

- Initial release: `Gateway`, `Host`, `Upstream` primitives; `Group`/
  `Route`/`Use`/`ErrorBoundary`/`NotFound`/`Redirect`/`Response`
  re-exported directly from `@johnhenry/servable`. Host-based routing
  compiles to a raw `URLPattern` instance (hostname + pathname), reusing
  servable's existing "accepts a raw URLPattern for `path`" escape hatch
  -- no changes needed to servable's own dispatch engine.
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

- `NotFound`/`ErrorBoundary` scope resolution is keyed purely by
  servable's own pathname-based scope, not by `Host` -- two sibling
  `Host`s at the same path scope share one `NotFound`/error boundary
  unless also separated by a real `Group prefix`.
- Only `Route`/`Upstream` get hostname-qualified matching; `Redirect`
  does not.
- `dialback`'s `Server#fetch()` has no way to target one specific
  connected agent by ID -- use one dedicated `Server` instance per
  `Upstream` that needs a specific agent.
