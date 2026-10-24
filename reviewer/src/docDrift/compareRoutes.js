// Normalizes a route path for comparison across Express and OpenAPI param
// syntax (':id' -> '{id}') and trailing slashes, so the same real route
// written either way compares equal. Express param regex constraints (e.g.
// ':id(\d+)') have no OpenAPI equivalent, so the constraint is dropped along
// with the conversion -- otherwise ':id(\d+)' -> '{id}(\d+)' never matches
// its documented '{id}' counterpart, and the same real, fully-documented
// route is reported as drift on both sides.
// Replaces each ':name' / ':name(constraint)' with '{name}'. The constraint is
// skipped by paren depth, not a [^)]* regex, so a nested group inside it
// (':name(\w+(?:x)?)') is dropped whole instead of leaving a stray ')'.
function replaceParams(routePath) {
  let out = '';
  let i = 0;
  const paramStart = /:([A-Za-z_$][\w$]*)/y;
  while (i < routePath.length) {
    paramStart.lastIndex = i;
    const m = routePath[i] === ':' ? paramStart.exec(routePath) : null;
    if (!m) {
      out += routePath[i];
      i += 1;
      continue;
    }
    out += `{${m[1]}}`;
    i += m[0].length;
    if (routePath[i] === '(') {
      let depth = 0;
      do {
        if (routePath[i] === '\\') i += 1;
        else if (routePath[i] === '(') depth += 1;
        else if (routePath[i] === ')') depth -= 1;
        i += 1;
      } while (i < routePath.length && depth > 0);
    }
  }
  return out;
}

function normalizeRoutePath(routePath) {
  const withBraceParams = replaceParams(routePath);
  if (withBraceParams === '/') return withBraceParams;
  return withBraceParams.replace(/\/$/, '');
}

function routeKey(route) {
  // OpenAPI templating is positional: '/users/{id}' and '/users/{userId}' are
  // the same path, so param names are erased for comparison only.
  return `${route.method.toUpperCase()} ${normalizeRoutePath(route.path).replace(/\{[^}]*\}/g, '{}')}`;
}

// Express 4 optional params (':id?') register both '/users' and '/users/:id'
// from one call, and OpenAPI can only document those as two separate paths.
// Returns every concrete path an optional-param route answers, so a route is
// matched against the spec per form instead of never matching either.
function expandOptionalParams(routePath) {
  // Runs on the brace form so a constrained param (':id(\d+)?') -- whose '?'
  // follows the constraint, not the name -- is recognized once replaceParams
  // has dropped the constraint.
  const m = /\/\{([^}]*)\}\?/.exec(routePath);
  if (!m) return [routePath];
  const before = routePath.slice(0, m.index);
  const after = routePath.slice(m.index + m[0].length);
  return [
    ...expandOptionalParams(`${before}/{${m[1]}}${after}`),
    ...expandOptionalParams(`${before}${after}` || '/'),
  ];
}

function routeKeys(route) {
  return expandOptionalParams(replaceParams(route.path)).map((p) => routeKey({ ...route, path: p }));
}

// Compares the routes actually defined in code against the routes documented
// in an OpenAPI spec, returning:
// - missingFromSpec: routes present in code but not documented in the spec
// - missingFromCode: paths documented in the spec but not implemented in code
// Each list holds the original (non-normalized) route as it appeared on its
// own side, so the report reads naturally in either style.
function compareRoutes(codeRoutes, specRoutes) {
  const specKeys = new Set(specRoutes.flatMap(routeKeys));
  const codeKeys = new Set(codeRoutes.flatMap(routeKeys));

  const missingFromSpecAll = codeRoutes.filter((route) => !routeKeys(route).every((key) => specKeys.has(key)));
  const missingFromCodeAll = specRoutes.filter((route) => !routeKeys(route).every((key) => codeKeys.has(key)));

  // One entry per logical route: a route registered twice (e.g. middleware
  // then handler) or as '/a' and '/a/' is a single piece of drift.
  const uniqueByKey = (routes) => {
    const seen = new Set();
    return routes.filter((route) => {
      const key = routeKey(route);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const byMethodThenPath = (a, b) => (a.method === b.method ? a.path.localeCompare(b.path) : a.method.localeCompare(b.method));
  const missingFromSpec = uniqueByKey(missingFromSpecAll);
  const missingFromCode = uniqueByKey(missingFromCodeAll);
  missingFromSpec.sort(byMethodThenPath);
  missingFromCode.sort(byMethodThenPath);

  return { missingFromSpec, missingFromCode };
}

module.exports = { compareRoutes, normalizeRoutePath };
