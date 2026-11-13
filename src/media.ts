import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";

/** beeper-mcp://attachments/{chatID}/{messageID}/{index}, as printed by the official Beeper MCP. */
export function parseAttachmentURI(uri: string): { chatID: string; messageID: string; index: number } | undefined {
  const m = uri.match(/^beeper-mcp:\/\/attachments\/([^/]+)\/([^/]+)\/(\d+)$/);
  return m ? { chatID: decodeURIComponent(m[1]), messageID: decodeURIComponent(m[2]), index: Number(m[3]) } : undefined;
}

/**
 * A file name chosen by someone else (an attachment's name), made safe to use as one path segment:
 * no directories ("/" or "\\"), no control or reserved characters, no leading dots, bounded length.
 */
export function safeFileName(name: string | undefined, fallback = "attachment"): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base
    .replace(/[\u0000-\u001f\u007f\u0085\u200e\u200f\u2028-\u202e\u2066-\u2069<>:"|?*]/g, "_")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .slice(0, 200);
  return clean || fallback;
}

/**
 * Per-user working directory (downloads, converted videos). On Linux /tmp is shared between users,
 * so use ~/.cache instead; macOS and Windows temp directories are already per-user.
 */
export const WORK_DIR =
  platform() === "linux" ? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "beeper-mcp-addon") : join(tmpdir(), "beeper-mcp-addon");

/** Cut text that comes from other people before handing it to the agent. */
export const clip = (s: string | undefined, max: number) => (s && s.length > max ? `${s.slice(0, max)}… [truncated, ${s.length} chars]` : s);
