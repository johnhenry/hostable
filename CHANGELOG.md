# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project will adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches 1.0.0.

## [0.2.0] - 2026-11-11

### Added
- **[#22] `E_UPSTREAM` names the backend and the request.** A failed `<Upstream url=>` fetch's `error` event now also has `backend` (that Upstream's entry in the `routes` event's `backends`: `hostname`, `path`, `url`, `methods`), `status` (502, or 504 on `timeout=`), and the gateway request's `method` and `path`. Additive in schema `v: 1`. The details travel on the failed fetch's own error, so concurrent requests to different backends are each attributed correctly; a supervisor no longer pairs `E_UPSTREAM` with the next 502/504 `request` event or matches `address`/`port` (which a timeout or DNS failure doesn't have). The `request` event itself is unchanged (servable writes it), and a `handler=`/`app=` upstream's own failed `fetch()` gets `status` but no `backend`. README: "The `E_UPSTREAM` event".
- **[#19] Every example answers `/`.** Each gateway ends with a host-agnostic `<Route path="/">` index of what it serves (hosts, paths, the `curl -H` to try), so opening `http://localhost:<port>/` lands somewhere instead of on a 404. `04-full-stack`'s mounted servable app gets its own `/` too, since that host's requests never reach the gateway's fallback. `03-dialback-tunnel` already answered `/` (an any-host `<Upstream path="/*">`). Part of johnhenry/sitefile-desktop#154.

### Changed
- **[#19] The `routes` event and `hostable routes` use servable's route report (servable#21), so a gateway's routes and an app's have one structure.** It's additive: every field from #11 stays (`hosts[].hostname`/`pattern`/`routes[].path`/`methods`/`redirect`, `backends`, `complete`). Each route gains `kind`, `params`, `hasParams`, `prefix` and, for redirects, `status`; each host gains `notFoundPrefixes`; the report gains `notFound`. One value is different: a Group's own `path="/"` route used to be listed as its match pattern (`/api{/}?`) and is now listed at its canonical path (`/api`), which is a link a UI can open.
- **[#19] The code is servable's now.** `routesCommand`, `routesFields` and `formatRoutesHuman` call `@johnhenry/servable/cli`'s, with hostable's label, usage and `E_ROUTES_UNKNOWN` message, and `describeRoutes(tree)` is servable's on the lowered tree plus `backends`. `compile()`'s `describeRoutes()` reads the table servable's `compile()` already built, rather than running Build/Resolve/Layout again on every `serve` load. The exports and the human output are unchanged. `hostable routes --help` gains an options list.
- **[#19] `hostable routes` lists an app compiled by servable >= 0.3 directly** (`complete: true`, `backends: []`). Before, that was `complete: false`.
- **[#19] `@johnhenry/servable` range raised to `>=0.3.0 <0.4.0`**, the first release with the route report.

## [0.1.1] - 2026-11-10

### Changed
- **[#13] The CLI runs servable's serve runtime, `@johnhenry/servable/cli` (servable#17), instead of a hand-kept copy.** `src/serve-cli.ts` is deleted. hostable's parts are `RunHooks` in `src/hostable-cli.ts`:
  - the `routes` event and its human rendering
  - `E_UPSTREAM` (502/504) through `requestError` and `errorCodes`
  - the `hostable` label and usage, the `hostable-reload` reload parameter, "the gateway failed to load" on the 500 page, and the `<Gateway>` hint in `E_NOT_AN_APP`

  The output of `hostable serve` and `hostable routes` doesn't change. `test/serve-cli.test.ts` now also pins those strings, the human `routes` block and `E_UPSTREAM` 502/504, and the same suite passes against the old copy. `serve` also picks up servable#15: listen errors come from the server's error event, and connections still open after the drain timeout are force-closed. Events and exit codes are unchanged.
- **[#13] `@johnhenry/servable` range raised to `>=0.2.0 <0.3.0`**, the first release with `./cli`.

## [0.1.0] - 2026-11-10

### Added

- **[#11, #12] `hostable serve <module>` and `hostable routes <module>`: a CLI for running a gateway under a supervisor (Node only).** `serve` follows `servable serve`'s contract (servable#13): `--port`/`--port 0`, `--host`, `--json` NDJSON events with a `v` schema version, the same error and exit codes, graceful SIGTERM/SIGINT drain, `--watch` with a 500 while broken, and `--public-url`/`--trust-proxy`. hostable adds a `routes` event (every hostname, path and method, plus the `url=` backends) emitted before each `ready`, the `routes` command that prints it without listening, and `E_UPSTREAM` (502, or 504 on `timeout=`) for unreachable backends. The CLI runtime (`src/serve-cli.ts`) is a copy of servable's, so this doesn't need a servable release.
- **[#11, #12] `describeRoutes(tree)` and a non-enumerable `describeRoutes()` on what `compile()` returns** (new `HostableCompileResult` type). They run servable's Layout on a copy of the lowered tree, so mounted and glob routes are listed too. Needs `@johnhenry/servable` >= 0.0.3 (the lockfile resolves 0.1.0, see #14; the range floor is still 0.0.2).
- **[#11, #12] Backend lifecycle contract, documented in README "Backends":** the supervisor starts and health-checks backends, and hostable reports them and returns 502/504 when they're down.

### Changed

- **[#14] `@johnhenry/servable` dependency range widened to `>=0.0.2 <0.2.0`** (was `<0.1.0`), so installs can get servable 0.1.0. The lockfile now resolves 0.1.0; the test suite, all seven examples and the `hostable` CLI (`routes`, `serve`, `serve --json --watch` under `--permission`, SIGTERM drain) pass against it. The CLI is still hostable's own copy (#13).
- **[#11, #12] `@johnhenry/leserve` is now a regular dependency** (it was a dev dependency). The CLI serves through servable's Node adapter, which needs it. It isn't loaded by the main entry.

## [0.0.2] - 2026-09-26

### Fixed

- **`@johnhenry/servable` dependency pinned to exactly `0.0.2`, causing a
  nested duplicate install** ([#7](https://github.com/johnhenry/hostable/issues/7)).
  `^0.0.2` only resolves to exactly `0.0.2` for a pre-1.0 `0.0.x` version (the
  same npm semver quirk #5's own fix noted for `fileable`) -- once the
  registry had `@johnhenry/servable@0.0.3`, a consuming site that already
  depended on `servable@0.0.3` elsewhere got a second, nested
  `node_modules/@johnhenry/hostable/node_modules/@johnhenry/servable@0.0.2`
  instead of deduping onto the one already installed. Widened to
  `>=0.0.2 <0.1.0` (the issue's own suggested form) so future `0.0.x`
  servable patches dedupe correctly without needing a release here just to
  bump the pin. Applied the same widening to the `@johnhenry/fileable`,
  `@johnhenry/dialback`, and `@johnhenry/browsermesh-discovery`
  devDependencies, which had the identical latent `0.0.x`-caret trap even
  though none had actively broken yet. Verified by installing
  `@johnhenry/servable@0.0.3` directly and confirming `npm ls
  @johnhenry/servable` shows one deduped entry, not a nested duplicate.

### Added

- **`lower(tree, options?)`**, exported alongside `compile()` -- runs just
  hostable's own `Gateway`/`Upstream`/raw-Fetch pre-transform and returns
  the resulting real servable descriptor tree, without handing it to
  servable's own `compile()` ([#7](https://github.com/johnhenry/hostable/issues/7)'s
  second ask). Lets a tool inspect what a gateway resolves to -- routes,
  `Host`/`Group` nesting, how many `Route`s a method-less `<Upstream>`
  expanded into -- without reimplementing this package's own transform
  rules. `compile()` itself is now just `lower()` followed by
  `servableCompile()`, not a separate code path. See "Inspecting the
  compiled tree" in the README.

## [0.0.1] - 2026-09-27

### Fixed

- **`compile.ts` imported `node:path/posix`, blocking browser bundling**
  ([#5](https://github.com/johnhenry/hostable/issues/5)). Used once, in the
  `<Group>` case, to join `ctx.pathPrefix` with a group's own `prefix` prop
  for `TransformCtx.pathPrefix` tracking (a runtime concern for
  `Upstream`'s path-prefix stripping in `forward.ts`, not route matching) --
  the only Node-only import anywhere in `src/`/`adapters/`, but enough to
  break a browser bundle on its own. Added a small, dependency-free
  `src/posix.ts` (copied from `@johnhenry/servable`'s own, added there for
  the identical reason in #7 -- not imported directly, since it isn't part
  of servable's public exports and duplicating ~100 lines of stable,
  already-tested logic was simpler than adding a new subpath export to a
  sibling package for one function) and swapped `compile.ts` to use it.
  Verified with a real bundler (esbuild, `platform: "browser"`) against the
  packed tarball, matching how #7 verified servable's own fix; a negative
  control confirmed the check fails with `Could not resolve
  "node:path/posix"` against the pre-fix code.
- Bumped the `@johnhenry/servable` dependency range to `^0.0.2` (the first
  version with servable's own browser-safe variants) and
  `@johnhenry/fileable` to `^0.0.4` (needed to satisfy servable 0.0.2's own
  `>=0.0.3` peer range -- `^0.0.2` only resolves to exactly `0.0.2` for a
  pre-1.0 `0.0.x` version, an easy-to-miss npm semver quirk).

## [0.0.0] - 2026-09-22

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
