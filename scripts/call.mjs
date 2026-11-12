#!/usr/bin/env node
// npm run call -- <tool> '<json args>' [<tool> '<json args>' ...]
// npm run call -- --list
//
// Starts the built server (dist/index.js) over stdio, like an MCP client would, and calls tools on
// the real Beeper Desktop. Several calls in one run share the same server process.
// Tools that send or delete act for real: test in "Note to self" (see AGENTS.md).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (!args.length || args[0] === "-h" || args[0] === "--help") {
  console.log("Usage: npm run call -- <tool> '<json args>' [...]   |   npm run call -- --list   |   npm run call -- --instructions");
  process.exit(0);
}
const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const client = new Client({ name: "beeper-mcp-addon-call", version: "1" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry], env: process.env, stderr: "inherit" }));

try {
  if (args[0] === "--list") {
    for (const t of (await client.listTools()).tools) console.log(`${t.name}: ${t.description?.split(". ")[0]}`);
  } else if (args[0] === "--instructions") {
    console.log(client.getInstructions());
  } else {
    for (let i = 0; i < args.length; i += 2) {
      const [name, raw = "{}"] = [args[i], args[i + 1]];
      const r = await client.callTool({ name, arguments: JSON.parse(raw) }, undefined, { timeout: 30 * 60_000 });
      console.log(`── ${name}${r.isError ? " (error)" : ""}`);
      for (const c of r.content) console.log(c.type === "text" ? c.text : JSON.stringify(c));
      if (r.isError) process.exitCode = 1;
    }
  }
} finally {
  await client.close();
}
