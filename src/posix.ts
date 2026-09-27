/**
 * A tiny, dependency-free reimplementation of the one `node:path/posix`
 * function this package's compile step needs: `join`. Pure string
 * manipulation -- no filesystem access, no platform detection -- so it
 * behaves identically in Node, browsers, Deno, Bun, and Cloudflare
 * Workers. compile.ts's `<Group>` case only ever joins path-prefix
 * strings for `TransformCtx.pathPrefix` tracking (used by `Upstream`'s
 * runtime path-prefix stripping in forward.ts, never real OS filesystem
 * paths), so this is deliberately posix-only, not a general node:path
 * polyfill.
 *
 * Copied from `@johnhenry/servable`'s own `src/posix.ts` (added there for
 * the identical reason -- see servable's #7), rather than importing it:
 * this package already depends on servable directly, but its posix
 * helpers aren't part of servable's public exports, and duplicating ~100
 * lines of stable, dependency-free, already-tested logic is simpler than
 * adding a new subpath export to a sibling package for one function.
 *
 * The algorithm is ported from Node.js's own `lib/path.js` posix
 * implementation (MIT-licensed, part of Node.js --
 * https://nodejs.org/api/path.html#pathposix) so behavior matches
 * `node:path/posix` exactly; verified directly against it in
 * test/posix.test.ts.
 */

function assertPath(path: string): void {
  if (typeof path !== "string") {
    throw new TypeError(`Path must be a string. Received ${JSON.stringify(path)}`);
  }
}

function normalizeStringPosix(path: string, allowAboveRoot: boolean): string {
  let res = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = 0;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) {
      code = path.charCodeAt(i);
    } else if (code === 47 /* '/' */) {
      break;
    } else {
      code = 47;
    }
    if (code === 47) {
      if (lastSlash === i - 1 || dots === 1) {
        // noop -- "//" or "/./"
      } else if (lastSlash !== i - 1 && dots === 2) {
        if (
          res.length < 2 ||
          lastSegmentLength !== 2 ||
          res.charCodeAt(res.length - 1) !== 46 ||
          res.charCodeAt(res.length - 2) !== 46
        ) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf("/");
            if (lastSlashIndex !== res.length - 1) {
              if (lastSlashIndex === -1) {
                res = "";
                lastSegmentLength = 0;
              } else {
                res = res.slice(0, lastSlashIndex);
                lastSegmentLength = res.length - 1 - res.lastIndexOf("/");
              }
              lastSlash = i;
              dots = 0;
              continue;
            }
          } else if (res.length === 2 || res.length === 1) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? "/.." : "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) res += `/${path.slice(lastSlash + 1, i)}`;
        else res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === 46 /* '.' */ && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

/** Equivalent to `node:path/posix`'s `normalize()` -- collapses `.`/`..` segments and redundant slashes. */
export function normalize(path: string): string {
  assertPath(path);
  if (path.length === 0) return ".";
  const isAbsolutePath = path.charCodeAt(0) === 47;
  const trailingSeparator = path.charCodeAt(path.length - 1) === 47;
  let out = normalizeStringPosix(path, !isAbsolutePath);
  if (out.length === 0 && !isAbsolutePath) out = ".";
  if (out.length > 0 && trailingSeparator) out += "/";
  return isAbsolutePath ? `/${out}` : out;
}

/**
 * Equivalent to `node:path/posix`'s `join()` -- note this faithfully
 * preserves Node's own quirk of returning `"."` when every segment is
 * empty (e.g. `join("", "")`), same as the real thing.
 */
export function join(...paths: string[]): string {
  if (paths.length === 0) return ".";
  let joined = "";
  for (const path of paths) {
    assertPath(path);
    if (path.length > 0) {
      joined = joined.length === 0 ? path : `${joined}/${path}`;
    }
  }
  return joined.length === 0 ? "." : normalize(joined);
}
