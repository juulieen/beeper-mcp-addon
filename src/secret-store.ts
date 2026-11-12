/**
 * Stores the Beeper token in the operating system's secret store, with no native dependency:
 *
 *   macOS    Keychain, via the built-in `security` tool
 *   Windows  a file encrypted with DPAPI (tied to the Windows user), via built-in PowerShell
 *   Linux    the Secret Service keyring (GNOME Keyring, KWallet) via `secret-tool`, when available
 *   fallback a JSON file readable only by the current user (mode 0600), like Claude Code on Linux
 *
 * The secret is always passed on stdin, never as a command-line argument, so it never shows up
 * in the process list.
 */
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, platform, userInfo } from "node:os";
import { dirname, join } from "node:path";

const SERVICE = "beeper-mcp-addon";
const ACCOUNT = "beeper-desktop-token";

export const CONFIG_DIR =
  platform() === "win32"
    ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), SERVICE)
    : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), SERVICE);

/** Plain-file location: used on Linux without a keyring, or when BEEPER_TOKEN_FILE is set. */
export const TOKEN_FILE = process.env.BEEPER_TOKEN_FILE ?? join(CONFIG_DIR, "token.json");
const DPAPI_FILE = join(CONFIG_DIR, "token.dpapi");

export type Backend = "macos-keychain" | "windows-dpapi" | "secret-service" | "file";

function run(cmd: string, args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch {
      return resolve({ code: -1, stdout: "", stderr: `${cmd} not found` });
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", () => resolve({ code: -1, stdout, stderr: `${cmd} not found` }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
const powershell = (script: string, input?: string) =>
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], input);

let linuxKeyring: boolean | undefined;
async function hasSecretService(): Promise<boolean> {
  if (linuxKeyring === undefined) {
    // `secret-tool` exists and a keyring daemon answers on the session bus.
    const probe = await run("secret-tool", ["search", "service", SERVICE]);
    linuxKeyring = probe.code === 0 || (probe.code === 1 && !/not found|cannot|error/i.test(probe.stderr));
  }
  return linuxKeyring;
}

export async function backend(): Promise<Backend> {
  if (process.env.BEEPER_TOKEN_FILE) return "file";
  if (platform() === "darwin") return "macos-keychain";
  if (platform() === "win32") return "windows-dpapi";
  if (platform() === "linux" && (await hasSecretService())) return "secret-service";
  return "file";
}

export async function saveSecret(value: string): Promise<Backend> {
  const b = await backend();
  if (b === "macos-keychain") {
    // `security -i` reads commands from stdin: the token never appears in argv.
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const r = await run("security", ["-i"], `add-generic-password -U -s "${SERVICE}" -a "${ACCOUNT}" -w "${escaped}"\n`);
    if (r.code === 0 && !/error/i.test(r.stderr)) return b;
  } else if (b === "windows-dpapi") {
    await mkdir(CONFIG_DIR, { recursive: true });
    const r = await powershell(
      `$s = [Console]::In.ReadToEnd() | ConvertTo-SecureString -AsPlainText -Force; ` +
        `ConvertFrom-SecureString $s | Set-Content -NoNewline -Path ${psQuote(DPAPI_FILE)}`,
      value,
    );
    if (r.code === 0) return b;
  } else if (b === "secret-service") {
    const r = await run("secret-tool", ["store", "--label=Beeper token (beeper-mcp-addon)", "service", SERVICE, "account", ACCOUNT], value);
    if (r.code === 0) return b;
  }
  // Fallback: owner-only file.
  await mkdir(dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
  await writeFile(TOKEN_FILE, value, { mode: 0o600 });
  await chmod(TOKEN_FILE, 0o600).catch(() => {});
  return "file";
}

export async function readSecret(): Promise<string | undefined> {
  const b = await backend();
  if (b === "macos-keychain") {
    const r = await run("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
  } else if (b === "windows-dpapi") {
    const r = await powershell(
      `if (Test-Path ${psQuote(DPAPI_FILE)}) { $s = Get-Content -Raw ${psQuote(DPAPI_FILE)} | ConvertTo-SecureString; ` +
        `[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) }`,
    );
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
  } else if (b === "secret-service") {
    const r = await run("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT]);
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  try {
    return (await readFile(TOKEN_FILE, "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function deleteSecret(): Promise<void> {
  const b = await backend();
  if (b === "macos-keychain") await run("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
  else if (b === "windows-dpapi") await rm(DPAPI_FILE, { force: true });
  else if (b === "secret-service") await run("secret-tool", ["clear", "service", SERVICE, "account", ACCOUNT]);
  await rm(TOKEN_FILE, { force: true });
}

export function describe(b: Backend): string {
  return {
    "macos-keychain": `macOS Keychain (service "${SERVICE}")`,
    "windows-dpapi": `${DPAPI_FILE}, encrypted for Windows user ${userInfo().username}`,
    "secret-service": `system keyring (service "${SERVICE}")`,
    file: `${TOKEN_FILE} (readable only by you)`,
  }[b];
}
