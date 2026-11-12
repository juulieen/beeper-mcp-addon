#!/usr/bin/env node
// node scripts/release.mjs <x.y.z> <notes.md>   (see .agents/skills/release/SKILL.md)
//
// Refuses unless master is clean and up to date, checks and tests pass, and the docs and security
// reviews are current. Then: bump the version everywhere, commit, push, and create the GitHub
// release (which creates the tag). GitHub Actions does the rest: CI, npm (trusted publishing),
// the .mcpb, and the MCP registry.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const [version, notes] = process.argv.slice(2);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
const out = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const fail = (msg) => (console.error(`release: ${msg}`), process.exit(1));

if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || !notes) fail("usage: node scripts/release.mjs <x.y.z> <notes.md>");
if (!existsSync(notes) || readFileSync(notes, "utf8").trim().length < 20) fail(`release notes missing or empty: ${notes}`);
const current = JSON.parse(readFileSync("package.json", "utf8")).version;
const [a, b] = [version, current].map((v) => v.split(".").map(Number));
if (!(a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2]))))) fail(`${version} is not newer than ${current}`);

if (out("git", ["branch", "--show-current"]) !== "master") fail("not on master");
if (out("git", ["status", "--porcelain", "--untracked-files=no"])) fail("uncommitted changes");
run("git", ["fetch", "-q", "origin", "master"]);
if (out("git", ["rev-parse", "HEAD"]) !== out("git", ["rev-parse", "origin/master"])) fail("master differs from origin/master (pull or push first)");

run("npm", ["run", "--silent", "check"]);
run("npm", ["test", "--silent"], { stdio: ["ignore", "ignore", "inherit"] });
const status = out(process.execPath, ["scripts/review-state.mjs", "status"]);
if (status.includes("✗")) fail(`reviews are not up to date:\n${status}`);

run("npm", ["version", version, "--no-git-tag-version"]); // also syncs server.json and manifest.json
run("git", ["add", "package.json", "package-lock.json", "server.json", "manifest.json"]);
run("git", ["commit", "-q", "-m", `chore: release ${version}`]);
run("git", ["push", "-q", "origin", "master"]);
run("gh", ["release", "create", `v${version}`, "--target", out("git", ["rev-parse", "HEAD"]), "--title", `v${version}`, "--notes-file", notes]);
run("git", ["fetch", "-q", "--tags"]);
console.log(`\nv${version} released. Follow the publishing at: gh run list --limit 3`);
