const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const METHOD_CALL_PATTERN = new RegExp(`\\b(?:router|app)\\.(${HTTP_METHODS.join('|')})\\(\\s*(['"])(.*?)\\2`, 'g');
const MOUNT_PATTERN = /\bapp\.use\(\s*(['"])(.*?)\1\s*,\s*(?:[A-Za-z_$][\w$]*\s*,\s*)*([A-Za-z_$][\w$]*)\s*\)/g;
const REQUIRE_PATTERN = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])(.*?)\2\s*\)/g;

// Extracts { method, path } route entries from a single Express router file's
// source text (e.g. tasks.routes.js). Only router.<verb>(path, ...) calls
// count as routes — router.use(middleware) and similar are ignored because
// the method pattern only matches recognized HTTP verbs.
function parseRouterSource(source) {
  const routes = [];
  for (const match of source.matchAll(METHOD_CALL_PATTERN)) {
    routes.push({ method: match[1].toUpperCase(), path: match[3] });
  }
  return routes;
}

// Extracts the routes defined directly on the app object (e.g. app.get('/health', ...))
// plus the app.use(prefix, router) mounts from an Express entry file's source text
// (e.g. app.js), resolving each mount's router variable back to the file it was
// require()'d from. Any middleware args between the prefix and the router
// (e.g. app.use(prefix, authMiddleware, router)) are tolerated — only the
// final identifier before the closing paren is treated as the router. A mount
// whose variable has no matching require(...) in the same source is skipped
// (e.g. app.use(express.json()), not a route module).
function parseAppEntrySource(source) {
  const directRoutes = [];
  for (const match of source.matchAll(METHOD_CALL_PATTERN)) {
    directRoutes.push({ method: match[1].toUpperCase(), path: match[3] });
  }

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
