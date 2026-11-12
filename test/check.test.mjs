// scripts/check.mjs must catch drift between the code and the docs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT, tempDir } from "./helpers.mjs";

function checkWith(edit) {
  const dir = tempDir("check");
  for (const f of ["package.json", "server.json", "manifest.json", "README.md", "src", "scripts"]) cpSync(join(ROOT, f), join(dir, f), { recursive: true });
  edit(dir);
  const r = spawnSync(process.execPath, ["scripts/check.mjs"], { cwd: dir, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}
const replaceIn = (file, from, to) => (dir) => {
  const text = readFileSync(join(dir, file), "utf8");
  assert.ok(text.includes(from), `${file} does not contain ${from}`);
  writeFileSync(join(dir, file), text.replace(from, to));
};

test("the repository passes", () => assert.equal(checkWith(() => {}).code, 0));

for (const [what, edit, message] of [
  ["a version mismatch", replaceIn("manifest.json", '"version": "', '"version": "9'), /manifest.json version/],
  ["a tool missing from the manifest", replaceIn("manifest.json", '"name": "delete_message"', '"name": "x_y"'), /manifest.json tools/],
  ["an undocumented variable", replaceIn("src/index.ts", "process.env.BEEPER_DOWNLOAD_DIR", "process.env.BEEPER_NEW_THING"), /missing BEEPER_NEW_THING/],
  ["a pinned version in the README", replaceIn("README.md", "npx -y beeper-mcp-addon install", "npx -y beeper-mcp-addon@0.3.0 install"), /real version/],
  ["a sending tool that doesn't ask to confirm", replaceIn("src/index.ts", "This sends a real message on the user's behalf: confirm the recipient and the file first.", "Sends it."), /send_file: not read-only/],
]) {
  test(`it catches ${what}`, () => {
    const r = checkWith(edit);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, message);
  });
}
