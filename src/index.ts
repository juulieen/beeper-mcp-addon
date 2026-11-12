#!/usr/bin/env node
/**
 * beeper-mcp-addon — companion MCP server for Beeper Desktop.
 *
 * Beeper's built-in MCP server handles text in existing chats only. This server adds the
 * missing file tools on top of the Beeper Client API (localhost:23373):
 *   - download_attachment: save a message attachment to disk
 *   - send_file: send a local file to any chat
 *   - search_contacts / start_chat: reach people you have no conversation with yet
 *
 * Run it alongside the official Beeper MCP, not instead of it.
 */
import { openAsBlob } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.BEEPER_URL ?? "http://localhost:23373").replace(/\/$/, "");
const TOKEN = process.env.BEEPER_ACCESS_TOKEN;
const DOWNLOAD_DIR = process.env.BEEPER_DOWNLOAD_DIR ?? join(tmpdir(), "beeper-mcp-addon");

if (!TOKEN) {
  process.stderr.write(
    "beeper-mcp-addon: BEEPER_ACCESS_TOKEN is required.\n" +
      "Create one in Beeper Desktop > Settings > Developers (read + write to send files).\n",
  );
  process.exit(1);
}

class BeeperError extends Error {}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
  const body = await res.text();
  if (!res.ok) {
    let message = body;
    try {
      message = (JSON.parse(body) as { message?: string }).message ?? body;
    } catch {}
    throw new BeeperError(`Beeper API ${res.status} on ${path}: ${message}`);
  }
  return JSON.parse(body) as T;
}

const enc = encodeURIComponent;

// Beeper only renders a file as video/image/audio when it knows its MIME type.
const MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".heic": "image/heic",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav",
  ".pdf": "application/pdf", ".txt": "text/plain", ".csv": "text/csv", ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

type Attachment = { id?: string; srcURL?: string; fileName?: string; mimeType?: string; fileSize?: number };
type Message = { id: string; attachments?: Attachment[] };

/** Accepts mxc:// / localmxc:// URLs and beeper-mcp://attachments/{chat}/{message}/{index} URIs. */
async function resolveMediaURL(input: {
  url?: string;
  chatID?: string;
  messageID?: string;
  index?: number;
}): Promise<{ url: string; attachment?: Attachment }> {
  let { url, chatID, messageID, index = 0 } = input;
  const mcpUri = url?.match(/^beeper-mcp:\/\/attachments\/([^/]+)\/([^/]+)\/(\d+)$/);
  if (mcpUri) {
    [chatID, messageID] = [decodeURIComponent(mcpUri[1]), decodeURIComponent(mcpUri[2])];
    index = Number(mcpUri[3]);
    url = undefined;
  }
  if (url) return { url };
  if (!chatID || !messageID) {
    throw new BeeperError("Provide either `url` (mxc://, localmxc:// or beeper-mcp://) or `chatID` + `messageID`.");
  }
  const message = await api<Message>(`/chats/${enc(chatID)}/messages/${enc(messageID)}`);
  const attachment = message.attachments?.[index];
  if (!attachment?.id) {
    throw new BeeperError(
      `Message ${messageID} has ${message.attachments?.length ?? 0} attachment(s); none at index ${index}.`,
    );
  }
  return { url: attachment.id, attachment };
}

function toLocalPath(srcURL: string): string {
  return srcURL.startsWith("file://") ? fileURLToPath(srcURL) : srcURL;
}

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (err: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
});

const server = new McpServer({ name: "beeper-mcp-addon", version: "0.1.0" });

