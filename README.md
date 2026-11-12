# beeper-files-mcp

File tools for [Beeper Desktop](https://www.beeper.com)'s MCP server.

Beeper Desktop ships a built-in MCP server, so an AI assistant can search and send messages across WhatsApp, Signal, Telegram, iMessage and more. It only handles **text**, though: the assistant can see that a message holds a video, but it can't open it, and it can't send a photo or a PDF.

The Beeper Client API that runs alongside it already supports files. This small MCP server exposes that capability as two tools:

| Tool | What it does |
|---|---|
| `download_attachment` | Saves a message attachment (video, image, audio, document) to disk and returns the local path |
| `send_file` | Uploads a local file and sends it to any chat, with an optional caption |

It runs **next to** the official Beeper MCP, not instead of it. Keep using the official server for search, chats and text messages.

## Requirements

- Beeper Desktop with the API enabled (Settings → Developers)
- An access token from that same screen. A `read` token is enough for `download_attachment`; `send_file` needs `read` + `write`
- Node.js 20+

## Setup

### Claude Code

```bash
claude mcp add beeper-files \
  --env BEEPER_ACCESS_TOKEN=your-token \
  -- npx -y beeper-files-mcp
```

### Claude Desktop, Cursor, and other MCP clients

```json
{
  "mcpServers": {
    "beeper-files": {
      "command": "npx",
      "args": ["-y", "beeper-files-mcp"],
      "env": { "BEEPER_ACCESS_TOKEN": "your-token" }
    }
  }
}
```

### From source

```bash
git clone https://github.com/juulieen/beeper-files-mcp
cd beeper-files-mcp && npm install && npm run build
# then use "command": "node", "args": ["/path/to/beeper-files-mcp/dist/index.js"]
```

## Configuration

| Variable | Default | |
|---|---|---|
| `BEEPER_ACCESS_TOKEN` | — (required) | Beeper Desktop API token |
| `BEEPER_URL` | `http://localhost:23373` | Base URL of the Beeper Client API |
| `BEEPER_DOWNLOAD_DIR` | `<tmp>/beeper-files-mcp` | Where downloads go when no `outputPath` is given |

## Tools

### `download_attachment`

Identify the attachment in any of these ways:

- `url`: an `mxc://` / `localmxc://` media URL, **or** a `beeper-mcp://attachments/{chatID}/{messageID}/{index}` URI as printed by the official Beeper MCP's search results
- `chatID` + `messageID` (+ `index` if the message has several attachments)

Optional `outputPath` chooses where to save it. Returns `{ path, fileName, mimeType, sizeBytes }`.

### `send_file`

`chatID`, `filePath`, and optionally `text` (caption), `fileName` (name shown to the recipient) and `replyToMessageID`. Files up to 500 MB. The MIME type comes from the file extension, so videos and images show up as media rather than generic files.

`send_file` sends a real message on your behalf. Most MCP clients ask you to approve each call; keep that confirmation on.

## Example

> "Find the videos my dad posted in the family group in June and send the French ones to him."

The assistant searches with the official Beeper MCP, calls `download_attachment` on each video (for instance to transcribe and check the language), then `send_file` to forward the right ones.

## How it works

It's about 200 lines of TypeScript that call three endpoints of the local Beeper Client API: `POST /v1/assets/download`, `POST /v1/assets/upload` and `POST /v1/chats/{chatID}/messages`. Everything stays on your machine; the server only talks to Beeper Desktop on `localhost`.

## License

MIT
