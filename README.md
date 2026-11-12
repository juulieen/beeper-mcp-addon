# beeper-mcp-addon

> Unofficial. Not affiliated with or endorsed by Beeper.

The missing tools for [Beeper Desktop](https://www.beeper.com)'s MCP server: files and new conversations.

Beeper Desktop ships a built-in MCP server, so an AI assistant can search and send messages across WhatsApp, Signal, Telegram, iMessage and more. It has two gaps, though:

- It only handles **text**: the assistant can see that a message holds a video, but it can't open it, and it can't send a photo or a PDF.
- It can only write in **existing** conversations. To message someone new, you have to send the first message yourself.

The Beeper Client API that runs alongside it already supports both. This small MCP server exposes them as five tools:

| Tool | What it does |
|---|---|
| `download_attachment` | Saves a message attachment (video, image, audio, document) to disk and returns the local path |
| `send_file` | Uploads a local file and sends it to any chat, with an optional caption |
| `search_contacts` | Finds people on an account (WhatsApp, Signal…), including ones you've never chatted with; phone numbers, emails and @usernames are looked up exactly |
| `start_chat` | Opens a direct chat with someone and returns its `chatID`, reusing the existing chat if there is one |
| `delete_message` | Deletes (unsends) a message, for everyone when the network allows it |

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

Options: `--client cursor,vscode` (only these), `--yes` (no questions), `--dry-run` (show what would change), `--read-only`. Undo with `npx -y beeper-mcp-addon uninstall`.

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

- **You approve access in Beeper.** `login` uses Beeper's own OAuth screen (with PKCE); nothing is copied by hand. Beeper's approval screen decides the access level (read only, or read + write to send).
- **The token stays in your system's secret store:** macOS Keychain, Windows DPAPI (encrypted for your user), or the Linux keyring (GNOME Keyring / KWallet via `secret-tool`). Without a keyring, it falls back to a file readable only by you — the same way Claude Code stores its own credentials on Linux. If a keyring shows up later, the token moves into it automatically and the file is deleted. It is never written to MCP client configs, and never passed on a command line.
- **Everything is local.** The server only talks to Beeper Desktop on `localhost`.
- **Sending is explicit.** `send_file`, `start_chat` and `delete_message` act on your behalf; keep your client's per-call approval on.
- `npx -y beeper-mcp-addon status` shows where the token lives and whether it's valid; `logout` revokes and deletes it.

### From source

```bash
git clone https://github.com/juulieen/beeper-mcp-addon
cd beeper-mcp-addon && npm install && npm run build
node dist/index.js install --local   # clients run this checkout, not the npm package
```

## Updates

**Nothing updates on its own.** `install` writes the exact version (`beeper-mcp-addon@0.1.0`) into each client's config, so a new release never runs on your machine before you've chosen to take it.

When you use one of the tools and a newer version exists, the first tool result of that session carries a short notice for your assistant: the new version, its release notes and the command to update. Your assistant tells you; you decide. The check is a plain request to the public npm and GitHub APIs, made at most once a day and only when a tool is actually used. Nothing about you is sent. Turn it off with `BEEPER_ADDON_NO_UPDATE_CHECK=1`.

To update: `npx -y beeper-mcp-addon@<version> install`. For Claude Desktop, open the new `.mcpb` from the [releases](https://github.com/juulieen/beeper-mcp-addon/releases).

There is no telemetry: the addon never reports usage or installs anywhere.

## Configuration

| Variable | Default | |
|---|---|---|
| `BEEPER_ACCESS_TOKEN` | token saved by `login` | Beeper Desktop API token; overrides the saved one |
| `BEEPER_URL` | `http://localhost:23373` | Base URL of the Beeper Client API |
| `BEEPER_TOKEN_FILE` | — | Force a plain token file instead of the system secret store |
| `BEEPER_DOWNLOAD_DIR` | `<tmp>/beeper-mcp-addon` | Where downloads go when no `outputPath` is given |
| `BEEPER_ADDON_NO_UPDATE_CHECK` | — | Set to `1` to never check for a new version |
| `BEEPER_FFMPEG` | `ffmpeg` on `PATH` | ffmpeg used to fix videos before sending (ffprobe is looked up next to it) |

## Tools

### `download_attachment`

Identify the attachment in any of these ways:

- `url`: an `mxc://` / `localmxc://` media URL, **or** a `beeper-mcp://attachments/{chatID}/{messageID}/{index}` URI as printed by the official Beeper MCP's search results
- `chatID` + `messageID` (+ `index` if the message has several attachments)

Optional `outputPath` chooses where to save it. Returns `{ path, fileName, mimeType, sizeBytes }`.

### `send_file`

`chatID`, `filePath`, and optionally `text` (caption), `fileName` (name shown to the recipient) and `replyToMessageID`. Files up to 500 MB. The MIME type comes from the file extension, so videos and images show up as media rather than generic files.

**Videos are fixed before sending.** Phone cameras often record videos that messaging apps play badly: HEVC, 60 fps, full-range color, rotation stored as metadata. The recipient then sees a black frame, a sideways picture, or nothing. When ffmpeg is installed, `send_file` checks each video with ffprobe and, only if needed, re-encodes it to H.264 + AAC MP4 (30 fps and 1280 px max, rotation applied). The result says what was fixed (`reasons`). Pass `convert: "never"` to send the original, or `"always"` to force it. Set `BEEPER_FFMPEG` if ffmpeg is not on your `PATH`.

### `search_contacts`

`accountID` (from the official MCP's `get_accounts`), `query`, optional `limit`. Returns contact `id`, name, phone number, username, email.

### `start_chat`

`accountID` plus one of `userID` (from `search_contacts`), `phoneNumber`, `username` or `email`. Returns the `chatID` to use with `send_message` or `send_file`. If a network refuses to create an empty chat, pass `messageText`: it becomes the first message and is sent right away.

### `delete_message`

`chatID`, `messageID`, optional `forEveryone` (default `true`). Most networks only let you delete your own, recent messages. It needs the final message ID: the `pendingMessageID` returned by `send_file` can't be deleted until the message is sent.

`send_file`, `start_chat` and `delete_message` act on your behalf. Most MCP clients ask you to approve each call; keep that confirmation on.

## Example

> "Find the videos my dad posted in the family group in June and send the French ones to him."

The assistant searches with the official Beeper MCP, calls `download_attachment` on each video (for instance to transcribe and check the language), then `send_file` to forward the right ones.

> "Send the flyer PDF to +33 6 12 34 56 78 on WhatsApp."

`start_chat` with the phone number, then `send_file` on the returned `chatID`. No need to open the conversation by hand first.

## Real-time: `beeper-watch`

MCP tools can only be called, so an assistant never learns on its own that someone replied. The package also ships a small command that listens to Beeper's WebSocket and prints one JSON line per incoming message:

```bash
npx -p beeper-mcp-addon beeper-watch --chat 22565 --once
# {"event":"message","chat":"Pierre","sender":"Pierre","text":"Ok pour samedi !",...}
```

| Option | |
|---|---|
| `--chat <id>` | Only this chat (chat ID or local chat ID). Repeatable. Default: all chats |
| `--from <text>` | Only senders whose name or ID contains `<text>` |
| `--once` | Exit after the first matching message |
| `--include-own` | Also print your own messages (skipped by default) |
| `--token-file <path>` | Read the token from this file |

Agents that can be woken by a command's output can use it to wait for a reply. In Claude Code, run it with the **Monitor** tool: each line wakes the assistant, and `--once` ends the watch after the reply. A `read` token is enough.

If the connection drops, it prints `{"event":"disconnected",...}` and reconnects. Beeper does not replay messages sent in the meantime, so re-read the chat after a disconnect.

## How it works

It's about 450 lines of TypeScript that call the local Beeper Client API: `/v1/assets/download`, `/v1/assets/upload`, `/v1/chats/{chatID}/messages` (send and delete), `/v1/accounts/{accountID}/contacts` and `/v1/chats/start`. Everything stays on your machine; the server only talks to Beeper Desktop on `localhost`.

## License

MIT
