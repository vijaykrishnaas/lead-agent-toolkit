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
