// Run by `npm install` (prepare): point git at scripts/hooks, so the hooks need no setup and work
// in every worktree. Does nothing outside a git checkout (e.g. when installed from npm).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".git") && !process.env.CI) {
  try {
    execFileSync("git", ["config", "core.hooksPath", "scripts/hooks"], { stdio: "ignore" });
  } catch {}
}
