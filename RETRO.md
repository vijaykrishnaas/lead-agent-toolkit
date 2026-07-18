# Retro — self-audit of tasks 1–12 (2026-07-18)

Source: every PROGRESS.md entry (12 task-completion entries + 10 adversarial
bug-hunt entries, 2026-07-17 through 2026-07-18) and every SKILL_CHANGELOG.md
entry, read in full for this run. This is task 13.

## What failed

**1. The single biggest recurring bug class shipped four separate times, in
four different disguises, despite being documented after the first
occurrence.** "Scope a check to its local block/occurrence, never aggregate a
boolean or regex match across a whole file/diff" was first codified
2026-07-17 (`errorHandling.js`'s file-wide `hasTry`/`hasCatch` booleans). It
then recurred as: (2) `missingTests.js`'s cross-file boolean (post-task-3),
(3) `performance.js`'s `AWAIT_IN_FOREACH` regex tested against a joined
multi-line string instead of a per-occurrence block (post-task-7 — notably, a
*prior* audit had explicitly reviewed this exact file for this exact bug
class and wrongly cleared it), and (4) `errorHandling.js`'s `.then()`/
`.catch()` check, which *did* extract a per-occurrence block but bounded it
with an arbitrary fixed 3-line window instead of real statement structure
(post-task-12). Each recurrence broadened the CLAUDE.md guideline's wording
after the fact, but the guideline is prose a rule author has to remember to
apply correctly in a new shape — it did not stop a fourth shape from
shipping. This is a structural gap, not a vigilance gap: `errorHandling.js`
and `performance.js` independently reinvented near-identical brace/paren-depth
block-extraction logic to fix their own instances, and the post-task-12
PROGRESS.md entry explicitly flagged the obvious fix (extract one shared
`collectBoundedBlock` helper so future rules get correct scoping by
construction) but left it undone, pending "an observed failure" — a bar this
bug class had already cleared four times over.

**2. Security/correctness fixes did not get propagated to sibling modules
with the same shape, and were only found when each sibling's own turn for an
adversarial hunt came up.** `postReviewComment.js`'s unencoded
`owner`/`repo`/`prNumber` → URL bug (post-task-9) was fixed and codified as a
CLAUDE.md guideline the same day, but `collectPullRequests.js` — a module
that already existed at that point with the identical unencoded-interpolation
shape — wasn't checked against the new guideline until task 10 happened to
touch it for an unrelated reason one run later. Nothing in the "add a
guideline" step included "grep the rest of the tree for the same shape right
now."

**3. Weak-test gaps were consistently the reason a real bug shipped, and the
fix pattern was reactive (a test happens to omit the exact combination that
breaks) rather than a checklist applied up front.** Concrete instances:
`formatStandupReport(new Map())` tested with no `meta` at all, missing the
`meta.since`-present-and-empty combination that produced the contradictory
"since 2020 / last 24h" output (post-task-11); the first draft of the
timezone-sort regression test used offsets that didn't straddle a day
boundary and passed against the buggy code by coincidence (post-task-6); and
`.claude/skills/doc-drift/SKILL.md` shipped in task 12 with zero automated
frontmatter coverage — the exact "invalid/silently-dropped YAML frontmatter"
bug class already fixed twice for the other two skills — and was only closed
a full run later (post-task-12), even though task 12's own PROGRESS.md entry
had already named the gap explicitly.

**4. Genuinely-flagged gaps sit open for many runs because nothing ever
"fails" in an offline, agent-only repo.** The "cite an observed failure, no
speculative rewrites" bar is working as intended for CLAUDE.md/skill
self-modification (it has kept the guideline additions tightly evidence-bound
rather than speculative), but the same bar is being applied by convention to
ordinary follow-up work items, and this repo has no external users or CI to
ever generate a failure signal for those. Concretely still open, unresolved
across many runs each: PR-comment "update in place instead of growing a
thread" (raised task 5, restated task 9, never touched); `collectPullRequests`
pagination past 50 (raised task 6, restated three more times); commit-
message/PR-title markdown escaping before reaching a real sink (raised
task 8, still open even though task 10 shipped the first real sink);
owner/repo inference from `git remote get-url origin` vs. always-explicit
flags (raised task 6, restated tasks 9 and 10, still undecided). These
aren't bugs, so the "cite a failure" bar can't apply the same way to them —
they're scoping decisions nobody has forced a resolution on.

**5. Plugin packaging (task 11) has silently drifted out of sync with the
skill set it's supposed to package.** `plugin/skills/` still only contains
`review-pr` and `standup`; `doc-drift` (task 12) was never added, even though
the flow this repo actually promises Vijay is "install the plugin, get the
skills." `reviewer/tests/plugin.test.js`'s guard (byte-identical copies) only
protects against the two skills it already knows about drifting from their
`.claude/skills/` originals — it has no way to notice a *third* skill exists
and isn't packaged at all, unlike the more general
`skillsFrontmatter.test.js` fix from post-task-12, which does enumerate
`.claude/skills/*` generically.

## What to improve

- Prefer fixing structural causes over broadening prose guidelines when the
  same underlying bug class recurs a second time in a new shape (item 1
  above) — a shared, correctly-implemented helper is harder to misuse than a
  CLAUDE.md paragraph, however well-worded.
- When a bug-class fix lands in one module, grep the rest of the tree for the
  same shape in the same run, rather than waiting for that sibling module's
  own future adversarial-hunt turn (item 2).
- When a task ships a new instance of a component type that already has
  automated coverage elsewhere (a third skill, a third CLI parser, a third
  rule file), check in the same run whether the existing coverage is
  hardcoded to a fixed list or genuinely generic, and close the gap
  immediately rather than logging it as an open question for a future run
  (items 3 and 5).
- Distinguish "no observed failure, so don't touch it" (correctly conservative
  for CLAUDE.md/skill content, per hard invariant 3) from "this is a
  known, scoped, cheap follow-up nobody has decided against" (item 4) —
  the latter is exactly what a backlog is for, so route it through TASKS.md
  instead of letting it re-accumulate as an unresolved "open question" every
  single run.

## Proposed new backlog tasks

**14. Package `doc-drift` into `plugin/` for parity with `review-pr` and
`standup`.** Evidence: post-task-12 PROGRESS.md entry explicitly raised this
as unresolved; confirmed directly this run — `plugin/skills/` still only has
two of the three shipped skills. Should also extend `plugin.test.js`'s
byte-identical-copy guard to be enumerated from `.claude/skills/*` (matching
how `skillsFrontmatter.test.js` already avoids a hardcoded list), so a future
fourth skill can't repeat this gap.

**15. Extract a shared `collectBoundedBlock`-style helper into
`reviewer/src/utils/` and refactor `errorHandling.js` and `performance.js` to
use it for per-occurrence block-boundary scoping.** Evidence: the same
"aggregate instead of scoping to one occurrence" bug class shipped four times
in four shapes (2026-07-17 reviewer adversarial-hunt run; post-task-3;
post-task-7; post-task-12 — see SKILL_CHANGELOG.md for all four), and the
post-task-12 PROGRESS.md entry explicitly named this exact refactor as the
structural fix but deferred it pending "an observed failure" that had, by
that point, already occurred four times over. Any new diff-scanning rule
added after this task should get correct per-occurrence scoping by
construction instead of re-deriving its own boundary heuristic.

**16. Make `review-pr`'s PR-comment posting update an existing bot comment in
place instead of always creating a new one.** Evidence: raised as an open
question in the task-5 PROGRESS.md entry ("is one comment per review run the
intended behavior, or should a later task look for an existing bot comment
and update it in place"), restated verbatim in the task-9 entry, and never
resolved across all subsequent runs — now a concrete usability problem, not a
hypothetical one, since task 9's own `review-pr` skill is explicitly designed
to be invoked repeatedly against the same PR (e.g. on every push), which
means the current behavior produces a growing, increasingly noisy comment
thread on any PR it's run against more than once.

## Not proposed as tasks (explicitly deferred, no strong evidence yet)

`collectPullRequests` pagination past 50 PRs and commit-message/PR-title
markdown escaping (both raised repeatedly, item 4 above) are real but lower-
evidence: no run has yet observed a repo active enough to exceed 50 PRs in a
report window, and no run has yet built a sink where standup output reaches a
rendered/trusted surface where escaping would matter. Flagging here instead
of adding as tasks 17/18 so they aren't spuriously reordered ahead of the
three above without a concrete trigger.
