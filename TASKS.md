# Backlog. Work top to bottom unless reordering is logged in PROGRESS.md with rationale.
# Mark [DONE] or [BLOCKED: reason]. Never delete tasks — only add or reorder.
1. [DONE] Scaffold sample-app/: minimal Express+Mongo REST API (users, auth, tasks CRUD), Jest, plain JS. `npm test` green.
2. [DONE] Reviewer core: diff -> structured review JSON (risk, issues[]: file/line/category/fix). Categories: security, missing-tests, error-handling, performance, style. Fixture-based unit tests.
3. review-rules.yaml config with MERN defaults; loader + tests.
4. CLI: `npm run review -- <base>..<head>` -> markdown report. Verify against sample-app history.
5. GitHub integration: post review as PR comment (token via env, mocked in tests).
6. Standup module: last 24h commits/PRs -> per-author standup markdown.
7. Doc-drift module: Express routes vs openapi.yaml -> mismatch report.
8. README + mermaid architecture diagram.
9. Skill: .claude/skills/review-pr/SKILL.md — runs the reviewer on a PR and posts results. Follow Claude Code skill-authoring best practices (check official docs in-run).
10. Skill: .claude/skills/standup/SKILL.md — generates standup digest.
11. Package skills as an installable Claude Code plugin (manifest per current plugin docs) so Vijay can install locally: `plugin/` dir + install instructions in README.
12. Skill: .claude/skills/doc-drift/SKILL.md.
13. Self-audit: read all PROGRESS.md entries, write RETRO.md — what failed, what to improve, propose 3 new backlog tasks.
