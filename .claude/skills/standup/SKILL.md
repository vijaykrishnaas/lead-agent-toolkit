---
name: standup
description: Generates a per-author standup digest (last 24h of git commits, plus GitHub pull request activity when a GitHub owner/repo is given) using reviewer/src/standupCli.js. Use when asked for a standup, daily digest, or "what did the team do yesterday/since <time>" summary for a git repo.
argument-hint: [owner] [gh-repo] [since]
---

## What this does

Collects git commits (via `git log`) from the last 24 hours — or since a
given timestamp — grouped by author, plus GitHub pull request activity for
the same window when a GitHub `owner`/`gh-repo` are given, and renders it as
a markdown standup report. One script, `reviewer/src/standupCli.js`
(`npm run standup` from `reviewer/`). The report is printed to stdout (or
written to a file with `--out`) — this skill does not post anywhere.

## Before running

1. Confirm the local git repo to summarize (`--repo`, defaults to the
   current working directory).
2. If pull request activity should be included, get both `owner` and
   `gh-repo` (the GitHub org/user and repo name) — they must be given
   together or not at all. Without them, the report covers commits only.
3. A GitHub token is only needed for PR collection, and only to avoid
   GitHub's unauthenticated rate limit — `GITHUB_TOKEN` from the environment
   is used automatically if set, or pass `--token <token>` explicitly.
   Neither is required; commit-only or lightly-rate-limited PR lookups still
   work without one.
4. Default window is the last 24 hours. Pass `--since <ISO-8601 timestamp>`
   for a different window (e.g. since last Friday for a Monday standup).

## Running it

From the repo root:

```bash
node reviewer/src/standupCli.js \
  [--owner <owner> --gh-repo <repo-name>] [--repo <path-to-local-git-repo>] \
  [--since <iso-date>] [--token <token>] [--out <file>]
```

- `--repo` defaults to the current working directory.
- `--owner`/`--gh-repo` are optional but must be given together; omit both
  for a commits-only report.
- `--since` defaults to 24 hours before now.
- `--out <file>` writes the report to a file instead of printing it.

Exit code is `0` on success, `1` on any failure (invalid args, `git log`
failure, a failed GitHub API call, or a failed file write), always with a
clear one-line message on stderr — never a raw crash.

## After running

Show the generated report back to the user (or confirm the file it was
written to with `--out`). If PR activity was requested but no token was
available, mention that unauthenticated GitHub API calls are more tightly
rate-limited, in case results looked truncated.

## Reference

- The reviewer's overall architecture is documented in the root
  [README.md](../../../README.md).
- `generateStandup` (`reviewer/src/standup/generateStandup.js`) is the
  underlying orchestration this skill's script wraps; `collectCommits.js`
  and `collectPullRequests.js` are its two data sources.
