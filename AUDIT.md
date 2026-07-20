# Audit — full review of the toolkit and its autonomous process

**Date:** 2026-07-20
**Auditor:** external audit session requested by Vijay (independent of the Builder/Reviewer Routines)
**Scope:** everything on `claude/dev` as of `e674f2a` (56 commits): `reviewer/`, `sample-app/`, skills, `plugin/`, `review-rules.yaml`, and the self-improvement process itself (CLAUDE.md, TASKS.md, PROGRESS.md, RETRO.md, SKILL_CHANGELOG.md, Routine behavior).

## Verification record

- Tree extracted from `origin/claude/dev` and both suites run clean before any change:
  `reviewer/` **314/314** green (34 suites), `sample-app/` **48/48** green (5 suites), Node v22.22.2 / npm 10.9.7.
- TASKS.md: all 19 items `[DONE]`, none deleted (invariant 2 holds across all 56 commits).
- SKILL_CHANGELOG.md: every CLAUDE.md/skill/backlog self-modification found in the history has a matching dated entry with PROGRESS.md evidence (invariant 3 holds).
- Every commit message claims a green suite and PROGRESS.md corroborates counts run-over-run (invariant 1 holds by record; see F4 — nothing enforces it mechanically).

## What went well (worth keeping, verbatim)

- **The hunt-after-every-task discipline works.** Best single example: task 19's HMAC bot-comment marker shipped with a copy-the-posted-marker bypass that defeated its own threat model — and the very next run's hunt found it, reproduced it, and fixed it (first-match-wins). The post-task cadence caught a real security reasoning error one run after it shipped.
- **Repro-before-fix and `git stash` fail/pass confirmation** for every regression test is consistently applied and documented. Test counts grew 0 → 362 with per-run deltas explained.
- **Evidence-gated self-modification** ("cite an observed failure — no speculative rewrites") visibly prevented scope invention: RETRO rounds repeatedly declined to promote single-mention items.
- **Honest escalation:** runs restated unresolved questions for Vijay instead of deciding them unilaterally, and said so explicitly.

## Findings

Severity: **P1** = structural, actively costing quality or spend today; **P2** = real gap, moderate cost or waiting-on-decision; **P3** = cleanup/polish.

### Process & architecture

**F1 (P1) — Backlog exhaustion; 11 consecutive improvised runs.**
All 19 tasks were done by 2026-07-19. Since then every run (both Routines) has improvised the same "hunt the newest not-yet-reviewed diff" behavior. The last ~6 finds are each a narrower edge case in the same ~80-line boundary machinery in `reviewer/src/rules/errorHandling.js` (nested default-param object literals, ASI termination, scan-vs-check ordering) — real bugs, but with visibly shrinking blast radius; run 7 itself called out the diminishing expected value. Two 12-runs/day Routines are spending full sessions on micro-edge-cases.
→ Fixed by this audit: TASKS.md refilled (tasks 20–28); empty-backlog behavior formalized via task 22.

**F2 (P1) — CLAUDE.md guideline bloat.**
The per-occurrence-scoping guideline (CLAUDE.md line 14) has been "broadened" ten times into a single ~15,000-character run-on paragraph; the file's guideline section is ~5× the size of the actual instructions. Every run must read this before starting — a real per-run token/attention tax, flagged by runs 7 and 8 and awaiting Vijay's decision. **Decision (Vijay, 2026-07-20): consolidate.** Compact numbered rules stay in CLAUDE.md; recurrence narratives move verbatim (not deleted) to `docs/GUIDELINES_HISTORY.md`. → Task 21.

**F3 (P1) — The regex-parser architectural ceiling.**
Ten documented recurrences of one bug class — deriving a code construct's boundary from hand-rolled brace/paren counting over masked text — across `errorHandling.js` (272 lines), `performance.js`, `parseExpressRoutes.js`, `collectBoundedBlock.js`, `maskStringLiterals.js` (165 lines). Each fix was correct; the class keeps recurring because the approach re-implements a JS lexer by hand. The structural fix is AST parsing (e.g. `acorn` — plain JS, zero deps, permissive license). Honest constraint: diff hunks are fragments and don't parse standalone, so the design is *resolve the post-image file via `git show <sha>:<path>`, parse it, and map changed line numbers onto AST nodes*, keeping the existing regex path as fallback when file content isn't resolvable (e.g. stdin-fed diffs). All existing rule fixtures become the acceptance suite. → Task 23 (spike, not big-bang); task 26 is the cheap short-term dedup if 23 lands later.

**F4 (P1) — Invariant 1 is not mechanically checkable, and there is no CI.**
"Every commit must pass `npm test`" — but the repo root has no `package.json`, so `npm test` at the root fails; each run re-interprets the invariant as "run both packages' suites" (they consistently did, but only by convention). No GitHub Actions workflow exists, so nothing verifies green on push, and a bad push would only be noticed by the next Routine run. → Task 20: root `package.json` running both suites, CI on Node 20 + 22, `engines` fields (CLAUDE.md says Node 20; everything actually runs on 22 — F12).

