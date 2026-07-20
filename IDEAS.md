# Ideas backlog-candidates (brainstorm, 2026-07-20)

**Status of this file:** these are NOT backlog tasks. CLAUDE.md's bar — "cite an observed failure or gap, no speculative rewrites" — still applies to promotion. This file exists so RETRO rounds and Vijay have a standing menu to promote *from* when evidence accumulates, instead of re-inventing candidates each round. Routines: you may promote an item to TASKS.md only with cited evidence (an observed failure, a repeated PROGRESS.md mention, or a Vijay decision), logged per invariant 3. Adding/removing ideas here is a normal edit, not protected history.

## Reviewer — detection depth
- **New rule: Mongo/NoSQL injection** — flag unsanitized `req.query`/`req.body` objects passed directly into model queries, `$where`, string-built queries. (sample-app is the natural fixture source.)
- **New rule: high-entropy secret detection** — current SECRET_PATTERN is keyword-based (`password|secret|apikey|token`); a base64/hex high-entropy literal assigned to any name sails through.
- **New rule: dependency-diff review** — when a diff touches `package.json`/lockfiles, flag newly added deps (name, version pin, install scripts) as a review item.
- **New rule: ReDoS-prone regex literals** in added lines (nested quantifiers on unbounded groups).
- **Complexity/size heuristic** — flag added functions above a line/nesting threshold (style-tier severity).

## Reviewer — usability & CI fit
- **Inline suppression** — `// reviewer-disable-next-line <category>` with a rule that suppressions themselves get reported in a summary count (so they're visible, not silent).
- **Baseline file** — record existing findings once; only fail on new ones. Needed before the dogfood step (task 28) can ever become blocking.
- **`--fail-on <severity>` exit-code threshold** so CI can gate on high-severity only.
- **SARIF output** — GitHub code scanning ingests it; findings would appear as PR file annotations natively, complementing (or replacing) the single-comment flow.
- **Line-anchored PR review comments** via the Reviews API instead of one issue comment (keep the marker/update-in-place logic for the summary).
- **GitHub API resilience** — retry with backoff on 403 rate-limit/5xx in `postReviewComment`/`collectPullRequests` (currently one-shot).
- **Rule plugins** — load extra rule modules from a configurable dir, so review-rules.yaml can enable repo-local custom rules.
- **LLM-assisted layer (biggest swing)** — optional Claude API pass for semantic findings the static rules can't reach, layered on top of the deterministic core; static findings stay the reproducible baseline, LLM findings marked as such. Fits the "lead-agent-toolkit" name; needs a cost/latency budget decision from Vijay first.

## Standup / doc-drift
- **Standup: `--author` filter, review-activity section (PRs reviewed, not just opened), Slack/Notion delivery** (the Routines already have a Notion MCP connection configured — a weekly digest Routine posting to a Notion page is nearly free).
- **Doc-drift: parameter/response drift** — today it's route presence/absence; comparing documented params vs. `req.params`/`req.query` usage is the next tier.
- **Doc-drift: scaffold mode** — `--fix` emitting stub openapi.yaml entries for undocumented routes.

## sample-app (as a better test bed)
- **Integration tests with mongodb-memory-server** — current suites mock the models; an in-memory-Mongo layer would catch query-shape bugs mocks can't (e.g. the past duplicate-key-race and owner-scoping fixes would have surfaced earlier).
- **Auth hardening set**: rate limiting on `/api/auth/*`, token expiry + refresh, password policy, `helmet`.
- **Request validation** via a schema library at the route boundary (zod/celebrate), replacing hand-rolled type checks in controllers.

## Process / meta (the agent system itself)
- **Invariant linter in CI** (promoted → task 29): mechanically enforce invariant 2 (no deleted TASKS.md task lines / PROGRESS / SKILL_CHANGELOG content in a diff) and invariant 3 (CLAUDE.md/skills/TASKS.md changes require a same-commit SKILL_CHANGELOG addition).
- **PROGRESS.md rollover** (promoted → task 30): the file is ~1,140 lines and grows every run — the same reading-tax class as the CLAUDE.md bloat (AUDIT.md F2). Monthly archive files, header pointer, move-not-delete.
- **Run metrics** — a script parsing PROGRESS.md into METRICS.md (tests over time, finds per run, runs since last high-severity find). Would have made the "11 improvised runs / diminishing returns" trend (AUDIT.md F1) visible numerically instead of anecdotally; also gives the empty-backlog rule (task 22) an objective "stop mining this module" signal.
- **CLAUDE.md length budget** — CI warning when CLAUDE.md exceeds a line cap, forcing consolidation discipline before bloat recurs post-task-21.
- **Repo hygiene**: LICENSE file, repo description, README badges once CI exists, dependabot config, gitleaks/secret-scanning in CI.
- **Release process** — version tags for `reviewer/`, a CHANGELOG for the tool itself (SKILL_CHANGELOG covers self-modifications, not product releases), plugin version bumps in `plugin.json`.
- **Branch protection on `claude/dev`** requiring the task-20 CI check — turns invariant 1 from convention into a hard gate (Vijay action; GitHub settings, not repo content).
- **Weekly digest Routine** — one scheduled run that generates the standup + doc-drift + metrics summary and delivers it (Notion/push), separate from Builder/Reviewer.
