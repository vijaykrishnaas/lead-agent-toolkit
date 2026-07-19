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

# Retro round 2 — self-audit of tasks 13–16 (2026-07-19)

Source: every PROGRESS.md entry since round 1 (task 13's own entry, the
post-task-13 adversarial-hunt entry, task 14, the post-task-14 hunt, task 15,
task 16, and the post-task-16 hunt — all 2026-07-18) and every
SKILL_CHANGELOG.md entry added since round 1, read in full. Tasks 14–16 (the
three round-1 proposals) are all `[DONE]`, and TASKS.md has no other
non-DONE/non-BLOCKED item, so this run does what the post-task-16 PROGRESS.md
entry's own open question anticipated ("should the next run do another
RETRO.md-style self-audit?") rather than leaving the backlog empty.

## What failed since round 1

**1. Round 1's item 1 (the four-times-recurring aggregation-scope bug class)
is now closed structurally, as intended.** Task 15 extracted
`collectBoundedBlock` and repointed `errorHandling.js`/`performance.js` at it
with zero behavior change (all pre-existing regression tests, including every
historical recurrence, still pass unmodified). No new instance of this exact
shape shipped in tasks 14–16 or either hunt since. Round 1's prescription
("prefer a structural fix over a fifth guideline broadening") worked.

**2. The same over-broad-scope failure mode reappeared once more, but in a
mirror-image shape round 1 didn't anticipate: an *exemption* check scoped too
broadly, not a *positive* check.** The post-task-14 hunt found
`security.js`'s `process.env` exemption matched anywhere on the line instead
of against the specific matched value, letting `const password = "hunter2";
// fallback for process.env.PASSWORD` slip through uncaught. This is a fifth
member of the same underlying "reasoning over too broad a scope" family the
CLAUDE.md guideline already tracks, codified as its own new guideline
paragraph the same run. Only one instance observed so far (unlike the
four-times-recurring positive-check shape before task 15's fix), so per this
repo's own "cite an observed failure" bar there isn't yet evidence to justify
a dedicated structural helper the way `collectBoundedBlock` was for the
positive-check shape — noted here so a second occurrence is recognized
quickly rather than treated as new.

**3. Round 1's item 3 (weak-test gaps letting real bugs ship) recurred once
more, in the same "test mocks only one canned return shape" shape newly
introduced by task 16 itself.** The post-task-16 hunt found
`reviewPrCli.js`'s "Posted review comment to ..." message stayed hardcoded
even after task 16 added real create-vs-update behavior, because
`postReviewComment`'s return value never surfaced which action it took and
`reviewPrCli.test.js` mocked it with one fixed shape (`{ id: 1 }`) in every
test. This is a new sub-shape (message-describes-which-action, not
message-describes-a-dynamic-value like round 1's `since`-window bug) but the
same underlying pattern: a test suite exercising only the common/expected
shape of a collaborator's output misses the specific combination that
breaks. Codified as its own CLAUDE.md guideline the same run. Two
now-distinct instances of "narrow-mock hides a real gap" across rounds 1 and
2 — worth watching for a third before considering anything more structural
than the guideline (e.g. a lint rule flagging single-shape mocks), since a
generic fix here is much harder to state precisely than
`collectBoundedBlock` was.

**4. Round 1's item 4 (genuinely-flagged gaps sitting open for many runs
because nothing ever "fails" in an offline repo) recurred for a specific,
now-three-times-raised item: `sample-app`'s `JWT_SECRET || 'dev-secret'`
fallback.** Raised in the post-task-14 hunt entry, restated in the task-16
entry ("open questions carried forward"), and restated again in the
post-task-16 entry — three separate PROGRESS.md entries, no resolution,
still present in both `authController.js` and `middleware/auth.js` as of
this run (confirmed directly by re-grepping). This is exactly the
"known, scoped, cheap follow-up nobody has decided against" shape round 1's
own "what to improve" section prescribed routing into TASKS.md rather than
re-logging indefinitely — so this round finally does that instead of
restating it as an open question a fourth time.

**5. Round 1's item 5 (plugin packaging silently drifting out of sync with
the skill set) is closed, and closed generically rather than just for the
one instance.** Task 14 packaged `doc-drift` into `plugin/` and rewrote
`plugin.test.js`'s guard to enumerate `.claude/skills/*` at test-run time
instead of a hardcoded two-skill list, so a future fourth skill can't repeat
this exact gap. Confirmed by inspection this run: `plugin/skills/` now
contains all three (`doc-drift`, `review-pr`, `standup`), and
`marketplace.json`'s description mentions all three.

