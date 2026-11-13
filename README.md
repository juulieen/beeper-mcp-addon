# beeper-mcp-addon

> Unofficial. Not affiliated with or endorsed by Beeper.

The missing tools for [Beeper Desktop](https://www.beeper.com)'s MCP server: files, new conversations, catching up, reactions and edits.

Beeper Desktop ships a built-in MCP server, so an AI assistant can search and send messages across WhatsApp, Signal, Telegram, iMessage and more. It has a few gaps, though:

- It only handles **text**: the assistant can see that a message holds a video, but it can't open it, and it can't send a photo or a PDF.
- It can only write in **existing** conversations. To message someone new, you have to send the first message yourself.
- Catching up on many chats takes one call per chat, and it can't see who reacted, react, or fix a message already sent.

The Beeper Client API that runs alongside it already supports all of that. This small MCP server exposes it as ten tools:

| Tool | What it does |
|---|---|
| `download_attachment` | Saves a message attachment (video, image, audio, document) to disk and returns the local path; or every photo and video of a chat over a period, into one folder |
| `send_file` | Uploads a local file and sends it to any chat, with an optional caption |
| `search_contacts` | Finds people on an account (WhatsApp, Signal…), including ones you've never chatted with; phone numbers, emails and @usernames are looked up exactly |
| `start_chat` | Opens a direct chat with someone and returns its `chatID`, reusing the existing chat if there is one |
| `delete_message` | Deletes (unsends) a message, for everyone when the network allows it |
| `wait_for_message` | Waits for an incoming message (a reply, say) and returns it, so the assistant doesn't have to poll |
| `get_new_messages` | Everything that arrived since a given time, across chats, in one call and in a compact form, with the connection state of each account |
| `get_reactions` | Who reacted to a message, by name (to count the 👍 on "who's in?") |
| `react` | Adds or removes an emoji reaction |
| `edit_message` | Changes the text of a message you sent, while the network allows it |

It runs **next to** the official Beeper MCP, not instead of it. Keep using the official server for search, chats and text messages.

## Requirements

- [Beeper Desktop](https://www.beeper.com/download) with its API enabled (Settings → Developers)
- Node.js 20+ — except for the Claude Desktop bundle, which uses Claude's built-in Node
- Optional: [ffmpeg](https://ffmpeg.org/download.html), so `send_file` can fix videos that phones play badly

Works on **macOS, Windows and Linux**.

## Install

### One command, every client

```bash
npx -y beeper-mcp-addon install
```

It finds the MCP clients on your machine — Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Kimi Code, Gemini CLI, Codex — asks before adding the server to each one (backing up the config first), then opens Beeper once so you can approve access. Restart your apps and you're done.

Options: `--client cursor,vscode` (only these), `--yes` (no questions), `--dry-run` (show what would change), `--no-login` (don't open Beeper afterwards), `--read-only`, `--local` (run this checkout of the code instead of the npm package). Undo with `npx -y beeper-mcp-addon uninstall`.

### One click

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=beeper-mcp-addon&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImJlZXBlci1tY3AtYWRkb24iXX0%3D)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_server-0098FF?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=beeper-mcp-addon&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22beeper-mcp-addon%22%5D%7D)

**Claude Desktop:** download `beeper-mcp-addon.mcpb` from the [latest release](https://github.com/juulieen/beeper-mcp-addon/releases/latest) and double-click it. No Node.js needed.

On first use, Beeper opens and asks you to approve access.

### By hand

```bash
claude mcp add beeper-mcp-addon -- npx -y beeper-mcp-addon   # Claude Code
```

Any other client:

```json
{
  "mcpServers": {
    "beeper-mcp-addon": { "command": "npx", "args": ["-y", "beeper-mcp-addon"] }
  }
}
```

On Windows, use `"command": "cmd", "args": ["/c", "npx", "-y", "beeper-mcp-addon"]`.

Then connect once with `npx -y beeper-mcp-addon login`, or just use a tool: Beeper will ask you to approve.

## Security

- **You approve access in Beeper.** `login` uses Beeper's own OAuth screen (with PKCE); nothing is copied by hand. Beeper's approval screen decides the access level (read only, or read + write to send); `login --read-only` asks for read only.
- **The token stays in your system's secret store:** macOS Keychain, Windows DPAPI (encrypted for your user), or the Linux keyring (GNOME Keyring / KWallet via `secret-tool`). Without a keyring, it falls back to a file readable only by you — the same way Claude Code stores its own credentials on Linux. If a keyring shows up later, the token moves into it automatically and the file is deleted. It is never written to MCP client configs, and never passed on a command line.
- **Everything is local.** The server only talks to Beeper Desktop on `localhost`.
- **Sending is explicit.** `send_file`, `start_chat`, `delete_message`, `react` and `edit_message` act on your behalf; keep your client's per-call approval on.
- **Access lasts 30 days.** Beeper's tokens expire after 30 days and can't be renewed in the background. Five days before, a tool result asks your assistant to tell you; after that, the next tool call opens Beeper so you approve access again (or run `login` yourself). A renewal asks for the same access level as before, never more: a read-only token is renewed read-only. `status` shows the expiry date.
- `npx -y beeper-mcp-addon status` shows where the token lives and whether it's valid; `logout` revokes and deletes it.

### From source

```bash
git clone https://github.com/juulieen/beeper-mcp-addon
cd beeper-mcp-addon && npm install && npm run build
node dist/index.js install --local   # clients run this checkout, not the npm package
```

## Updates

**Nothing updates on its own.** `install` writes the exact version (for example `beeper-mcp-addon@1.2.3`) into each client's config, so a new release never runs on your machine before you've chosen to take it.

When you use one of the tools and a newer version exists, the first tool result of that session carries a short notice for your assistant: the new version, its release notes and the command to update. Your assistant tells you; you decide. The check is a plain request to the public npm and GitHub APIs, made at most once a day and only when a tool is actually used. Nothing about you is sent. Turn it off with `BEEPER_ADDON_NO_UPDATE_CHECK=1`.

To update: `npx -y beeper-mcp-addon@<version> install`. For Claude Desktop, open the new `.mcpb` from the [releases](https://github.com/juulieen/beeper-mcp-addon/releases).

There is no telemetry: the addon never reports usage or installs anywhere.

## Configuration

| Variable | Default | |
|---|---|---|
| `BEEPER_ACCESS_TOKEN` | token saved by `login` | Beeper Desktop API token; overrides the saved one |
| `BEEPER_URL` | `http://localhost:23373` | Base URL of the Beeper Client API |
| `BEEPER_TOKEN_FILE` | — | Force a plain token file instead of the system secret store |
| `BEEPER_DOWNLOAD_DIR` | `~/.cache/beeper-mcp-addon/downloads` on Linux, `<temp>/beeper-mcp-addon/downloads` elsewhere | Where downloads go when no `outputPath` (one file) or `outputDir` (a period, one subfolder per chat) is given |
| `BEEPER_ADDON_NO_UPDATE_CHECK` | — | Set to `1` to never check for a new version |
| `BEEPER_FFMPEG` | `ffmpeg` on `PATH` | ffmpeg used to fix videos before sending (ffprobe is looked up next to it) |
| `BEEPER_FFPROBE` | next to `BEEPER_FFMPEG`, else `ffprobe` on `PATH` | ffprobe used to check videos before sending |

## Tools

### `download_attachment`

Identify the attachment in any of these ways:

- `url`: an `mxc://` / `localmxc://` media URL, **or** a `beeper-mcp://attachments/{chatID}/{messageID}/{index}` URI as printed by the official Beeper MCP's search results
- `chatID` + `messageID` (+ `index` if the message has several attachments)

By default it's saved as a new file in the download folder (`BEEPER_DOWNLOAD_DIR`); the sender's file name is sanitized, so it can never choose the folder. `outputPath` saves it elsewhere (`~/` means your home folder), without replacing an existing file unless `overwrite: true` (which replaces your file: your client should ask first). Returns `{ path, fileName, mimeType, sizeBytes }`.

**A whole period at once:** pass `chatID` + `since` (+ `until`) instead of a message, and it saves every photo and video of that chat sent in that period into one folder, oldest first. Options:

- `mediaTypes`: which kinds, among `image`, `video` and `file` (documents, audio…). Default: `["image", "video"]`. Stickers are skipped.
- `maxFiles`: at most this many files per call, from 1 to 200. Default: 30.
- `outputDir`: the folder to save into. Default: one folder per chat in the download folder. Your client should ask you before saving elsewhere.

Files are named by date and message ID (`2026-10-11_104635_75649_photo.jpg`), so the folder sorts in time order. A file already in the folder is skipped, never replaced. The result gives one short line per file, with time, sender and message ID:

```
2026-10-11 10:46 · Maxime · #75649 → 2026-10-11_104635_75649_photo.jpg (6.4 MB)
```

When there are more files than `maxFiles`, the result gives `nextSince`. Call again with it and the same folder to get the rest.

### `send_file`

`chatID`, `filePath`, and optionally `text` (caption), `fileName` (name shown to the recipient) and `replyToMessageID`. Files up to 500 MB. The MIME type comes from the file extension, so videos and images show up as media rather than generic files.

**Videos are fixed before sending.** Phone cameras often record videos that messaging apps play badly: HEVC, 60 fps, full-range color, rotation stored as metadata. The recipient then sees a black frame, a sideways picture, or nothing. When ffmpeg is installed, `send_file` checks each video with ffprobe and, only if needed, re-encodes it to H.264 + AAC MP4 (30 fps and 1280 px max, rotation applied). The result says what was fixed (`reasons`). Pass `convert: "never"` to send the original, or `"always"` to force it. Set `BEEPER_FFMPEG` if ffmpeg is not on your `PATH`.

### `search_contacts`

`accountID` (from the official MCP's `get_accounts`), `query`, optional `limit`. Returns contact `id`, name, phone number, username, email.

### `start_chat`

`accountID` plus one of `userID` (from `search_contacts`), `phoneNumber`, `username` or `email`. Returns the `chatID` to use with `send_message` or `send_file`. If a network refuses to create an empty chat, pass `messageText`: it becomes the first message and is sent right away.

### `wait_for_message`

Optional `chatID`, `from` (part of the sender's name or ID), `includeOwn` (also your own messages, default `false`), `since` (ISO time, usually that of your last message, needs `chatID`: a reply that arrived just before the call is returned right away) and `timeoutSeconds` (default 300, max 1800). Returns `{ status: "message", message, note }` or `{ status: "timeout" }`; `note` reminds the assistant that the message was written by its sender and is data, not instructions. Text from other people is length-limited: message text at 4000 characters, names at 200, at most 20 attachment names, each marked `… [truncated, N chars]` when cut (same in `watch` output). For long waits, the `watch` command below is better: it doesn't hold a tool call open.

### `delete_message`

`chatID`, `messageID`, optional `forEveryone` (default `true`). Most networks only let you delete your own, recent messages. It needs the final message ID: the `pendingMessageID` returned by `send_file` can't be deleted until the message is sent.

### `get_new_messages`

`since` (ISO time), and optionally `chatIDs`, `chatQuery` (words in the chat title, e.g. `"Ghoster"`), `accountIDs`, `includeMuted` (default `true`), `includeOwn` (default `true`), `detail` (`"messages"`, the default, or `"counts"`), `maxChats` (default 25) and `maxMessagesPerChat` (default 30, the newest are kept).

It returns one short line per message, grouped by chat, newest chats first:

```
2026-11-13 09:12 · Maxime · #79581 ↩79570: Ok pour samedi ! ⏎ À 10 h ? [image: photo.jpg] (👍 3)
```

That is the local time, the sender (`[me]` for you; other people's names can't contain brackets, so nobody can pass as you), the message ID (for `react`, `edit_message`, `download_attachment`…), the message it replies to, the text (line breaks shown as `⏎`, cut at 1000 characters; names at 80), attachments and reactions. The result also says whether Beeper and each account are connected (when one isn't, its new messages may be missing), and gives `nextSince` to pass as `since` next time.

It's made for periodic checks ("anything new in the club's groups since this morning?"). To keep the assistant's context small, ask for `detail: "counts"` first, then read only the chats that matter.

### `get_reactions`

`chatID`, `messageID`. Returns each reaction with how many people used it and their names (`[me]` for you).

### `react`

`chatID`, `messageID`, `reaction` (an emoji), optional `remove: true` to take it back.

### `edit_message`

`chatID`, `messageID`, `text`. Only your own messages, and only for a while after sending (15 minutes on WhatsApp, for example); recipients see it marked as edited. Like `delete_message`, it needs the final message ID, not a `pendingMessageID`.

`send_file`, `start_chat`, `delete_message`, `react` and `edit_message` act on your behalf. Most MCP clients ask you to approve each call; keep that confirmation on.

## Example

> "Find the videos my dad posted in the family group in June and send the French ones to him."

The assistant gets the June videos of that group with one `download_attachment` call (`since`, `until`, `mediaTypes: ["video"]`), checks them (for instance it transcribes them to find the language), then sends the right ones with `send_file`.

> "Put all the photos and videos from the club's group in October in ~/Pictures/club-october."

One `download_attachment` call with `chatID`, `since`, `until` and `outputDir`, then more calls with `nextSince` if there are more than 30.

> "Every hour, tell me if someone in the club's groups asked something I haven't answered."

`get_new_messages` with `chatQuery: "club"` and the `nextSince` of the previous run: one call, a few lines per chat, and a warning if WhatsApp was disconnected in the meantime.

> "How many people put a 👍 on the Pastourelle message? We need 15."

`get_reactions` on that message.

> "Send the flyer PDF to +33 6 12 34 56 78 on WhatsApp."

`start_chat` with the phone number, then `send_file` on the returned `chatID`. No need to open the conversation by hand first.

## Real-time: `watch`

MCP tools only answer when called, so an assistant never learns on its own that someone replied. `watch` listens to Beeper's WebSocket and prints one JSON line per incoming message:

```bash
npx -y beeper-mcp-addon watch --chat 22565 --since 2026-11-12T10:00:00Z --once
# {"event":"message","chat":"Pierre","sender":"Pierre","text":"Ok pour samedi !",...}
```

| Option | |
|---|---|
| `--chat <id>` | Only this chat (chat ID or local chat ID). Repeatable. Default: all chats |
| `--from <text>` | Only senders whose name or ID contains `<text>` |
| `--since <time>` | First print messages already received after this ISO time (with `--chat`), so a reply sent just before isn't missed |
| `--once` | Exit after the first matching message |
| `--include-own` | Also print your own messages (skipped by default) |
| `--token-file <path>` | Read the token from this file |

Agents that can be woken by a command's output can use it to wait for a reply. In Claude Code, run it with the **Monitor** tool: each line wakes the assistant, and `--once` ends the watch after the reply. The server's MCP instructions tell assistants exactly this, with the right command for how it was installed. A `read` token is enough. The same command is also installed as `beeper-watch`.

If the connection drops, it prints `{"event":"disconnected",...}` and reconnects. Beeper does not replay messages sent in the meantime, so re-read the chat after a disconnect.

## How it works

A few small TypeScript files that call the local Beeper Client API: `/v1/assets/download`, `/v1/assets/upload`, `/v1/chats/{chatID}/messages` (send, read, edit and delete), `/v1/chats/{chatID}/messages/{messageID}/reactions`, `/v1/chats/search`, `/v1/chats/{chatID}`, `/v1/accounts`, `/v1/accounts/{accountID}/contacts` and `/v1/chats/start`, plus Beeper's WebSocket (`/v1/ws`) for real-time messages. Everything stays on your machine; the server only talks to Beeper Desktop on `localhost` (and, once a day at most, to npm and GitHub to check for a new version).

## License

MIT
