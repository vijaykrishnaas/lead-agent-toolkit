# Progress Log

## 2026-07-18 (task 5: GitHub integration — post review as PR comment)

**Done:** Task 5 — added `reviewer/src/github/postReviewComment.js`:
- `postReviewComment({ token, owner, repo, prNumber, body }, deps)` — POSTs `body` (the markdown report from task 4) to `POST /repos/{owner}/{repo}/issues/{prNumber}/comments` on the GitHub REST API, with a `Bearer` auth header. `deps.request` defaults to the global `fetch` (Node 20+, no new dependency needed) but is fully injectable so tests never make a real network call. Throws a clear error (without calling `request`) when `token`, `owner`/`repo`, or `prNumber` is missing, and throws with the response status + body text on a non-2xx GitHub response.
- `tokenFromEnv(env = process.env)` — reads `GITHUB_TOKEN` from the environment (injectable `env` for tests), matching the task's "token via env" requirement without hardcoding secrets anywhere in the module.
- Re-exported both from `reviewer/src/index.js` alongside the other public API (`reviewDiff`, `loadRules`, `formatMarkdownReport`).
- 7 new tests in `tests/github/postReviewComment.test.js` (happy path asserts the exact URL/method/headers/body; missing-token, missing-owner/repo, and missing-prNumber cases all assert `request` is never called; a non-ok response case asserts the thrown error includes status + body text; two `tokenFromEnv` cases). Suite is now 69/69 green in `reviewer/`; `sample-app/` still 29/29 green (untouched).

**Decisions:**
- Did not wire this into `reviewer/src/cli.js`. `runCli` is currently fully synchronous (returns a plain exit code, and all 15 existing CLI tests assert on that synchronous return value); posting to GitHub is inherently async, so wiring it in would mean either making `runCli` return a `Promise` everywhere (touching every existing CLI test and the `require.main` entrypoint) or bolting on a parallel async code path — both are bigger, riskier changes than what task 5 actually asks for, and nothing in the task description or backlog says the CLI itself needs a `--post-pr` flag. Kept `postReviewComment` as a standalone, directly-importable module instead, matching how `reviewer/src/index.js` already re-exports each task's public API piece by piece. Backlog task 9 (`.claude/skills/review-pr/SKILL.md`, "runs the reviewer on a PR and posts results") is the natural place to compose the CLI's diff/report generation with this module's PR-commenting — revisit CLI wiring there only if that task's shape actually needs it.
- Used the global `fetch` (stable in Node 20+, confirmed available in this environment) instead of adding an HTTP client dependency (e.g. `node-fetch`, `axios`) or hand-rolling an `https` request — no observed need for anything beyond a single injectable POST call, and it keeps `reviewer/`'s dependency list unchanged (`js-yaml` is still the only runtime dependency).
- Auth header is `Bearer <token>` (current GitHub REST API guidance) rather than the older `token <token>` scheme — both are accepted by GitHub today, but `Bearer` is the documented current form and there's no existing convention in this repo to match instead.
- Kept validation minimal and specific (three distinct missing-field error messages) rather than a generic schema validator — matches this repo's existing style in `cli.js`'s `parseArgs` (hand-written checks with specific error messages) over introducing a validation library for three required fields.

