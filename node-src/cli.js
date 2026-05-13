import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMediaPolicy,
  channelPageUrl,
  dedupePosts,
  mediaPolicyLabel,
  normalizeChannel,
  parseMediaPolicy,
  parsePage,
  postSortKey,
} from "./parser.js";

export async function main(argv) {
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    return;
  }

  const channel = normalizeChannel(args.channel);
  const mediaTypes = parseMediaPolicy(args.media);
  const result = await readChannel({
    channel,
    limit: args.limit,
    outDir: args.out,
    mediaTypes,
    before: args.before,
    sleepMs: args.sleep * 1000,
    failOnMediaError: args.failOnMediaError,
  });

  console.log(`saved ${result.count} posts -> ${result.outputFile}`);
  if (result.mediaDownloadFailures > 0) {
    console.error(`media download failures: ${result.mediaDownloadFailures}`);
    if (args.failOnMediaError) {
      process.exitCode = 1;
    }
  }
}

export async function readChannel({
  channel,
  limit,
  outDir,
  mediaTypes,
  before,
  sleepMs,
  failOnMediaError,
}) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit must be >= 1");
  }

  await mkdir(outDir, { recursive: true });
  const mediaDir = path.join(outDir, "media");
  await mkdir(mediaDir, { recursive: true });

  const seenCursors = new Set();
  const posts = [];
  const pages = [];
  let nextBefore = before;

  while (posts.length < limit) {
    const pageUrl = channelPageUrl(channel, nextBefore);
    const html = await fetchText(pageUrl);
    const { posts: pagePosts, nextBefore: pageBefore, channelInfo } = parsePage(html, channel);
    pages.push({
      url: pageUrl,
      posts: pagePosts.length,
      next_before: pageBefore,
      channel_info: pages.length === 0 ? channelInfo : null,
    });

    if (pagePosts.length === 0) {
      throw new Error(`No posts found at ${pageUrl}`);
    }

    posts.push(...pagePosts);
    if (posts.length >= limit || pageBefore == null) {
      break;
    }
    if (seenCursors.has(pageBefore)) {
      throw new Error(`Pagination loop detected at before=${pageBefore}`);
    }

    seenCursors.add(pageBefore);
    nextBefore = pageBefore;
    if (sleepMs > 0) {
      await sleep(sleepMs);
    }
  }

  const selectedPosts = dedupePosts(posts).sort(postSortKey).reverse().slice(0, limit);
  let mediaDownloadFailures = 0;

  for (const post of selectedPosts) {
    for (const media of post.media) {
      await applyMediaPolicy(media, mediaTypes, mediaDir);
      if (media.download_requested && !media.downloaded) {
        mediaDownloadFailures += 1;
      }
    }
  }

  if (failOnMediaError && mediaDownloadFailures > 0) {
    throw new Error(`${mediaDownloadFailures} selected media item(s) could not be downloaded`);
  }

  const firstChannelInfo = pages.find((page) => page.channel_info)?.channel_info ?? {};
  const payload = {
    schema_version: 1,
    channel,
    channel_info: firstChannelInfo,
    read_at: new Date().toISOString(),
    source: {
      base_url: `https://t.me/s/${channel}`,
      pagination: "Use a.js-messages_more[data-before] as ?before=<value> for older pages.",
    },
    request: {
      limit,
      before,
      media: mediaPolicyLabel(mediaTypes),
    },
    count: selectedPosts.length,
    media_download_failures: mediaDownloadFailures,
    pages,
    posts: selectedPosts,
  };

  const outputFile = path.join(outDir, `${channel}.json`);
  await writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return {
    count: selectedPosts.length,
    outputFile,
    mediaDownloadFailures,
  };
}

function parseArgs(argv) {
  const args = {
    channel: null,
    limit: 50,
    out: "telegram_channel_output",
    media: "none",
    before: null,
    sleep: 0.3,
    failOnMediaError: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--limit") {
      args.limit = parseIntValue("--limit", argv[++index]);
    } else if (arg === "--out") {
      args.out = argv[++index];
    } else if (arg === "--media") {
      args.media = argv[++index];
    } else if (arg === "--before") {
      args.before = parseIntValue("--before", argv[++index]);
    } else if (arg === "--sleep") {
      args.sleep = parseFloatValue("--sleep", argv[++index]);
    } else if (arg === "--fail-on-media-error") {
      args.failOnMediaError = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (args.channel == null) {
      args.channel = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!args.help && args.channel == null) {
    throw new Error("Missing channel. Run tg-channel-read --help.");
  }

  return args;
}

function parseIntValue(name, value) {
  if (value == null) {
    throw new Error(`${name} expects a value`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} expects an integer`);
  }
  return parsed;
}

function parseFloatValue(name, value) {
  if (value == null) {
    throw new Error(`${name} expects a value`);
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} expects a number`);
  }
  return parsed;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": userAgent() },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

function userAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  const command = path.basename(fileURLToPath(import.meta.url));
  void command;
  console.log(`Usage:
  tg-channel-read <channel|t.me/s URL> [options]

Options:
  --limit <n>              Logical posts to save. Default: 50
  --out <dir>              Output directory. Default: telegram_channel_output
  --media <policy>         none, all, or comma list: photo,video,document,audio,sticker. Default: none
  --before <n>             Start from a specific Telegram before cursor
  --sleep <seconds>        Delay between page requests. Default: 0.3
  --fail-on-media-error    Exit non-zero if selected media cannot be downloaded
  -h, --help               Show this help

Examples:
  tg-channel-read oestick --limit 50 --out ./out --media none
  tg-channel-read tips_ai --limit 10 --out ./out --media all
  tg-channel-read nobilix --limit 50 --out ./out --media photo,video`);
}
