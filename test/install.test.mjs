// `install` / `uninstall` against a fake home directory, for every file-based client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { platform } from "node:os";
import { ROOT, cli, fakeHome } from "./helpers.mjs";

const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const WIN = platform() === "win32";
const MAC = platform() === "darwin";
const CLIENTS = "claude-desktop,cursor,vscode,windsurf,kimi-code,gemini-cli,codex";

function paths(home) {
  const app = (name) =>
    MAC ? join(home, "Library", "Application Support", name) : WIN ? join(home, "AppData", "Roaming", name) : join(home, ".config", name);
  return {
    "claude-desktop": join(app("Claude"), "claude_desktop_config.json"),
    cursor: join(home, ".cursor", "mcp.json"),
    vscode: join(app("Code"), "User", "mcp.json"),
    windsurf: join(home, ".codeium", "windsurf", "mcp_config.json"),
    "kimi-code": join(home, ".kimi-code", "mcp.json"),
    "gemini-cli": join(home, ".gemini", "settings.json"),
    codex: join(home, ".codex", "config.toml"),
  };
}
const expected = WIN
  ? { command: "cmd", args: ["/c", "npx", "-y", `beeper-mcp-addon@${VERSION}`] }
  : { command: "npx", args: ["-y", `beeper-mcp-addon@${VERSION}`] };
const write = (file, text) => (mkdirSync(dirname(file), { recursive: true }), writeFileSync(file, text));

test("install adds a pinned entry to every client, keeps other servers, and is idempotent", () => {
  const { home, env } = fakeHome();
  const p = paths(home);
  write(p.cursor, JSON.stringify({ mcpServers: { other: { command: "x" } }, theme: "dark" }));
  write(p.codex, 'model = "o4"\n\n[mcp_servers.other]\ncommand = "x"\nargs = ["[a]", "b"]\n');

  const first = cli(["install", "--client", CLIENTS, "--yes", "--no-login"], env);
  assert.equal(first.code, 0, first.out);
  for (const [id, file] of Object.entries(p)) {
    assert.ok(existsSync(file), `${id}: ${file} missing`);
    if (id === "codex") continue;
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    const entry = (id === "vscode" ? cfg.servers : cfg.mcpServers)["beeper-mcp-addon"];
    assert.deepEqual(entry, id === "vscode" ? { type: "stdio", ...expected } : expected, id);
  }
  const cursor = JSON.parse(readFileSync(p.cursor, "utf8"));
  assert.deepEqual(cursor.mcpServers.other, { command: "x" });
  assert.equal(cursor.theme, "dark");
  const toml = readFileSync(p.codex, "utf8");
  assert.match(toml, /\[mcp_servers\.other\]\ncommand = "x"\nargs = \["\[a\]", "b"\]/);
  assert.match(toml, new RegExp(`\\[mcp_servers\\.beeper-mcp-addon\\]\\ncommand = "${expected.command}"`));
  assert.ok(readdirSync(dirname(p.cursor)).some((f) => f.startsWith("mcp.json.bak-")), "no backup of the existing file");

  const second = cli(["install", "--client", CLIENTS, "--yes", "--no-login"], env);
  assert.equal(second.code, 0, second.out);
  assert.match(second.out, /Cursor: unchanged/);
  assert.equal(readFileSync(p.codex, "utf8").match(/\[mcp_servers\.beeper-mcp-addon\]/g).length, 1, "duplicate TOML table");
});

test("uninstall removes only our entry", () => {
  const { home, env } = fakeHome();
  const p = paths(home);
  write(p.codex, '[mcp_servers.other]\ncommand = "x"\n');
  write(p.cursor, JSON.stringify({ mcpServers: { other: { command: "x" } } }));
  cli(["install", "--client", CLIENTS, "--yes", "--no-login"], env);

  const r = cli(["uninstall", "--client", CLIENTS, "--yes"], env);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(readFileSync(p.cursor, "utf8")).mcpServers, { other: { command: "x" } });
  const toml = readFileSync(p.codex, "utf8");
  assert.doesNotMatch(toml, /beeper-mcp-addon/);
  assert.match(toml, /\[mcp_servers\.other\]/);

  const again = cli(["uninstall", "--client", CLIENTS, "--yes"], env);
  assert.match(again.out, /Cursor: absent/);
});

test("a config with comments is left alone, with a snippet to add by hand", () => {
  const { home, env } = fakeHome();
  const file = paths(home).vscode;
  const original = '{\n  // my servers\n  "servers": {}\n}\n';
  write(file, original);
  const r = cli(["install", "--client", "vscode", "--yes", "--no-login"], env);
  assert.match(r.out, /not plain JSON/);
  assert.equal(readFileSync(file, "utf8"), original);
  assert.match(cli(["uninstall", "--client", "vscode", "--yes"], env).out, /absent/);
});

test("--dry-run writes nothing, unknown clients are refused", () => {
  const { home, env } = fakeHome();
  cli(["install", "--client", "cursor", "--dry-run"], env);
  assert.ok(!existsSync(paths(home).cursor));
  const bad = cli(["install", "--client", "nope", "--yes"], env);
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /Unknown client/);
});
