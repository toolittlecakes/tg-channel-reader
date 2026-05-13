---
name: tg-channel-reader
description: CLI reader for public Telegram channel preview pages and public Discussion Widget comments. Use when the user wants to export public Telegram channel posts, media metadata, reactions, links, and comments without Telegram login.
allowed-tools: Bash(tg-channel-read:*), Bash(npx -y tg-channel-reader:*)
hidden: true
---

# tg-channel-reader

CLI for public Telegram channel preview pages and public post comments.

Install:

```bash
npm install -g tg-channel-reader@latest
```

Or run without installing:

```bash
npx -y tg-channel-reader --skill
```

This file is a discovery stub, not the full usage guide.

Before running `tg-channel-read`, load the actual workflow content from the installed CLI:

```bash
tg-channel-read --skill
```

The CLI serves skill content that matches the installed version, so instructions stay in sync with the binary.

To install this discovery stub into local agent skill directories:

```bash
tg-channel-read --install-skill all
```
