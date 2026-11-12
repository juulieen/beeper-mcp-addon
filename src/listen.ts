/**
 * Real-time incoming messages from Beeper's WebSocket (/v1/ws), shared by the `watch` command
 * and the `wait_for_message` tool.
 *
 * Beeper's WebSocket delivers each message at most once and does not replay what was sent while
 * disconnected, so `recentMessages` covers the gap through the REST API.
 */
import { BASE_URL } from "./auth.js";
import { clip } from "./media.js";

type Entry = {
  id: string;
  chatID: string;
  senderID?: string;
  senderName?: string;
  timestamp?: string;
  type?: string;
  text?: string;
  isSender?: boolean;
  attachments?: { type?: string; fileName?: string }[];
};
type Chat = { id: string; title?: string; network?: string };

export type IncomingMessage = {
  event: "message";
  chatID: string;
  chat?: string;
  network?: string;
  messageID: string;
  sender?: string;
  time?: string;
  type?: string;
  text?: string;
  attachments?: string[];
};

export type Filter = { chats?: string[]; from?: string; includeOwn?: boolean };

export function createClient(token: string) {
  async function api<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE_URL}/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Beeper API ${res.status} on ${path}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  const chats = new Map<string, Chat>();
  async function chatInfo(id: string): Promise<Chat> {
    if (!chats.has(id)) chats.set(id, await api<Chat>(`/chats/${encodeURIComponent(id)}`).catch(() => ({ id })));
    return chats.get(id)!;
  }

  /** Local chat IDs ("22565") become full chat IDs, which the WebSocket subscription needs. */
  async function resolveChats(ids?: string[]): Promise<string[]> {
    if (!ids?.length) return ["*"];
    const resolved = await Promise.all(ids.map(async (c) => (await chatInfo(c)).id));
    for (const id of resolved) chats.set(id, await chatInfo(id));
    return resolved;
  }

  const matches = (e: Entry, f: Filter) =>
    !(e.isSender && !f.includeOwn) &&
    !(f.from && !`${e.senderName ?? ""} ${e.senderID ?? ""}`.toLowerCase().includes(f.from.toLowerCase()));

  async function format(e: Entry): Promise<IncomingMessage> {
    const chat = await chatInfo(e.chatID);
    return {
      event: "message",
      chatID: e.chatID,
      // Written by other people: keep it bounded before it reaches the agent.
      chat: clip(chat.title, 200),
      network: chat.network,
      messageID: e.id,
      sender: clip(e.senderName ?? e.senderID, 200),
      time: e.timestamp,
      type: e.type,
      text: clip(e.text, 4000),
      ...(e.attachments?.length ? { attachments: e.attachments.slice(0, 20).map((a) => clip(a.fileName ?? a.type ?? "file", 200)!) } : {}),
    };
  }

  /** Messages already in these chats, newer than `since`: the ones a live listener would have missed. */
  async function recentMessages(chatIDs: string[], since: Date, f: Filter): Promise<IncomingMessage[]> {
    const out: IncomingMessage[] = [];
    for (const id of chatIDs) {
      const page = await api<{ items: Entry[] }>(`/chats/${encodeURIComponent(id)}/messages?limit=20`);
      for (const e of page.items) {
        if (e.timestamp && new Date(e.timestamp) > since && matches(e, f)) out.push(await format(e));
      }
    }
    return out.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  }

  /** Listen until close(). Reconnects with backoff; `onDisconnect` reports each drop. */
  function listen(
    subscribed: string[],
    f: Filter,
    handlers: {
      onMessage: (m: IncomingMessage) => void;
      onReady?: (titles: string) => void;
      onDisconnect?: (info: { code: number; reason?: string; retryInSeconds: number }) => void;
      onError?: (message: string) => void;
    },
  ) {
    const seen = new Set<string>();
    let retry = 0;
    let closed = false;
    let ws: WebSocket | undefined;
    let timer: NodeJS.Timeout | undefined;

    const connect = () => {
      // Node's WebSocket (undici) accepts headers in the options object.
      ws = new WebSocket(`${BASE_URL.replace(/^http/, "ws")}/v1/ws`, {
        headers: { Authorization: `Bearer ${token}` },
      } as unknown as string[]);
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as { type: string; entries?: Entry[]; message?: string };
        if (msg.type === "ready") {
          ws!.send(JSON.stringify({ type: "subscriptions.set", chatIDs: subscribed }));
        } else if (msg.type === "subscriptions.updated") {
          retry = 0;
          handlers.onReady?.(subscribed[0] === "*" ? "all chats" : subscribed.map((id) => chats.get(id)?.title ?? id).join(", "));
        } else if (msg.type === "message.upserted") {
          for (const e of msg.entries ?? []) {
            const key = `${e.chatID}|${e.id}`;
            if (seen.has(key)) continue; // the same message is upserted again once confirmed
            seen.add(key);
            if (seen.size > 5000) seen.delete(seen.values().next().value!);
            if (matches(e, f)) void format(e).then(handlers.onMessage);
          }
        } else if (msg.type === "error") {
          handlers.onError?.(msg.message ?? JSON.stringify(msg));
        }
      };
      ws.onerror = () => {}; // followed by onclose
      ws.onclose = (ev) => {
        if (closed) return;
        const delay = Math.min(30_000, 1000 * 2 ** retry++);
        handlers.onDisconnect?.({ code: ev.code, reason: ev.reason || undefined, retryInSeconds: delay / 1000 });
        timer = setTimeout(connect, delay);
      };
    };
    connect();
    return {
      close() {
        closed = true;
        clearTimeout(timer);
        ws?.close();
      },
    };
  }

  /**
   * The first matching message: from the live stream, or, with `since`, one already received after
   * that time. Listening starts before the history is read, so nothing falls in between.
   */
  function nextMessage(subscribed: string[], f: Filter, opts: { since?: Date; timeoutMs: number }): Promise<IncomingMessage | undefined> {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (m?: IncomingMessage, err?: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        listener.close();
        if (err) reject(err);
        else resolve(m);
      };
      const timer = setTimeout(() => finish(), opts.timeoutMs);
      const listener = listen(subscribed, f, {
        onMessage: (m) => finish(m),
        onReady: () => {
          if (!opts.since || done) return;
          recentMessages(subscribed, opts.since, f).then((ms) => ms.length && finish(ms[0]), (err) => finish(undefined, err));
        },
      });
    });
  }

  return { api, resolveChats, recentMessages, listen, nextMessage };
}
