# tg-channel-reader

Node CLI for public Telegram channel preview pages: `https://t.me/s/<username>`.

No bun dependency. Uses `cheerio` for HTML parsing.

## Install

From this folder:

```bash
npm install -g .
```

After publish:

```bash
npm install -g tg-channel-reader
```

## Usage

```bash
tg-channel-read oestick --limit 50 --out ./out --media none
tg-channel-read tips_ai --limit 10 --out ./out --media all
tg-channel-read nobilix --limit 50 --out ./out --media photo,video
tg-channel-read contest --limit 1 --comments-limit all --out ./out
tg-channel-read --help
```

## Tests

```bash
npm test
npm run test:live
```

`npm test` uses local fixtures only. `npm run test:live` calls real `t.me/s` pages and can fail if Telegram or the target channels are unavailable.

Output:

- `<out>/<username>.json`
- `<out>/media/*` when selected media are downloadable from the preview HTML

`--media` accepts:

- `none`: keep media placeholders in JSON, download nothing.
- `all`: try to download every direct media URL found in the preview HTML.
- comma list: `photo,video,document,audio,sticker`.

Some Telegram preview items expose only a Telegram post link, not a direct file URL. Those stay as placeholders with `download_error: "no_direct_url"`.

`--comments-limit <n|all>` fetches latest comments per selected post from Telegram's public Discussion Widget. Use `all` to keep paginating until the widget stops returning older-page cursors. The default is `0`, so comments are skipped unless explicitly requested. Posts without public discussions get a `comments.available: false` marker.

## t.me/s pagination

`t.me/s/<username>` renders a static preview window of roughly 20 messages.

The older-page cursor is:

```html
<a class="... js-messages_more" data-before="479" href="/s/oestick?before=479">
```

Next request:

```text
https://t.me/s/<username>?before=<data-before>
```

Grouped media must be treated as one logical post. Telegram exposes this in `data-view.p`, often as a key with `g`, for example `4665g`; nested media links like `?single` are only media items inside that post.

## Discussion widget pagination

Post comments are loaded from:

```text
https://t.me/<username>/<post_id>?embed=1&discussion=1&comments_limit=<n>
```

The widget page exposes a `data-before` cursor plus `peer`, `top_msg_id`, and `discussion_hash` form fields. Older comment pages are requested through the widget API with `method=loadComments&before_id=<data-before>`.
