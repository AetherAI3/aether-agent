import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secretReference } from "../src/core/settings_registry.js";
import {
  SETTINGS_STORE_MAX_BYTES,
  SETTINGS_STORE_SCHEMA_VERSION,
  VersionedSettingsStore,
  type SettingsStorePaths,
} from "../src/core/settings_store.js";
import { withSettingsFileLock } from "../src/core/settings_file_authority.js";

function fixture(): { root: string; paths: SettingsStorePaths; store: VersionedSettingsStore } {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-store-"));
  const paths = {
    global: join(root, "global", "settings.json"),
    project: join(root, "project", "settings.json"),
    session: join(root, "session", "settings.json"),
  };
  for (const directory of ["global", "project", "session"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  let id = 0;
  return {
    root,
    paths,
    store: new VersionedSettingsStore(paths, { nextId: () => `test-${++id}` }),
  };
}

test("missing scoped stores become versioned durable files only on apply", () => {
  const { paths, store } = fixture();
  assert.equal(store.inspect("global").status, "missing");
  const plan = store.plan("global", "set", "appearance.color", "boolean", false);
  assert.equal(existsSync(paths.global), false, "planning must not mutate");
  const receipt = store.apply(plan);
  assert.equal(existsSync(paths.global), true);
  assert.equal(receipt.rollbackToken.backupPath, null);
  assert.deepEqual(JSON.parse(readFileSync(paths.global, "utf8")), {
    schema_version: SETTINGS_STORE_SCHEMA_VERSION,
    settings: { "appearance.color": false },
  });
  assert.equal(store.inspect("project").status, "missing");
  assert.equal(store.inspect("session").status, "missing");
});

test("writes preserve unknown fields/settings and rollback restores exact original bytes", () => {
  const { paths, store } = fixture();
  const original = '{\n  "future_top": {"b": 2, "a": 1},\n  "schema_version": 1,\n  "settings": {"future.setting": {"shape": 7}, "voice.enabled": false}\n}\n';
  writeFileSync(paths.global, original, { encoding: "utf8", flag: "wx" });

  const plan = store.plan("global", "set", "voice.enabled", "boolean", true);
  assert.deepEqual(plan.beforeValue, false);
  const receipt = store.apply(plan);
  assert.ok(receipt.rollbackToken.backupPath);
  assert.equal(readFileSync(receipt.rollbackToken.backupPath as string, "utf8"), original);
  const changed = JSON.parse(readFileSync(paths.global, "utf8")) as Record<string, unknown>;
  assert.deepEqual(changed["future_top"], { b: 2, a: 1 });
  assert.deepEqual((changed["settings"] as Record<string, unknown>)["future.setting"], { shape: 7 });
  assert.equal((changed["settings"] as Record<string, unknown>)["voice.enabled"], true);

  const rolledBack = store.rollback(receipt.rollbackToken);
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(readFileSync(paths.global, "utf8"), original);
  assert.throws(() => store.rollback(receipt.rollbackToken), /already rolled back/);
});

test("unique backups support reverse rollback across multiple writes to one scope", () => {
  const { paths, store } = fixture();
  const original = '{"schema_version":1,"settings":{"one":false,"two":false}}\n';
  writeFileSync(paths.project, original, { encoding: "utf8", flag: "wx" });

  const first = store.apply(store.plan("project", "set", "one", "boolean", true));
  const second = store.apply(store.plan("project", "set", "two", "boolean", true));
  assert.notEqual(first.rollbackToken.backupPath, second.rollbackToken.backupPath);
  store.rollback(second.rollbackToken);
  store.rollback(first.rollbackToken);
  assert.equal(readFileSync(paths.project, "utf8"), original);
});

test("one batch key commits multiple same-scope leaves in one atomic document", () => {
  const { paths, store } = fixture();
  const original = '{"schema_version":1,"future":{"keep":true},"settings":{"one":false,"two":false}}\n';
  writeFileSync(paths.project, original, { encoding: "utf8", flag: "wx" });
  const batchKey = {};
  const firstPlan = store.plan("project", "set", "one", "boolean", true, batchKey);
  const secondPlan = store.plan("project", "set", "two", "boolean", true, batchKey);

  const first = store.apply(firstPlan);
  const second = store.apply(secondPlan);
  assert.equal(first.performedWrite, true);
  assert.equal(second.performedWrite, false);
  assert.equal(first.rollbackToken.receiptId, second.rollbackToken.receiptId);
  assert.deepEqual(JSON.parse(readFileSync(paths.project, "utf8")), {
    schema_version: 1,
    future: { keep: true },
    settings: { one: true, two: true },
  });

  store.rollback(first.rollbackToken);
  assert.equal(readFileSync(paths.project, "utf8"), original);
  assert.throws(() => store.apply(secondPlan), /batch was already rolled back/);
});

test("same-scope batches retain stale-write and forged-plan refusal", () => {
  const { paths, store } = fixture();
  writeFileSync(paths.global, '{"schema_version":1,"settings":{"one":false,"two":false}}\n', "utf8");
  const batchKey = {};
  const first = store.plan("global", "set", "one", "boolean", true, batchKey);
  store.plan("global", "set", "two", "boolean", true, batchKey);
  writeFileSync(paths.global, '{"schema_version":1,"settings":{"one":false,"two":"external"}}\n', "utf8");
  assert.throws(() => store.apply(first), /changed after preview/);
  assert.equal((store.inspect("global").settings)["two"], "external");

  const forged = { ...first };
  assert.throws(() => store.apply(forged), /foreign or was forged/);
});

test("stale plans and stale rollback receipts refuse to overwrite newer state", () => {
  const { paths, store } = fixture();
  writeFileSync(paths.session, '{"schema_version":1,"settings":{"mode":"a"}}\n', "utf8");
  const stale = store.plan("session", "set", "mode", "string", "b");
  writeFileSync(paths.session, '{"schema_version":1,"settings":{"mode":"newer"}}\n', "utf8");
  assert.throws(() => store.apply(stale), /changed after preview/);

  const current = store.plan("session", "set", "mode", "string", "b");
  const receipt = store.apply(current);
  writeFileSync(paths.session, '{"schema_version":1,"settings":{"mode":"external"}}\n', "utf8");
  assert.throws(() => store.rollback(receipt.rollbackToken), /refusing to overwrite newer state/);
});

test("corrupt, unsupported, and unsafe stores remain visible and are never auto-repaired", () => {
  const { paths, store } = fixture();
  writeFileSync(paths.global, "{broken", "utf8");
  assert.equal(store.inspect("global").status, "corrupt");
  assert.throws(
    () => store.plan("global", "set", "safe.value", "string", "ok"),
    /settings are corrupt/,
  );
  assert.equal(readFileSync(paths.global, "utf8"), "{broken");

  writeFileSync(paths.project, '{"schema_version":99,"settings":{"future":true}}\n', "utf8");
  const future = store.inspect("project");
  assert.equal(future.status, "unsupported_version");
  assert.equal(future.schemaVersion, 99);

  writeFileSync(
    paths.session,
    '{"schema_version":1,"settings":{"api_token":"sk-abcdefghijklmnop123456"}}\n',
    "utf8",
  );
  const unsafe = store.inspect("session");
  assert.equal(unsafe.status, "unsafe");
  assert.doesNotMatch(unsafe.detail ?? "", /abcdefghijklmnop/);
});

test("new writes reject raw credentials and accept structural secret references only", () => {
  const { store } = fixture();
  assert.throws(
    () => store.plan("global", "set", "auth.api_token", "string", "sk-abcdefghijklmnop123456"),
    /secret_ref/,
  );
  assert.throws(
    () => store.plan("global", "set", "flag", "boolean", "true"),
    /declared boolean/,
  );
  assert.throws(
    () => store.plan("global", "set", "auth.api_token", "secret_ref", {
      ...secretReference("env", "AETHER_API_TOKEN"),
      raw_token: "sk-abcdefghijklmnop123456",
    } as never),
    /only kind, provider, and name/,
  );
  const ref = secretReference("env", "AETHER_API_TOKEN");
  store.apply(store.plan("global", "set", "auth.api_token", "secret_ref", ref));
  const inspection = store.inspect("global");
  assert.equal(inspection.status, "ok");
  assert.deepEqual(inspection.settings["auth.api_token"], ref);
});

test("apply reconstructs plans so forged documents cannot drop unknowns or add secrets", () => {
  const { paths, store } = fixture();
  writeFileSync(
    paths.global,
    '{"schema_version":1,"future":{"keep":true},"settings":{"future.setting":7}}\n',
    "utf8",
  );
  const plan = store.plan("global", "set", "safe.value", "string", "ok");
  const forged = {
    ...plan,
    document: {
      schema_version: 1,
      settings: {
        "safe.value": "ok",
        api_token: "sk-abcdefghijklmnop123456",
      },
    },
  };
  assert.throws(() => store.apply(forged), /content or digest mismatch/);
  assert.deepEqual(JSON.parse(readFileSync(paths.global, "utf8")), {
    schema_version: 1,
    future: { keep: true },
    settings: { "future.setting": 7 },
  });
});

test("rollback removes a file that did not exist before apply", () => {
  const { paths, store } = fixture();
  const receipt = store.apply(store.plan("session", "set", "temporary", "number", 3));
  assert.equal(existsSync(paths.session), true);
  store.rollback(receipt.rollbackToken);
  assert.equal(existsSync(paths.session), false);
});

test("inspection rejects oversize, invalid UTF-8, and non-regular settings paths before parsing", () => {
  const { paths, store } = fixture();
  writeFileSync(paths.global, " ".repeat(SETTINGS_STORE_MAX_BYTES + 1), "utf8");
  assert.equal(store.inspect("global").status, "oversize");
  assert.throws(() => store.plan("global", "set", "safe", "boolean", true), /settings are oversize/);

  writeFileSync(paths.global, Buffer.from([0xff]));
  assert.equal(store.inspect("global").status, "unreadable");

  rmSync(paths.global, { force: true });
  mkdirSync(paths.global);
  assert.equal(store.inspect("global").status, "unreadable");
  assert.throws(() => store.plan("global", "set", "safe", "boolean", true), /settings are unreadable/);
});

test("inspection refuses symbolic-link settings without reading the target", (t) => {
  const { root, paths, store } = fixture();
  const source = join(root, "outside.json");
  writeFileSync(source, '{"schema_version":1,"settings":{"followed":true}}\n', "utf8");
  try {
    symlinkSync(source, paths.global, "file");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "ENOTSUP") {
      t.skip(`file symlinks are unavailable on this host (${code})`);
      return;
    }
    throw error;
  }
  const inspection = store.inspect("global");
  assert.equal(inspection.status, "unsafe");
  assert.deepEqual(inspection.settings, {});
  assert.throws(() => store.plan("global", "set", "safe", "boolean", true), /settings are unsafe/);
});

test("adjacent exclusive lock serializes apply and rollback across store instances", () => {
  const { paths, store } = fixture();
  const contender = new VersionedSettingsStore(paths, { nextId: () => "contender" });
  const plan = contender.plan("global", "set", "locked.value", "boolean", true);

  withSettingsFileLock(paths.global, () => {
    assert.throws(() => contender.apply(plan), /locked by another apply or rollback/);
    assert.equal(existsSync(paths.global), false, "refused apply must leave target untouched");
  });

  const receipt = contender.apply(plan);
  const appliedBytes = readFileSync(paths.global, "utf8");
  withSettingsFileLock(paths.global, () => {
    assert.throws(() => contender.rollback(receipt.rollbackToken), /locked by another apply or rollback/);
    assert.equal(readFileSync(paths.global, "utf8"), appliedBytes, "refused rollback must leave target untouched");
  });
  contender.rollback(receipt.rollbackToken);
  assert.equal(existsSync(paths.global), false);
  assert.equal(store.inspect("global").status, "missing");
});
