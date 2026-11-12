#!/usr/bin/env node
/**
 * beeper-watch — print one line per incoming Beeper message, in real time.
 *
 * MCP tools can only be polled. This command listens to the Beeper Client API
 * WebSocket instead, so an agent can be woken up when someone writes, e.g. with
 * Claude Code's Monitor tool:   beeper-mcp-addon watch --chat 22565 --once
 *
 * Output: one JSON object per line (NDJSON) on stdout. Status and errors go to stderr,
 * except connection loss, which is also reported on stdout so a watcher never stays silent.
 */
import { parseArgs } from "node:util";
import { BASE_URL, NO_TOKEN_HELP, getToken } from "./auth.js";
import { createClient, type IncomingMessage } from "./listen.js";

const HELP = `Usage: beeper-mcp-addon watch [options]   (also installed as: beeper-watch)

Print one JSON line per new message received in Beeper, in real time.

Options:
  --chat <id>        Only watch this chat (chat ID or local chat ID). Repeatable. Default: all chats
  --from <text>      Only messages whose sender name or ID contains <text> (case-insensitive)
  --since <time>     Also print messages already received after this ISO time (needs --chat),
                     e.g. the time of your last message, so a reply sent just before is not missed
  --include-own      Also print messages you send (skipped by default)
  --once             Exit after the first matching message
  --token-file <p>   Read the access token from this file
  -h, --help         Show this help

Token: BEEPER_ACCESS_TOKEN, else the one saved by "beeper-mcp-addon login" (read scope is enough).
Environment: BEEPER_URL (default http://localhost:23373)`;

const { values: opts } = parseArgs({
  // Accept both "beeper-watch ..." and "beeper-mcp-addon watch ...".
  args: process.argv.slice(process.argv[2] === "watch" ? 3 : 2),
  options: {
    chat: { type: "string", multiple: true },
    from: { type: "string" },
    since: { type: "string" },
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
const client = createClient(TOKEN);

// Fail fast on a bad token or a stopped Beeper, instead of retrying forever.
try {
  await client.api("/accounts");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`beeper-watch: ${msg === "fetch failed" ? `cannot reach Beeper at ${BASE_URL}. Is Beeper Desktop running with the API enabled?` : msg}`);
  process.exit(1);
}

const filter = { from: opts.from, includeOwn: opts["include-own"] };
const subscribed = await client.resolveChats(opts.chat);
const emit = (line: object) => process.stdout.write(JSON.stringify(line) + "\n");
const onMessage = (m: IncomingMessage) => {
  emit(m);
  if (opts.once) process.exit(0);
};

if (opts.since) {
  const since = new Date(opts.since);
  if (Number.isNaN(+since)) throw new Error(`--since: not a date: ${opts.since}`);
  if (subscribed[0] === "*") throw new Error("--since needs --chat");
  for (const m of await client.recentMessages(subscribed, since, filter)) onMessage(m);
}

client.listen(subscribed, filter, {
  onMessage,
  onReady: (titles) => console.error(`beeper-watch: listening on ${titles}`),
  // Messages sent while disconnected are not replayed by Beeper: say so on stdout.
  onDisconnect: (d) => emit({ event: "disconnected", ...d }),
  onError: (m) => console.error(`beeper-watch: server error: ${m}`),
});
