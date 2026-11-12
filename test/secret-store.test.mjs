// The real OS secret store of the machine running the tests (Keychain, DPAPI, keyring or file),
// under a test-only service name so the user's token is never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { platform } from "node:os";
import { statSync } from "node:fs";
import { tempDir } from "./helpers.mjs";

const dir = tempDir("secret");
process.env.BEEPER_ADDON_TEST_SERVICE = `beeper-mcp-addon-test-${process.pid}`;
process.env.APPDATA = dir; // DPAPI file location on Windows
process.env.XDG_CONFIG_HOME = dir; // fallback file location elsewhere
delete process.env.BEEPER_TOKEN_FILE;
const store = await import("../dist/secret-store.js");

test("save, read back and delete a secret in the OS store", async () => {
  const value = JSON.stringify({ access_token: 'tok-"quoted"\\-\u00e9', created_at: new Date().toISOString() });
  const where = await store.saveSecret(value);
  const expected = { darwin: "macos-keychain", win32: "windows-dpapi" }[platform()];
  if (expected && where !== expected) console.log(`# secret store fell back to "${where}" (expected ${expected})`);
  if (process.env.CI && expected) assert.equal(where, expected, `the ${expected} backend failed on CI`);
  assert.equal(await store.readSecret(), value);
  await store.deleteSecret();
  assert.equal(await store.readSecret(), undefined);
});

test("the fallback file is readable only by the user", { skip: platform() === "win32" }, async () => {
  process.env.BEEPER_TOKEN_FILE = join(dir, "forced", "token.json");
  const forced = await import(`../dist/secret-store.js?forced`);
  assert.equal(await forced.saveSecret("x"), "file");
  assert.equal(statSync(process.env.BEEPER_TOKEN_FILE).mode & 0o777, 0o600);
  await forced.deleteSecret();
});
