# Progress Log

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
