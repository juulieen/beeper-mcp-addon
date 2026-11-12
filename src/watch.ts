#!/usr/bin/env node
/**
 * beeper-watch — print one line per incoming Beeper message, in real time.
 *
 * MCP tools can only be polled. This command listens to the Beeper Client API
 * WebSocket instead, so an agent can be woken up when someone writes, e.g. with
 * Claude Code's Monitor tool:   beeper-watch --chat 22565 --once
 *
 * Output: one JSON object per line (NDJSON) on stdout. Status and errors go to stderr,
 * except connection loss, which is also reported on stdout so a watcher never stays silent.
 */
import { parseArgs } from "node:util";
import { BASE_URL, NO_TOKEN_HELP, getToken } from "./auth.js";

const HELP = `Usage: beeper-watch [options]

Print one JSON line per new message received in Beeper.

Options:
  --chat <id>        Only watch this chat (chat ID or local chat ID). Repeatable. Default: all chats
  --from <text>      Only messages whose sender name or ID contains <text> (case-insensitive)
  --include-own      Also print messages you send (skipped by default)
  --once             Exit after the first matching message
  --token-file <p>   Read the access token from this file
  -h, --help         Show this help

Token: BEEPER_ACCESS_TOKEN, else the one saved by "beeper-mcp-addon login" (read scope is enough).
Environment: BEEPER_URL (default http://localhost:23373)`;

const { values: opts } = parseArgs({
  options: {
    chat: { type: "string", multiple: true },
    from: { type: "string" },
    "include-own": { type: "boolean", default: false },
    once: { type: "boolean", default: false },
    "token-file": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

const TOKEN = await getToken(opts["token-file"]);
if (!TOKEN) {
  console.error(`beeper-watch: ${NO_TOKEN_HELP}`);
  process.exit(1);
}

type Entry = {
  id: string;
  chatID: string;
  accountID?: string;
  senderID?: string;
  senderName?: string;
  timestamp?: string;
  type?: string;
  text?: string;
  isSender?: boolean;
  attachments?: { type?: string; fileName?: string }[];
};
type Chat = { id: string; title?: string; network?: string };

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}/v1${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`Beeper API ${res.status} on ${path}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Fail fast on a bad token or a stopped Beeper, instead of retrying forever.
try {
  await api("/accounts");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`beeper-watch: ${msg === "fetch failed" ? `cannot reach Beeper at ${BASE_URL}. Is Beeper Desktop running with the API enabled?` : msg}`);
  process.exit(1);
}

const chats = new Map<string, Chat>();
async function chatInfo(id: string): Promise<Chat> {
  if (!chats.has(id)) {
    chats.set(id, await api<Chat>(`/chats/${encodeURIComponent(id)}`).catch(() => ({ id })));
  }
  return chats.get(id)!;
}

// Local chat IDs (e.g. "22565") are resolved to full chat IDs for the subscription.
const watched = opts.chat?.length ? await Promise.all(opts.chat.map(async (c) => (await chatInfo(c)).id)) : ["*"];
for (const id of watched) if (id !== "*") chats.set(id, await chatInfo(id));

const seen = new Set<string>();
const from = opts.from?.toLowerCase();

function emit(line: object) {
  process.stdout.write(JSON.stringify(line) + "\n");
}

async function onEntry(e: Entry) {
  const key = `${e.chatID}|${e.id}`;
  if (seen.has(key)) return; // the same message is upserted again once confirmed
  seen.add(key);
  if (seen.size > 5000) seen.delete(seen.values().next().value!);

  if (e.isSender && !opts["include-own"]) return;
  if (from && !`${e.senderName ?? ""} ${e.senderID ?? ""}`.toLowerCase().includes(from)) return;

  const chat = await chatInfo(e.chatID);
  emit({
    event: "message",
    chatID: e.chatID,
    chat: chat.title,
    network: chat.network,
    messageID: e.id,
    sender: e.senderName ?? e.senderID,
    time: e.timestamp,
    type: e.type,
    text: e.text,
    ...(e.attachments?.length ? { attachments: e.attachments.map((a) => a.fileName ?? a.type) } : {}),
  });
  if (opts.once) process.exit(0);
}

let retry = 0;
function connect() {
  const wsURL = `${BASE_URL.replace(/^http/, "ws")}/v1/ws`;
  // Node's WebSocket (undici) accepts headers in the options object.
  const ws = new WebSocket(wsURL, { headers: { Authorization: `Bearer ${TOKEN}` } } as unknown as string[]);

  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as { type: string; entries?: Entry[]; message?: string };
    if (msg.type === "ready") {
      ws.send(JSON.stringify({ type: "subscriptions.set", chatIDs: watched }));
    } else if (msg.type === "subscriptions.updated") {
      retry = 0;
      console.error(`beeper-watch: listening on ${watched[0] === "*" ? "all chats" : watched.map((id) => chats.get(id)?.title ?? id).join(", ")}`);
    } else if (msg.type === "message.upserted") {
      for (const e of msg.entries ?? []) void onEntry(e);
    } else if (msg.type === "error") {
      console.error(`beeper-watch: server error: ${msg.message ?? JSON.stringify(msg)}`);
    }
  };
  ws.onerror = () => {}; // followed by onclose
  ws.onclose = (ev) => {
    const delay = Math.min(30_000, 1000 * 2 ** retry++);
    // Messages sent while disconnected are not replayed by Beeper: say so on stdout.
    emit({ event: "disconnected", code: ev.code, reason: ev.reason || undefined, retryInSeconds: delay / 1000 });
    setTimeout(connect, delay);
  };
}

connect();
