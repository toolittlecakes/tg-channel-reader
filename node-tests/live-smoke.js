import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readChannel } from "../node-src/cli.js";
import { parseMediaPolicy } from "../node-src/parser.js";

const channels = ["oestick", "nobilix", "tips_ai"];
const root = await mkdtemp(path.join(os.tmpdir(), "tg-channel-reader-live-"));

try {
  for (const channel of channels) {
    const outDir = path.join(root, channel);
    await readChannel({
      channel,
      limit: 50,
      outDir,
      mediaTypes: parseMediaPolicy("none"),
      before: null,
      sleepMs: 100,
      failOnMediaError: false,
    });

    const data = await readJson(path.join(outDir, `${channel}.json`));
    assert.equal(data.channel, channel);
    assert.equal(data.count, 50);
    assert.ok(data.pages.length >= 2);
    assert.ok(data.posts.every((post) => post.source_post_key && post.url && Array.isArray(post.reactions)));
    assert.ok(data.posts.some((post) => post.media.length > 0));
  }

  const mediaOutDir = path.join(root, "tips_ai_media");
  await readChannel({
    channel: "tips_ai",
    limit: 3,
    outDir: mediaOutDir,
    mediaTypes: parseMediaPolicy("all"),
    before: 4685,
    sleepMs: 100,
    failOnMediaError: true,
  });

  const mediaData = await readJson(path.join(mediaOutDir, "tips_ai.json"));
  const media = mediaData.posts.flatMap((post) => post.media);
  assert.ok(media.length > 0);
  assert.ok(media.some((item) => item.downloaded && item.local_path));
} finally {
  await rm(root, { recursive: true, force: true });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
