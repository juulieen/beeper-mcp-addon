import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const ENTRY = join(ROOT, "dist", "index.js");
export const tempDir = (name) => mkdtempSync(join(tmpdir(), `bma-${name}-`));

/** A fake user profile: every client config lands inside it, never in the real one. */
export function fakeHome() {
  const home = tempDir("home");
  return {
    home,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, "AppData", "Roaming"),
      XDG_CONFIG_HOME: join(home, ".config"),
      BEEPER_ACCESS_TOKEN: "test-token",
      BEEPER_ADDON_NO_UPDATE_CHECK: "1",
    },
  };
}

export function cli(args, env) {
  const r = spawnSync(process.execPath, [ENTRY, ...args], { env, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

export const hasBin = (bin) => spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0;