**Open questions for Vijay:**
- Should posting fail loudly (current behavior: reject/throw) or should there be a "dry run" / `--no-post` type escape hatch once this is wired into a CI-triggered flow (task 9's skill), so a reviewer run can still produce a report even if the GitHub API call fails or `GITHUB_TOKEN` isn't set in that environment?
- Is one comment per review run the intended behavior, or should a later task look for an existing bot comment on the PR and update it in place (avoiding a growing thread of comments on every push)? No existing behavior to preserve either way since this is the first GitHub-API-writing code in the repo — flagging before task 9 builds on top of it.

## 2026-07-17 (task 4: CLI)

**Done:** Task 4 — added `reviewer/src/cli.js`, a `npm run review -- <base>..<head>` CLI that shells out to `git diff <range>`, runs it through `loadRules()` (the repo-root `review-rules.yaml`) and `reviewDiff`, and renders the result as a markdown report:
- `reviewer/src/format/markdownReport.js`: `formatMarkdownReport({risk, issues}, {range})` — groups issues by category (alphabetical), sorts within a category by severity then file/line, and prints a `# Code Review Report` header with range/risk/count. Re-exported from `reviewer/src/index.js`.
- `reviewer/src/cli.js`: `parseArgs(argv)` parses the positional `<base>..<head>` range plus `--repo`, `--config`, `--out` flags; `runCli(argv, deps)` is the testable entry point (all IO — `execGit`, `loadRules`, `writeFile`, `stdout`/`stderr` — is dependency-injected so tests never shell out to real git or touch the filesystem) and returns a process exit code instead of calling `process.exit` itself. `require.main === module` wires it to `process.exitCode` for the real bin. Added `"review": "node src/cli.js"` to `reviewer/package.json`.
- 22 new tests: `tests/format/markdownReport.test.js` (grouping/sorting/no-issues/no-range cases) and `tests/cli.test.js` (`parseArgs` validation, happy path via injected `execGit` returning existing fixtures, `--out` file-write path, invalid-range and git-failure and malformed-config error paths all returning exit code 1 without side effects, `--config` passthrough). Suite is now 62/62 green in `reviewer/`.
- **Verified against sample-app history** (the task's explicit ask): ran the real CLI (`node reviewer/src/cli.js 8bdc160..1728088 --repo .`) against the actual `sample-app` commit range from the first adversarial-hunt run (`8bdc160` scaffold -> `1728088` asyncHandler/JWT-alg fix). Produced a correct 6-issue `missing-tests` report for every `sample-app/src/**` file touched in that commit (app.js, authController.js, asyncHandler.js, auth.js, tasks.routes.js, users.routes.js) — expected, since that commit's actual test additions live in `tests/{tasks,users}.test.js` (matching the *controller* files' behavior, not these files' basenames), so the existing basename-matching `missing-tests` rule correctly has no test file to match against for these specific paths. Also manually verified the CLI's error paths against real `git`: an unparseable range (`bogus`) and a nonexistent ref (`nonexistent..head`) both exit 1 with a clear stderr message and no report emitted; `--out <file>` correctly writes the report to disk instead of stdout.

**Decisions:**
- Kept `runCli` fully dependency-injected (`execGit`/`loadRules`/`reviewDiff`/`writeFile`/`stdout`/`stderr` all overridable) rather than mocking `child_process`/`fs` at the module level in tests — matches this repo's existing style of testing pure functions over real fixtures (see `reviewer.test.js`), and avoids `jest.mock`-ing Node builtins for a script whose whole job is orchestrating side effects.
- `--config` defaults to `DEFAULT_CONFIG_PATH` (repo-root `review-rules.yaml`) rather than requiring the flag, resolving the open question from the task 3 entry below in favor of "always resolve from repo root unless overridden" — matches how `loadRules()` already behaves with no argument, and a CLI invoked via `npm run review` from `reviewer/` needs a working default regardless of invocation directory.
- Did not extend this task to also open a PR-comment integration (that's backlog task 5) or to expand `README.md` (backlog task 8) — kept scope to exactly what task 4 asks for.

**Open questions for Vijay:**
- Confirmed via this run's verification: the `missing-tests` rule's basename-matching contract (open question from the "adversarial bug-hunt run, post-task-3" entry below) means a diff that adds tests under a differently-named test file (e.g. `tests/users.test.js` covering `src/controllers/usersController.js`) still gets flagged. Now that the CLI surfaces this concretely, is 1:1 basename matching still the intended contract, or should task 5/6 add a controller-to-test mapping (e.g. via `review-rules.yaml` options)?
- Should the CLI support the `base...head` (three-dot, merge-base-relative) form in addition to `base..head`, or is two-dot sufficient for how this will actually be invoked (e.g. from a PR-comment integration in task 5, which will likely already resolve the merge base itself)?

## 2026-07-17 (adversarial bug-hunt run, post-task-3)

**Done:** Fetched all branches, checked out `claude/dev`, ran `npm test` in both `sample-app/` (29/29 green) and `reviewer/` (46/46 green), then hunted adversarially for bugs/weak tests/security holes on the two commits since the last hunt (`97a4882` errorHandling fix, `ad9b7de` task 3 config+loader) — `sample-app/` was untouched since the prior hunt and showed nothing new on re-inspection.

- **Real bug found and fixed — `missingTests` rule aggregated "has a test" across the whole diff instead of per source file:** `reviewer/src/rules/missingTests.js` computed `testFiles.length > 0` once for the entire diff and used that single boolean to suppress *every* source file's missing-tests finding. Reproduced directly: a diff changing `src/utils/round.js` (no test) and `src/utils/slugify.js` alongside `tests/slugify.test.js` (its own test) produced **zero** issues — `round.js`'s missing coverage was silently hidden because *some* test file happened to be present elsewhere in the same diff. This is the exact same class of bug already codified in CLAUDE.md's error-handling-rule guideline below (one compliant instance silencing findings for an unrelated non-compliant instance) but at cross-file scope instead of within-file scope, and it shipped in task 2 (2026-07-17 "task 2: reviewer core") undetected because none of the pre-existing tests put more than one source file in a single diff.
  - Fix: `check()` now matches each source file against changed test files by basename convention (`round.js` <-> `round.test.js`) instead of a diff-wide flag; a source file is only suppressed if *its own* matching test changed, not merely *some* test file anywhere in the diff.
  - Added a fixture (`missing-tests-mixed-files.diff`) and 1 regression test reproducing the false negative. Suite is now 47/47 green in `reviewer/`.
- **Reviewed, left as-is:** `security.js`, `performance.js`, `style.js` all iterate and emit issues per-line/per-file already (no file-wide aggregate booleans) — checked each against the same false-negative shape (multiple lines/files, mixed compliant/non-compliant) and found no analogous bug. `diffParser.js`'s `/dev/null` labeling for deleted files (flagged in the prior hunt entry) remains cosmetic-only and unchanged — still no observed failure. `loadRuleConfig.js`'s YAML malformed-file handling (throws on any non-ENOENT error) and `buildRules.js`'s severity filtering were re-checked and are correct; `js-yaml@4`'s `load()` uses the safe schema by default, so no arbitrary-code-execution risk from a malicious `review-rules.yaml`.

**Decisions:**
- Matched source-to-test files by basename (stripping `.js`/`.test.js`) rather than requiring an exact directory mirror (e.g. `src/foo.js` <-> `tests/foo.test.js` specifically), since the existing fixtures and `missing-tests` rule already tolerate test files living directly under `tests/` regardless of the source file's subdirectory depth — an exact-path convention would have been a stricter rule than the one already in place and risked new false positives without an observed failure motivating it.
- Did not extend the same per-file matching to a "does the test actually cover the changed lines" check (already an open question from task 2) — out of scope for this bug fix; the fix only closes the cross-file aggregation false negative, not the coarser diff-local-vs-coverage-aware heuristic question.

**Open questions for Vijay:**
- Now that `missing-tests` matches by basename convention, should non-conventionally-named test files (e.g. a single `tests/controllers.test.js` covering multiple controller source files) be supported via config, or is 1:1 basename matching the intended contract going forward?

## 2026-07-17 (task 3: review-rules.yaml + loader)

**Done:** Task 3 — added `review-rules.yaml` (repo root) with MERN defaults, and a loader in `reviewer/src/config/`:
- `review-rules.yaml`: per-category config (`security`, `error-handling`, `missing-tests`, `performance`, `style`) with `enabled`, `minSeverity`, and rule-specific `options`. `missing-tests.options.sourceDirs` defaults to `[src, lib, client/src, server/src, sample-app/src, reviewer/src]` — this directly closes the gap flagged as an open question in the 2026-07-17 "reviewer adversarial-hunt run" entry below (the old hardcoded `^(src|lib)/` pattern never matched nested packages like `sample-app/src/...`).
- `reviewer/src/config/loadRuleConfig.js`: reads + normalizes the YAML (`js-yaml` added as a dependency). Missing file -> empty config (all rules run with defaults, matching `reviewDiff`'s no-config behavior); malformed file (any non-ENOENT read error) still throws; invalid `minSeverity` values fall back to `'low'`.
- `reviewer/src/config/buildRules.js`: applies a normalized config over a base rule set — drops disabled categories, filters issues below `minSeverity`, forwards `options` as each rule's second `check(files, options)` argument.
- `reviewer/src/config/loadRules.js`: composes the two into `loadRules(configPath?, baseRules?)`, returning a rules array usable directly by `reviewDiff`. Re-exported from `reviewer/src/index.js` alongside the existing `reviewDiff`/`parseDiff`/`defaultRules`.
- `reviewer/src/rules/missingTests.js`: extended `check(files, options)` to accept `options.sourceDirs` (falls back to the original `['src', 'lib']` default when omitted or empty), so the rule itself stays config-driven instead of the loader needing to monkey-patch it.
- 15 new tests: `tests/config/{loadRuleConfig,buildRules,loadRules}.test.js` plus 4 new cases in `tests/rules/missingTests.test.js` (default-pattern-unchanged, widened-via-options, empty-options-falls-back, one new fixture `tests/fixtures/config/custom-rules.yaml`). One `loadRules` integration test asserts the actual repo-root `review-rules.yaml` reproduces the pre-task-3 default `reviewDiff` output byte-for-byte on the existing `security-hardcoded-secret.diff` fixture, guarding against the new config accidentally changing behavior for categories that weren't the point of this task. Suite is now 46/46 green in `reviewer/`; `sample-app/` still 29/29 green (untouched).

**Decisions:**
- Placed `review-rules.yaml` at the repo root (not inside `reviewer/`), matching how CLAUDE.md lists it alongside other root-level, agent-tunable files ("You MAY improve: ... TASKS.md ordering, review-rules.yaml") rather than as reviewer-package-internal config.
- Kept per-category config to `enabled` + `minSeverity` + free-form `options`, instead of letting config override individual issue severities — the existing rules emit multiple severities per category (e.g. `error-handling` emits both `high` for a missing try/catch and `medium` for an uncaught `.then()`), so a single per-category severity override would have silently collapsed that distinction. `minSeverity` filtering preserves it while still letting a MERN-tuned config quiet noisy categories.
- Only `missing-tests` gained a real config-consumed option (`sourceDirs`) in this pass — no other rule has an analogous config-shaped need yet (e.g. `security`'s secret-pattern regex isn't backlog-scoped for this task), so no speculative `options` support was added to `security`/`performance`/`style`/`error-handling`.
- Chose `js-yaml@^4` (CommonJS, no ESM-only surprises) over hand-rolling a YAML subset parser; network access to the npm registry was confirmed working before adding the dependency.

**Open questions for Vijay:**
- Should task 4's CLI accept a `--config <path>` flag wired to `loadRules(path)`, or always resolve `review-rules.yaml` from the repo root regardless of where the CLI is invoked from?
- Is `minSeverity`-based filtering the right lever for a MERN-tuned config, or would you rather see per-issue-type (not just per-category) severity overrides once more rules exist — e.g. distinguishing the two `error-handling` sub-checks (missing try/catch vs. uncaught `.then()`) in config?

## 2026-07-17

**Done:** Task 1 — scaffolded `sample-app/`, a minimal Express + Mongoose REST API in plain JS (Node 20):
- Models: `User` (name/email/password), `Task` (title/description/completed/owner).
- Auth: `POST /api/auth/register`, `POST /api/auth/login` — bcrypt password hashing, JWT issuance.
- Users: `GET /api/users/me`, `GET /api/users/:id`, `PUT /api/users/:id`, `DELETE /api/users/:id` (JWT-protected, self-only for write/delete).
- Tasks: full CRUD under `/api/tasks`, scoped to the authenticated owner.
- `GET /health` and a JSON 404 fallback.
- 25 Jest + Supertest tests across `tests/{app,auth,users,tasks}.test.js`, all green (`npm test` inside `sample-app/`).

**Decisions:**
- Tests mock the Mongoose models (`jest.mock('../src/models/User')` / `Task`) instead of hitting a real MongoDB. A live Mongo (or `mongodb-memory-server`, which downloads a binary) isn't reliably available in this sandboxed run, and hard invariant #1 requires every commit to pass `npm test` — mocking the data layer keeps tests deterministic and offline while still exercising the full route → controller → model contract. Production code (`src/config/db.js`, `src/server.js`) still connects to a real Mongo via `MONGO_URI`.
- `sample-app/` is a self-contained package (own `package.json`, own `node_modules`), matching the backlog item's literal scope. No root-level `package.json` was added since no task has asked for one yet.
- Users CRUD is restricted to acting on one's own record (403 otherwise) since there's no roles/admin concept yet in the backlog.

**Open questions for Vijay:**
- Should later tasks (e.g. the reviewer core in task 2) live in their own top-level package, or should the repo grow a root `package.json`/workspaces to run all suites with one `npm test`?
- Do you want an integration-test pass against a real MongoDB (e.g. via `mongodb-memory-server`) added later as a separate, allowed-to-be-slow suite, or is the current mocked-model coverage sufficient for this sample app's purposes?

## 2026-07-17 (adversarial bug-hunt run)

**Done:** Fetched all branches, checked out `claude/dev`, ran `npm install && npm test` in `sample-app/` (25/25 green), then hunted adversarially for bugs/weak tests/security holes.

- **Real bug found and fixed — hanging requests on DB errors:** `usersController.js` and `tasksController.js` had no try/catch and `app.js` had no error-handling middleware. Reproduced it directly: mocking a rejected model call (e.g. `User.findById` rejecting, as a real Mongoose `CastError` would on an invalid ObjectId like `GET /api/users/not-a-valid-id`) caused the HTTP request to hang indefinitely instead of returning any response — a DoS-shaped availability bug. All 25 existing tests only ever mocked *resolved* values, so this shipped to `claude/dev` completely undetected.
  - Fix: added `src/middleware/asyncHandler.js`, wired it into every route in `users.routes.js` and `tasks.routes.js`, and added a catch-all Express error middleware in `app.js` (CastError/ValidationError → 400, everything else → 500).
  - Added 4 regression tests (2 per resource) covering the rejection path. Suite is now 29/29 green.
- **Security hardening — JWT algorithm confusion:** `jwt.sign`/`jwt.verify` didn't pin an algorithm, relying on implicit defaults. Pinned `algorithm: 'HS256'` on sign and `algorithms: ['HS256']` on verify in `authController.js`/`middleware/auth.js` to close the classic alg-confusion class of attack. No behavior change for existing tests (HS256 was already the implicit default), so nothing else needed updating.
- **Reviewed, left as-is:** `GET /api/users/:id` lets any authenticated user look up any other user's name/email by id (no ownership check). This is explicitly covered by an existing test as intended behavior (public-profile-style lookup), so it wasn't treated as a bug without direction from Vijay — see open question below.

**Decisions:**
- Did not touch the `email.toLowerCase()`-on-non-string-input path in `authController.js` — it already fails closed (throws → 500) before any query is built, so it isn't a NoSQL-injection vector despite the missing explicit type check.
- Kept the fix minimal and test-covered rather than introducing a broader validation library (e.g. Joi/Zod) — no observed failure justified that scope yet.

**Open questions for Vijay:**
- Should `GET /api/users/:id` be locked down to self-only, or is cross-user lookup of name/email intentional public-profile behavior? Left unchanged pending your call.
- Given this run found a systemic gap (tests only ever mock happy-path resolves, never rejections), should task 2's reviewer core treat "no rejected-promise test per async handler" as a first-class `missing-tests` finding category?

## 2026-07-17 (task 2: reviewer core)

**Done:** Task 2 — built `reviewer/`, a self-contained package implementing diff -> structured review JSON:
- `src/diffParser.js`: parses unified-diff text (as produced by `git diff`) into `{ file, hunks: [{ header, lines: [{ type: 'add'|'del'|'context', content, newLine, oldLine }] }] }`, tracking old/new line numbers per hunk header.
- `src/rules/{security,errorHandling,missingTests,performance,style}.js`: one rule module per required category, each exporting `{ category, check(files) }`. Heuristics implemented: hardcoded-credential patterns and `eval(` (security); async route handlers with no `try`/`asyncHandler` wrapper and `.then()` without `.catch()` (error-handling); source files changed with no corresponding test file changed in the same diff (missing-tests); `await` inside `.forEach()` and the `JSON.parse(JSON.stringify(...))` deep-clone anti-pattern (performance); `var` declarations and stray `console.log` (style).
- `src/reviewer.js`: `reviewDiff(diffText, rules = defaultRules)` runs all rules over the parsed diff and returns `{ risk, issues: [{ file, line, category, severity, message, fix }] }`. `risk` is `'none'|'low'|'medium'|'high'`, taken as the max issue severity present (or `'none'` if no issues).
- 6 diff fixtures under `tests/fixtures/` (one per category plus a `clean.diff` with no findings), 29 Jest tests across `tests/diffParser.test.js`, `tests/reviewer.test.js`, and one test file per rule — all green (`npm test` inside `reviewer/`).

**Decisions:**
- Resolved the open question above (own top-level package vs. root workspace) by following the same precedent as `sample-app/`: `reviewer/` is a self-contained package with its own `package.json`/`node_modules`, so each package's `npm test` stays independent and green per hard invariant #1. Revisit if a later task (e.g. task 4's CLI) needs to import across packages.
- Rules are intentionally hardcoded regex/heuristic checks for now, not yet driven by config — task 3 (`review-rules.yaml` + loader) is the next backlog item and is expected to supply/override the rule set that `reviewDiff` accepts as its second argument, which is why that parameter already exists and is exercised by a "custom rule set" test.
- `missing-tests` is diff-local (no test file present anywhere in the same diff), not a full-repo check for an existing test file — matches the scope of "diff -> structured review JSON" without needing repo/filesystem access from the reviewer core.
- Both root-level packages (`sample-app/`, `reviewer/`) currently need separate `npm install && npm test` runs; there is still no root `package.json`. Flagging again below since task 4 (CLI) may need to invoke the reviewer as a library from a different entry point.

**Open questions for Vijay:**
- Should `reviewer/` and `sample-app/` be unified under an npm workspaces root once there are 3+ packages, or is the current fully-independent-packages layout fine to keep through the rest of the backlog?
- The `missing-tests` rule only checks whether *any* test file changed alongside a source file in the diff, not whether it actually covers the changed lines. Is that heuristic sufficient for the reviewer's purposes, or should a later task try to map test files to the source files they cover (e.g. by naming convention)?

## 2026-07-17 (reviewer adversarial-hunt run)

**Done:** Fetched all branches (`claude/quirky-faraday-cd968y` was deleted upstream; `claude/dev` is current), checked out `claude/dev`, ran `npm test` in both `sample-app/` (29/29 green) and `reviewer/` (29/29 green), then hunted adversarially for bugs/weak tests/security holes. Sample-app was already hardened by the prior run (asyncHandler wired into every route, catch-all error middleware, pinned JWT alg) and showed no new issues on inspection. Focus shifted to `reviewer/`, the newest, not-yet-adversarially-reviewed commit.

- **Real bug found and fixed — `errorHandling` rule reasoned file-wide instead of per-handler/per-chain:** `reviewer/src/rules/errorHandling.js` computed `hasTry`/`hasAsyncWrapper`/`hasCatch` once for the *entire* file's added lines, then reused those three booleans for every async handler and every `.then()` call in that file. Reproduced directly: a diff adding two async route handlers to the same file — one correctly wrapped in try/catch, one not — produced **zero** issues, because the first handler's try/catch satisfied `hasTry` for the whole file and silenced the check for the second, unguarded handler. Same false-negative shape for `.then()`/`.catch()`: a diff with one caught chain and one uncaught chain in the same file flagged nothing, because the first chain's `.catch()` satisfied file-wide `hasCatch`. This defeats the rule's entire purpose in any realistically-sized controller file (the sample-app's own controllers have 4-5 handlers per file), and none of the 4 existing rule tests exercised more than one handler/chain per file, so it shipped undetected.
  - Fix: rewrote `check()` to scope the try/catch-or-asyncHandler check to the block from one handler signature up to the next (not the whole file), and the `.catch()` check to a small local window after each `.then()` call (not a file-wide flag).
  - Added a fixture (`error-handling-mixed-handlers.diff`) and 2 regression tests reproducing both false-negative shapes. Suite is now 31/31 green in `reviewer/`.
- **Reviewed, left as-is:** `diffParser.js` labels a deleted file's entry as `/dev/null` (from the `+++ /dev/null` line) rather than the pre-deletion path. Cosmetic only — deleted files have no added lines, so no rule (all of which operate on `collectAddedLines`) is affected. No observed failure, so left unchanged per the "cite an observed failure" rule for self-modification; flagging in case a later task adds a delete-aware rule. Also checked the `AWAIT_IN_FOREACH` regex against a forEach body containing an object literal before the `await` (a plausible brace-nesting false-negative shape) — it matched correctly since the regex isn't brace-depth-aware and doesn't need to be for this pattern.

**Decisions:**
- Did not touch `missing-tests`' `SOURCE_DIR_PATTERN` (`^(src|lib)\/`), which won't match nested-package paths like `sample-app/src/...` if the reviewer is ever run from the repo root — this is the same scope question already open from the task 2 entry (diff-local heuristic vs. repo-aware), not a new bug; task 4 (CLI) is the natural place to revisit it.
- Kept the fix mechanical (block-scoping the existing regex checks) rather than moving to a real JS/AST parser — no observed failure justified that scope, and the existing heuristic style is what the rest of `reviewer/` uses.

**Open questions for Vijay:**
- Should the `errorHandling` rule's per-handler block boundary (next handler signature, or end of file) be made brace-depth-aware instead of signature-to-signature, to guard against a handler containing a nested function that also matches the `async (req, res) =>`-shaped signature regex? No false positive was observed in this run, but it's a plausible edge case worth a decision before task 3 hardens the rule set further.
