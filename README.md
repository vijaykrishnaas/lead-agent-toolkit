# lead-agent-toolkit

Two self-contained Node 20 / plain-JavaScript packages:

- **`sample-app/`** — a minimal Express + Mongoose REST API (auth, users, tasks CRUD) that exists as a realistic MERN-style target for `reviewer/` to analyze and demo against.
- **`reviewer/`** — a diff-scanning code review toolkit: turns a git diff into a structured, categorized review (security, error-handling, missing-tests, performance, style), plus a standup-digest generator and an Express-routes-vs-OpenAPI-spec doc-drift checker.

Each package keeps its own `package.json`/`node_modules` and its own `npm test`, plus the repo-root `package.json` runs both in sequence — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml) for the CI matrix (Node 20 + 22). A blocking `invariant-lint` job mechanically enforces CLAUDE.md's hard invariants 2 and 3 against each push/PR's diff (`scripts/invariantLint.js`): it fails if a diff deletes an existing TASKS.md task, removes PROGRESS.md/SKILL_CHANGELOG.md history, or substantively changes TASKS.md's backlog (an added task, edited wording, or reordering) — or touches CLAUDE.md/`.claude/skills/**` — without a paired SKILL_CHANGELOG.md addition in the same diff; marking an existing task `[DONE]`/`[BLOCKED: ...]` in place is exempt. On every push, a separate non-blocking `dogfood` job also runs the `reviewer` CLI against that push's own diff and uploads the markdown report as a build artifact — this repo's own commits are the richest available real-world input for `reviewer`'s rules, and the job's failures never fail the workflow (`continue-on-error: true`).

```bash
npm run install:all   # installs reviewer/ and sample-app/ deps
npm test               # runs both packages' suites
```

## Architecture

```mermaid
flowchart TB
    subgraph sampleapp["sample-app/ (demo target)"]
        routes["routes/*.routes.js"] --> controllers["controllers/*Controller.js"]
        controllers --> asyncHandler["middleware/asyncHandler.js"]
        controllers --> models["models/User.js, Task.js"]
        auth["middleware/auth.js"] --> routes
        app["app.js"] --> routes
        app --> errorMiddleware["catch-all error middleware"]
        server["server.js"] --> app
        server --> db["config/db.js (MongoDB)"]
    end

    subgraph reviewer["reviewer/"]
        git[("git diff / repo")] --> diffParser["diffParser.js"]
        diffParser --> rulesEngine["reviewer.js: reviewDiff()"]

        subgraph rules["rules/*"]
            security["security.js"]
            errorHandling["errorHandling.js"]
            missingTests["missingTests.js"]
            performance["performance.js"]
            style["style.js"]
        end
        rulesEngine --> rules

        yamlConfig[("review-rules.yaml")] --> configLoader["config/loadRules.js"]
        configLoader --> rulesEngine

        rulesEngine --> markdownReport["format/markdownReport.js"]
        markdownReport --> cli["cli.js: npm run review"]
        markdownReport --> postComment["github/postReviewComment.js"]
        postComment --> githubApi[("GitHub REST API")]

        commits[("git log")] --> collectCommits["standup/collectCommits.js"]
        prs[("GitHub PRs API")] --> collectPRs["standup/collectPullRequests.js"]
        collectCommits --> groupByAuthor["standup/groupByAuthor.js"]
        collectPRs --> groupByAuthor
        groupByAuthor --> formatStandup["standup/formatStandup.js"]

        appEntry[("Express app entry + routers")] --> parseRoutes["docDrift/parseExpressRoutes.js"]
        openapi[("openapi.yaml")] --> parseOpenApi["docDrift/parseOpenApi.js"]
        parseRoutes --> compareRoutes["docDrift/compareRoutes.js"]
        parseOpenApi --> compareRoutes
        compareRoutes --> formatDocDrift["docDrift/formatDocDrift.js"]
        formatDocDrift --> docDriftCli["docDriftCli.js: npm run doc-drift"]
    end

    routes -.diffed / scanned.-> git
    app -.routes.-> appEntry
```

## `sample-app/`

Minimal Express + Mongoose REST API, plain JS.

