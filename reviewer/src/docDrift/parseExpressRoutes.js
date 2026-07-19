const { maskStringLiterals } = require('../utils/maskStringLiterals');
const { HTTP_METHODS } = require('./httpMethods');
const VERB_ALTERNATION = HTTP_METHODS.join('|');
const METHOD_CALL_PATTERN = new RegExp(`\\b(?:router|app)\\.(${VERB_ALTERNATION})\\(\\s*(['"])(.*?)\\2`, 'g');
// Matches both app.use(prefix, router) (in the app entry file) and
// router.use(prefix, subRouter) (a router file mounting a *nested* router
// under a sub-prefix) — the same mount syntax, just on a different receiver
// — so a nested router's own routes aren't dropped when this same parser is
// run recursively against router files, not just the app entry file.
const MOUNT_PATTERN = /\b(?:router|app)\.use\(\s*(['"])(.*?)\1\s*,\s*(?:[A-Za-z_$][\w$]*\s*,\s*)*([A-Za-z_$][\w$]*)\s*\)/g;
const REQUIRE_PATTERN = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])(.*?)\2\s*\)/g;
// Matches router.route('/path') / app.route('/path') so its chained
// .<verb>(...) calls (e.g. .get(fn).post(fn)) can be found separately —
// METHOD_CALL_PATTERN can't see them because the verb call isn't preceded
// by "router."/"app." directly, only by the ").route(...)" chain.
const ROUTE_CALL_PATTERN = /\.route\(\s*(['"])(.*?)\1\s*\)/g;
const CHAINED_VERB_START_PATTERN = new RegExp(`^\\.(${VERB_ALTERNATION})\\(`);

// Walks forward from `chainStart` (right after a .route(path) call)
// collecting only .<verb>(...) calls that are *directly* chained — i.e.
// nothing but whitespace between one call's closing ")" and the next ".".
// Each call's own argument list is skipped by paren-depth (using `masked`,
// a string-literal-safe version of `source` from maskStringLiterals, so a
// stray "(" or ")" inside a string/template literal in a handler body can't
// desync the depth count), not by jumping to the *next* .route() call's
// index — that boundary is unsafe whenever unrelated code (e.g. a separate
// router.<verb>(...) statement) sits between two .route() chains, since it
// would sweep that unrelated statement's own verb call into this chain. See
// CLAUDE.md's per-occurrence-scoping guideline, which names this exact
// "next occurrence's start" shape as unsafe for the same reason.
function collectChainedVerbs(source, masked, chainStart) {
  const verbs = [];
  let pos = chainStart;
  while (pos < source.length) {
    const wsLen = /^\s*/.exec(source.slice(pos))[0].length;
    const afterWs = pos + wsLen;
    const verbMatch = CHAINED_VERB_START_PATTERN.exec(source.slice(afterWs));
    if (!verbMatch) break;
    verbs.push(verbMatch[1].toUpperCase());
    let depth = 1;
    let i = afterWs + verbMatch[0].length;
    while (i < source.length && depth > 0) {
      if (masked[i] === '(') depth += 1;
      else if (masked[i] === ')') depth -= 1;
      i += 1;
    }
    pos = i;
  }
  return verbs;
}

// Extracts { method, path } route entries from a single Express router file's
// source text (e.g. tasks.routes.js). Only router.<verb>(path, ...) calls
// and router.route(path).<verb>(...) chains count as routes — router.use
// (middleware) and similar are ignored because neither pattern matches
// anything but a recognized HTTP verb.
function parseRouterSource(source) {
  const routes = [];
  for (const match of source.matchAll(METHOD_CALL_PATTERN)) {
    routes.push({ method: match[1].toUpperCase(), path: match[3] });
  }

  // For each .route(path) call, its chained verbs are only the .<verb>(...)
  // calls directly chained onto it (see collectChainedVerbs) — not "whatever
  // appears before the next .route() call," which would misattribute an
  // unrelated router.<verb>(...) statement sitting between two chains.
  const { masked } = maskStringLiterals(source);
  for (const routeMatch of source.matchAll(ROUTE_CALL_PATTERN)) {
    const path = routeMatch[2];
    const chainStart = routeMatch.index + routeMatch[0].length;
    for (const method of collectChainedVerbs(source, masked, chainStart)) {
      routes.push({ method, path });
    }
  }

  return routes;
}

// Extracts the routes defined directly on the app/router object (e.g.
// app.get('/health', ...)) plus its own app.use|router.use(prefix, router)
// mounts from an Express source file's text (the app entry file, e.g.
// app.js, or a router file that itself mounts a nested sub-router),
// resolving each mount's router variable back to the file it was
// require()'d from. Any middleware args between the prefix and the router
// (e.g. app.use(prefix, authMiddleware, router)) are tolerated — only the
// final identifier before the closing paren is treated as the router. A mount
// whose variable has no matching require(...) in the same source is skipped
// (e.g. app.use(express.json()), not a route module). directRoutes reuses
// parseRouterSource so router.route(path).<verb>() chains are recognized
// here too, not just plain router.<verb>(path) calls.
function parseAppEntrySource(source) {
  const directRoutes = parseRouterSource(source);

  const requiresByVarName = new Map();
  for (const match of source.matchAll(REQUIRE_PATTERN)) {
    requiresByVarName.set(match[1], match[3]);
  }

  const mounts = [];
  for (const match of source.matchAll(MOUNT_PATTERN)) {
    const [, , prefix, varName] = match;
    const requirePath = requiresByVarName.get(varName);
    if (requirePath) mounts.push({ prefix, requirePath });
  }

  return { directRoutes, mounts };
}

module.exports = { parseRouterSource, parseAppEntrySource };
