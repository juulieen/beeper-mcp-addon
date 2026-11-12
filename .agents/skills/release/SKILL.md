---
name: release
description: Publish a new version of beeper-mcp-addon (npm, GitHub release with .mcpb, MCP registry). Use when the user asks to release, publish or ship a version.
---

# Release beeper-mcp-addon

Publishing is outward-facing and can't be undone (a version number can never be reused on npm): get the user's go before step 4.

1. **Pick the version.** `git log --oneline v$(node -p 'require("./package.json").version')..HEAD`. New tool, option or behavior → minor (0.x.0). Only fixes → patch. Anything breaking (removed tool or option, changed default) → minor while in 0.x, and say so in the notes.
2. **Make sure the reviews are current.** `node scripts/review-state.mjs status`. If one is needed, run its reviewer subagent (see AGENTS.md → Reviews) and fix what it reports.
3. **Write the notes** in a temp file (not in the repo): what users can now do and what changed for them, in English, as a short bullet list; any action needed; then `To update: npx -y beeper-mcp-addon@<version> install. Claude Desktop: download beeper-mcp-addon.mcpb below and open it.` These notes are shown to every user's assistant by the update notice. Run the **release-notes-reviewer** subagent on the file (give it the path and the previous version) and apply its corrections.
4. **Show the user** the version and the notes, and wait for the go.
5. `node scripts/release.mjs <version> <notes file>`. It refuses unless master is clean and pushed, `check` and tests pass and the reviews are current. Then it bumps, commits, pushes and creates the GitHub release.
6. **Follow the publishing**: `gh run list --limit 3`, then `gh run watch <id> --exit-status` for `release` and then `mcp-registry`. Confirm: `npm view beeper-mcp-addon version`, the `.mcpb` attached to the release, and the registry (`curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=beeper-mcp-addon"`).
7. Report the three links to the user.
