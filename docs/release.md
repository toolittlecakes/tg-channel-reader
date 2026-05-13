# Release

Publishing uses npm Trusted Publishing from GitHub Actions.

## One-time setup

- npm package: `tg-channel-reader`
- GitHub repo: `toolittlecakes/tg-channel-reader`
- npm Trusted Publisher:
  - Provider: GitHub Actions
  - Repository: `toolittlecakes/tg-channel-reader`
  - Workflow filename: `publish.yml`
  - Environment: empty

## Release flow

From `main` with a clean worktree:

```bash
npm test
npm version patch
git push --follow-tags
```

The `v*` tag triggers `.github/workflows/publish.yml`, which runs:

```bash
npm ci
npm test
npm publish
```

## Verify

```bash
gh run list --limit 3
npm view tg-channel-reader version dist-tags --json
```

## Notes

- `npm test` is fixture-only and stable.
- `npm run test:live` calls real `t.me/s` pages and is a manual smoke check.
- Do not publish from local npm unless CI publishing is broken.
