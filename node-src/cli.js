import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMediaPolicy,
  channelPageUrl,
  dedupePosts,
  discussionPageUrl,
  mediaPolicyLabel,
  normalizeChannel,
  parseCommentsFragment,
  parseDiscussionPage,
  parseMediaPolicy,
  parsePage,
  postSortKey,
} from "./parser.js";

const DISCOVERY_SKILL_NAME = "tg-channel-reader";
const PACKAGE_NAME = "tg-channel-reader";

export async function main(argv) {
  const args = parseArgs(argv);

  if (!args.skipUpdates) {
    await assertPackageIsCurrent();
  }

  if (args.version) {
    console.log(await currentPackageVersion());
    return;
  }
  if (args.help) {
    printHelp();
    return;
  }
  if (args.skill) {
    await printSkill();
    return;
  }
  if (args.installSkill) {
    await installDiscoverySkill(args);
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
    commentsLimit: args.commentsLimit,
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
  commentsLimit = 0,
}) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit must be >= 1");
  }
  if (commentsLimit !== "all" && (!Number.isInteger(commentsLimit) || commentsLimit < 0)) {
    throw new Error('--comments-limit must be >= 0 or "all"');
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

  if (commentsLimit === "all" || commentsLimit > 0) {
    for (const post of selectedPosts) {
      post.comments = await readPostComments({ channel, postId: post.post_id, limit: commentsLimit, sleepMs });
      if (sleepMs > 0) {
        await sleep(sleepMs);
      }
    }
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
      comments_limit: commentsLimit,
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

async function readPostComments({ channel, postId, limit, sleepMs }) {
  const pageSize = limit === "all" ? 50 : Math.min(limit, 50);
  const url = discussionPageUrl(channel, postId, pageSize);
  const html = await fetchText(url);
  const firstPage = parseDiscussionPage(html, channel, postId);
  const pages = [
    {
      url,
      method: "embed",
      comments: firstPage.comments.length,
      next_before: firstPage.next_before,
      available: firstPage.available,
      unavailable_reason: firstPage.unavailable_reason,
    },
  ];

  if (!firstPage.available) {
    return {
      available: false,
      unavailable_reason: firstPage.unavailable_reason,
      total_count: firstPage.total_count,
      total_count_text: firstPage.total_count_text,
      loaded_count: 0,
      pages,
      comments: [],
    };
  }

  assertDiscussionRequest(firstPage, channel, postId);

  const seenCursors = new Set();
  const comments = [...firstPage.comments];
  let totalCount = firstPage.total_count;
  let totalCountText = firstPage.total_count_text;
  let nextBefore = firstPage.next_before;

  while ((limit === "all" || comments.length < limit) && nextBefore != null) {
    if (seenCursors.has(nextBefore)) {
      throw new Error(`Comments pagination loop detected at ${channel}/${postId} before_id=${nextBefore}`);
    }
    seenCursors.add(nextBefore);

    const result = await postWidgetApi(firstPage.api_url, {
      method: "loadComments",
      peer: firstPage.request.peer,
      top_msg_id: firstPage.request.top_msg_id,
      discussion_hash: firstPage.request.discussion_hash,
      before_id: nextBefore,
    });
    if (!result.ok) {
      throw new Error(`Comments fetch failed for ${channel}/${postId}: ${result.error ?? "unknown API error"}`);
    }

    const page = parseCommentsFragment(result.comments_html ?? "", channel, postId);
    comments.push(...page.comments);
    totalCount = typeof result.comments_cnt === "number" ? result.comments_cnt : totalCount;
    totalCountText = result.header_html ?? totalCountText;
    pages.push({
      url: firstPage.api_url,
      method: "loadComments",
      before_id: nextBefore,
      comments: page.comments.length,
      next_before: page.next_before,
    });
    nextBefore = page.next_before;

    if (sleepMs > 0) {
      await sleep(sleepMs);
    }
  }

  const sortedComments = dedupeComments(comments).sort(
    (left, right) => Number.parseInt(left.id, 10) - Number.parseInt(right.id, 10),
  );
  const selectedComments =
    limit === "all" ? sortedComments : sortedComments.slice(Math.max(0, sortedComments.length - limit));

  return {
    available: true,
    unavailable_reason: null,
    total_count: totalCount,
    total_count_text: totalCountText,
    loaded_count: selectedComments.length,
    pages,
    comments: selectedComments,
  };
}

function assertDiscussionRequest(page, channel, postId) {
  if (!page.api_url || !page.request.peer || !page.request.top_msg_id || !page.request.discussion_hash) {
    throw new Error(`Discussion widget metadata is missing for ${channel}/${postId}`);
  }
}

function dedupeComments(comments) {
  return [...new Map(comments.map((comment) => [comment.id, comment])).values()];
}

async function postWidgetApi(url, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": userAgent(),
      "x-requested-with": "XMLHttpRequest",
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

export function parseArgs(argv) {
  const args = {
    channel: null,
    limit: 50,
    out: "telegram_channel_output",
    media: "none",
    before: null,
    commentsLimit: 0,
    sleep: 0.3,
    failOnMediaError: false,
    skill: false,
    installSkill: false,
    installSkillTarget: null,
    skipUpdates: false,
    version: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--version") {
      args.version = true;
    } else if (arg === "--skip-updates") {
      args.skipUpdates = true;
    } else if (arg === "--skill") {
      args.skill = true;
    } else if (arg === "--install-skill") {
      args.installSkill = true;
      const next = argv[index + 1];
      if (next != null && !next.startsWith("--")) {
        args.installSkillTarget = argv[++index];
      }
    } else if (arg === "--limit") {
      args.limit = parseIntValue("--limit", argv[++index]);
    } else if (arg === "--out") {
      args.out = argv[++index];
    } else if (arg === "--media") {
      args.media = argv[++index];
    } else if (arg === "--before") {
      args.before = parseIntValue("--before", argv[++index]);
    } else if (arg === "--comments-limit") {
      args.commentsLimit = parseCommentsLimit(argv[++index]);
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

  if (!args.help && !args.version && !args.skill && !args.installSkill && args.channel == null) {
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

function parseCommentsLimit(value) {
  if (value == null) {
    throw new Error("--comments-limit expects a value");
  }
  if (value === "all") {
    return "all";
  }
  return parseIntValue("--comments-limit", value);
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

async function printSkill() {
  process.stdout.write(await readFile(path.join(packageRoot(), "skill-data", "core", "SKILL.md"), "utf8"));
}

async function installDiscoverySkill(args) {
  const stub = await readFile(path.join(packageRoot(), "skills", DISCOVERY_SKILL_NAME, "SKILL.md"), "utf8");
  const targets = resolveSkillInstallTargets(args);

  for (const targetDir of targets) {
    await mkdir(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, "SKILL.md");
    await writeFile(targetFile, stub, "utf8");
    console.log(`Installed discovery skill to ${targetFile}`);
  }

  console.log("Run 'tg-channel-read --skill' to view the agent-facing usage guide.");
}

export function resolveSkillInstallTargets(args) {
  const target = args.installSkillTarget;
  if (target == null) {
    return unique([skillInstallDirForAgent("codex"), skillInstallDirForAgent("claude"), skillInstallDirForAgent("universal")]);
  }
  if (target === "all") {
    return unique([
      skillInstallDirForAgent("codex"),
      skillInstallDirForAgent("claude"),
      skillInstallDirForAgent("cursor"),
      skillInstallDirForAgent("universal"),
    ]);
  }
  if (["codex", "claude", "cursor", "universal"].includes(target)) {
    return [skillInstallDirForAgent(target)];
  }
  return [target];
}

function skillInstallDirForAgent(agent) {
  const home = os.homedir();
  if (agent === "codex") return path.join(home, ".codex", "skills", DISCOVERY_SKILL_NAME);
  if (agent === "claude") return path.join(home, ".claude", "skills", DISCOVERY_SKILL_NAME);
  if (agent === "cursor") return path.join(home, ".cursor", "skills", DISCOVERY_SKILL_NAME);
  if (agent === "universal") return path.join(home, ".agents", "skills", DISCOVERY_SKILL_NAME);
  throw new Error(`Unknown agent: ${agent}`);
}

function unique(values) {
  return [...new Set(values)];
}

async function assertPackageIsCurrent() {
  const [current, latest] = await Promise.all([currentPackageVersion(), fetchLatestPackageVersion()]);
  if (!isNewerVersion(latest, current)) return;

  throw new Error(
    [
      `${PACKAGE_NAME} ${latest} is available. Installed version: ${current}.`,
      `Update first: npm install -g ${PACKAGE_NAME}@latest`,
      "Or bypass this gate for this run: tg-channel-read --skip-updates ...",
    ].join("\n"),
  );
}

async function currentPackageVersion() {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot(), "package.json"), "utf8"));
  return packageJson.version;
}

async function fetchLatestPackageVersion() {
  const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
    headers: { accept: "application/json", "user-agent": `${PACKAGE_NAME} update-check` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Update check failed: npm registry returned HTTP ${response.status}. Use --skip-updates to run anyway.`);
  }

  const metadata = await response.json();
  if (typeof metadata.version !== "string") {
    throw new Error("Update check failed: npm registry response has no version. Use --skip-updates to run anyway.");
  }
  return metadata.version;
}

export function isNewerVersion(candidate, current) {
  const candidateParts = parseVersion(candidate);
  const currentParts = parseVersion(current);
  for (let index = 0; index < 3; index += 1) {
    if (candidateParts[index] > currentParts[index]) return true;
    if (candidateParts[index] < currentParts[index]) return false;
  }
  return false;
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Invalid package version: ${version}`);
  }
  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function packageRoot() {
  const currentFile = fileURLToPath(import.meta.url);
  return path.dirname(path.dirname(currentFile));
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
  --comments-limit <n|all> Save latest comments per post, or all available comments. Default: 0
  --sleep <seconds>        Delay between page requests. Default: 0.3
  --fail-on-media-error    Exit non-zero if selected media cannot be downloaded
  --skip-updates           Skip the npm latest-version gate for this run
  --version                Print the installed version
  --skill                  Print the agent-facing usage guide
  --install-skill [target] Install discovery SKILL.md. target: all, codex, claude, cursor, universal, or path
  -h, --help               Show this help

Examples:
  tg-channel-read oestick --limit 50 --out ./out --media none
  tg-channel-read tips_ai --limit 10 --out ./out --media all
  tg-channel-read nobilix --limit 50 --out ./out --media photo,video
  tg-channel-read --install-skill all`);
}
