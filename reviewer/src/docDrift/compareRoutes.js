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

// Compares the routes actually defined in code against the routes documented
// in an OpenAPI spec, returning:
// - missingFromSpec: routes present in code but not documented in the spec
// - missingFromCode: paths documented in the spec but not implemented in code
// Each list holds the original (non-normalized) route as it appeared on its
// own side, so the report reads naturally in either style.
function compareRoutes(codeRoutes, specRoutes) {
  const specKeys = new Set(specRoutes.map(routeKey));
  const codeKeys = new Set(codeRoutes.map(routeKey));

  const missingFromSpec = codeRoutes.filter((route) => !specKeys.has(routeKey(route)));
  const missingFromCode = specRoutes.filter((route) => !codeKeys.has(routeKey(route)));

  const byMethodThenPath = (a, b) => (a.method === b.method ? a.path.localeCompare(b.path) : a.method.localeCompare(b.method));
  missingFromSpec.sort(byMethodThenPath);
  missingFromCode.sort(byMethodThenPath);

  return { missingFromSpec, missingFromCode };
}

module.exports = { compareRoutes, normalizeRoutePath };
