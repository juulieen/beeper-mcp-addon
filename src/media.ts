/** beeper-mcp://attachments/{chatID}/{messageID}/{index}, as printed by the official Beeper MCP. */
export function parseAttachmentURI(uri: string): { chatID: string; messageID: string; index: number } | undefined {
  const m = uri.match(/^beeper-mcp:\/\/attachments\/([^/]+)\/([^/]+)\/(\d+)$/);
  return m ? { chatID: decodeURIComponent(m[1]), messageID: decodeURIComponent(m[2]), index: Number(m[3]) } : undefined;
}
