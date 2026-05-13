import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeDataView,
  normalizeChannel,
  parseMediaPolicy,
  parsePage,
  safeFilename,
} from "../node-src/parser.js";

test("normalizeChannel accepts urls", () => {
  assert.equal(normalizeChannel("https://t.me/s/oestick?before=10"), "oestick");
  assert.equal(normalizeChannel("@tips_ai"), "tips_ai");
});

test("parseMediaPolicy", () => {
  assert.deepEqual(parseMediaPolicy("none"), new Set());
  assert.equal(parseMediaPolicy("all"), null);
  assert.deepEqual(parseMediaPolicy("photo,video"), new Set(["photo", "video"]));
});

test("decodeDataView", () => {
  assert.deepEqual(decodeDataView("eyJjIjotMTkwNDA0MjgwOCwicCI6IjQ2NjVnIn0"), {
    c: -1904042808,
    p: "4665g",
  });
});

test("safeFilename", () => {
  assert.equal(safeFilename("tips_ai/4665g/1", ".mp4"), "tips_ai_4665g_1.mp4");
});

test("parse grouped document placeholder", () => {
  const html = `
    <section class="tgme_channel_history">
      <a class="js-messages_more" data-before="217"></a>
      <div class="tgme_widget_message_wrap js-widget_message_wrap">
        <div class="tgme_widget_message js-widget_message" data-post="nobilix/217"
          data-view="eyJjIjotMjI3MzM0OTgxNCwicCI6IjIxN2cifQ">
          <div class="tgme_widget_message_grouped_wrap">
            <a class="tgme_widget_message_document_wrap" href="https://t.me/nobilix/217?single">
              <div class="tgme_widget_message_document_title">demo.pdf</div>
              <div class="tgme_widget_message_document_extra">2.3 MB</div>
            </a>
          </div>
          <div class="tgme_widget_message_text js-message_text">Hello<br/>world</div>
          <time datetime="2026-05-01T10:00:00+00:00"></time>
        </div>
      </div>
    </section>
  `;
  const { posts, nextBefore } = parsePage(html, "nobilix");
  assert.equal(nextBefore, 217);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].source_post_key, "217g");
  assert.equal(posts[0].is_grouped, true);
  assert.equal(posts[0].text_plain, "Hello\nworld");
  assert.equal(posts[0].media[0].title, "demo.pdf");
  assert.equal(posts[0].media[0].size, "2.3 MB");
  assert.equal(posts[0].media[0].url, null);
});
