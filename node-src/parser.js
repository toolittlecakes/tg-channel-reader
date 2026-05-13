import { writeFile } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";

const BASE_URL = "https://t.me";
const MEDIA_TYPES = new Set(["photo", "video", "document", "audio", "sticker"]);
const MEDIA_SELECTOR = [
  "a.tgme_widget_message_photo_wrap",
  "a.tgme_widget_message_video_player",
  "audio[src]",
  "a.tgme_widget_message_document_wrap",
  ".tgme_widget_message_sticker_wrap img[src]",
  "img.tgme_widget_message_sticker[src]",
  "tgs-player.tgme_widget_message_sticker[src]",
].join(",");

export function normalizeChannel(value) {
  const channel = value
    .trim()
    .replace(/^https?:\/\/t\.me\/s\//, "")
    .replace(/^https?:\/\/t\.me\//, "")
    .replace(/^@/, "")
    .split("?", 1)[0]
    .replace(/^\/+|\/+$/g, "");

  if (!/^[A-Za-z0-9_]{3,}$/.test(channel)) {
    throw new Error(`Invalid channel username: ${JSON.stringify(channel)}`);
  }
  return channel;
}

export function parseMediaPolicy(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "all") return null;
  if (normalized === "none") return new Set();

  const selected = new Set(normalized.split(",").map((part) => part.trim()).filter(Boolean));
  const unknown = [...selected].filter((type) => !MEDIA_TYPES.has(type));
  if (unknown.length > 0) {
    throw new Error(`Unknown media type(s): ${unknown.sort().join(", ")}`);
  }
  return selected;
}

export function mediaPolicyLabel(mediaTypes) {
  if (mediaTypes == null) return "all";
  if (mediaTypes.size === 0) return "none";
  return [...mediaTypes].sort().join(",");
}

export function channelPageUrl(channel, before) {
  return before == null ? `${BASE_URL}/s/${channel}` : `${BASE_URL}/s/${channel}?before=${before}`;
}

export function discussionPageUrl(channel, postId, commentsLimit) {
  const url = new URL(`${BASE_URL}/${channel}/${postId}`);
  url.searchParams.set("embed", "1");
  url.searchParams.set("discussion", "1");
  url.searchParams.set("comments_limit", String(commentsLimit));
  return url.toString();
}

export function parsePage(html, channel) {
  const $ = cheerio.load(html);
  const before = $("a.js-messages_more[data-before]").first().attr("data-before");
  return {
    posts: $("div.js-widget_message[data-post]")
      .toArray()
      .map((element) => parsePost($, $(element), channel))
      .filter(Boolean),
    nextBefore: before && /^\d+$/.test(before) ? Number.parseInt(before, 10) : null,
    channelInfo: parseChannelInfo($),
  };
}

export function parseDiscussionPage(html, channel, postId) {
  const $ = cheerio.load(html);
  const noMessages = textOrNull($(".tme_no_messages_found").first());
  const form = $(".js-new_message_form").first();
  const parsed = parseCommentsDocument($, channel, postId);
  const authOptions = parseWidgetAuthOptions($);

  return {
    ...parsed,
    available: parsed.comments.length > 0 || form.length > 0,
    unavailable_reason: noMessages && form.length === 0 ? "discussion_unavailable" : null,
    api_url: typeof authOptions.api_url === "string" ? authOptions.api_url : null,
    request: {
      peer: form.find('input[name="peer"]').first().attr("value") ?? null,
      top_msg_id: form.find('input[name="top_msg_id"]').first().attr("value") ?? null,
      discussion_hash: form.find('input[name="discussion_hash"]').first().attr("value") ?? null,
    },
  };
}

export function parseCommentsFragment(html, channel, postId) {
  const $ = cheerio.load(`<main>${html}</main>`);
  return parseCommentsDocument($, channel, postId);
}

export function decodeDataView(value) {
  if (!value) return {};
  try {
    const decoded = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(decoded);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  } catch {
    return {};
  }
}

export function dedupePosts(posts) {
  return [...new Map(posts.map((post) => [post.source_post_key, post])).values()];
}

export function postSortKey(a, b) {
  const left = `${a.published_at ?? ""}:${String(a.post_id).padStart(12, "0")}`;
  const right = `${b.published_at ?? ""}:${String(b.post_id).padStart(12, "0")}`;
  return left.localeCompare(right);
}

export async function applyMediaPolicy(media, mediaTypes, mediaDir) {
  media.download_requested = mediaTypes == null || mediaTypes.has(media.type);
  if (!media.download_requested) return;

  if (media.url == null) {
    media.download_error = "no_direct_url";
    return;
  }
  if (!isDirectDownloadUrl(media.url)) {
    media.download_error = "not_a_direct_file_url";
    return;
  }

  try {
    const { filename, bytes } = await downloadMedia(media);
    await writeFile(path.join(mediaDir, filename), bytes);
    media.filename = filename;
    media.local_path = `media/${filename}`;
    media.downloaded = true;
  } catch (error) {
    media.download_error = `${error.name}: ${error.message}`;
  }
}

function parseChannelInfo($) {
  const counters = {};
  $(".tgme_channel_info_counter").each((_, element) => {
    const counter = $(element);
    const label = textOrNull(counter.find(".counter_type").first());
    if (label) counters[label] = textOrNull(counter.find(".counter_value").first());
  });
  const descriptionNode = $(".tgme_channel_info_description").first();
  const description = descriptionNode.length ? plainText(descriptionNode.html() ?? "") : null;

  return {
    title: textOrNull($(".tgme_channel_info_header_title span, .tgme_header_title span").first()),
    description: description || null,
    avatar_url: absoluteUrl($(".tgme_channel_info_header img, .tgme_header_info img").first().attr("src")),
    counters,
  };
}

function parseCommentsDocument($, channel, postId) {
  const before = $(".js-messages_more[data-before]").first().attr("data-before");
  const after = $(".js-messages_more[data-after]").first().attr("data-after");
  const countText = textOrNull($(".js-header").first());

  return {
    total_count: parseCount(countText),
    total_count_text: countText,
    next_before: before && /^\d+$/.test(before) ? Number.parseInt(before, 10) : null,
    next_after: after && /^\d+$/.test(after) ? Number.parseInt(after, 10) : null,
    comments: $("div.js-widget_message[data-post-id]")
      .toArray()
      .map((element) => parseComment($, $(element), channel, postId))
      .filter(Boolean),
  };
}

function parseComment($, message, channel, postId) {
  const rawId = message.attr("data-post-id");
  if (!/^\d+$/.test(rawId ?? "")) return null;

  const bubble = message.find(".tgme_widget_message_bubble").first();
  const textNode = bubble.children(".tgme_widget_message_text.js-message_text").first();
  const textHtml = textNode.length ? textNode.html() : null;
  const authorNode = bubble.find(".tgme_widget_message_author_name").first();
  const authorUrl = absoluteUrl(authorNode.is("a") ? authorNode.attr("href") : null);
  const replyNode = bubble.children(".tgme_widget_message_reply.js-reply_to").first();

  return {
    id: rawId,
    url:
      absoluteUrl(message.find(".tgme_widget_message_date[href]").first().attr("href")) ??
      `${BASE_URL}/${channel}/${postId}?comment=${rawId}`,
    published_at: message.find("time[datetime]").first().attr("datetime") ?? null,
    author_name: textOrNull(authorNode),
    author_url: authorUrl,
    author_username: usernameFromTelegramUrl(authorUrl),
    author_avatar_url: absoluteUrl(
      message.find(".tgme_widget_message_user img[src]").first().attr("src") ??
        message.find(".tgme_widget_message_user video[poster]").first().attr("poster"),
    ),
    text_plain: textHtml == null ? null : plainText(textHtml),
    text_html: textHtml,
    reply_to: parseCommentReply($, replyNode),
    reactions: parseReactions($, message),
    links: parseLinks($, textNode),
  };
}

function parseCommentReply($, replyNode) {
  if (!replyNode.length) return null;
  const textNode = replyNode.find(".js-message_reply_text").first();
  const textHtml = textNode.length ? textNode.html() : null;
  return {
    id: replyNode.attr("data-reply-to") ?? null,
    author_name: textOrNull(replyNode.find(".tgme_widget_message_author_name").first()),
    text_plain: textHtml == null ? null : plainText(textHtml),
    text_html: textHtml,
  };
}

function parsePost($, message, channel) {
  const dataPost = message.attr("data-post");
  const [sourceChannel, rawId] = dataPost?.split("/") ?? [];
  if (sourceChannel !== channel || !/^\d+$/.test(rawId ?? "")) return null;

  const postId = Number.parseInt(rawId, 10);
  const dataView = decodeDataView(message.attr("data-view"));
  const sourcePostKey = String(dataView.p ?? postId);
  const textNode = message.find(".js-message_text").first();
  const textHtml = textNode.length ? textNode.html() : null;

  return {
    source_post_key: sourcePostKey,
    post_id: postId,
    source_slug: `${channel}/${postId}`,
    url: `${BASE_URL}/${channel}/${postId}`,
    published_at: message.find("time[datetime]").first().attr("datetime") ?? null,
    telegram_channel_id: dataView.c == null ? null : String(dataView.c),
    is_grouped:
      sourcePostKey.endsWith("g") ||
      message.find(".tgme_widget_message_grouped_wrap, .tgme_widget_message_grouped").length > 0,
    text_plain: textHtml == null ? null : plainText(textHtml),
    text_html: textHtml,
    views: textOrNull(message.find(".tgme_widget_message_views").first()),
    reactions: parseReactions($, message),
    links: parseLinks($, textNode),
    media: parseMedia($, message, channel, sourcePostKey),
  };
}

function parseReactions($, message) {
  return message
    .find(".tgme_reaction")
    .toArray()
    .map((element) => {
      const reaction = $(element);
      const emoji = textOrNull(reaction.find("b").first()) ?? "";
      return { emoji, count: reaction.text().trim().replace(emoji, "").trim() };
    });
}

function parseLinks($, textNode) {
  return textNode
    .find("a[href]")
    .toArray()
    .map((element) => {
      const link = $(element);
      return { text: link.text().trim(), url: absoluteUrl(link.attr("href")) };
    });
}

function parseMedia($, message, channel, sourcePostKey) {
  return message
    .find(MEDIA_SELECTOR)
    .toArray()
    .map((element, index) => parseMediaItem($, $(element), channel, sourcePostKey, index + 1));
}

function parseMediaItem($, node, channel, sourcePostKey, index) {
  const base = { id: `${channel}/${sourcePostKey}/${index}`, ...emptyMediaFields() };

  if (node.is("a.tgme_widget_message_photo_wrap")) {
    return {
      ...base,
      type: "photo",
      url: styleUrl(node.attr("style")),
      telegram_url: absoluteUrl(node.attr("href")),
    };
  }
  if (node.is("a.tgme_widget_message_video_player")) {
    const video = node.find("video.tgme_widget_message_video").first();
    const thumb = node.find(".tgme_widget_message_video_thumb").first();
    return {
      ...base,
      type: "video",
      url: absoluteUrl(video.attr("src")),
      telegram_url: absoluteUrl(node.attr("href")),
      thumbnail_url: styleUrl(thumb.attr("style")),
    };
  }
  if (node.is("audio[src]")) {
    return { ...base, type: "audio", url: absoluteUrl(node.attr("src")) };
  }
  if (node.is("a.tgme_widget_message_document_wrap")) {
    return {
      ...base,
      type: "document",
      telegram_url: absoluteUrl(node.attr("href")),
      title: textOrNull(node.find(".tgme_widget_message_document_title").first()),
      size: textOrNull(node.find(".tgme_widget_message_document_extra").first()),
    };
  }
  return { ...base, type: "sticker", url: absoluteUrl(node.attr("src")) };
}

function emptyMediaFields() {
  return {
    type: null,
    url: null,
    telegram_url: null,
    thumbnail_url: null,
    title: null,
    size: null,
    filename: null,
    local_path: null,
    downloaded: false,
    download_requested: false,
    download_error: null,
  };
}

function plainText(html) {
  const $ = cheerio.load(`<main>${html}</main>`);
  $("br").replaceWith("\n");
  $("p, div, blockquote, pre").append("\n");
  return $("main")
    .text()
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

function textOrNull(node) {
  if (!node?.length) return null;
  const text = node.text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return text || null;
}

function styleUrl(style) {
  const match = style?.match(/url\((['"]?)(.*?)\1\)/);
  return match ? absoluteUrl(match[2]) : null;
}

function absoluteUrl(value) {
  if (!value) return null;
  return value.startsWith("//") ? `https:${value}` : new URL(value, BASE_URL).toString();
}

function usernameFromTelegramUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.hostname !== "t.me") return null;
  const username = url.pathname.replace(/^\/+|\/+$/g, "");
  return /^[A-Za-z0-9_]{3,}$/.test(username) ? username : null;
}

function parseWidgetAuthOptions($) {
  const scriptText = $("script")
    .toArray()
    .map((element) => $(element).html() ?? "")
    .find((text) => text.includes("TWidgetAuth.init("));
  const match = scriptText?.match(/TWidgetAuth\.init\((\{.*?\})\);/s);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseCount(value) {
  const match = value?.trim().match(/^([\d.,\s]+)\s*([KMB])?\b/i);
  if (!match) return null;

  const suffix = match[2]?.toUpperCase();
  if (suffix) {
    const base = Number.parseFloat(match[1].replace(/\s/g, "").replace(",", "."));
    const multiplier = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[suffix];
    return Number.isFinite(base) ? Math.round(base * multiplier) : null;
  }

  const normalized = match[1].replace(/[^\d]/g, "");
  return normalized ? Number.parseInt(normalized, 10) : null;
}

function isDirectDownloadUrl(url) {
  const hostname = new URL(url).hostname;
  return hostname.endsWith("telesco.pe") || hostname.endsWith("telegram.org");
}

async function downloadMedia(media) {
  const response = await fetch(media.url, {
    headers: { "user-agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  return {
    filename: safeFilename(media.id, extensionFor(media.url, contentType, media.type)),
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

function extensionFor(url, contentType, mediaType) {
  const suffix = path.extname(new URL(url).pathname);
  if (suffix && suffix.length <= 8) return suffix;

  return (
    {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "video/mp4": ".mp4",
      "audio/ogg": ".ogg",
      "application/pdf": ".pdf",
    }[contentType] ??
    { photo: ".jpg", video: ".mp4", audio: ".ogg", sticker: ".webp" }[mediaType] ??
    ".bin"
  );
}

export function safeFilename(mediaId, ext) {
  return `${mediaId.replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9_.-]+/g, "_")}${ext}`;
}
