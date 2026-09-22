# Agent playbook

`@johnhenry/hostable` — declaratively describe an API gateway using JSX,
routing across multiple domains and backend services by `Host` header, on
top of `@johnhenry/servable`'s single-app dispatcher. Single package,
Node >= 26, `node --test` via `scripts/run-tests.mjs` (`npm test`), builds
to `dist/` via `tsc` (`npm run build`). Third package in the
`fileable -> servable -> hostable` lineage; most capability here is reused
directly from servable (`Group`/`Host`/`Route`/`Use`/`ErrorBoundary`/
`NotFound`/`Redirect`/`Response` are re-exports), so changes usually touch
either `Gateway`/`Upstream` (this package's own two primitives) or an
adapter in `adapters/`.

`CLAUDE.md` in this directory is a symlink to this file.

## The verification loop (before every push)

1. `npm run build` — `tsc -p tsconfig.json`; compiles `src/`, `adapters/`,
   `test/`, and `examples/**/*.{ts,tsx}` together (examples are typechecked,
   not just src).
2. `npm test` — `pretest` reruns the build first, then
   `node --test scripts/run-tests.mjs`. No suite here is allowed to SKIP.
3. `npm pack --dry-run` — read the file list, not just the exit code.
4. A genuinely fresh clone:
   `git clone . /tmp/hostable-verifyN && cd $_ && npm ci && npm run build && npm test`.
   This is the only way to catch "works on my checked-out tree" bugs
   (missing `files` entries, undeclared deps — `@johnhenry/dialback` and
   the `browsermesh` packages are dev-time integration examples, not
   runtime deps of the library itself; don't let an example accidentally
   promote one to a real dependency).
5. Run an example after building: `npm run build && node dist/examples/01-multi-domain/server.js`,
   then hit it with `curl -H "Host: ..."` per that example's own header
   comment.
6. Commit, push, close the issue with a comment naming the commit SHA.

CI (`.github/workflows/ci.yml`) runs build then test in that order; match it
locally.

## Repo-specific gotchas

- **`Host` lives in `@johnhenry/servable` now, not here.** It used to be a
  hostable-only pre-Build tree rewrite; that leaked content across sibling
  `<Host>`s because anything created by a *later* pipeline stage (a mounted
  fileable tree, `Group from="glob"`) was invisible to the rewrite. It's a
  real servable Layout-stage primitive now — don't reintroduce a
  hostable-local `Host` implementation to "fix" something; the fix already
  lives one layer down. See servable's README, "Adding a new primitive".
- **`Upstream`'s `url=`/`app=`/`handler=` are mutually exclusive** — setting
  more than one throws. A new backend shape for `app=` (matching
  `{fetch(request): Promise<Response>}`) never needs `Upstream`-specific
  code; a shape that *doesn't* satisfy `FetchLike` as-is needs a small,
  generic adapter (`fromFetchFn`/`fromNullableRouter` are the precedent —
  not integration-specific, just shape-specific).
- **This package has no build/resolve/layout pipeline of its own below
  `<Host>`.** It hands everything to servable's real `compile()`. Its own
  exported `Fragment` is deliberately *servable's* Fragment symbol,
  re-exported rather than redefined — minting a distinct one broke Fragment
  composition under this package's own pragma (real bug, fixed; see
  `test/fragment.test.tsx`). Don't reintroduce a hostable-local
  `Symbol.for(...)` for anything servable already has a marker for.

## Definition of done

A change is done when all of the following hold, not just when tests pass:

- A regression test exists for any bug fixed.
- Anything the feature does **not** do is stated in the README's
  "Non-goals" or the relevant section, not only in an issue comment.
- `CHANGELOG.md` has an entry citing the commit/PR.
- A new forwarding mechanism on `Upstream` (a new `url=` scheme, a new
  `app=` backend shape) follows README's "Adding a new primitive" section's
  worked example (`ipfs://` upstreams); a genuinely new primitive follows
  the same four-touchpoint checklist `@johnhenry/servable`'s own section
  documents.

## Non-goals

See README's "Non-goals": not a service mesh, no pod discovery/sidecar
injection (that's `browsermesh`'s domain), no built-in TLS/cert management,
no built-in load balancing/health checks/circuit breaking in v1, no
built-in caching layer, no built-in DNS/service discovery.

## Releases

Bump `version` in `package.json` in a PR, add the `CHANGELOG.md` entry, merge,
then `gh release create v<version>` — the release event triggers
`.github/workflows/publish.yml`, which is idempotent (skips if the version is
already on npm).
