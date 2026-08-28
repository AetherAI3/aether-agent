import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { installedPackageDir } from "../scripts/release-candidate.js";

test("release candidate resolves npm's Windows global package directory", () => {
  const prefix = join("C:\\", "release-prefix");
  assert.equal(
    installedPackageDir(prefix, "fixture-package", "win32"),
    join(prefix, "node_modules", "fixture-package"),
  );
});

test("release candidate resolves npm's POSIX global package directory", () => {
  for (const platform of ["linux", "darwin"] as const) {
    assert.equal(
      installedPackageDir("/release-prefix", "@fixture/package", platform),
      join("/release-prefix", "lib", "node_modules", "@fixture/package"),
    );
  }
});
