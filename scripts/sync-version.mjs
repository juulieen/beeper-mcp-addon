// Run by `npm version <x.y.z>`: copy package.json's version into server.json and manifest.json.
import { readFileSync, writeFileSync } from "node:fs";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
for (const file of ["server.json", "manifest.json"]) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  data.version = version;
  for (const p of data.packages ?? []) p.version = version;
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
console.log(`server.json and manifest.json set to ${version}`);
