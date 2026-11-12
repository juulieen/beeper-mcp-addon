// npm test: run every test/*.test.mjs with node's built-in runner (no glob support needed, Node 20+).
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const files = readdirSync("test").filter((f) => f.endsWith(".test.mjs")).map((f) => `test/${f}`);
const r = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
