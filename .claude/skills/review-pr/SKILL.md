---
name: review-pr
description: Runs this repo's reviewer (reviewer/src/reviewPrCli.js) on a pull request's diff and posts the markdown report as a PR comment. Use when asked to review a PR, review a commit/branch range and post feedback, or run the reviewer against a specific base..head range for a GitHub PR.
argument-hint: "[owner] [gh-repo] [pr-number] [base..head]"
---

## What this does

Generates a `git diff <base>..<head>` for a local repo, runs it through the
reviewer's rule set (`review-rules.yaml`), formats a markdown report, and
posts that report as a comment on the given GitHub PR — all via one script,
`reviewer/src/reviewPrCli.js` (`npm run review-pr` from `reviewer/`).

Re-running this skill against a PR it already commented on updates that
prior comment in place rather than posting a new one each time, so
reviewing the same PR repeatedly doesn't grow a long comment thread.

## Before running

1. Confirm the four required values: `owner`, `gh-repo` (the GitHub repo
   name), `pr-number`, and the `base..head` commit range to diff. Ask the
   user for whichever of these aren't already clear from context (e.g. a PR
   URL gives you owner/repo/number directly; the range is usually the PR's
   base branch and head commit/branch).
2. A GitHub token is required to post the comment: either `GITHUB_TOKEN` is
   set in the environment, or pass `--token <token>` explicitly. If neither
   is available, run with `--no-post` to still produce the report without
   posting, and tell the user a token is needed to post it.
3. If the user only wants to see the report (no posting), use `--no-post`.

## Running it

From the repo root:

```bash
node reviewer/src/reviewPrCli.js \
  --owner <owner> --gh-repo <repo-name> --pr <number> <base>..<head> \
  [--repo <path-to-local-git-repo>] [--config <path-to-review-rules.yaml>] \
  [--token <token>] [--out <file>] [--no-post]
```

- `--repo` defaults to the current working directory; point it at the local
  clone containing the commit range if you're not already inside it.
- `--config` defaults to the repo-root `review-rules.yaml`.
- `--out <file>` also writes the report to a file (in addition to printing
  it, unless combined with posting).
- `--no-post` skips posting to GitHub entirely — use for a dry run.

Exit code is `0` on success, `1` on any failure (invalid args, `git diff`
failure, bad config, review error, or a failed GitHub API post), always with
a clear one-line message on stderr — never a raw crash.

## After running

Report the risk level and issue count back to the user, and confirm whether
the comment was actually posted (the CLI prints
`Posted review comment to <owner>/<gh-repo>#<pr-number>.` on success) or
just previewed (`--no-post` / no token available).

## Reference

- The reviewer's rule categories, CLI, and config are documented in the root
  [README.md](../../../README.md).
- `postReviewComment` (`reviewer/src/github/postReviewComment.js`) is the
  underlying GitHub API call this skill's script wraps.
