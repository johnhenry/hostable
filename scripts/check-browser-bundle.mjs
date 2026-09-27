// Real bundler regression check for issue #5: proves `import
// "@johnhenry/hostable"` bundles cleanly for a browser target -- zero Node
// built-ins (`node:path`, `node:path/posix`, ...) -- using a real bundler
// (esbuild) against the actual *packed* npm tarball, not a live checkout
// of this repo. Adapted from @johnhenry/servable's own
// scripts/check-browser-bundle.mjs (#7), which verifies the identical
// class of bug the same way.
//
// The packed tarball matters, not just "does it build" against src/dist in
// place: a live checkout's own tsconfig.json can map bare specifiers back
// to unconditional source in ways a published tarball never would (see
// servable's script for the full writeup of that trap). This script packs
// for real, extracts into a scratch node_modules (dependencies symlinked
// from this repo's own already-resolved node_modules, not reinstalled),
// then bundles with esbuild `platform: "browser"`, `conditions: ["browser"]`.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, cpSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
// See servable's check-browser-bundle.mjs for why this is shell:true (on
// win32 only) rather than resolving "npm.cmd" directly -- execFileSync
// can't run a .cmd at all without a shell, even naming it explicitly.
const npmSpawnOpts = { shell: process.platform === "win32" };

const FORBIDDEN_MARKERS = ['from "node:', 'require("node:'];

const ENTRY_CONTENTS = `import {
  compile, Gateway, Upstream, Group, Host, Route, Use, ErrorBoundary, NotFound, Redirect, Response,
  linkTo, warn, markdownToHtml, setCookie, sse, streamBody, upgradeWebSocket, serveFile,
  fromFetchFn, fromNullableRouter,
} from "@johnhenry/hostable";
export {
  compile, Gateway, Upstream, Group, Host, Route, Use, ErrorBoundary, NotFound, Redirect, Response,
  linkTo, warn, markdownToHtml, setCookie, sse, streamBody, upgradeWebSocket, serveFile,
  fromFetchFn, fromNullableRouter,
};
`;

function log(msg) {
  console.log(`[check-browser-bundle] ${msg}`);
}

function main() {
  log("building (tsc)...");
  execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit", ...npmSpawnOpts });

  const scratchRoot = mkdtempSync(join(tmpdir(), "hostable-bundle-check-"));
  const packDir = join(scratchRoot, "pack");
  const scratchDir = join(scratchRoot, "app");
  mkdirSync(packDir, { recursive: true });
  mkdirSync(scratchDir, { recursive: true });

  let result;
  let buildFailed = false;
  let buildErrors = [];

  try {
    log("npm pack...");
    const packOutput = execFileSync("npm", ["pack", "--pack-destination", packDir], {
      cwd: repoRoot,
      encoding: "utf8",
      ...npmSpawnOpts,
    }).trim();
    const tarballName = packOutput.split("\n").pop().trim();
    const tarballPath = join(packDir, tarballName);
    log(`packed ${tarballName}`);

    const scopeDir = join(scratchDir, "node_modules", "@johnhenry");
    mkdirSync(scopeDir, { recursive: true });
    // --force-local: see servable's script -- GNU tar on windows-latest
    // misreads a "C:\..." path's drive-letter colon as a remote host spec
    // without it. macOS's bsdtar doesn't recognize the flag at all.
    const tarArgs =
      process.platform === "win32"
        ? ["-xf", tarballPath, "-C", packDir, "--force-local"]
        : ["-xf", tarballPath, "-C", packDir];
    execFileSync("tar", tarArgs);
    cpSync(join(packDir, "package"), join(scopeDir, "hostable"), { recursive: true });

    // Real dependencies -- symlinked from this repo's own already-resolved
    // node_modules (real install, no network), so this proves the bundle
    // builds against a real, published-shape @johnhenry/servable (whose
    // own browser condition/posix fix this depends on), not just this
    // repo's own source tree.
    for (const dep of ["servable", "fileable", "leserve"]) {
      const target = join(repoRoot, "node_modules", "@johnhenry", dep);
      symlinkSync(target, join(scopeDir, dep), "dir");
    }
    mkdirSync(join(scratchDir, "node_modules"), { recursive: true });
    for (const dep of ["urlpattern-polyfill", "glob", "marked"]) {
      symlinkSync(join(repoRoot, "node_modules", dep), join(scratchDir, "node_modules", dep), "dir");
    }

    const entryFile = join(scratchDir, "entry.mjs");
    writeFileSync(entryFile, ENTRY_CONTENTS);

    log("bundling with esbuild (platform: browser, conditions: [browser])...");
    result = esbuild.buildSync({
      entryPoints: [entryFile],
      bundle: true,
      write: false,
      platform: "browser",
      conditions: ["browser"],
      format: "esm",
      absWorkingDir: scratchDir,
      logLevel: "silent",
    });
  } catch (err) {
    buildFailed = true;
    buildErrors = err.errors ?? [{ text: String(err) }];
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }

  if (buildFailed) {
    console.error("[check-browser-bundle] FAIL -- esbuild could not bundle @johnhenry/hostable for browser:");
    for (const e of buildErrors) console.error(`  ${e.text}`);
    console.error("[check-browser-bundle] This means a Node-only built-in is being pulled into the bundle -- see #5.");
    process.exit(1);
  }

  const outputText = result.outputFiles.map((f) => f.text).join("\n");
  const hits = FORBIDDEN_MARKERS.filter((marker) => outputText.includes(marker));
  if (hits.length > 0) {
    console.error("[check-browser-bundle] FAIL -- browser bundle built, but contains forbidden Node-only markers:");
    for (const h of hits) console.error(`  found: ${h}`);
    process.exit(1);
  }

  log(`PASS -- browser bundle built clean (${outputText.length} bytes), no Node-only markers found.`);
}

main();
