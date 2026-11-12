# beeper-mcp-addon

> Unofficial. Not affiliated with or endorsed by Beeper.

The missing tools for [Beeper Desktop](https://www.beeper.com)'s MCP server: files and new conversations.

Beeper Desktop ships a built-in MCP server, so an AI assistant can search and send messages across WhatsApp, Signal, Telegram, iMessage and more. It has two gaps, though:

- It only handles **text**: the assistant can see that a message holds a video, but it can't open it, and it can't send a photo or a PDF.
- It can only write in **existing** conversations. To message someone new, you have to send the first message yourself.

The Beeper Client API that runs alongside it already supports both. This small MCP server exposes them as four tools:

| Tool | What it does |
|---|---|
| `download_attachment` | Saves a message attachment (video, image, audio, document) to disk and returns the local path |
| `send_file` | Uploads a local file and sends it to any chat, with an optional caption |
| `search_contacts` | Finds people on an account (WhatsApp, Signal…), including ones you've never chatted with; phone numbers, emails and @usernames are looked up exactly |
| `start_chat` | Opens a direct chat with someone and returns its `chatID`, reusing the existing chat if there is one |

It runs **next to** the official Beeper MCP, not instead of it. Keep using the official server for search, chats and text messages.

## Requirements

- Beeper Desktop with the API enabled (Settings → Developers)
- Node.js 20+ (macOS, Linux and Windows)

## Setup

**1. Connect to Beeper (once).** This opens Beeper so you can approve access, then saves a token on your machine:

```bash
npx -y beeper-mcp-addon login
```

The token is stored in `~/.config/beeper-mcp-addon/token.json` (Windows: `%APPDATA%\beeper-mcp-addon\token.json`), readable only by you. Check it with `npx beeper-mcp-addon status`, revoke it with `npx beeper-mcp-addon logout`.

**2. Add the server to your MCP client.** No token in the config: the server reads the saved one.

| Client | How |
|---|---|
| Claude Code | `claude mcp add beeper-mcp-addon -- npx -y beeper-mcp-addon` |
| Claude Desktop | Add the JSON below to `claude_desktop_config.json` |
| Cursor | Add the JSON below to `~/.cursor/mcp.json` |
| Kimi Code | Add the JSON below to `~/.kimi-code/mcp.json` |
| VS Code, Windsurf, others | Same JSON, in the client's MCP config file |

```json
{
  "mcpServers": {
    "beeper-mcp-addon": {
      "command": "npx",
      "args": ["-y", "beeper-mcp-addon"]
    }
  }
}
```

Prefer a manual token? Create one in Beeper Desktop → Settings → Developers and pass it as `BEEPER_ACCESS_TOKEN` in the `env` block instead of running `login`. A `read` token is enough for `download_attachment`, `search_contacts` and `beeper-watch`; `send_file` and `start_chat` need `read` + `write`.

### From source

```bash
git clone https://github.com/juulieen/beeper-mcp-addon
cd beeper-mcp-addon && npm install && npm run build
node dist/index.js login
# then use "command": "node", "args": ["/path/to/beeper-mcp-addon/dist/index.js"]
```

## Configuration

| Variable | Default | |
|---|---|---|
| `BEEPER_ACCESS_TOKEN` | token saved by `login` | Beeper Desktop API token; overrides the saved one |
| `BEEPER_URL` | `http://localhost:23373` | Base URL of the Beeper Client API |
| `BEEPER_TOKEN_FILE` | see above | Where `login` saves the token and where the server reads it |
| `BEEPER_DOWNLOAD_DIR` | `<tmp>/beeper-mcp-addon` | Where downloads go when no `outputPath` is given |

## Tools

### `download_attachment`

Identify the attachment in any of these ways:

- `url`: an `mxc://` / `localmxc://` media URL, **or** a `beeper-mcp://attachments/{chatID}/{messageID}/{index}` URI as printed by the official Beeper MCP's search results
- `chatID` + `messageID` (+ `index` if the message has several attachments)

Optional `outputPath` chooses where to save it. Returns `{ path, fileName, mimeType, sizeBytes }`.

### `send_file`

`chatID`, `filePath`, and optionally `text` (caption), `fileName` (name shown to the recipient) and `replyToMessageID`. Files up to 500 MB. The MIME type comes from the file extension, so videos and images show up as media rather than generic files.

### `search_contacts`

`accountID` (from the official MCP's `get_accounts`), `query`, optional `limit`. Returns contact `id`, name, phone number, username, email.

### `start_chat`

`accountID` plus one of `userID` (from `search_contacts`), `phoneNumber`, `username` or `email`. Returns the `chatID` to use with `send_message` or `send_file`. If a network refuses to create an empty chat, pass `messageText`: it becomes the first message and is sent right away.

`send_file` and `start_chat` act on your behalf. Most MCP clients ask you to approve each call; keep that confirmation on.

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

It's about 300 lines of TypeScript that call the local Beeper Client API: `/v1/assets/download`, `/v1/assets/upload`, `/v1/chats/{chatID}/messages`, `/v1/accounts/{accountID}/contacts` and `/v1/chats/start`. Everything stays on your machine; the server only talks to Beeper Desktop on `localhost`.

## License

MIT
