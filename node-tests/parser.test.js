import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, resolveSkillInstallTargets } from "../node-src/cli.js";
import {
  decodeDataView,
  normalizeChannel,
  parseCommentsFragment,
  parseDiscussionPage,
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

test("parseArgs accepts comments-limit all", () => {
  assert.equal(parseArgs(["contest", "--comments-limit", "all"]).commentsLimit, "all");
  assert.equal(parseArgs(["contest", "--comments-limit", "100"]).commentsLimit, 100);
});

test("parseArgs accepts skill without channel", () => {
  const args = parseArgs(["--skill"]);
  assert.equal(args.skill, true);
  assert.equal(args.channel, null);
});

test("parseArgs accepts install-skill without channel", () => {
  const args = parseArgs(["--install-skill", "/tmp/tg-skill"]);
  assert.equal(args.installSkill, true);
  assert.equal(args.installSkillTarget, "/tmp/tg-skill");
  assert.deepEqual(resolveSkillInstallTargets(args), ["/tmp/tg-skill"]);
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

test("parse channel description preserves blank lines", () => {
  const html = `
    <div class="tgme_channel_info">
      <div class="tgme_channel_info_header">
        <div class="tgme_channel_info_header_title"><span>AI и грабли</span></div>
      </div>
      <div class="tgme_channel_info_description">Строил HR продукты<br/><br/><a href="https://t.me/nikolay_sheyko">@nikolay_sheyko</a></div>
    </div>
  `;

  const { channelInfo } = parsePage(html, "oestick");
  assert.equal(channelInfo.description, "Строил HR продукты\n\n@nikolay_sheyko");
});

test("parse discussion widget page with comments", () => {
  const html = `
    <div class="tgme_post_discussion_header_wrap">
      <h3><span class="js-header">740 comments</span> on <a href="https://t.me/contest/198">this post</a></h3>
    </div>
    <div class="tgme_post_discussion js-message_history">
      <div class="tme_messages_more js-messages_more" data-before="235679">Show more</div>
      <div class="tgme_widget_message_wrap js-widget_message_wrap">
        <div class="tgme_widget_message js-widget_message" data-post-id="238737">
          <div class="tgme_widget_message_user">
            <a href="https://t.me/skorphil"><i><img src="//example.com/avatar.jpg"></i></a>
          </div>
          <div class="tgme_widget_message_bubble">
            <div class="tgme_widget_message_author accent_color">
              <a class="tgme_widget_message_author_name" href="https://t.me/skorphil">
                <span dir="auto">Philipp</span>
              </a>
            </div>
            <div class="tgme_widget_message_reply js-reply_to" data-reply-to="1">
              <span class="tgme_widget_message_author_name">Alice</span>
              <div class="tgme_widget_message_text js-message_reply_text">Original<br/>text</div>
            </div>
            <div class="tgme_widget_message_text js-message_text">Not bad <a href="https://example.com">link</a></div>
            <div class="tgme_widget_message_reactions js-message_reactions">
              <span class="tgme_reaction"><b>❤</b>3</span>
            </div>
            <div class="tgme_widget_message_footer">
              <a class="tgme_widget_message_date" href="https://t.me/contest/198?comment=238737">
                <time datetime="2024-07-09T07:23:30+00:00">Jul 9, 2024</time>
              </a>
            </div>
          </div>
        </div>
      </div>
      <div class="tme_messages_more js-messages_more autoload hide" data-after="238737"></div>
    </div>
    <form class="tgme_post_discussion_new_message_form js-new_message_form">
      <input type="hidden" name="peer" value="c1322215945_4517828080545053944" />
      <input type="hidden" name="top_msg_id" value="130198" />
      <input type="hidden" name="discussion_hash" value="83c60ba1c7893cb3dd" />
    </form>
    <script>TWidgetAuth.init({"api_url":"https:\\/\\/t.me\\/api\\/method?api_hash=abc","unauth":true});</script>
  `;

  const page = parseDiscussionPage(html, "contest", 198);
  assert.equal(page.available, true);
  assert.equal(page.total_count, 740);
  assert.equal(page.next_before, 235679);
  assert.equal(page.next_after, 238737);
  assert.equal(page.api_url, "https://t.me/api/method?api_hash=abc");
  assert.deepEqual(page.request, {
    peer: "c1322215945_4517828080545053944",
    top_msg_id: "130198",
    discussion_hash: "83c60ba1c7893cb3dd",
  });
  assert.equal(page.comments.length, 1);
  assert.equal(page.comments[0].id, "238737");
  assert.equal(page.comments[0].author_name, "Philipp");
  assert.equal(page.comments[0].author_username, "skorphil");
  assert.equal(page.comments[0].author_avatar_url, "https://example.com/avatar.jpg");
  assert.equal(page.comments[0].text_plain, "Not bad link");
  assert.equal(page.comments[0].reply_to.id, "1");
  assert.equal(page.comments[0].reply_to.text_plain, "Original\ntext");
  assert.deepEqual(page.comments[0].reactions, [{ emoji: "❤", count: "3" }]);
  assert.deepEqual(page.comments[0].links, [{ text: "link", url: "https://example.com/" }]);
});

test("parse unavailable discussion widget page", () => {
  const html = `
    <div class="tgme_post_discussion tgme_widget_messages_helper js-message_history">
      <div class="tgme_widget_message_wrap js-widget_message_wrap js-no_messages_wrap">
        <div class="tme_no_messages_found">Discussion is not available at the moment.</div>
      </div>
    </div>
  `;

  const page = parseDiscussionPage(html, "durov", 508);
  assert.equal(page.available, false);
  assert.equal(page.unavailable_reason, "discussion_unavailable");
  assert.equal(page.comments.length, 0);
});

test("parse comments API fragment", () => {
  const fragment = `
    <div class="tme_messages_more js-messages_more" data-before="193654">Show more</div>
    <div class="tgme_widget_message_wrap js-widget_message_wrap">
      <div class="tgme_widget_message js-widget_message" data-post-id="193654">
        <div class="tgme_widget_message_bubble">
          <div class="tgme_widget_message_author accent_color">
            <span class="tgme_widget_message_author_name">Deleted Account</span>
          </div>
          <div class="tgme_widget_message_text js-message_text"><code>Hello</code><br/><i>world</i></div>
          <div class="tgme_widget_message_footer">
            <a class="tgme_widget_message_date" href="https://t.me/contest/198?comment=193654">
              <time datetime="2022-04-20T09:09:35+00:00">Apr 20, 2022</time>
            </a>
          </div>
        </div>
      </div>
    </div>
  `;

  const page = parseCommentsFragment(fragment, "contest", 198);
  assert.equal(page.next_before, 193654);
  assert.equal(page.comments.length, 1);
  assert.equal(page.comments[0].text_plain, "Hello\nworld");
});
