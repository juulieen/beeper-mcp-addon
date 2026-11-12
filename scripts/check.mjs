#!/usr/bin/env node
// npm run check: fast, deterministic consistency checks between the code and everything that
// describes it (README, Claude Desktop manifest, MCP registry entry, one-click install links).
// Exit 1 with one line per problem. Runs in the pre-commit hook and in CI.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (f) => readFileSync(f, "utf8");
const json = (f) => JSON.parse(read(f));
const problems = [];
const expect = (ok, msg) => ok || problems.push(msg);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const pkg = json("package.json");
const server = json("server.json");
const manifest = json("manifest.json");
const readme = read("README.md");
const src = Object.fromEntries(readdirSync("src").filter((f) => f.endsWith(".ts")).map((f) => [f, read(join("src", f))]));

// 1. Versions agree everywhere.
for (const [where, v] of [
  ["server.json version", server.version],
  ["server.json packages[0].version", server.packages?.[0]?.version],
  ["manifest.json version", manifest.version],
]) expect(v === pkg.version, `${where} is ${v}, package.json is ${pkg.version} (run: node scripts/sync-version.mjs)`);

// 2. Names agree.
expect(server.name === pkg.mcpName, `server.json name ${server.name} != package.json mcpName ${pkg.mcpName}`);
expect(server.packages?.[0]?.identifier === pkg.name, `server.json package identifier != ${pkg.name}`);
expect(manifest.name === pkg.name, `manifest.json name != ${pkg.name}`);

// 3. The same tools in the code, the manifest and the README table.
const codeTools = [...src["index.ts"].matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
const manifestTools = manifest.tools.map((t) => t.name);
// The tool table is the one whose header starts with "| Tool |".
const lines = readme.split("\n");
const start = lines.findIndex((l) => l.startsWith("| Tool |"));
const toolTable = [];
for (let i = start + 2; start >= 0 && lines[i]?.startsWith("|"); i++) toolTable.push(lines[i].match(/^\| `([a-z_]+)`/)?.[1]);
expect(same(codeTools, manifestTools), `manifest.json tools [${manifestTools}] != code [${codeTools}]`);
expect(same(toolTable, codeTools), `README tool table [${toolTable}] != code [${codeTools}]`);
for (const t of codeTools) expect(readme.includes(`### \`${t}\``), `README has no "### \`${t}\`" section`);
const countWord = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][codeTools.length];
expect(readme.includes(`as ${countWord} tools`), `README should say "as ${countWord} tools"`);

// 4. Every environment variable the code reads is documented (test-only ones excepted).
const envVars = new Set(Object.values(src).flatMap((s) => [...s.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1])));
for (const v of envVars) {
  if (!v.startsWith("BEEPER_") || v.includes("_TEST_")) continue;
  expect(readme.includes(`| \`${v}\` |`), `README configuration table is missing ${v}`);
}

// 5. One-click install links decode to the right command.
const cursor = readme.match(/cursor\.com\/en\/install-mcp\?name=([^&]+)&config=([^)\s]+)/);
expect(cursor, "README: Add to Cursor link not found");
if (cursor) {
  const cfg = JSON.parse(Buffer.from(decodeURIComponent(cursor[2]), "base64").toString());
  expect(cursor[1] === pkg.name && cfg.command === "npx" && cfg.args?.includes(pkg.name), `Cursor link config is ${JSON.stringify(cfg)}`);
}
const vscode = readme.match(/vscode\.dev\/redirect\/mcp\/install\?name=([^&]+)&config=([^)\s]+)/);
expect(vscode, "README: VS Code install link not found");
if (vscode) {
  const cfg = JSON.parse(decodeURIComponent(vscode[2]));
  expect(vscode[1] === pkg.name && cfg.command === "npx" && cfg.args?.includes(pkg.name), `VS Code link config is ${JSON.stringify(cfg)}`);
}

// 6. The README never pins a version number (it would go stale); install pins it for the user.
const pinned = readme.match(new RegExp(`${pkg.name}@\\d+\\.\\d+\\.\\d+`, "g"))?.filter((m) => !m.endsWith("@1.2.3"));
expect(!pinned?.length, `README mentions a real version (${pinned}); use a placeholder`);

// 7. Tools that act for the user say so, and carry the matching annotations.
const blocks = src["index.ts"].split(/server\.registerTool\(/).slice(1);
for (const b of blocks) {
  const name = b.match(/^\s*"([a-z_]+)"/)?.[1];
  const readOnly = /readOnlyHint:\s*true/.test(b);
  if (!readOnly) expect(/confirm/i.test(b), `${name}: not read-only, so its description must ask to confirm with the user`);
  if (/^delete_/.test(name)) expect(/destructiveHint:\s*true/.test(b), `${name}: must have destructiveHint: true`);
}

if (problems.length) {
  console.error(`npm run check: ${problems.length} problem(s)\n` + problems.map((p) => `  ✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`npm run check: OK (${codeTools.length} tools, version ${pkg.version})`);
