# Design decisions

Short records of choices that look arbitrary but aren't. Add one when you make a choice someone might undo.

- **A companion, not a replacement** for the official Beeper MCP. Beeper's server already covers search and text; duplicating it would mean tracking their changes. This server only adds what's missing.
- **Name "addon"**, not "plus" (Beeper Plus is their paid plan) or "extras".
- **OAuth with Beeper, no token to copy.** Beeper Desktop has an OAuth server (PKCE, dynamic registration). Beeper's approval screen decides the access level; `--read-only` only asks for less.
- **OS secret store, file as fallback.** Keychain / DPAPI / Secret Service via the system's own tools (`security`, PowerShell, `secret-tool`), so there's no native dependency to compile. Without a keyring, a 0600 file, as Claude Code itself does on Linux. A file token moves into the keyring as soon as one is available.
- **Lazy login.** Without a token the server still starts; the first tool call opens Beeper's approval. Works in any client, even without running `install`.
- **`cmd /c npx` on Windows.** Clients start servers without a shell, and `npx` is a `.cmd` there.
- **Pinned version, never `@latest`.** `@latest` would run whatever is published next, unseen, on every machine — a hijacked npm account would own every user. The update notice announces new versions with their notes; the user decides.
- **Update notice in tool results, only when a tool is used**, once per run, checked at most once a day. Not at startup and not in CLI output, so nobody gets nagged when they aren't using it. Release notes are framed as data for the agent.
- **Video conversion only when needed.** ffprobe decides (codec, pixel format, color range, fps, rotation metadata, size, container); phone videos with these traits play as black or sideways frames on recipients' phones. ffmpeg stays optional.
- **Waiting for messages: `watch` + `wait_for_message`.** MCP tools can't push. A background command that wakes the agent (Claude Code's Monitor) is best for long waits; the blocking tool covers clients without one. The server's MCP instructions say which to use, with the command matching how it was installed. Listening starts before reading the history, so a reply can't fall in between.
- **Releases from GitHub Actions only.** npm trusted publishing (OIDC, no token, provenance) and MCP registry via GitHub OIDC. The first 0.1.0 was published by hand.
- **Reviews by local subagents, triggered by a Stop hook.** Not in git hooks (slow, no context, can't fix on the spot) and not on GitHub (the user wants them local). The hook compares content fingerprints, so nothing re-runs when nothing changed.
- **Quiet disclosure of security fixes.** Release notes reach every user's assistant and are public: describing how to exploit a fixed bug helps attackers more than users, since many will update late. Notes say "security fix, update"; details wait for an advisory. (Learned on 0.3.1, whose fix commit was pushed with a descriptive message before this rule existed.)
