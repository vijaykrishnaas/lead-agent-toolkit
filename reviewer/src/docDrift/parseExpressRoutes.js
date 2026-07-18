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
const CHAINED_VERB_PATTERN = new RegExp(`\\.(${VERB_ALTERNATION})\\(`, 'g');

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

  // For each .route(path) call, its chained verbs are whatever
  // .<verb>(...) calls appear between it and the *next* .route(...) call
  // (or end of source) — that span is exactly the chain hanging off this
  // one .route(...), and stopping at the next .route(...) keeps two
  // separate route() chains in the same file from bleeding into each other.
  const routeCalls = [...source.matchAll(ROUTE_CALL_PATTERN)];
  routeCalls.forEach((routeMatch, i) => {
    const path = routeMatch[2];
    const chainStart = routeMatch.index + routeMatch[0].length;
    const chainEnd = i + 1 < routeCalls.length ? routeCalls[i + 1].index : source.length;
    const chainSource = source.slice(chainStart, chainEnd);
    for (const verbMatch of chainSource.matchAll(CHAINED_VERB_PATTERN)) {
      routes.push({ method: verbMatch[1].toUpperCase(), path });
    }
  });

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