server.registerTool(
  "download_attachment",
  {
    title: "Download a Beeper attachment",
    description:
      "Save a message attachment (video, image, audio, document) to a local file and return its path. " +
      "Identify it with `url` (an mxc:// or localmxc:// URL, or a beeper-mcp://attachments/... URI " +
      "as returned by the official Beeper MCP), or with `chatID` + `messageID` (+ `index` when a message has several attachments).",
    inputSchema: {
      url: z.string().optional().describe("mxc://, localmxc:// or beeper-mcp://attachments/{chatID}/{messageID}/{index}"),
      chatID: z.string().optional().describe("Chat ID (or local chat ID) of the message"),
      messageID: z.string().optional().describe("ID of the message holding the attachment"),
      index: z.number().int().min(0).optional().describe("Attachment index in the message (default 0)"),
      outputPath: z
        .string()
        .optional()
        .describe(`Where to save the file. Defaults to a copy in ${DOWNLOAD_DIR}`),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async (args) => {
    try {
      const { url, attachment } = await resolveMediaURL(args);
      const result = await api<{ srcURL?: string; error?: string }>("/assets/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (result.error || !result.srcURL) throw new BeeperError(`Download failed: ${result.error ?? "no srcURL returned"}`);

      const cached = toLocalPath(result.srcURL);
      const name = attachment?.fileName ?? basename(cached);
      const target = resolve(args.outputPath ?? join(DOWNLOAD_DIR, `${Date.now()}-${name}`));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(cached, target);
      const { size } = await stat(target);
      return ok({ path: target, fileName: name, mimeType: attachment?.mimeType, sizeBytes: size });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "send_file",
  {
    title: "Send a file to a Beeper chat",
    description:
      "Upload a local file (video, image, audio, document; max 500 MB) and send it to a chat, " +
      "with an optional caption. This sends a real message on the user's behalf: confirm the recipient first.",
    inputSchema: {
      chatID: z.string().describe("Chat ID (or local chat ID) to send to"),
      filePath: z.string().describe("Absolute path of the file to send"),
      text: z.string().optional().describe("Optional caption sent with the file"),
      fileName: z.string().optional().describe("File name shown to the recipient (defaults to the local name)"),
      replyToMessageID: z.string().optional().describe("Message ID to reply to"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ chatID, filePath, text, fileName, replyToMessageID }) => {
    try {
      const path = resolve(filePath);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) throw new BeeperError(`File not found: ${path}`);

      const name = fileName ?? basename(path);
      const mimeType = MIME_TYPES[extname(name).toLowerCase()] ?? MIME_TYPES[extname(path).toLowerCase()];
      const form = new FormData();
      form.append("file", await openAsBlob(path, mimeType ? { type: mimeType } : {}), name);
      form.append("fileName", name);
      if (mimeType) form.append("mimeType", mimeType);
      const upload = await api<{ uploadID?: string; mimeType?: string; error?: string }>("/assets/upload", {
        method: "POST",
        body: form,
      });
      if (!upload.uploadID) throw new BeeperError(`Upload failed: ${upload.error ?? "no uploadID returned"}`);

      const sent = await api<{ chatID: string; pendingMessageID: string }>(`/chats/${enc(chatID)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attachment: { uploadID: upload.uploadID, fileName: name, ...(mimeType ? { mimeType } : {}) },
          ...(text ? { text } : {}),
          ...(replyToMessageID ? { replyToMessageID } : {}),
        }),
      });
      return ok({
        status: "queued",
        chatID: sent.chatID,
        pendingMessageID: sent.pendingMessageID,
        fileName: name,
        mimeType: mimeType ?? upload.mimeType,
        sizeBytes: info.size,
      });
    } catch (err) {
      return fail(err);
    }
  },
);

type Contact = { id: string; fullName?: string; username?: string; phoneNumber?: string; email?: string; cannotMessage?: boolean };

server.registerTool(
  "search_contacts",
  {
    title: "Search contacts on a Beeper account",
    description:
      "Find people on one account (e.g. WhatsApp, Signal), including people you have never chatted with. " +
      "A phone number, email or @username is also looked up exactly on the network. " +
      "Use the returned `id` with start_chat. Account IDs come from the official Beeper MCP's get_accounts.",
    inputSchema: {
      accountID: z.string().describe("Account to search, e.g. whatsapp.33612345678"),
      query: z.string().min(1).describe("Name, phone number (E.164), email or @username"),
      limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ accountID, query, limit = 10 }) => {
    try {
      const res = await api<{ items?: Contact[] }>(
        `/accounts/${enc(accountID)}/contacts?query=${enc(query)}`,
      );
      const contacts = (res.items ?? []).slice(0, limit).map(({ id, fullName, username, phoneNumber, email, cannotMessage }) => ({
        id, fullName, username, phoneNumber, email, ...(cannotMessage ? { cannotMessage } : {}),
      }));
      return ok({ count: contacts.length, contacts });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "start_chat",
  {
    title: "Start a direct chat",
    description:
      "Open a direct chat with someone, even if you have never messaged them on this account, and return its chatID " +
      "so you can then send messages or files. Reuses the existing chat when there is one. " +
      "Identify the person with `userID` (from search_contacts), `phoneNumber`, `username` or `email`. " +
      "Some networks need a first message to create the chat: pass it in `messageText` (it is sent immediately; confirm with the user first).",
    inputSchema: {
      accountID: z.string().describe("Account to start the chat on, e.g. whatsapp.33612345678"),
      userID: z.string().optional().describe("Contact ID from search_contacts"),
      phoneNumber: z.string().optional().describe("Phone number, E.164 preferred (+33612345678)"),
      username: z.string().optional().describe("Username / handle"),
      email: z.string().optional().describe("Email address"),
      fullName: z.string().optional().describe("Display name, only used to rank candidates"),
      messageText: z.string().optional().describe("First message, only if the network requires one to create the chat"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ accountID, userID, phoneNumber, username, email, fullName, messageText }) => {
    try {
      if (!userID && !phoneNumber && !username && !email) {
        throw new BeeperError("Provide at least one of userID, phoneNumber, username or email.");
      }
      const user = Object.fromEntries(
        Object.entries({ id: userID, phoneNumber, username, email, fullName }).filter(([, v]) => v),
      );
      const chat = await api<{ id: string; localChatID?: string; title?: string; network?: string; type?: string }>(
        "/chats/start",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountID, user, ...(messageText ? { messageText } : {}) }),
        },
      );
      return ok({
        chatID: chat.id,
        localChatID: chat.localChatID,
        title: chat.title,
        network: chat.network,
        type: chat.type,
      });
    } catch (err) {
      return fail(err);
    }
  },
);

await server.connect(new StdioServerTransport());
