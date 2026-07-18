---
name: doc-drift
description: Compares a project's Express routes against its OpenAPI spec using reviewer/src/docDriftCli.js, reporting routes missing from the spec or missing from the code. Use when asked to check for doc drift, verify an OpenAPI spec matches the actual API, or find undocumented/stale routes.
argument-hint: "[app-entry-path] [openapi-path]"
---

## What this does

Parses an Express app's entry file (following its `app.use(prefix, router)`
mounts to each router file) to build the real list of implemented routes,
parses an OpenAPI YAML doc's `paths` map into the same shape, and diffs the
two — reporting routes present in code but missing from the spec, and routes
documented in the spec but missing from the code. One script,
`reviewer/src/docDriftCli.js` (`npm run doc-drift` from `reviewer/`). The
report is printed to stdout (or written to a file with `--out`) — this skill
does not modify either the app source or the spec.

## Before running

1. Confirm the path to the Express app's entry file (the file that calls
   `app.use(...)`/`app.<verb>(...)` and mounts routers, e.g.
   `sample-app/src/app.js`) and the path to the OpenAPI YAML spec (e.g.
   `sample-app/openapi.yaml`). Ask the user for whichever isn't already clear
   from context.
2. Route parsing is regex-based (no AST), following the same style as the
   rest of `reviewer/src`. It follows one level of `app.use(prefix, router)`
   mounts resolved via `require(...)` in the same file — nested sub-router
   mounts (`router.use('/x', subRouter)`) aren't currently followed.

## Running it

From the repo root:

```bash
node reviewer/src/docDriftCli.js \
  --app <path-to-express-entry> --openapi <path-to-openapi.yaml> \
  [--out <file>]
```

- `--app` and `--openapi` are both required.
- `--out <file>` writes the report to a file instead of printing it.

Exit code is `0` on success (whether or not drift was found — drift is a
finding, not a script failure), `1` on any failure (invalid args, unreadable
files, or a malformed spec), always with a clear one-line message on stderr —
never a raw crash.

## After running

Report whether drift was found and list any routes missing from the spec or
missing from the code back to the user. If none, say so plainly (e.g. "No
drift detected.").

## Reference

- The reviewer's overall architecture is documented in the root
  [README.md](../../../README.md).
- `generateDocDrift` (`reviewer/src/docDrift/generateDocDrift.js`) is the
  underlying orchestration this skill's script wraps; `collectExpressRoutes.js`
  and `parseOpenApi.js` are its two data sources, and `compareRoutes.js` does
  the actual diffing.
