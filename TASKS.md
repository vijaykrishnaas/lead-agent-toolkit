# Backlog. Work top to bottom unless reordering is logged in PROGRESS.md with rationale.
# Mark [DONE] or [BLOCKED: reason]. Never delete tasks — only add or reorder.
1. [DONE] Scaffold sample-app/: minimal Express+Mongo REST API (users, auth, tasks CRUD), Jest, plain JS. `npm test` green.
2. [DONE] Reviewer core: diff -> structured review JSON (risk, issues[]: file/line/category/fix). Categories: security, missing-tests, error-handling, performance, style. Fixture-based unit tests.
3. [DONE] review-rules.yaml config with MERN defaults; loader + tests.
4. [DONE] CLI: `npm run review -- <base>..<head>` -> markdown report. Verify against sample-app history.
5. [DONE] GitHub integration: post review as PR comment (token via env, mocked in tests).
6. [DONE] Standup module: last 24h commits/PRs -> per-author standup markdown.
7. [DONE] Doc-drift module: Express routes vs openapi.yaml -> mismatch report.
8. [DONE] README + mermaid architecture diagram.
9. [DONE] Skill: .claude/skills/review-pr/SKILL.md — runs the reviewer on a PR and posts results. Follow Claude Code skill-authoring best practices (check official docs in-run).
10. [DONE] Skill: .claude/skills/standup/SKILL.md — generates standup digest.
11. [DONE] Package skills as an installable Claude Code plugin (manifest per current plugin docs) so Vijay can install locally: `plugin/` dir + install instructions in README.
12. [DONE] Skill: .claude/skills/doc-drift/SKILL.md.
13. [DONE] Self-audit: read all PROGRESS.md entries, write RETRO.md — what failed, what to improve, propose 3 new backlog tasks.
14. Package `doc-drift` into `plugin/` for parity with `review-pr`/`standup`; generalize `plugin.test.js`'s copy-drift guard to enumerate `.claude/skills/*` instead of a hardcoded list. (Proposed in RETRO.md, 2026-07-18 self-audit.)
15. Extract a shared `collectBoundedBlock`-style helper into `reviewer/src/utils/` and refactor `errorHandling.js`/`performance.js` to use it for per-occurrence block-boundary scoping. (Proposed in RETRO.md, 2026-07-18 self-audit — see SKILL_CHANGELOG.md for the four recurrences of this bug class this closes off structurally.)
16. Make `review-pr`'s PR-comment posting update an existing bot comment in place instead of always creating a new one. (Proposed in RETRO.md, 2026-07-18 self-audit — resolves the open question first raised in the task-5 PROGRESS.md entry and restated in task-9's.)
