/**
 * Compact views of chats and messages for the agent: one short line per message instead of the
 * raw API objects, so catching up on many chats costs little context.
 *
 * Everything here was written by other people (texts, names, file names): it is cut to a bounded
 * length, and tool results that carry it say it is data, not instructions.
 */
import { clip } from "./media.js";

export type Reaction = { id?: string; participantID?: string; reactionKey?: string; emoji?: boolean };
export type ApiMessage = {
  id: string;
  chatID?: string;
  senderID?: string;
  senderName?: string;
  timestamp?: string;
  type?: string;
  text?: string;
  isSender?: boolean;
  isDeleted?: boolean;
  isHidden?: boolean;
  linkedMessageID?: string;
  attachments?: { type?: string; fileName?: string; isVoiceNote?: boolean; duration?: number }[];
  reactions?: Reaction[];
};
export type Participant = { id: string; fullName?: string; username?: string; phoneNumber?: string; isSelf?: boolean };

/** "2026-11-13 09:12" in the machine's time zone (the user's, for a desktop app). */
export function localTime(iso: string | undefined): string {
  if (!iso) return "?";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "?";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Beeper returns rich text as light HTML (<p>, <br>); turn it back into plain text. */
export function plainText(text: string | undefined): string {
  return (text ?? "")
    // Mentions are links to matrix.to: keep "@Name". Other links: keep the text, and the URL if it differs.
    // (Linear-time patterns only: this runs on text from anyone.)
    .replace(/<a\s[^<>"]*href="([^"]*)"[^<>]*>([^<]*)<\/a>/gi, (_, href: string, label: string) =>
      href.startsWith("https://matrix.to/") ? `@${label.replace(/^@/, "")}` : label === href ? label : `${label} (${href})`,
    )
    .replace(/<\/?(?:b|i|u|s|em|strong|del|code|pre|span|blockquote|ul|ol|li|h[1-6])(?:\s[^>]*)?>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<\/?p>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * The user's own messages and reactions are marked "[me]". Names chosen by other people lose their
 * brackets, "·" and line breaks, so nobody can pass as the user or fake the start of another line.
 */
export const ME = "[me]";
export const outsideName = (name: string | undefined, max = 80) =>
  clip((name ?? "?").replace(/[[\]\u00b7\r\n]/g, " ").replace(/\s+/g, " ").trim() || "?", max)!;

/** Messages that only exist to carry a reaction or a hidden event: not worth a line. */
export const isNoise = (m: ApiMessage) => m.isHidden || m.type === "REACTION";

/** 👍 3 · ❤️ 1 */
export function reactionCounts(reactions: Reaction[] | undefined): string {
  const counts = new Map<string, number>();
  for (const r of reactions ?? []) if (r.reactionKey) counts.set(r.reactionKey, (counts.get(r.reactionKey) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, n]) => `${clip(k, 20)} ${n}`)
    .join(" · ");
}

/**
 * One line per message:
 *   2026-11-13 09:12 · Maxime · #79581 ↩79570: Ok pour samedi ! ⏎ À 10 h ? [image: photo.jpg] (👍 3)
 * Line breaks inside the text become " ⏎ ", so a message can't look like several lines.
 */
export function messageLine(m: ApiMessage, maxText = 1000): string {
  const who = m.isSender ? ME : outsideName(m.senderName ?? m.senderID);
  const reply = m.linkedMessageID ? ` ↩${m.linkedMessageID}` : "";
  const files = (m.attachments ?? [])
    .slice(0, 10)
    .map((a) => `[${a.isVoiceNote ? "voice note" : (a.type ?? "file")}${a.fileName ? `: ${outsideName(a.fileName)}` : ""}${a.duration ? `, ${Math.round(a.duration)}s` : ""}]`)
    .join(" ");
  // Cut the raw text before cleaning it: the cleaning cost must not depend on what a sender chose to send.
  const raw = m.text && m.text.length > maxText * 4 ? m.text.slice(0, maxText * 4) : m.text;
  const cleaned = plainText(raw).replace(/\s*(\r?\n)+\s*/g, " ⏎ ");
  const text = m.isDeleted
    ? "[deleted]"
    : cleaned.length > maxText || raw !== m.text
      ? `${cleaned.slice(0, maxText)}… [truncated, ${m.text!.length} chars]`
      : cleaned;
  const reactions = reactionCounts(m.reactions);
  return [
    `${localTime(m.timestamp)} · ${who} · #${m.id}${reply}:`,
    text,
    files,
    reactions ? `(${reactions})` : "",
  ].filter(Boolean).join(" ");
}

/** Who reacted with what, by name: [{ reaction: "👍", count: 2, people: ["Maxime", "me"] }]. */
export function reactionsByPeople(reactions: Reaction[] | undefined, participants: Participant[]) {
  const byID = new Map(participants.map((p) => [p.id, p]));
  const groups = new Map<string, string[]>();
  for (const r of reactions ?? []) {
    if (!r.reactionKey) continue;
    const id = r.participantID ?? r.id ?? "?";
    const p = byID.get(id);
    const name = p?.isSelf ? ME : outsideName(p?.fullName ?? p?.username ?? p?.phoneNumber ?? id);
    groups.set(r.reactionKey, [...(groups.get(r.reactionKey) ?? []), name]);
  }
  return [...groups]
    .map(([reaction, people]) => ({ reaction: clip(reaction, 20)!, count: people.length, people }))
    .sort((a, b) => b.count - a.count);
}
