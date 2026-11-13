# beeper-mcp-addon — notes for agents

MCP server published on npm that adds what Beeper Desktop's built-in MCP lacks: files, new chats, catching up on many chats, reactions, editing, deleting and waiting for messages. It runs **next to** the official Beeper MCP and only talks to Beeper Desktop's local Client API (`http://localhost:23373`, OpenAPI at `/v1/spec`). Public repo, used by other people: everything user-facing is in English.

## Commands

| | |
|---|---|
| `npm run build` | TypeScript → `dist/` |
| `npm run check` | Consistency between code and docs (tools, versions, env vars, links, confirm wording). < 1 s |
| `npm test` | Build + unit tests (`test/*.test.mjs`, node's runner). ~3 s. Never touches real configs or the real token |
| `npm run test:live` | Real tools on the real Beeper, **only in "Note to self"**, deletes what it sent. Run after changing a tool |
| `npm run call -- <tool> '<json>'` | Call a tool of the built server, like a client would. `--list`, `--instructions` |
| `node dist/index.js status` | Which token is used, and whether it's valid |
| `node scripts/review-state.mjs status` | Which agent reviews are needed |
| `/release` skill | Publish a version (`.agents/skills/release/SKILL.md`) |

The `pre-commit` hook (`scripts/hooks/`, enabled by `npm install`) runs `check` and `npm test`. CI runs them on Linux, macOS and Windows; a release can't publish if CI fails.

## Files

- `src/index.ts`: CLI dispatch (`install`, `login`, `status`, `watch`…), then the MCP server: token renewal (expiry or 401 → approve again in Beeper, same scope, retried once; a token approved during this run is never asked for again), instructions, the 10 tools, the wrapper that adds the update and token-expiry notices.
- `src/auth.ts`: OAuth with Beeper (PKCE, dynamic registration), `getToken`, `tokenInfo` / `tokenExpiry` (expiry and scope from `/oauth/userinfo`; tokens last 30 days), `savedScope` (a renewal asks for the same access level, never more; a token saved without its scope gets it from `tokenInfo` while it still works), `status`.
- `src/secret-store.ts`: token in macOS Keychain / Windows DPAPI / Linux Secret Service, fallback file 0600; moves a file token into a keyring once one exists.
- `src/install.ts`: adds/removes the server in 8 MCP clients (JSON, VS Code `servers`, Codex TOML, Claude Code CLI).
- `src/messages.ts`: compact one-line view of messages and reactions for the agent (`get_new_messages`, `get_reactions`), `fileTime` (file names of batch downloads).
- `src/listen.ts`: Beeper WebSocket (`/v1/ws`) + history, shared by `watch` and `wait_for_message`.
- `src/watch.ts`: `watch` command (also the `beeper-watch` bin). `src/video.ts`: ffprobe check + ffmpeg conversion. `src/update.ts`: once-a-day update notice. `src/media.ts`: `beeper-mcp://` URIs, `safeFileName` (sender-chosen attachment names), `WORK_DIR` (per-user folder for downloads and converted videos: `~/.cache/beeper-mcp-addon` on Linux), `clip` (limits text from outside).
- `manifest.json`: Claude Desktop `.mcpb` (`npm run bundle`). `server.json`: MCP registry entry.
- `.github/workflows/`: `ci` (3 OS), `release` (on a GitHub release: CI, then npm trusted publishing with provenance and the `.mcpb` in separate jobs), `mcp-registry` (after release, GitHub OIDC).
- `.agents/agents/` (reviewers) and `.agents/skills/` (release): read by Kimi Code, linked from `.claude/` for Claude Code.
- `docs/decisions.md`: why things are the way they are. Read it before changing a design choice.

## Rules that must not break

1. **The token never appears** in argv, logs, errors, tool results, client configs or network requests other than to Beeper. Secrets reach child processes on stdin only.
2. **No telemetry.** The only outside requests are the update check (public npm + GitHub releases, nothing about the user).
3. **Pinned versions.** `install` writes `beeper-mcp-addon@<exact version>`; never `@latest`. Updates are announced, never automatic.
4. **Tools that act for the user** say "confirm with the user" in their description and carry the right annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`). `npm run check` enforces the wording.
5. **Text from outside** (messages, file names, release notes) given to the agent is framed as data and length-limited.
6. **Tests and live tests never touch the user's real data**: fake home dir, `BEEPER_ADDON_TEST_SERVICE` for the keychain, "Note to self" only.
7. **Every tool, option and env var is documented** in the README (checked), the tool's own description, and `manifest.json`.
8. The README never contains a real version number (it would go stale).
9. **Security fixes are disclosed quietly.** Commit messages, release notes, the npm deprecation message and the update notice say "security fix, update recommended" and name the affected tool at most — never how to exploit it (no example payload, no "a sender could…"). Details go in a GitHub security advisory, published only once most users have updated. Vulnerability reports come in privately (`SECURITY.md`), never in public issues.

## Beeper API pitfalls

- Local chat IDs (`"22565"`) work in REST paths, but the WebSocket subscription needs full IDs (`!abc:beeper.local`): resolve with `GET /v1/chats/{id}`.
- WebSocket: send `subscriptions.set` after `ready`; each message is upserted twice (pending, then confirmed): dedupe on `chatID|id`. No replay after a disconnect.
- `send` returns a `pendingMessageID` (`~…`), which can't be deleted: get the final ID from the chat or `wait_for_message`.
- `DELETE` returns 204 with an empty body. `/assets/upload` needs the MIME type, or videos arrive as generic files.
- `wait_for_message` with `since` returns the **oldest** match after that time.
- Tokens last **30 days** and can't be refreshed (`grant_types_supported: authorization_code` only). `GET /oauth/userinfo` gives `exp` and `scope` (some older tokens have no `exp`).
- Message text is light HTML (`<p>`, `<br>`, mentions as `<a href="https://matrix.to/#/…">Name</a>`): `plainText()` in `messages.ts` cleans it.
- `GET /v1/messages/search` accepts `limit` ≤ 20 (more → "400 Invalid input"); `mediaTypes` has no `audio`. It works without `query` (used for batch downloads by `chatIDs` + `mediaTypes` + dates). `dateAfter` and `dateBefore` are both exclusive. Attachment `type` is `img`, `video`, `audio` or `unknown`; stickers have `isSticker`. An unknown chat ID gives 404. `/chats/search` `query` matches words of the title.
- Reactions carry a `participantID` only: names come from the chat's participants (`GET /v1/chats/{id}?maxParticipantCount=500`). Reaction events also appear as messages of type `REACTION`; skip them.
- Many group chats are muted: don't exclude muted chats by default.

## Reviews (before ending a turn)

A `Stop` hook (`node scripts/review-state.mjs stop-hook`, in `.claude/settings.json` and in Kimi's config) blocks the end of a turn while a review is out of date for the files you changed. Then run, as **subagents** (fresh context, they don't see your reasoning):

| Review | Agent file | Model | Scope |
|---|---|---|---|
| docs | `.agents/agents/doc-reviewer.md` | sonnet | `src/`, README, AGENTS.md, `docs/`, manifest, server.json, package.json |
| security | `.agents/agents/security-reviewer.md` | opus | auth, secret store, install, update, listen, watch, media, messages, tools, video, dependencies, workflows, hooks |

Give the subagent only its task ("Review the current changes"), not your conclusions. Fix what it reports and run it again; it records its own pass (`review-state.mjs pass <review>`). Don't record a pass yourself. `release-notes-reviewer.md` runs during `/release`.

## Testing against Beeper

Beeper Desktop must run with its API enabled. The token comes from `node dist/index.js login` (OS secret store). Test sends go to the Matrix **"Note to self"** chat only (local ID `19099` on Julien's machine; `test:live` finds it by name) and must be deleted afterwards. Never message real contacts while testing.
