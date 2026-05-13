---
name: core
description: Core tg-channel-reader usage guide. Read this before running tg-channel-read commands. Covers exporting public Telegram channel preview posts, media metadata, reactions, links, and public Discussion Widget comments without Telegram login.
allowed-tools: Bash(tg-channel-read:*), Bash(npx -y tg-channel-reader:*)
---

# tg-channel-reader core

CLI reader for public Telegram `t.me/s/<username>` preview pages.

Use this tool when the user wants to export public Telegram channel posts without a Telegram login. It can also read public post comments exposed through Telegram's Discussion Widget.

The CLI checks npm before every command. If a newer version exists, it exits before reading anything. Update with `npm install -g tg-channel-reader@latest`, or use `--skip-updates` only when the user explicitly wants to bypass the gate for one run.

## Main path

```bash
tg-channel-read <channel|t.me/s URL> --limit 50 --out ./out --media none
```

Output:

```text
<out>/<channel>.json
<out>/media/*  # only when selected media are downloadable
```

## Useful commands

```bash
tg-channel-read oestick --limit 50 --out ./out --media none
tg-channel-read tips_ai --limit 10 --out ./out --media all
tg-channel-read nobilix --limit 50 --out ./out --media photo,video
tg-channel-read contest --limit 1 --comments-limit all --out ./out
```

## Options

- `--limit <n>`: number of logical posts to save.
- `--out <dir>`: output directory.
- `--media <policy>`: `none`, `all`, or comma list: `photo,video,document,audio,sticker`.
- `--before <n>`: start from a specific `t.me/s` `data-before` cursor.
- `--comments-limit <n|all>`: save latest comments per selected post, or all available comments.
- `--sleep <seconds>`: delay between page/widget requests.
- `--fail-on-media-error`: exit non-zero if selected media cannot be downloaded.
- `--skip-updates`: skip the npm latest-version gate for this run.
- `--version`: print the installed version.
- `--skill`: print this guide.
- `--install-skill`: install the discovery `SKILL.md` into local agent skill directories.

## Comments

Comments are stored under each post:

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

For `--comments-limit 100`, the CLI keeps the latest 100 comments, ordered oldest to newest. For `--comments-limit all`, it keeps every comment available through the widget.

Posts without public discussions get:

```json
{
  "comments": {
    "available": false,
    "unavailable_reason": "discussion_unavailable",
    "comments": []
  }
}
```

## Pagination model

Posts:

```text
https://t.me/s/<username>?before=<data-before>
```

Comments:

```text
https://t.me/<username>/<post_id>?embed=1&discussion=1&comments_limit=<n>
```

The widget page exposes `data-before`, `peer`, `top_msg_id`, and `discussion_hash`. Older comment pages are loaded through the widget API with `method=loadComments&before_id=<data-before>`.

## Rules

- Use `--media none` unless the user explicitly asks to download media.
- Do not use `--skip-updates` by default. First update the package when the update gate blocks execution.
- Use `--comments-limit all` only when the user explicitly asks for all comments. Do not use it as the default path for a whole channel; reading all comments for many posts can be slow and request-heavy. Start with a small `--limit` unless the user requested a full export.
- Treat unavailable comments as expected output, not a failure.
- Run `npm test` after changing parser or CLI behavior.

## Agent setup

Install the local discovery skill for default agent targets:

```bash
tg-channel-read --install-skill
```

Install for every supported target:

```bash
tg-channel-read --install-skill all
```

Install for one target:

```bash
tg-channel-read --install-skill codex
tg-channel-read --install-skill claude
tg-channel-read --install-skill cursor
tg-channel-read --install-skill universal
```

Custom target:

```bash
tg-channel-read --install-skill ~/.agents/skills/tg-channel-reader
```

This writes the small discovery stub to `<target>/SKILL.md`. The full workflow remains available through `tg-channel-read --skill`.
