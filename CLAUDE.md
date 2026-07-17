Plain JavaScript, Node 20, Jest. Branch: claude/dev only.

HARD INVARIANTS — never edit or weaken these three lines:
1. Every commit must pass `npm test`. If you cannot get green this run, revert and mark task BLOCKED.
2. Never delete backlog tasks or PROGRESS/CHANGELOG history.
3. Every self-modification (skills, CLAUDE.md, backlog order) gets a SKILL_CHANGELOG.md entry: date, change, evidence from PROGRESS.md justifying it.

You MAY improve: .claude/skills/*, this file below the invariants, TASKS.md ordering, review-rules.yaml.
Improvements must cite an observed failure or gap — no speculative rewrites. Skills stay under 150 lines each.
Each run: append dated PROGRESS.md entry (done, decisions, open questions for Vijay).
