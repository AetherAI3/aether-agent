import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  validateInstallerText,
  validateManifest,
  validatePack,
  validateWorkflowText,
  type PackReport,
} from "../scripts/verify-production.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";

const manifest = {
  name: "aether-agents",
  version: "1.2.3",
  main: "dist/src/index.js",
  types: "dist/src/index.d.ts",
  bin: { aether: "dist/src/main.js" },
  files: ["dist/src", "README.md", "COMMANDS.md", "LICENSE", "NOTICE.md"],
  engines: { node: ">=24" },
  scripts: { prepack: "npm run build" },
};

const pack: PackReport = {
  name: "aether-agents",
  version: "1.2.3",
  filename: "aether-agents-1.2.3.tgz",
  size: 100,
  unpackedSize: 1000,
  entryCount: 8,
  files: [
    "COMMANDS.md",
    "LICENSE",
    "NOTICE.md",
    "README.md",
    "package.json",
    "dist/src/index.js",
    "dist/src/index.d.ts",
    "dist/src/main.js",
  ].map((path) => ({ path, size: 1 })),
};

test("release manifest binds the tag and preserves the zero-runtime-dependency contract", () => {
  assert.deepEqual(validateManifest(manifest, "v1.2.3"), []);
  assert.match(validateManifest({ ...manifest, dependencies: { unsafe: "1.0.0" } }, "v1.2.4").join("\n"), /runtime dependencies/);
  assert.match(validateManifest(manifest, "v1.2.4").join("\n"), /does not match/);
});

test("package allowlist rejects compiled tests and environment files", () => {
  assert.deepEqual(validatePack(pack, manifest), []);
  const poisoned = {
    ...pack,
    files: [...pack.files, { path: "dist/test/auth.test.js", size: 1 }, { path: ".env", size: 1 }],
  };
  const errors = validatePack(poisoned, manifest).join("\n");
  assert.match(errors, /dist\/test/);
  assert.match(errors, /\.env/);
});

test("workflow policy rejects floating actions and unbounded jobs", () => {
  const valid = `permissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567\n      - run: npm ci --ignore-scripts\n`;
  assert.deepEqual(validateWorkflowText("valid.yml", valid), []);
  const invalid = valid
    .replace("actions/checkout@0123456789abcdef0123456789abcdef01234567", "actions/checkout@v7")
    .replace("    timeout-minutes: 10\n", "");
  const errors = validateWorkflowText("invalid.yml", invalid).join("\n");
  assert.match(errors, /not pinned/);
  assert.match(errors, /timeout-minutes/);
});

test("publishing workflow must be event-gated, main-derived, and install-smoked", () => {
  const invalid = `on:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    environment: npm-production\n    permissions:\n      id-token: write\n      attestations: write\n    steps:\n      - run: npm publish package.tgz --provenance\n`;
  const errors = validateWorkflowText("release.yml", invalid).join("\n");
  assert.match(errors, /manually dispatched/);
  assert.match(errors, /ancestry/);
  assert.match(errors, /install smoke/);
});

test("installer policy rejects pipe-to-shell and lifecycle-enabled global installs", () => {
  assert.deepEqual(validateInstallerText("safe.sh", "npm install -g aether-agents@latest --ignore-scripts"), []);
  assert.match(validateInstallerText("bad.sh", "curl https://example.test/install.sh | sh\nnpm install -g aether-agents").join("\n"), /pipe-to-shell/);
});

test("checked-in workflows and installers satisfy the production policy", () => {
  const root = process.cwd();
  const workflowDir = join(root, ".github", "workflows");
  for (const name of readdirSync(workflowDir).filter((entry) => /\.ya?ml$/i.test(entry))) {
    assert.deepEqual(validateWorkflowText(name, readFileSync(join(workflowDir, name), "utf8")), []);
  }
  for (const name of ["install.sh", "install.ps1", "README.md"]) {
    assert.deepEqual(validateInstallerText(name, readFileSync(join(root, name), "utf8")), []);
  }
});

test("operator-facing API defaults match the production transport path", () => {
  assert.equal(DEFAULT_CONFIG.baseUrl, "https://api.aethersystems.net/cloud");
  assert.match(readFileSync(".env.example", "utf8"), /AETHER_BASE_URL=https:\/\/api\.aethersystems\.net\/cloud/);
  assert.match(readFileSync("COMMANDS.md", "utf8"), /`https:\/\/api\.aethersystems\.net\/cloud`/);
});
