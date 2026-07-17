Plain JavaScript, Node 20, Jest. Branch: claude/dev only.

HARD INVARIANTS — never edit or weaken these three lines:
1. Every commit must pass `npm test`. If you cannot get green this run, revert and mark task BLOCKED.
2. Never delete backlog tasks or PROGRESS/CHANGELOG history.
3. Every self-modification (skills, CLAUDE.md, backlog order) gets a SKILL_CHANGELOG.md entry: date, change, evidence from PROGRESS.md justifying it.

You MAY improve: .claude/skills/*, this file below the invariants, TASKS.md ordering, review-rules.yaml.
Improvements must cite an observed failure or gap — no speculative rewrites. Skills stay under 150 lines each.
Each run: append dated PROGRESS.md entry (done, decisions, open questions for Vijay).

Async Express route handlers must never let a rejected promise reach the client unhandled — wrap with an async-error handler (e.g. `src/middleware/asyncHandler.js`) and route errors to a catch-all error middleware. Every handler's test suite must include at least one rejected-promise case, not only resolved-happy-path mocks. (Evidence: PROGRESS.md 2026-07-17 adversarial-hunt run — `usersController`/`tasksController` had no error handling; a rejected model call hung the request indefinitely, undetected by 25 happy-path-only tests.)

Diff-scanning static-analysis rules (in `reviewer/src/rules/*` and, later, `review-rules.yaml`) must scope pattern checks to the local block/occurrence being evaluated, never aggregate a single boolean across a whole file diff OR across multiple files in the same diff — one compliant instance (a try/catch, a `.catch()`, a matching test file) must not silence findings for a different non-compliant instance, whether in the same file or a different file changed in the same diff. Every such rule's test suite must include a multi-occurrence case (2+ handlers/chains in one file, or 2+ source files in one diff, mixed compliant/non-compliant) — a single-occurrence test cannot catch this class of false negative. (Evidence: PROGRESS.md 2026-07-17 reviewer-hunt run — `errorHandling.js` computed `hasTry`/`hasAsyncWrapper`/`hasCatch` once per file diff, silencing sibling handlers in the same file, undetected by single-handler-per-file tests. Recurred at cross-file scope in the 2026-07-17 "adversarial bug-hunt run, post-task-3" entry: `missingTests.js` computed `testFiles.length > 0` once for the whole diff, so a test file changed for one source file silenced the missing-tests finding for a completely different, untested source file in the same diff — undetected because no existing test put more than one source file in a diff. The original wording ("across a whole file diff") didn't explicitly cover this cross-file case, which is why it shipped a second time; this line was broadened in response.)