- **Auth:** `POST /api/auth/register`, `POST /api/auth/login` — bcrypt password hashing, JWT (HS256, pinned algorithm).
- **Users:** `GET /api/users/me`, `GET /api/users/:id`, `PUT /api/users/:id`, `DELETE /api/users/:id` (JWT-protected, self-only for write/delete).
- **Tasks:** full CRUD under `/api/tasks`, scoped to the authenticated owner.
- `GET /health`, JSON 404 fallback, and a catch-all error middleware (every async handler is wrapped via `middleware/asyncHandler.js` so rejected promises can't hang a request).
- `openapi.yaml` at the package root documents all routes; kept in sync with the code and checked by `reviewer/`'s doc-drift module.

```bash
cd sample-app
npm install
npm test    # Jest + Supertest tests, models mocked (no live MongoDB needed)
npm start   # requires a real MONGO_URI
```

## `reviewer/`

### Code review: diff → structured findings

`reviewDiff(diffText, rules)` parses a unified diff and runs it through pluggable rule modules (`security`, `error-handling`, `missing-tests`, `performance`, `style`), each scoped to the individual block/occurrence being checked (not aggregated file-wide — see `CLAUDE.md`). Rules and their severities are configurable via the repo-root `review-rules.yaml`.

```bash
cd reviewer
npm install
npm test
npm run review -- <base>..<head>        # markdown report to stdout
npm run review -- <base>..<head> --out report.md
```

Findings can also be posted directly to a PR via `github/postReviewComment.js` (`GITHUB_TOKEN` from the environment).

### Standup digest

`standup/generateStandup({ repo, owner, ghRepo, since }, deps)` collects the last N hours of commits (`git log`) and pull requests (GitHub REST API), groups them by author, and renders a per-author markdown digest.

```bash
npm run standup -- [--owner <owner> --gh-repo <name>] [--since <iso-date>] [--out report.md]
```

### Doc-drift: routes vs. OpenAPI spec

`docDrift/generateDocDrift` parses an Express app's routes (entry file + mounted routers) and an OpenAPI YAML doc, then diffs the two route lists.

```bash
npm run doc-drift -- --app <path/to/app.js> --openapi <path/to/openapi.yaml> [--out report.md]
```

## Claude Code plugin

The `review-pr`, `standup`, and `doc-drift` skills are also packaged as an
installable Claude Code plugin at `plugin/` — install it once and invoke the
skills as `/lead-agent-toolkit:review-pr`, `/lead-agent-toolkit:standup`, and
`/lead-agent-toolkit:doc-drift` from any project, instead of relying on this
repo's standalone `.claude/skills/` (`plugin/skills/*` are exact copies of
`.claude/skills/*`; both need to stay in sync, which
`reviewer/tests/plugin.test.js` checks against every directory under
`.claude/skills/`, not a hardcoded list).

**Skills are edited only under `.claude/skills/`** — never edit a file under
`plugin/skills/` directly, since the next sync overwrites it. After changing
a skill, run:

```bash
npm run sync-plugin
```

from the repo root (`scripts/syncPlugin.js`) to mirror `.claude/skills/*`
into `plugin/skills/*` (copies new/changed files, removes anything under
`plugin/skills/` that no longer exists in `.claude/skills/`), then re-run
`npm test` so `reviewer/tests/plugin.test.js`'s byte-parity check and
`reviewer/tests/syncPlugin.test.js` both confirm the two trees agree.

**Test it for a single session**, from the repo root:

```bash
claude --plugin-dir ./plugin
```

**Install it persistently** (survives across sessions/projects), from the
repo root:

```bash
claude
> /plugin marketplace add ./plugin
> /plugin install lead-agent-toolkit@lead-agent-toolkit-plugins
```

Either way, the skills' underlying scripts (`reviewer/src/reviewPrCli.js`,
`reviewer/src/standupCli.js`) are invoked with `node`, so run them from a
shell that's `cd`'d into (or pass `--repo` pointing at) a checkout of this
repo — the plugin doesn't bundle its own copy of `reviewer/`.

## Project conventions

- Plain JavaScript, Node 20, Jest — no TypeScript, no AST parser (rules use scoped regex/heuristics over diff text, consistent with the rest of the codebase).
- All I/O (`git`, `fetch`, filesystem) is dependency-injected into orchestration functions (`runCli`, `generateStandup`, `postReviewComment`, ...) so tests never shell out or hit the network.
- Full history of decisions, bugs found/fixed, and open questions lives in `PROGRESS.md`; self-modification history (CLAUDE.md guideline changes) lives in `SKILL_CHANGELOG.md`; the backlog lives in `TASKS.md`.
