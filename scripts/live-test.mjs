#!/usr/bin/env node
// npm run test:live — end-to-end run of the real tools against the local Beeper Desktop.
// Only ever writes to "Note to self" (or BEEPER_TEST_CHAT), and deletes what it sent.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_URL, getToken } from "../dist/auth.js";

const token = await getToken();
if (!token) throw new Error("Not logged in: run `node dist/index.js login` first.");
const rest = async (path) => (await fetch(`${BASE_URL}/v1${path}`, { headers: { Authorization: `Bearer ${token}` } })).json();

let chatID = process.env.BEEPER_TEST_CHAT;
if (!chatID) {
  const found = await rest(`/chats/search?query=${encodeURIComponent("Note to self")}&limit=10`);
  chatID = found.items?.find((c) => c.title === "Note to self" && c.accountID === "matrix")?.id;
  if (!chatID) throw new Error('No Beeper "Note to self" chat found; set BEEPER_TEST_CHAT to a chat of your own.');
}

const client = new Client({ name: "live-test", version: "1" });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [new URL("../dist/index.js", import.meta.url).pathname],
  env: { ...process.env, BEEPER_ADDON_NO_UPDATE_CHECK: "1" },
}));
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return JSON.parse(r.content[0].text);
};
const dir = mkdtempSync(join(tmpdir(), "bma-live-"));
const sent = [];
const step = (msg) => console.log(`✓ ${msg}`);

/** Send a file, then wait for the confirmed message (its final ID) with wait_for_message. */
async function sendAndConfirm(filePath, text, fileName = text.endsWith("evil name") ? "../../../../evil-test.txt" : undefined) {
  let since = new Date(Date.now() - 1000).toISOString();
  const r = await call("send_file", { chatID, filePath, text, ...(fileName ? { fileName } : {}) });
  // `since` returns the oldest message after that time: skip earlier ones until ours shows up.
  for (let i = 0; i < 5; i++) {
    const w = await call("wait_for_message", { chatID, since, includeOwn: true, timeoutSeconds: 60 });
    if (w.status !== "message") throw new Error(`sent message not seen: ${JSON.stringify(w)}`);
    if (w.message.text === text) {
      sent.push(w.message.messageID);
      return { ...r, messageID: w.message.messageID };
    }
    since = w.message.time;
  }
  throw new Error(`sent message "${text}" not found`);
}

const startedAt = new Date(Date.now() - 5000).toISOString();
try {
  const doc = join(dir, "live-test.txt");
  writeFileSync(doc, `beeper-mcp-addon live test ${new Date().toISOString()}\n`);
  const a = await sendAndConfirm(doc, "beeper-mcp-addon live test: file");
  step(`send_file + wait_for_message (message ${a.messageID})`);

  const d = await call("download_attachment", { chatID, messageID: a.messageID, outputPath: join(dir, "back.txt") });
  if (d.sizeBytes !== statSync(doc).size) throw new Error(`downloaded ${d.sizeBytes} bytes, sent ${statSync(doc).size}`);
  step("download_attachment returns the same file");

  // A sender-chosen name like "../../x" must never leave the download folder.
  const evil = await sendAndConfirm(doc, "beeper-mcp-addon live test: evil name");
  const e = await call("download_attachment", { chatID, messageID: evil.messageID });
  if (!e.path.includes("beeper-mcp-addon") || e.path.includes("..")) throw new Error(`unsafe download path: ${e.path}`);
  step(`download_attachment keeps a hostile file name in the download folder (${e.path})`);

  // Batch: both test files of this run, into one folder; a second call skips them.
  const batchDir = join(dir, "batch");
  const batch = { chatID, since: startedAt, mediaTypes: ["file"], outputDir: batchDir };
  const b1 = await call("download_attachment", batch);
  const names = readdirSync(batchDir);
  if (b1.saved < 2 || names.length !== b1.saved || !b1.files.some((l) => l.includes(`#${evil.messageID}`))) throw new Error(`batch download: ${JSON.stringify(b1)}`);
  if (names.some((n) => n.includes("..") || n.includes("/"))) throw new Error(`unsafe batch file name: ${names}`);
  const b2 = await call("download_attachment", batch);
  if (b2.saved !== 0 || b2.alreadySaved !== b1.saved) throw new Error(`batch download again: ${JSON.stringify(b2)}`);
  step(`download_attachment batch saves a period into one folder (${b1.saved} files), and skips them the second time`);

  // Reactions, edit, and catching up, on the first test message.
  await call("react", { chatID, messageID: a.messageID, reaction: "👍" });
  await new Promise((r) => setTimeout(r, 1500));
  const reacted = await call("get_reactions", { chatID, messageID: a.messageID });
  if (!reacted.reactions.some((r) => r.reaction === "👍" && r.people.includes("[me]"))) throw new Error(`reaction not seen: ${JSON.stringify(reacted)}`);
  await call("react", { chatID, messageID: a.messageID, reaction: "👍", remove: true });
  step("react adds and removes a reaction; get_reactions names who reacted");

  const edited = "beeper-mcp-addon live test: file (edited)";
  await call("edit_message", { chatID, messageID: a.messageID, text: edited });
  await new Promise((r) => setTimeout(r, 1500));
  const news = await call("get_new_messages", { since: new Date(Date.now() - 10 * 60_000).toISOString(), chatIDs: [chatID] });
  const lines = news.chats[0]?.messages ?? [];
  if (!lines.some((l) => l.includes(`#${a.messageID}`) && l.includes(edited))) throw new Error(`edit not seen in get_new_messages: ${JSON.stringify(news)}`);
  step("edit_message changes the text; get_new_messages shows it");

  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0) {
    const video = join(dir, "pixel.mp4");
    spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=60:duration=1",
      "-c:v", "libx264", "-pix_fmt", "yuvj420p", video]);
    const v = await sendAndConfirm(video, "beeper-mcp-addon live test: video");
    if (!v.reasons?.length) throw new Error("the 60 fps / yuvj420p video was not converted");
    step(`send_file converts a phone-style video (${v.reasons.join(", ")})`);
  } else console.log("- video conversion skipped (no ffmpeg)");
} finally {
  for (const messageID of sent) await call("delete_message", { chatID, messageID }).catch((e) => console.error(`✗ cleanup ${messageID}: ${e.message}`));
  await new Promise((r) => setTimeout(r, 1500));
  const left = [];
  for (const id of sent) if (!(await rest(`/chats/${encodeURIComponent(chatID)}/messages/${id}`)).isDeleted) left.push(id);
  if (left.length) console.error(`✗ not deleted: ${left.join(", ")}`);
  else if (sent.length) step(`delete_message cleaned up ${sent.length} test message(s)`);
  await client.close();
}
