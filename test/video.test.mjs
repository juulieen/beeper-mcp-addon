// Video defect detection and conversion, on tiny videos generated with ffmpeg.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { hasBin, tempDir } from "./helpers.mjs";

const skip = !hasBin("ffmpeg") || !hasBin("ffprobe") ? "ffmpeg/ffprobe not installed" : false;
const dir = tempDir("video");
const make = (name, args) => {
  const out = join(dir, name);
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=1",
    "-f", "lavfi", "-i", "sine=duration=1", "-shortest", ...args, out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return out;
};

test("a phone-camera style video is flagged, converted, and the result is clean", { skip }, async () => {
  const { videoProblems, convertVideo } = await import("../dist/video.js");
  const good = make("good.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"]);
  assert.deepEqual(await videoProblems(good), []);

  const raw = make("raw.mp4", ["-r", "60", "-c:v", "libx264", "-pix_fmt", "yuvj420p", "-color_range", "pc",
    "-c:a", "libopus", "-strict", "-2"]);
  // Like a Pixel phone: the rotation is only stored as metadata (an input option, hence a remux).
  const bad = join(dir, "pixel.mp4");
  const remux = spawnSync("ffmpeg", ["-v", "error", "-y", "-display_rotation", "-90", "-i", raw, "-c", "copy", "-strict", "-2", bad], { encoding: "utf8" });
  assert.equal(remux.status, 0, remux.stderr);
  const problems = await videoProblems(bad);
  for (const p of ["pixel format yuvj420p", "60 fps", "audio codec opus"]) assert.ok(problems.includes(p), `${p} not in ${problems}`);
  assert.ok(problems.some((p) => p.startsWith("rotation metadata")), `rotation not in ${problems}`);

  const fixed = await convertVideo(bad);
  assert.deepEqual(await videoProblems(fixed), []);
});
