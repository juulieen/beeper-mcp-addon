/**
 * `beeper-mcp-addon install`: add (or remove) the server in every MCP client found on this machine.
 * Works on macOS, Windows and Linux. Existing configs are backed up before any change, and only
 * the "beeper-mcp-addon" entry is touched.
 */
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "./update.js";
import { createInterface } from "node:readline/promises";

const NAME = "beeper-mcp-addon";
const WIN = platform() === "win32";
const MAC = platform() === "darwin";
const HOME = homedir();
const APPDATA = process.env.APPDATA ?? join(HOME, "AppData", "Roaming");
const XDG = process.env.XDG_CONFIG_HOME ?? join(HOME, ".config");

/** On Windows, clients start servers without a shell, so `npx` (a .cmd) must go through cmd. */
// With --local, point clients at this copy of the code (a git checkout) instead of the npm package.
const LOCAL = process.argv.includes("--local");
const COMMAND = LOCAL
  ? { command: process.execPath, args: [join(dirname(fileURLToPath(import.meta.url)), "index.js")] }
  : WIN
    ? { command: "cmd", args: ["/c", "npx", "-y", `${NAME}@${VERSION}`] }
    : { command: "npx", args: ["-y", `${NAME}@${VERSION}`] }; // exact version: a new release never runs unseen

/** Per-OS user config directory of an Electron app (Claude Desktop, VS Code…). */
const appConfig = (app: string) => (MAC ? join(HOME, "Library", "Application Support", app) : WIN ? join(APPDATA, app) : join(XDG, app));

type Client = {
  id: string;
  label: string;
  /** Config file to edit, or undefined for clients installed through their own CLI. */
  file?: string;
  /** Directory whose existence means the client is installed. */
  detect: string;
  format?: "mcpServers" | "vscode" | "codex-toml";
  cli?: { bin: string; add: string[]; remove: string[] };
};

const CLIENTS: Client[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    detect: join(HOME, ".claude"),
    cli: {
      bin: "claude",
      add: ["mcp", "add", "--scope", "user", NAME, "--", COMMAND.command, ...COMMAND.args],
      remove: ["mcp", "remove", "--scope", "user", NAME],
    },
  },
  { id: "claude-desktop", label: "Claude Desktop", detect: appConfig("Claude"), file: join(appConfig("Claude"), "claude_desktop_config.json"), format: "mcpServers" },
  { id: "cursor", label: "Cursor", detect: join(HOME, ".cursor"), file: join(HOME, ".cursor", "mcp.json"), format: "mcpServers" },
  { id: "vscode", label: "VS Code", detect: join(appConfig("Code"), "User"), file: join(appConfig("Code"), "User", "mcp.json"), format: "vscode" },
  { id: "windsurf", label: "Windsurf", detect: join(HOME, ".codeium", "windsurf"), file: join(HOME, ".codeium", "windsurf", "mcp_config.json"), format: "mcpServers" },
  { id: "kimi-code", label: "Kimi Code", detect: join(HOME, ".kimi-code"), file: join(HOME, ".kimi-code", "mcp.json"), format: "mcpServers" },
  { id: "gemini-cli", label: "Gemini CLI", detect: join(HOME, ".gemini"), file: join(HOME, ".gemini", "settings.json"), format: "mcpServers" },
  { id: "codex", label: "Codex CLI", detect: join(HOME, ".codex"), file: join(HOME, ".codex", "config.toml"), format: "codex-toml" },
];

const exists = (p: string) => stat(p).then(() => true, () => false);

function hasBin(bin: string) {
  const r = spawnSync(WIN ? "where" : "which", [bin], { stdio: "ignore", shell: false });
  return r.status === 0;
}

const tomlBlock = () =>
  `\n[mcp_servers.${NAME}]\ncommand = ${JSON.stringify(COMMAND.command)}\nargs = [${COMMAND.args.map((a) => JSON.stringify(a)).join(", ")}]\n`;
// The table header and every following line up to the next table header ("[...]" at line start).
const TOML_RE = new RegExp(`\\n?^\\[mcp_servers\\.${NAME.replace(/-/g, "\\-")}\\][ \\t]*\\n(?:(?!\\[)[^\\n]*(?:\\n|$))*`, "gm");

type Result = { client: string; status: "added" | "updated" | "removed" | "unchanged" | "absent" | "skipped" | "error"; detail?: string };

