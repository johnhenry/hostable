import { test } from "node:test";
import assert from "node:assert/strict";
import * as real from "node:path/posix";
import * as pure from "../src/posix.js";

// Verifies src/posix.ts (the browser-safe reimplementation used instead of
// node:path/posix in compile.ts's <Group> prefix-joining, see #5) is
// byte-for-byte identical to the real node:path/posix across a broad
// sample of inputs -- not just the handful of cases compile.ts happens to
// hit. Copied from @johnhenry/servable's own test/posix.test.ts, which
// verifies the identical implementation there the same way.
const samples = [
  "",
  ".",
  "..",
  "/",
  "//",
  "a",
  "a/b",
  "/a/b",
  "a/../b",
  "./a",
  "../a",
  "a/./b/../c",
  "a/b/",
  "/a/b/",
  "a//b",
  "a/b/../../c",
  "foo",
  "foo/bar",
  "/foo/bar/baz",
  "../..",
  "a/b/c/../../..",
  "a/b/c/../../../..",
];

test("normalize() matches node:path/posix", () => {
  for (const s of samples) assert.equal(pure.normalize(s), real.normalize(s), s);
});

test("join() matches node:path/posix, including the '.' for all-empty-segments quirk", () => {
  for (const a of samples) {
    for (const b of samples) {
      assert.equal(pure.join(a, b), real.join(a, b), `join(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
    }
  }
  assert.equal(pure.join("", ""), ".");
  assert.equal(pure.join(), ".");
});
