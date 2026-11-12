import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers.mjs";

process.env.BEEPER_ADDON_NO_UPDATE_CHECK = "1";
const { newer, VERSION } = await import("../dist/update.js");
const { parseAttachmentURI } = await import("../dist/media.js");

test("version comparison", () => {
  assert.ok(newer("0.10.0", "0.9.9"));
  assert.ok(newer("1.0.0", "0.99.0"));
  assert.ok(!newer("0.3.0", "0.3.0"));
  assert.ok(!newer("0.2.9", "0.3.0"));
  assert.equal(VERSION, JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version);
});

test("beeper-mcp:// attachment URIs", () => {
  assert.deepEqual(parseAttachmentURI("beeper-mcp://attachments/%21abc%3Abeeper.local/55618/2"), {
    chatID: "!abc:beeper.local",
    messageID: "55618",
    index: 2,
  });
  assert.equal(parseAttachmentURI("mxc://beeper.com/xyz"), undefined);
  assert.equal(parseAttachmentURI("beeper-mcp://attachments/a/b"), undefined);
});