async function backup(file: string) {
  if (await exists(file)) await copyFile(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`);
}

async function applyFile(c: Client, remove: boolean, dryRun: boolean): Promise<Result> {
  const file = c.file!;
  const raw = (await exists(file)) ? await readFile(file, "utf8") : "";

  if (c.format === "codex-toml") {
    const present = TOML_RE.test(raw);
    TOML_RE.lastIndex = 0;
    if (remove && !present) return { client: c.label, status: "absent" };
    const next = remove ? raw.replace(TOML_RE, "") : present ? raw.replace(TOML_RE, tomlBlock()) : raw.trimEnd() + "\n" + tomlBlock();
    if (next === raw) return { client: c.label, status: "unchanged", detail: file };
    if (!dryRun) {
      await backup(file);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, next);
    }
    return { client: c.label, status: remove ? "removed" : present ? "updated" : "added", detail: file };
  }

  if (remove && !raw.includes(`"${NAME}"`)) return { client: c.label, status: "absent" };
  let config: Record<string, any>;
  try {
    config = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {
      client: c.label,
      status: "error",
      detail: `${file} is not plain JSON (comments?). Add this by hand under "${c.format === "vscode" ? "servers" : "mcpServers"}": ${JSON.stringify(entry(c))}`,
    };
  }
  const key = c.format === "vscode" ? "servers" : "mcpServers";
  const servers = (config[key] ??= {});
  const before = JSON.stringify(servers[NAME]);
  if (remove) {
    if (!(NAME in servers)) return { client: c.label, status: "absent" };
    delete servers[NAME];
  } else {
    servers[NAME] = entry(c);
  }
  if (!remove && before === JSON.stringify(servers[NAME])) return { client: c.label, status: "unchanged", detail: file };
  if (!dryRun) {
    await backup(file);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(config, null, 2) + "\n");
  }
  return { client: c.label, status: remove ? "removed" : before ? "updated" : "added", detail: file };
}

const entry = (c: Client) => (c.format === "vscode" ? { type: "stdio", ...COMMAND } : { ...COMMAND });

function applyCli(c: Client, remove: boolean, dryRun: boolean): Result {
  const { bin, add, remove: rm } = c.cli!;
  if (!hasBin(bin)) return { client: c.label, status: "skipped", detail: `"${bin}" not on PATH` };
  if (dryRun) return { client: c.label, status: remove ? "removed" : "added", detail: `would run: ${bin} ${(remove ? rm : add).join(" ")}` };
  if (!remove) spawnSync(bin, rm, { stdio: "ignore", shell: WIN }); // re-add cleanly if already there
  const r = spawnSync(bin, remove ? rm : add, { encoding: "utf8", shell: WIN });
  if (r.status !== 0) {
    const out = `${r.stderr ?? ""}${r.stdout ?? ""}`.trim();
    if (remove && /not found|no .*server/i.test(out)) return { client: c.label, status: "absent" };
    return { client: c.label, status: "error", detail: out || `${bin} exited with ${r.status}` };
  }
  return { client: c.label, status: remove ? "removed" : "added", detail: `${bin} mcp (user scope)` };
}

export async function install(argv: string[]) {
  const flag = (f: string) => argv.includes(f);
  const remove = flag("--uninstall");
  const dryRun = flag("--dry-run");
  const yes = flag("--yes") || flag("-y");
  const wanted = argv.flatMap((a, i) => (a === "--client" && argv[i + 1] ? argv[i + 1].split(",") : []));

  const unknown = wanted.filter((w) => !CLIENTS.some((c) => c.id === w));
  if (unknown.length) throw new Error(`Unknown client(s): ${unknown.join(", ")}. Known: ${CLIENTS.map((c) => c.id).join(", ")}`);

  const detected: Client[] = [];
  for (const c of CLIENTS) {
    if (wanted.length ? wanted.includes(c.id) : (await exists(c.detect)) || (c.cli && hasBin(c.cli.bin))) detected.push(c);
  }
  if (!detected.length) {
    console.log(`No supported MCP client found. Supported: ${CLIENTS.map((c) => c.label).join(", ")}.\nAdd it by hand: ${JSON.stringify({ mcpServers: { [NAME]: COMMAND } })}`);
    return { results: [] as Result[], installed: false };
  }

  console.log(`${dryRun ? "[dry run] " : ""}${remove ? "Remove from" : "Install for"}: ${detected.map((c) => c.label).join(", ")}`);
  const rl = !yes && !dryRun && process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;

  const results: Result[] = [];
  for (const c of detected) {
    if (rl) {
      const a = (await rl.question(`  ${remove ? "Remove from" : "Add to"} ${c.label}? [Y/n] `)).trim().toLowerCase();
      if (a === "n" || a === "no") {
        results.push({ client: c.label, status: "skipped", detail: "declined" });
        continue;
      }
    }
    try {
      results.push(c.cli ? applyCli(c, remove, dryRun) : await applyFile(c, remove, dryRun));
    } catch (err) {
      results.push({ client: c.label, status: "error", detail: err instanceof Error ? err.message : String(err) });
    }
  }
  rl?.close();

  const icon = { added: "✅", updated: "✅", removed: "🗑️ ", unchanged: "✔️ ", absent: "·", skipped: "⏭️ ", error: "❌" } as const;
  for (const r of results) console.log(`  ${icon[r.status]} ${r.client}: ${r.status}${r.detail ? ` (${r.detail})` : ""}`);
  if (!dryRun && results.some((r) => ["added", "updated", "removed"].includes(r.status))) {
    console.log("Restart the affected apps to apply the change. Backups of edited files end in .bak-<date>.");
  }
  return { results, installed: results.some((r) => ["added", "updated", "unchanged"].includes(r.status)) };
}
