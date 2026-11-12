/**
 * Optional video conversion before sending, with ffmpeg if it is installed.
 *
 * Phone cameras often record videos that messaging apps play badly: HEVC, 60 fps, full-range
 * color (yuvj420p), rotation stored as metadata, or the index at the end of the file. Those can show
 * a black frame or a sideways picture, or fail to play on the recipient's phone. Re-encoding to plain
 * H.264 + AAC MP4 (30 fps max, 1280 px max, rotation applied, index at the start) plays everywhere.
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

const FFMPEG = process.env.BEEPER_FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.BEEPER_FFPROBE ?? (process.env.BEEPER_FFMPEG ? process.env.BEEPER_FFMPEG.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1") : "ffprobe");
const MAX_SIDE = 1280;
const MAX_FPS = 30;

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch {
      return resolve({ code: -1, stdout, stderr: `${cmd} not found` });
    }
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    child.on("error", () => resolve({ code: -1, stdout, stderr: `${cmd} not found` }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

type Stream = {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  color_range?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
};

/** Why this video would not play well as-is, or [] if it is fine. Undefined when ffprobe is missing. */
export async function videoProblems(path: string): Promise<string[] | undefined> {
  const r = await run(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path]);
  if (r.code === -1) return undefined;
  if (r.code !== 0) return ["unreadable by ffprobe"];
  const probe = JSON.parse(r.stdout) as { streams?: Stream[]; format?: { format_name?: string } };
  const v = probe.streams?.find((s) => s.codec_type === "video");
  const a = probe.streams?.find((s) => s.codec_type === "audio");
  if (!v) return [];

  const problems: string[] = [];
  if (v.codec_name !== "h264") problems.push(`video codec ${v.codec_name}`);
  if (v.pix_fmt !== "yuv420p") problems.push(`pixel format ${v.pix_fmt}`);
  if (v.color_range === "pc") problems.push("full-range color");
  const [n, d] = (v.avg_frame_rate ?? "0/1").split("/").map(Number);
  const fps = d ? n / d : 0;
  if (fps > MAX_FPS + 0.5) problems.push(`${Math.round(fps)} fps`);
  if (Math.max(v.width ?? 0, v.height ?? 0) > 1920) problems.push(`${v.width}x${v.height}`);
  const rotation = v.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? Number(v.tags?.rotate ?? 0);
  if (rotation) problems.push(`rotation metadata (${rotation}°)`);
  if (a && a.codec_name !== "aac") problems.push(`audio codec ${a.codec_name}`);
  if (!/mp4|mov/.test(probe.format?.format_name ?? "")) problems.push(`container ${probe.format?.format_name}`);
  return problems;
}

/** Re-encode to a widely compatible MP4. Returns the new file's path. */
export async function convertVideo(path: string): Promise<string> {
  const dir = join(tmpdir(), "beeper-mcp-addon", "converted");
  await mkdir(dir, { recursive: true });
  const out = join(dir, `${Date.now()}-${basename(path, extname(path))}.mp4`);
  // ffmpeg applies the rotation metadata by default (autorotate), then we scale the longest side.
  const scale =
    `scale='if(gte(iw,ih),min(${MAX_SIDE},iw),-2)':'if(gte(iw,ih),-2,min(${MAX_SIDE},ih))'` +
    `:out_range=tv,format=yuv420p`;
  const r = await run(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", path,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", scale,
    "-fpsmax", String(MAX_FPS),
    "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-profile:v", "high", "-color_range", "tv",
    "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    "-movflags", "+faststart",
    "-map_metadata", "-1",
    out,
  ]);
  if (r.code === -1) throw new Error(`ffmpeg not found (looked for "${FFMPEG}"). Install it, or pass convert: "never".`);
  if (r.code !== 0) throw new Error(`ffmpeg failed: ${r.stderr.trim().split("\n").slice(-3).join(" ")}`);
  return out;
}