**6. A new pattern this round: real doc/prose drift inside this repo's own
README and plugin manifests was found three separate times in a single hunt
(post-task-14), and every one of them was found by manual inspection, not by
any automated check — despite this repo's entire `doc-drift` module existing
specifically to catch code-vs-docs drift for its *users*.** The three
instances (README's reviewer quickstart hardcoding a stale Jest test count
that was guaranteed to keep drifting; README's standup section describing a
feature as "not yet wired to a CLI" four commits after it shipped;
`marketplace.json`'s top-level description omitting `doc-drift` after task
14 added the other two descriptions but missed this one) were all fixed the
same run they were found, so there's no live bug today — but nothing added
since prevents a fourth instance from shipping and sitting undetected for a
full run cycle again, the same "found only by inspection, not test" gap
round 1's item 3 flagged for narrower cases.

## What to improve

- Continue preferring a structural fix (like `collectBoundedBlock`) over a
  guideline once a bug-class shape recurs a *second* time, not waiting for a
  fourth recurrence the way the original aggregation class did before task
  15 — apply this to the exemption-scope shape (item 2) and the
  narrow-mock-testing shape (item 3) above if either recurs once more.
- When a "no observed failure" open question gets restated for a *third*
  distinct PROGRESS.md entry with no new information (item 4), stop
  re-logging it as an open question and promote it to TASKS.md the way this
  round does for the `JWT_SECRET` fallback — round 1 named this
  improvement but this round is the first to actually apply it.
- Doc/prose drift inside this repo's own README and plugin manifests (item
  6) has now cost one full hunt run's worth of manual-inspection effort to
  catch three instances; a proposed task below closes this the same way
  `skillsFrontmatter.test.js` (post-task-12) closed the analogous "no test
  scans every `SKILL.md`" gap — enumerate the generic, checkable claims
  (skill names, package test counts) automatically instead of trusting prose
  to stay accurate by hand.

## Proposed new backlog tasks

**17. Harden `sample-app`'s `JWT_SECRET || 'dev-secret'` fallback for
production use** — e.g. throw at startup (or on first token
sign/verify) when `NODE_ENV === 'production'` and `JWT_SECRET` is unset or
still equals the `.env.example` placeholder, in both `authController.js` and
`middleware/auth.js`. Evidence: raised as an open question in the
post-task-14 PROGRESS.md entry, restated in the task-16 entry, and restated
again in the post-task-16 entry — three separate, unresolved mentions with no
new information added between them, which is precisely the "known, scoped,
cheap follow-up" pattern this retro's own item 4 (and round 1's item 4)
flags as something that belongs in TASKS.md rather than being re-logged as
an open question indefinitely. `.env.example` already documents
`JWT_SECRET=change-me` as something operators are expected to set, so a
startup-time check enforcing that in production is a small, well-scoped
change with an obvious correct behavior (unlike, e.g., the still-deferred
template-literal-route-path question, which has no agreed-on correct
behavior yet).

**18. Add automated regression coverage against doc/prose drift inside this
repo's own README.md and `plugin/.claude-plugin/*.json` manifests** — e.g. a
test asserting `plugin/.claude-plugin/marketplace.json` and `plugin.json`'s
descriptions mention every skill directory actually present under
`plugin/skills/` (mirroring how `plugin.test.js`'s byte-identical-copy check
and `skillsFrontmatter.test.js` already enumerate `.claude/skills/*`
generically instead of a hardcoded list), and/or a check that README.md
doesn't hardcode a specific Jest test count that's guaranteed to go stale.
Evidence: the post-task-14 hunt found three separate instances of exactly
this drift shape in one run — a hardcoded, already-stale test count in
README, prose describing a shipped feature as not-yet-built, and
`marketplace.json`'s description missing a skill task 14 had just added
elsewhere — all found by manual inspection only, none caught by any test.
This repo's own product is a doc-drift detector; closing this gap for its
own docs is the same "fix the class, not the instance" approach task 14
already applied to plugin skill-copy parity.

## Not proposed as tasks (explicitly deferred, no strong evidence yet)

- **`findExistingBotComment`'s comment-authorship trust boundary**
  (task 16's marker-prefix matching has no author-identity check, so any PR
  commenter could in principle author a marker-prefixed comment). Raised
  once, in the post-task-16 hunt entry, with a reasoned decision already
  attached (the only available fix breaks the common `GITHUB_TOKEN`
  GitHub-Actions credential shape, and the exploitable impact is
  self-limited to griefing the spoofer's own comment). One mention, not a
  repeated pattern — leaving as an open question rather than promoting it.
- **Template-literal Express route paths in `docDrift`** (confirmed-but-
  unfixed in the post-task-13 hunt entry, no design decision made on the
  correct failure mode). Only one mention since round 1, and — unlike the
  `JWT_SECRET` item above — has no agreed-on correct behavior yet, so
  promoting it now would mean deciding a design question inside a backlog
  task description rather than the task doing well-scoped implementation
  work.
- **`collectPullRequests`' pagination cap and standup markdown-escaping**,
  carried forward again from round 1's own deferred list — still no run has
  observed either triggering condition (a >1000-PR window post-task-13's own
  pagination fix, or a real rendered sink for standup output).
