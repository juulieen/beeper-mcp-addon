#!/usr/bin/env node
// Tracks which agent reviews are up to date, by content fingerprint (like ttt-chrono's e2e cache).
//
//   node scripts/review-state.mjs status            which reviews are needed, and why
//   node scripts/review-state.mjs diff <review>     what changed since that review last passed
//   node scripts/review-state.mjs pass <review>     record a passed review (reviewers only)
//   node scripts/review-state.mjs stop-hook         Claude Code / Kimi Code "Stop" hook
//
// A review is needed when the files in its scope differ from the last time it passed. The stop
// hook refuses to end the agent's turn (exit 2) until every needed review has passed.
// Markers live in the git dir: local, never committed, per worktree.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const REVIEWS = {
  docs: {
    agent: "doc-reviewer",
    why: "the code or the docs changed: README, tool descriptions, manifest and registry entry must still agree",
    scope: (f) => /^(src\/|README\.md$|AGENTS\.md$|docs\/|manifest\.json$|server\.json$|package\.json$)/.test(f),
  },
  security: {
    agent: "security-reviewer",
    why: "token handling, client configs, tools that act for the user, dependencies or CI changed",
    scope: (f) =>
      /^(src\/(auth|secret-store|install|update|listen|index|video|media|messages|watch)\.ts$|package(-lock)?\.json$|\.github\/workflows\/|scripts\/hooks\/)/.test(f),
  },
};

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const root = git("rev-parse", "--show-toplevel");
process.chdir(root);
const markerDir = join(git("rev-parse", "--git-dir"), "agent-reviews");

/** Tracked and untracked (not ignored) files of a review's scope, with their current content. */
function scopeFiles(name) {
  return git("ls-files", "-co", "--exclude-standard", "-z")
    .split("\0")
    .filter((f) => f && REVIEWS[name].scope(f))
    .sort();
}
function fingerprint(name) {
  const h = createHash("sha256");
  for (const f of scopeFiles(name)) h.update(f + "\0" + (existsSync(f) ? readFileSync(f) : "<deleted>") + "\0");
  return h.digest("hex");
}
const markerFile = (name) => join(markerDir, `${name}.json`);
const marker = (name) => (existsSync(markerFile(name)) ? JSON.parse(readFileSync(markerFile(name), "utf8")) : undefined);
const needed = () => Object.keys(REVIEWS).filter((n) => marker(n)?.fingerprint !== fingerprint(n));

const [cmd, name] = process.argv.slice(2);
const known = (n) => {
  if (!REVIEWS[n]) {
    console.error(`Unknown review "${n}". Known: ${Object.keys(REVIEWS).join(", ")}`);
    process.exit(1);
  }
};

if (cmd === "status") {
  for (const n of Object.keys(REVIEWS)) {
    const m = marker(n);
    const ok = m?.fingerprint === fingerprint(n);
    console.log(`${ok ? "✓" : "✗"} ${n}: ${ok ? `up to date (passed ${m.at})` : `needed — ${REVIEWS[n].why}`}`);
  }
} else if (cmd === "diff") {
  known(name);
  const base = marker(name)?.commit;
  const files = scopeFiles(name);
  if (!base) {
    console.log(`# No previous ${name} review: review these files in full.\n${files.join("\n")}`);
  } else {
    console.log(`# Changes in the ${name} scope since the last passed review (snapshot ${base.slice(0, 10)}), including uncommitted ones:\n`);
    const tracked = new Set(git("ls-files", "-z").split("\0"));
    // git diff <commit> compares that commit to the working tree; new untracked files are listed after.
    process.stdout.write(execFileSync("git", ["diff", base, "--", ...files.filter((f) => tracked.has(f) || !existsSync(f))], { encoding: "utf8" }));
    const untracked = files.filter((f) => !tracked.has(f));
    if (untracked.length) console.log(`\n# New untracked files (read them in full):\n${untracked.join("\n")}`);
  }
} else if (cmd === "pass") {
  known(name);
  mkdirSync(markerDir, { recursive: true });
  // Snapshot of the working tree as reviewed (tracked files), without touching it; a ref keeps it
  // from being garbage-collected. The next `diff` then shows only what changed after this review.
  const snapshot = git("stash", "create") || git("rev-parse", "HEAD");
  git("update-ref", `refs/agent-reviews/${name}`, snapshot);
  const m = { fingerprint: fingerprint(name), commit: snapshot, at: new Date().toISOString() };
  writeFileSync(markerFile(name), JSON.stringify(m, null, 2));
  console.log(`✓ ${name} review recorded for the current files.`);
} else if (cmd === "stop-hook") {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {}
  const todo = needed();
  // Already blocked once in this turn and still not done: let the turn end, the user will see it.
  if (!todo.length || input.stop_hook_active || input.stopHookActive) process.exit(0);
  console.error(
    `Before ending your turn, run these reviews as subagents (fresh context, see AGENTS.md → Reviews):\n` +
      todo.map((n) => `- ${REVIEWS[n].agent}: ${REVIEWS[n].why}`).join("\n") +
      `\nFix what they report, and re-run them until they pass. Each reviewer records its own pass.` +
      `\n(If you changed nothing in this repository during this turn, say so to the user and end the turn.)`,
  );
  process.exit(2);
} else {
  console.log("Usage: node scripts/review-state.mjs status | diff <review> | pass <review> | stop-hook");
  process.exit(cmd ? 1 : 0);
}