**F5 (P2) — No path from `claude/dev` to `main`.**
`main` has 3 commits; `claude/dev` has 56. Nothing defines when work merges. Recommendation for Vijay (not a Routine task): open a PR `claude/dev` → `main` once task 20 (CI) is green, then keep `main` fast-forwarded periodically. Not acted on in this audit per instructions.

**F6 (P2) — Routine configuration drift (recommendation only; config lives outside the repo).**
With an empty backlog the Builder and Reviewer prompts converge on identical behavior (both end up hunting). Combined cadence is 24 runs/day. Recommendation: keep Builder 2-hourly while tasks 20–28 drain; drop Reviewer to ~4-hourly; revisit both once the backlog empties again. Also note both Routine prompts say "push to claude/dev" while platform sessions get per-session designated branches — the pushes have landed on `claude/dev` correctly so far, but if a future run reports a branch-permission conflict, this is where to look.

### Product decisions that were stuck (now decided)

**F7 (P2) — `GET /api/users/:id` cross-user read.**
Any authenticated user can fetch any other user's name + email (`sample-app/src/controllers/usersController.js` `getById`) — the oldest open question in PROGRESS.md, restated ~15 runs. **Decision (Vijay, 2026-07-20): restrict to self; 403 otherwise**, matching `update`/`remove`'s existing pattern. → Task 24. Remove this from the standing open-questions list once done.

**F8 (P2) — Doc-drift silently skips template-literal route paths.**
Confirmed-but-unfixed since retro round 1 because the correct failure mode was undecided. Decision: don't guess the path — emit an explicit `unparsed-route` warning finding so drift reports say "this route exists but couldn't be checked" instead of silently claiming full coverage. → Task 25.

### Code & repo cleanups

**F9 (P3) — Duplicated statement-walk logic.** `findHandlerBraceStart` and `collectStatement` (both in `errorHandling.js`) implement near-identical "walk lines, mask, track depth, check-then-scan" loops; run 6 already flagged the duplication after fixing a divergence between them (scan-vs-check ordering). → Task 26 (superseded if task 23's AST path replaces both).

**F10 (P3) — Plugin skills are hand-maintained byte copies.** `plugin/skills/*` must stay byte-identical to `.claude/skills/*`; tests guard it, but every skill edit needs a manual second copy. → Task 27: `npm run sync-plugin` script; keep the parity tests as the guard.

**F11 (P3) — PROGRESS.md ordering is inconsistent.** Early entries are newest-first from the top; later entries are appended chronologically at the bottom (the 07-18 task-11 entry sits between 07-17 blocks at lines ~800). History must not be rewritten (invariant 2), so: document the convention — **append new entries at the bottom** — via a one-line header note. Done in this audit's own entry; no separate task.

**F12 (P3) — Node version drift.** CLAUDE.md pins Node 20; the execution environment runs Node 22 and all green counts were produced there. Folded into task 20 (`engines: ">=20"`, CI matrix 20 + 22).

**F13 (P3) — No dogfooding.** The reviewer has never been run continuously against this repo's own diffs — the richest available source of real-world input for its rules. → Task 28: non-blocking CI step running the reviewer CLI on each push's diff, report uploaded as an artifact.

### Explicitly reviewed, no action needed

- `postReviewComment.js`: HMAC marker + first-match-wins + URL-encoding + pagination cap — sound against the documented threat model.
- `security.js`'s intentional over-flagging of secrets in comments/strings: documented tradeoff, kept.
- `collectPullRequests` pagination cap and the first-match two-genuine-comments race: no observed trigger; correctly left as documented deferrals.
- Deep re-hunt of `errorHandling.js` edge cases: deliberately **not** attempted here — 11 adversarial runs have mined it; the marginal find there is worth less than any item above (that judgment is itself finding F1/F3).

## Finding → task map

| Finding | Action | Where |
|---|---|---|
| F1 backlog exhaustion | refill + formalize empty-backlog rule | tasks 20–28, 22 |
| F2 CLAUDE.md bloat | consolidate guidelines | task 21 |
| F3 regex ceiling | AST spike | task 23 (26 short-term) |
| F4 no CI / broken invariant harness | root harness + CI | task 20 |
| F5 no merge path | PR `claude/dev`→`main` after task 20 | Vijay (manual) |
| F6 routine cadence/prompts | recommendation recorded above | Vijay (manual) |
| F7 users/:id | restrict to self | task 24 |
| F8 template-literal routes | `unparsed-route` finding | task 25 |
| F9 duplicated walkers | consolidate | task 26 |
| F10 plugin byte-copies | sync script | task 27 |
| F11 PROGRESS ordering | convention documented | done in this audit |
| F12 node drift | engines + CI matrix | task 20 |
| F13 no dogfooding | reviewer-on-own-diff CI step | task 28 |

Routines: work tasks 20–28 top-to-bottom per the standard TASKS.md rules. Task descriptions in TASKS.md are the source of truth for scope; this file is the evidence and rationale.
