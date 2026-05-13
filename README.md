# tg-channel-reader

CLI for exporting public Telegram channel posts from `t.me/s/<channel>`.

It works without Telegram login. It reads the public web preview, saves posts as JSON, and can optionally fetch public comments exposed through Telegram's Discussion Widget.

## Install

```bash
npm install -g tg-channel-reader
```

Local checkout:

```bash
npm install -g .
```

## Quick Start

Export latest 50 posts:

```bash
tg-channel-read oestick --limit 50 --out ./out
```

Read a `t.me/s` URL directly:

```bash
tg-channel-read https://t.me/s/oestick --limit 20 --out ./out
```

Save comments too:

```bash
tg-channel-read contest --limit 1 --comments-limit all --out ./out
```

Output:

```text
./out/<channel>.json
./out/media/*   # only when media downloading is enabled
```

## Options

```text
--limit <n>              Posts to save. Default: 50
--out <dir>              Output directory. Default: telegram_channel_output
--media <policy>         none, all, or comma list: photo,video,document,audio,sticker. Default: none
--before <n>             Start from a Telegram web preview cursor
--comments-limit <n|all> Save latest comments per post, or all available comments. Default: 0
--sleep <seconds>        Delay between requests. Default: 0.3
--fail-on-media-error    Exit non-zero if selected media cannot be downloaded
--skill                  Print the agent-facing usage guide
--install-skill [target] Install discovery SKILL.md. target: all, codex, claude, cursor, universal, or path
```

## Media

By default, media is not downloaded. The JSON still includes media metadata and preview URLs when Telegram exposes them.

Download all direct media URLs:

```bash
tg-channel-read tips_ai --limit 10 --media all --out ./out
```

Download only selected media types:

```bash
tg-channel-read nobilix --limit 50 --media photo,video --out ./out
```

Some Telegram preview items expose only a Telegram post link, not a direct file URL. Those stay in JSON with `download_error: "no_direct_url"` when download is requested.

## Comments

Comments are disabled by default.

Reading all comments for many posts can take a long time and make many requests. Do not use `--comments-limit all` as the default path for a whole channel. Use it only when you explicitly need every available comment, and usually start with a small `--limit`.

Fetch the latest 100 comments per post:

```bash
tg-channel-read contest --limit 5 --comments-limit 100 --out ./out
```

Fetch all comments available through the public widget:

```bash
tg-channel-read contest --limit 1 --comments-limit all --out ./out
```

Comments are stored inside each post:

```json
{
  "posts": [
    {
      "source_slug": "contest/198",
      "comments": {
        "available": true,
        "total_count": 740,
        "loaded_count": 740,
        "comments": []
      }
    }
  ]
}
```

Comment order is chronological: oldest first, newest last.

If a post has no public discussion widget, the output contains:

```json
{
  "comments": {
    "available": false,
    "unavailable_reason": "discussion_unavailable",
    "comments": []
  }
}
```

## Agent Skill

Print the bundled agent instructions:

```bash
tg-channel-read --skill
```

Install the discovery skill locally:

```bash
tg-channel-read --install-skill
```

Install for all supported agent directories:

```bash
tg-channel-read --install-skill all
```

Install to a custom directory:

```bash
tg-channel-read --install-skill ~/.agents/skills/tg-channel-reader
```

## Development

```bash
npm test
npm run test:live
```

`npm test` uses local fixtures. `npm run test:live` calls real Telegram pages and may fail if Telegram or target channels are unavailable.
